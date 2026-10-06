// The "stage": the picture of the at-bat at the top of the game screen. It shows the 3D stadium
// (scene3d.js) when the browser supports WebGL, and the flat 2D scene (scene.js) otherwise or when
// the user turns 3D off in Settings. The game screen only talks to this file:
//
//   const stage = createStage(element, { colors });
//   stage.update(gameState);            // every time the game state changes
//   stage.hit(historyRow, gameState);   // when an at-bat just ended in a hit
//   stage.dispose();                    // when leaving the screen

import { getSettings, saveSettings } from "../settings.js";
import { teamColor, esc, pct } from "../util.js";
import { countMood, sceneHtml, resultSceneHtml, playResult } from "./scene.js";
import { playCrack, playCheer } from "../audio.js";
import { typeColor } from "../pitchdata.js";
import { webglAvailable } from "./gl.js";
import { getVenue, wallColor } from "../venues.js";

// The camera views (their positions live in scene3d.js; this is just the buttons)
const VIEW_BUTTONS = [["catcher", "Catcher"], ["side", "Side"], ["pitcher", "Pitcher"], ["center", "Center field"], ["top", "Overhead"]];

const handWord = (h) => (h === "L" ? "left" : "right");

export function createStage(host, { colors, compact = false }) {
  let mode = null;              // "3d" or "2d"
  let stage3d = null;           // the Three.js stage, once loaded
  let state = null;             // the latest game state
  let disposed = false;

  // 2D bookkeeping (same idea as before: don't redraw unless something visible changed)
  let sceneKey = null;
  let busyUntil = 0, busyTimer = null;

  // 3D bookkeeping
  let lastAtBat = null, lastPitchCount = 0, lastPitch = null, lastHit = null;
  let currentPitches = [];      // the pitches of the at-bat on screen (for "replay this pitch")
  let chipTimer = null;
  let venue = null, venueId = null; // this game's ballpark (loaded once per venue)

  // The "speed gun": a little readout of the pitch's speed and type when it is thrown.
  function showPitchChip(pitch) {
    const chip = host.querySelector(".pitch-chip");
    if (!chip || !pitch) return;
    const parts = [pitch.speed ? `${pitch.speed.toFixed(1)} mph` : null, pitch.type || null].filter(Boolean);
    if (!parts.length) return;
    chip.innerHTML = `<i class="chip-dot" style="background:${typeColor(pitch.typeCode)}"></i>${esc(parts.join("  ·  "))}`;
    chip.hidden = false;
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => { chip.hidden = true; }, 3200);
  }

  let ready = Promise.resolve();   // resolves once the 3D scene (if any) is on the page

  const wantsThree = () => getSettings().visual !== "2d" && webglAvailable();

  // ---------------------------------------------------------------- building the DOM
  function build(nextMode) {
    mode = nextMode;
    if (stage3d) { stage3d.dispose(); stage3d = null; }
    sceneKey = null; lastAtBat = null;
    const toggle = webglAvailable()
      ? `<button type="button" class="chip-btn" data-stage="mode">${mode === "3d" ? "Switch to 2D" : "Switch to 3D"}</button>` : "";
    if (mode === "3d") {
      host.innerHTML = `
        <div class="stage-view">
          <div class="stage-canvas-host"></div>
          <div class="stage-hud" aria-hidden="true"></div>
          <div class="stage-banner" hidden></div>
          <div class="pitch-chip" hidden></div>
        </div>
        <div class="stage-controls" role="toolbar" aria-label="Camera and tools">
          ${VIEW_BUTTONS.map(([k, label]) => `<button type="button" class="chip-btn" data-view="${k}">${label}</button>`).join("")}
        </div>
        <div class="stage-controls tools">
          <button type="button" class="chip-btn" data-stage="pitch">Replay pitch</button>
          ${compact ? "" : `<button type="button" class="chip-btn" data-stage="hit">Replay last hit</button>`}
          <button type="button" class="chip-btn" data-stage="snap">Snapshot</button>
          ${toggle}
        </div>
        <div class="stage-caption"></div>
        <p class="note stage-tip">Drag to look around. Pinch or scroll to zoom. Double-tap to reset.</p>`;
    } else {
      host.innerHTML = `<div class="flat-scene"></div>${toggle ? `<div class="stage-controls tools">${toggle}</div>` : ""}`;
    }
  }

  async function start3d() {
    try {
      const { createStage3d } = await import("./scene3d.js");
      if (disposed) return;
      build("3d");
      const view = host.querySelector(".stage-canvas-host");
      stage3d = createStage3d(view, {
        onView: (name) => {
          for (const b of host.querySelectorAll("[data-view]")) b.classList.toggle("on", b.dataset.view === name);
        },
        onBanner: (title, detail, big) => {
          const el = host.querySelector(".stage-banner");
          if (!el) return;
          el.className = "stage-banner" + (big ? " big" : "");
          el.innerHTML = `<b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}`;
          el.hidden = false;
          playCheer(!!big);
        },
        onContact: () => playCrack(),
        onBannerHide: () => { const el = host.querySelector(".stage-banner"); if (el) el.hidden = true; },
        onHitDone: () => { busyUntil = 0; if (state) update(state); },
      });
      host.querySelector('[data-view="catcher"]')?.classList.add("on");
      if (state) update(state);
    } catch (error) {
      console.warn("3D view unavailable, using the flat scene instead:", error);
      build("2d");
      if (state) update(state);
    }
  }

  // ---------------------------------------------------------------- updating
  function teams(s) {
    const awayBats = /^Top/.test(s.inningLabel);
    return { batting: awayBats ? s.away : s.home, fielding: awayBats ? s.home : s.away };
  }

  function dotsHtml(n, max, cls) {
    return Array.from({ length: max }, (_, i) => `<i class="hud-dot ${cls} ${i < n ? "on" : ""}"></i>`).join("");
  }

  // Build the stage (3D if possible). update() does this on its first call; screens that only
  // replay pitches (the Saved screen) call it directly.
  function init() {
    if (mode) return;
    if (wantsThree()) { build("2d"); ready = start3d(); } else build("2d");
  }

  function update(s) {
    state = s;
    if (disposed) return;
    if (!mode) init(); // first call
    if (Date.now() < busyUntil) return;
    if (!s.current || !s.isLive) { host.hidden = true; sceneKey = null; return; }
    host.hidden = false;
    const mood = countMood(s.balls, s.strikes);
    const spike = s.current.prediction.timesLeague >= getSettings().spikeMultiple;
    const { batting, fielding } = teams(s);
    const common = {
      batSide: s.current.batter.side, pitchHand: s.current.pitcher.hand,
      batterId: s.current.batter.id, pitcherId: s.current.pitcher.id,
      batColor: teamColor(colors, batting.id), pitchColor: teamColor(colors, fielding.id),
    };

    if (mode === "3d" && stage3d) {
      if (s.venueId && s.venueId !== venueId) {
        venueId = s.venueId;
        venue = null;
        getVenue(venueId).then((v) => { if (venueId === s.venueId && !disposed) { venue = v; if (state) update(state); } });
      }
      if (venue) stage3d.setVenue({ ...venue, wallColor: wallColor(venue.id, teamColor(colors, s.home.id)) });
      stage3d.setPlayers(common);
      stage3d.setMood({ balls: s.balls, strikes: s.strikes, spike });
      const pitches = s.current.pitches || [];
      const withZone = pitches.find((p) => Number.isFinite(p.top));
      stage3d.setZone(pitches, withZone?.top ?? 3.4, withZone?.bottom ?? 1.6);
      // a new pitch since last time in this at-bat: throw it
      const key = `${s.current.batter.id}|${s.current.atBatIndex}`;
      currentPitches = pitches;
      if (key === lastAtBat && pitches.length > lastPitchCount) { lastPitch = pitches[pitches.length - 1]; stage3d.throwPitch(lastPitch); showPitchChip(lastPitch); }
      else if (key !== lastAtBat) lastPitch = pitches[pitches.length - 1] || null;
      lastAtBat = key; lastPitchCount = pitches.length;
      host.querySelector(".stage-hud").innerHTML =
        `<div class="hud-col"><span>BALLS</span><div>${dotsHtml(s.balls, 3, "hud-ball")}</div><span>STRIKES</span><div>${dotsHtml(s.strikes, 2, "hud-strike")}</div></div>` +
        `<div class="hud-col right"><span>OUTS</span><div>${dotsHtml(s.outs, 2, "hud-out")}</div></div>`;
      host.querySelector(".stage-caption").innerHTML =
        `<div class="scene-caption"><b>${esc(mood.label)}</b> <span>${esc(mood.text)}</span></div>
         <div class="scene-hands"><span>Bats <b>${handWord(common.batSide)}</b></span><span>Pitcher throws <b>${handWord(common.pitchHand)}</b></span></div>`;
      return;
    }

    // ---- the flat 2D scene
    const flat = sceneHtml({ ...common, balls: s.balls, strikes: s.strikes, outs: s.outs, spike });
    if (flat.key !== sceneKey) { host.querySelector(".flat-scene").innerHTML = flat.html; sceneKey = flat.key; }
  }

  // ---------------------------------------------------------------- a hit
  function hit(row, s) {
    state = s || state;
    if (disposed || !row?.hit) return;
    const batting = row.isTop ? s.away : s.home;
    const fielding = row.isTop ? s.home : s.away;
    const info = {
      hit: row.hit, event: row.hit.event, batterName: row.batterName,
      batSide: row.situation.batSide, pitchHand: row.situation.pitchHand,
      batterId: row.situation.batterId, pitcherId: row.situation.pitcherId,
      batColor: teamColor(colors, batting.id), pitchColor: teamColor(colors, fielding.id),
      pitch: row.lastPitch,
    };
    host.hidden = false;
    if (mode === "3d" && stage3d) {
      lastHit = info;
      busyUntil = Date.now() + stage3d.playHit(info) + 400;
      return;
    }
    // 2D replay (the sounds are timed by hand here)
    setTimeout(playCrack, 880);
    setTimeout(() => playCheer(row.hit.event === "home_run"), 1750);
    const replay = resultSceneHtml({ ...info, balls: 0, strikes: 0, outs: s.outs });
    const el = host.querySelector(".flat-scene");
    el.innerHTML = replay.html;
    sceneKey = null;
    playResult(el);
    busyUntil = Date.now() + replay.durationMs;
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { busyUntil = 0; if (state) update(state); }, replay.durationMs);
  }

  // ---------------------------------------------------------------- buttons
  async function onClick(event) {
    const view = event.target.closest("[data-view]");
    if (view && stage3d) { stage3d.setView(view.dataset.view); return; }
    const tool = event.target.closest("[data-stage]");
    if (!tool) return;
    const action = tool.dataset.stage;
    if (action === "mode") {
      busyUntil = 0; // (a replay in progress is simply dropped)
      saveSettings({ visual: mode === "3d" ? "2d" : "3d" });
      if (mode === "3d") { build("2d"); if (state) update(state); }
      else if (webglAvailable()) { build("2d"); ready = start3d(); }
    } else if (action === "pitch" && stage3d && lastPitch) {
      stage3d.throwPitch(lastPitch, { showPath: true }); showPitchChip(lastPitch);
    } else if (action === "hit" && stage3d && lastHit) {
      busyUntil = Date.now() + stage3d.playHit(lastHit) + 400;
    } else if (action === "snap" && stage3d) {
      const blob = await stage3d.snapshot();
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hr-meter-snapshot.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  }
  host.addEventListener("click", onClick);

  const onTheme = () => stage3d?.refreshTheme();
  window.addEventListener("themechange", onTheme);

  // Replay one pitch of the current at-bat (tapped in the strike-zone card) in the 3D scene.
  function replayPitch(n) {
    const pitch = currentPitches.find((p) => p.n === n);
    if (!pitch || !stage3d) return;
    stage3d.throwPitch(pitch, { showPath: true });
    showPitchChip(pitch);
  }

  /**
   * Replay ANY pitch of the game (from the Pitch finder or the Saved screen): put that at-bat's
   * pitcher and batter on the field, fly the ball along its real path and draw the path.
   * Returns false if there is no 3D scene (the caller then shows a flat view instead).
   */
  function replayFull(ctx, pitch) {
    if (mode !== "3d" || !stage3d) return false;
    stage3d.setPlayers({
      batSide: ctx.batter.side, pitchHand: ctx.pitcher.hand, batterId: ctx.batter.id, pitcherId: ctx.pitcher.id,
      batColor: teamColor(colors, ctx.battingTeamId), pitchColor: teamColor(colors, ctx.fieldingTeamId),
    });
    stage3d.setMood({ balls: pitch.balls ?? 0, strikes: pitch.strikes ?? 0, spike: false });
    stage3d.setZone([pitch], pitch.top ?? 3.4, pitch.bottom ?? 1.6);
    lastPitch = pitch; currentPitches = [pitch]; // (so "Replay pitch" repeats this one)
    const seconds = stage3d.throwPitch(pitch, { showPath: true });
    showPitchChip(pitch);
    host.hidden = false;
    // leave the scene alone while it plays and the path lingers, then go back to the live at-bat
    busyUntil = Date.now() + (seconds + 6.5) * 1000;
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { busyUntil = 0; if (state) { stage3d?.clearPath(); lastAtBat = null; update(state); } }, (seconds + 6.5) * 1000);
    return true;
  }

  const api = {
    update, hit, replayPitch, replayFull, init, whenReady: () => ready,
    get stage3d() { return stage3d; },
    get mode() { return mode; },
    dispose() {
      disposed = true;
      clearTimeout(busyTimer); clearTimeout(chipTimer);
      host.removeEventListener("click", onClick);
      window.removeEventListener("themechange", onTheme);
      stage3d?.dispose();
    },
  };
  host.stageApi = api; // (handy for testing in the browser console)
  return api;
}
