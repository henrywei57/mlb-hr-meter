// Screen 2: the game screen. Top to bottom:
//   score + situation  ->  scene  ->  batter vs pitcher  ->  Home Run Meter  ->  "Why"  ->  at-bat history
//
// This file only DRAWS. The numbers come from a "source" (src/sources.js) that hands us a
// game state each time something changes, and from model.js via scoreState().

import { esc, pct, timeAgo, textOn, teamColor, saveLocal, loadLocal } from "../util.js";
import { predictHomeRun } from "../model.js";
import { getSettings } from "../settings.js";
import { THEMES, currentTheme, nextTheme, applyTheme } from "../theme.js";
import { diamondSvg } from "./diamond.js";
import { whyHtml } from "./why.js";
import { zoneHtml } from "./zone.js";
import { drawWinProbability } from "./wp.js";
import { loadSaved, storeSaved, makeSaved, toggleSaved, isSaved, pitchId } from "../saved.js";
import { pitchKind, resultText, fastestKeys, typeColor } from "../pitchdata.js";
import { showPitchDialog } from "./pitchdialog.js";
import { createStage } from "./stage.js";

const handWord = (h) => (h === "L" ? "Left" : "Right");

// Buzz the phone on a spike. iPhone Safari has no navigator.vibrate, so we check first and
// swallow any error: this must never be able to break the screen.
function buzz(pattern = [200, 100, 200]) {
  try {
    if (getSettings().vibrate && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch { /* not supported or blocked: ignore */ }
}

export function showGame(root, { gamePk, rates: defaultRates, colors, makeSource }) {
  root.innerHTML = `
    <header class="top">
      <a class="back" href="#/">‹ Games</a>
      <span class="header-right"><button type="button" id="theme-btn" class="theme-btn" title="Switch theme"></button><span id="chip" class="chip"></span></span>
    </header>
    <div id="demo-bar" class="demo-bar replay-bar" hidden>
      <div class="rb-row"><b id="rb-title">Replay</b><span class="spacer"></span>
        <button id="pause" type="button">Pause</button><button id="restart" type="button">Restart</button></div>
      <div class="rb-row"><button type="button" id="rb-prev" aria-label="Previous at-bat">‹</button>
        <input type="range" id="rb-seek" min="0" max="0" value="0" aria-label="Scrub through the game">
        <button type="button" id="rb-next" aria-label="Next at-bat">›</button></div>
      <div class="rb-row rb-meta"><span id="rb-label" class="muted"></span><span class="spacer"></span>
        <label>Speed <select id="rb-speed"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option><option value="8">8x</option></select></label>
        <label>Inning <select id="rb-inning" aria-label="Jump to inning"></select></label>
        <button type="button" id="rb-end">To end</button></div>
      <p id="rb-note" class="note" hidden></p>
    </div>
    <div id="banner" class="banner" hidden></div>
    <div class="game-grid"><div class="col-main">
    <section id="score" class="card score"></section>
    <section id="wp" class="card wp"></section>
    <section id="scene" class="card scene" hidden></section>
    <section id="matchup" class="card"></section>
    <section id="extras" class="extras" hidden>
      <div class="extra-tile" id="x-hr">
        <div class="extra-label">Home run chance <span id="m-est" class="estimate" hidden>est.</span></div>
        <div class="extra-number" id="x-hr-n">–</div>
        <div class="extra-ref" id="x-hr-r"></div>
      </div>
      <div class="extra-tile">
        <div class="extra-label">Expected total bases</div>
        <div class="extra-number" id="x-tb-n">–</div>
        <div class="extra-ref" id="x-tb-r"></div>
      </div>
      <div class="extra-tile">
        <div class="extra-label">Strikeout chance</div>
        <div class="extra-number" id="x-k-n">–</div>
        <div class="extra-ref" id="x-k-r"></div>
      </div>
    </section>
    <p class="kbd-hint">Replays: <kbd>Space</kbd> pause or resume · <kbd>←</kbd> <kbd>→</kbd> step through at-bats</p>
    </div><div class="col-side">
    <section id="zone" class="card zone" hidden></section>
    <section id="finder" class="card finder"></section>
    <section id="why" class="card" hidden></section>
    <section id="history" class="card"></section>
    </div></div>`;

  const $ = (id) => root.querySelector("#" + id);
  // The rates in use: a replay of an older game loads that season's own rates file.
  const activeRates = () => source.rates || defaultRates;
  const wpEl = $("wp");
  const hrTile = $("x-hr");
  // On a computer the win probability card sits at the top of the right column; on a phone it stays
  // in the single column, right under the score.
  const wide = window.matchMedia("(min-width: 960px)");
  const placeMeter = () => {
    if (wide.matches) root.querySelector(".col-side").prepend(wpEl);
    else $("score").after(wpEl);
  };
  placeMeter();
  wide.addEventListener("change", placeMeter);
  // Quick theme switch: tap to cycle through the themes.
  const themeBtn = $("theme-btn");
  const showThemeName = () => { themeBtn.textContent = `Theme: ${THEMES[currentTheme()].label}`; };
  themeBtn.addEventListener("click", () => { applyTheme(nextTheme(), true); showThemeName(); });
  showThemeName();

  let state = null;
  let lastUpdate = 0; // when we last got fresh data
  let offline = false;
  let lastSpikeKey = null;
  let openPitch = null;           // pitch number tapped in the strike zone card
  let saved = loadSaved();        // pitches you saved (on this device)
  let finderFilter = "all";       // Pitch finder filter: all | strike | ball | play | fast
  let finderTouched = false;      // false until you open/close an inning yourself (then we stop auto-opening the latest)
  const openInnings = new Set();  // innings you have opened in the Pitch finder
  let finderIndex = new Map();    // "atBatIndex-n" -> { row, pitch } for the pitches on screen
  const openWhy = new Set();      // "Why" rows whose tip is expanded
  const openHist = new Set();     // history rows that are expanded
  let whatIfCount = null;         // count picked in the "try another count" grid, e.g. "3-1"

  // ---------------------------------------------------------------- drawing
  function drawScore(s) {
    const awayColor = teamColor(colors, s.away.id);
    const homeColor = teamColor(colors, s.home.id);
    root.style.setProperty("--away", awayColor);
    root.style.setProperty("--home", homeColor);
    const team = (t, color, batting) => `
      <div class="team ${batting ? "batting" : ""}" style="background:${color};color:${textOn(color)}">
        <span class="team-name">${batting ? "▸ " : ""}${esc(t.name)}</span>
        <b class="team-score">${t.score}</b>
      </div>`;
    const awayBats = s.isLive && /^Top/.test(s.inningLabel);
    const homeBats = s.isLive && /^Bot/.test(s.inningLabel);
    const outsDots = [0, 1, 2].map((i) => `<i class="out ${i < s.outs ? "on" : ""}"></i>`).join("");
    $("score").innerHTML = `
      <div class="teams-row">${team(s.away, awayColor, awayBats)}${team(s.home, homeColor, homeBats)}</div>
      <div class="situation">
        ${diamondSvg(s.runners)}
        <div class="sit-text">
          <div class="inning">${esc(s.inningLabel || s.statusLabel)}</div>
          ${s.isLive ? `<div class="outs">${outsDots}<span>${s.outs} out${s.outs === 1 ? "" : "s"}</span></div>
          <div class="count">Count <b>${s.balls}-${s.strikes}</b> <span class="muted">(balls-strikes)</span></div>` : ""}
        </div>
      </div>`;
    const chip = $("chip");
    chip.textContent = s.isFinal ? "Final" : source.isReplay ? "Replay" : s.isLive ? "Live" : s.statusLabel;
    chip.className = "chip " + (s.isLive && !source.isReplay ? "live" : "");
  }

  // The picture of the at-bat (3D stadium, or the flat 2D scene). It lives in stage.js.
  const stage = createStage($("scene"), { colors });
  let seenHistory = null;   // how many finished at-bats we'd already seen (to spot new hits)

  // When a new at-bat finishes with a hit, replay it on the stage: the swing and the ball flying out.
  function checkForNewHit(s) {
    if (seenHistory === null || s.history.length < seenHistory) { seenHistory = s.history.length; return; } // first load or demo restart
    const fresh = s.history.slice(seenHistory);
    seenHistory = s.history.length;
    const row = [...fresh].reverse().find((r) => r.hit);
    if (row) stage.hit(row, s);
  }

  function drawMatchup(s) {
    const el = $("matchup");
    if (!s.current) {
      el.innerHTML = `<p class="muted">${s.isFinal ? "Game over." : "No at-bat in progress."}</p>`;
      return;
    }
    const { batter, pitcher, batterLine } = s.current;
    const line = batterLine
      ? `<span>AVG <b>${esc(batterLine.avg)}</b></span><span>HR <b>${esc(batterLine.hr)}</b></span><span>OPS <b>${esc(batterLine.ops)}</b></span>`
      : `<span class="muted">Season stats unavailable</span>`;
    el.innerHTML = `
      <div class="matchup-head">
        <div><div class="role">Batting</div><div class="player">${esc(batter.name)}</div></div>
        <div class="hands" title="${handWord(batter.side)}-handed batter vs ${handWord(pitcher.hand).toLowerCase()}-handed pitcher">${batter.side} vs ${pitcher.hand}</div>
        <div class="right"><div class="role">Pitching</div><div class="player">${esc(pitcher.name)}</div></div>
      </div>
      <div class="stat-line">${line}<span class="muted">season</span></div>`;
  }

  function drawZone(s) {
    const el = $("zone");
    el.hidden = !s.current;
    if (s.current) {
      const actions = (p) => {
        const id = pitchId(s.game.pk, s.current.atBatIndex, p.n);
        const on = isSaved(saved, id);
        return `<div class="zone-actions"><button type="button" class="chip-btn" data-replay-pitch="${s.current.atBatIndex}-${p.n}">Replay with flight path</button>
          <button type="button" class="chip-btn ${on ? "on" : ""}" data-save-pitch="${s.current.atBatIndex}-${p.n}">${on ? "Saved" : "Save this pitch"}</button></div>`;
      };
      el.innerHTML = zoneHtml(s.current.pitches, openPitch, actions);
    }
  }

  // The home run chance tile (it glows on a spike) and the "Why" breakdown under it.
  function drawHr(s) {
    const prediction = s.current?.prediction;
    if (!prediction) {
      $("x-hr-n").textContent = "–";
      $("x-hr-r").textContent = "";
      $("m-est").hidden = true;
      hrTile.classList.remove("spike");
      $("why").hidden = true;
      return;
    }
    $("x-hr-n").textContent = pct(prediction.probability);
    $("x-hr-r").textContent = `${prediction.timesLeague.toFixed(1)}x league avg (${pct(prediction.leagueRate)})`;
    $("m-est").hidden = !prediction.isEstimate;

    // Spike cue: glow/pulse while the chance is high; buzz once when a new spike starts.
    const spike = prediction.timesLeague >= getSettings().spikeMultiple;
    hrTile.classList.toggle("spike", spike);
    const key = spike ? `${s.current.batter.id}-${s.balls}-${s.strikes}` : null;
    if (key && key !== lastSpikeKey) buzz();
    lastSpikeKey = key;

    $("why").hidden = false;
    $("why").innerHTML = whyHtml(prediction, s.current.situation, openWhy) + whatIfHtml(s);
  }

  // "Try another count": what the chance would be at each count, same batter and pitcher.
  function whatIfHtml(s) {
    const sit = s.current.situation;
    const cells = [];
    for (let balls = 0; balls <= 3; balls++) {
      for (let strikes = 0; strikes <= 2; strikes++) {
        const p = predictHomeRun(activeRates(), { ...sit, balls, strikes });
        const key = `${balls}-${strikes}`;
        const isNow = balls === sit.balls && strikes === sit.strikes;
        cells.push(`<button type="button" class="count-cell ${isNow ? "now" : ""} ${whatIfCount === key ? "picked" : ""}" data-count="${key}"
          aria-label="${key} count, ${pct(p.probability)}">${key}<b>${pct(p.probability)}</b></button>`);
      }
    }
    let preview = `<p class="hint">Tap a count to see what it would do to the chance.</p>`;
    if (whatIfCount) {
      const [b, st] = whatIfCount.split("-").map(Number);
      const p = predictHomeRun(activeRates(), { ...sit, balls: b, strikes: st });
      preview = `<p class="what-if">At <b>${whatIfCount}</b> this at-bat would be <b>${pct(p.probability)}</b> (${p.timesLeague.toFixed(1)}x the league average).</p>`;
    }
    return `<h2 class="spaced">Try another count</h2>${preview}<div class="count-grid">${cells.join("")}</div>
      <p class="note">Rows are balls (0-3), columns are strikes (0-2). Yellow outline = the current count.</p>`;
  }

  // The expected total bases and strikeout tiles.
  function drawExtras(s) {
    const box = $("extras");
    if (!s.current?.predictions || !s.isLive) { box.hidden = true; return; } // (older saved copies have no extras)
    box.hidden = false;
    const { tb, k } = s.current.predictions;
    const xbh = s.current.extraBase;
    $("x-tb-n").textContent = tb.value.toFixed(2);
    $("x-tb-r").textContent = `League avg ${tb.leagueRate.toFixed(2)}${xbh != null ? ` · 2+ bases ${pct(xbh)}` : ""}`;
    $("x-k-n").textContent = pct(k.value);
    $("x-k-r").textContent = `League avg ${pct(k.leagueRate)}`;
  }

  // ---------------------------------------------------------------- the Pitch finder
  const KIND_LABEL = { all: "All", strike: "Strikes", ball: "Balls", play: "In play", fast: "Fastest 10" };

  function drawFinder(s) {
    const el = $("finder");
    const groups = s.pitchLog || [];
    finderIndex = new Map();
    if (!groups.length) {
      el.innerHTML = `<h2>Pitch finder</h2><p class="muted">Every pitch of the game will appear here, by inning.</p>`;
      return;
    }
    const counts = { all: 0, strike: 0, ball: 0, play: 0, fast: 10 };
    for (const g of groups) for (const r of g.rows) for (const p of r.pitches) { counts.all++; const k = pitchKind(p); if (counts[k] !== undefined) counts[k]++; }
    const fast = finderFilter === "fast" ? fastestKeys(groups) : null;
    const keep = (p, key) => (finderFilter === "all" ? true : finderFilter === "fast" ? fast.has(key) : pitchKind(p) === finderFilter);

    const lastLabel = groups[groups.length - 1].label;
    const html = [...groups].reverse().map((g) => {  // newest inning first
      const open = finderTouched ? openInnings.has(g.label) : g.label === lastLabel;
      let shown = 0;
      const rows = open ? g.rows.map((row) => {
        const items = row.pitches.filter((p) => keep(p, `${row.atBatIndex}-${p.n}`));
        if (!items.length) return "";
        shown += items.length;
        return `<div class="ab">
          <div class="ab-head"><b>${esc(row.batter.name)}</b> <span class="muted">(${row.batter.side}) vs</span> <b>${esc(row.pitcher.name)}</b> <span class="muted">(${row.pitcher.hand}HP)</span>${row.result ? ` <span class="ab-result">${esc(row.result)}</span>` : ""}</div>
          <ul class="pitch-list">${items.map((p) => {
            const key = `${row.atBatIndex}-${p.n}`;
            finderIndex.set(key, { row, pitch: p });
            const on = isSaved(saved, pitchId(s.game.pk, row.atBatIndex, p.n));
            return `<li class="pitch-row kind-${pitchKind(p)}">
              <span class="pr-num">#${p.n}<small>${p.balls}-${p.strikes}</small></span>
              <span class="pr-main"><i class="chip-dot" style="background:${typeColor(p.typeCode)}"></i><b>${esc(p.type || "Pitch")}</b>${p.speed ? ` ${p.speed.toFixed(1)} mph` : ""}<small>${esc(resultText(p, row.result))}</small></span>
              <span class="pr-btns"><button type="button" class="mini" data-replay-pitch="${key}">Replay</button><button type="button" class="mini ${on ? "on" : ""}" data-save-pitch="${key}" aria-pressed="${on}">${on ? "Saved" : "Save"}</button></span>
            </li>`;
          }).join("")}</ul>
        </div>`;
      }).join("") : "";
      const note = open && shown === 0 ? `<p class="muted pad-s">No ${esc(KIND_LABEL[finderFilter].toLowerCase())} in this inning.</p>` : "";
      return `<div class="inning-block">
        <button type="button" class="inning-head" data-inning="${esc(g.label)}" aria-expanded="${open}"><b>${esc(g.label)}</b><span>${g.count} pitch${g.count === 1 ? "" : "es"}</span><i class="caret">${open ? "−" : "+"}</i></button>
        ${rows}${note}
      </div>`;
    }).join("");

    el.innerHTML = `
      <h2>Pitch finder</h2>
      <p class="hint">Every pitch of the game, by inning. Replay one in 3D with its flight path, and save the ones you want to keep.</p>
      <div class="stage-controls filter-row" role="toolbar" aria-label="Filter pitches">
        ${Object.keys(KIND_LABEL).map((k) => `<button type="button" class="chip-btn ${finderFilter === k ? "on" : ""}" data-finder-filter="${k}">${KIND_LABEL[k]} <small>${counts[k]}</small></button>`).join("")}
      </div>
      ${html}
      <p class="note">${saved.length} saved pitch${saved.length === 1 ? "" : "es"} · <a href="#/saved">Open saved pitches</a></p>`;
  }

  // Replay one pitch (from the finder or the zone card) on the 3D stage, or in a pop-up if there is no 3D.
  function replayFromLog(key) {
    const entry = finderIndex.get(key) || currentEntry(key);
    if (!entry) return;
    const { row, pitch } = entry;
    const ctx = { batter: row.batter, pitcher: row.pitcher, battingTeamId: row.isTop ? state.away.id : state.home.id, fieldingTeamId: row.isTop ? state.home.id : state.away.id };
    if (stage.replayFull(ctx, pitch)) {
      const box = $("scene").getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) $("scene").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      showPitchDialog({ title: `${row.batter.name} vs ${row.pitcher.name}`, subtitle: `${row.label} · pitch ${pitch.n}`, pitch, atBatResult: row.result });
    }
  }
  // (the strike-zone card shows the at-bat in progress, which is the last row of the pitch log)
  function currentEntry(key) {
    const cut = key.lastIndexOf("-");
    const atBat = key.slice(0, cut), n = Number(key.slice(cut + 1));
    const row = state.pitchLog.flatMap((g) => g.rows).find((r) => String(r.atBatIndex) === atBat);
    const pitch = row?.pitches.find((p) => p.n === n);
    return row && pitch ? { row, pitch } : null;
  }
  function toggleSave(key) {
    const entry = finderIndex.get(key) || currentEntry(key);
    if (!entry) return;
    saved = toggleSaved(saved, makeSaved(state.game, entry.row, entry.pitch));
    storeSaved(saved);
    drawFinder(state);
    drawZone(state);
  }

  function drawHistory(s) {
    const el = $("history");
    if (!s.history.length) {
      el.innerHTML = `<h2>At-bat history</h2><p class="muted">No completed at-bats yet.</p>`;
      return;
    }
    const rows = [...s.history].reverse().map((row) => {
      const color = teamColor(colors, row.isTop ? s.away.id : s.home.id);
      const open = openHist.has(row.id);
      const p = row.predictions;
      return `
        <li class="hist-row ${row.isHR ? "hr" : ""} ${open ? "open" : ""}" style="--team:${color}" data-hist="${row.id}" tabindex="0" role="button" aria-expanded="${open}">
          <div class="hist-main">
            <div class="hist-batter">${esc(row.batterName)}</div>
            <div class="hist-sub">${esc(row.inning)} · vs ${esc(row.pitcherName)}</div>
          </div>
          <div class="hist-result ${row.isHR ? "hr" : ""}">${row.isHR ? "HOME RUN" : esc(row.result)}</div>
          <div class="hist-pred" title="Predicted chance before the first pitch">${pct(row.prediction.probability)}<small>chance</small></div>
          ${open ? `<p class="hist-desc">${esc(row.description)}${p ? `<br>Before the first pitch: HR ${pct(p.hr.value)} · strikeout ${pct(p.k.value)} · ${p.tb.value.toFixed(2)} expected bases` : ""}</p>` : ""}
        </li>`;
    }).join("");
    el.innerHTML = `<h2>At-bat history</h2><p class="hint">The chance shown is the prediction before the first pitch. Tap a row for the play-by-play.</p><ul class="hist-list">${rows}</ul>`;
  }

  function draw() {
    if (!state) return;
    drawScore(state);
    stage.update(state);
    drawMatchup(state);
    drawWinProbability(wpEl, state, colors);
    drawHr(state);
    drawZone(state);
    drawFinder(state);
    drawExtras(state);
    drawHistory(state);
    drawReplayBar(state);
    tick();
  }

  // Runs every second: keeps "Updated X seconds ago" and the offline banner current.
  function tick() {
    if (!lastUpdate) return;
    const updated = $("m-updated");
    if (updated) updated.textContent = `Updated ${timeAgo(lastUpdate)}`;
    const banner = $("banner");
    banner.hidden = !offline;
    if (offline) banner.textContent = `No connection. Showing the numbers from ${timeAgo(lastUpdate)}. Retrying automatically…`;
  }
  const clock = setInterval(tick, 1000);

  // ---------------------------------------------------------------- data in
  const source = makeSource({
    onUpdate(newState, time) {
      state = newState;
      lastUpdate = time;
      offline = false;
      if (!source.isReplay) saveLocal(`hr:game:${gamePk}`, { state: newState, time });

      checkForNewHit(newState);
      draw();
    },
    onError() {
      if (source.isReplay) {
        // a replay can't retry by itself: explain, and offer a way back
        if (!state) {
          $("banner").hidden = false;
          $("banner").innerHTML = `Couldn't load that game from MLB. Check your connection, then <a href="">try again</a> or <a href="#/browse">pick another game</a>.`;
        }
        return;
      }
      if (!state) {
        // First load failed. If we've seen this game before, show the saved copy.
        const saved = loadLocal(`hr:game:${gamePk}`);
        if (saved) { state = saved.state; lastUpdate = saved.time; draw(); }
        else {
          $("banner").hidden = false;
          $("banner").textContent = "Can't reach MLB yet. Retrying automatically…";
        }
      }
      if (state) { offline = true; tick(); }
    },
  });

  // ---------------------------------------------------------------- replay controls (demo and "replay any game")
  let seeking = false; // true while a finger or mouse is dragging the scrubber
  let innerOptions = "";
  function drawReplayBar(s) {
    if (!source.isReplay) return;
    const total = source.total, step = s.progress?.step ?? 0;
    const info = source.info;
    $("rb-title").textContent = source.isDemo || !info ? source.title : `${info.away} @ ${info.home} · ${info.date}`;
    const seek = $("rb-seek");
    seek.max = total;
    if (!seeking) seek.value = step;
    $("rb-label").textContent = step >= total ? "Game over" : `At-bat ${step + 1} of ${total}`;
    // the inning menu (built once the game has loaded)
    const stops = source.innings;
    const options = stops.map((i) => `<option value="${i.step}">${i.label}</option>`).join("");
    if (options !== innerOptions) { $("rb-inning").innerHTML = options; innerOptions = options; }
    const here = stops.filter((i) => i.step <= step).at(-1);
    if (here) $("rb-inning").value = String(here.step);
    const note = $("rb-note");
    note.hidden = !source.ratesNote;
    note.textContent = source.ratesNote;
    $("pause").textContent = source.paused ? "Resume" : "Pause";
  }

  if (source.isReplay) {
    $("demo-bar").hidden = false;
    if (!source.isDemo) { $("banner").hidden = false; $("banner").textContent = "Loading the game from MLB…"; }
    const jump = (fn) => { seenHistory = null; fn(); }; // jumping around shouldn't replay a hit for every at-bat we skipped
    $("pause").addEventListener("click", () => {
      if (source.paused) source.resume(); else source.pause();
      $("pause").textContent = source.paused ? "Resume" : "Pause";
    });
    $("restart").addEventListener("click", () => jump(() => { source.restart(); $("pause").textContent = "Pause"; lastSpikeKey = null; }));
    $("rb-prev").addEventListener("click", () => jump(() => source.stepBy(-1)));
    $("rb-next").addEventListener("click", () => jump(() => source.stepBy(1)));
    $("rb-end").addEventListener("click", () => jump(() => source.toEnd()));
    $("rb-speed").addEventListener("change", (e) => source.setSpeed(Number(e.target.value)));
    $("rb-inning").addEventListener("change", (e) => jump(() => source.seek(Number(e.target.value))));
    const seek = $("rb-seek");
    seek.addEventListener("pointerdown", () => { seeking = true; });
    seek.addEventListener("input", () => { seenHistory = null; source.seek(Number(seek.value)); });
    for (const type of ["pointerup", "pointercancel", "change"]) seek.addEventListener(type, () => { seeking = false; });
  }

  // ---------------------------------------------------------------- taps (one listener for the whole screen)
  root.addEventListener("click", (event) => {
    const hit = (selector) => event.target.closest(selector);
    if (hit("[data-save-pitch]")) {
      toggleSave(hit("[data-save-pitch]").dataset.savePitch);
    } else if (hit("[data-replay-pitch]")) {
      replayFromLog(hit("[data-replay-pitch]").dataset.replayPitch);
    } else if (hit("[data-inning]")) {
      const label = hit("[data-inning]").dataset.inning;
      if (!finderTouched) { finderTouched = true; openInnings.add(state.pitchLog.at(-1).label); } // start from what was showing
      openInnings.has(label) ? openInnings.delete(label) : openInnings.add(label);
      drawFinder(state);
    } else if (hit("[data-finder-filter]")) {
      finderFilter = hit("[data-finder-filter]").dataset.finderFilter;
      drawFinder(state);
    } else if (hit("[data-why]")) {
      const key = hit("[data-why]").dataset.why;
      openWhy.has(key) ? openWhy.delete(key) : openWhy.add(key);
      drawHr(state);
    } else if (hit("[data-count]")) {
      const key = hit("[data-count]").dataset.count;
      whatIfCount = whatIfCount === key ? null : key;
      drawHr(state);
    } else if (hit("[data-pitch]")) {
      openPitch = Number(hit("[data-pitch]").dataset.pitch);
      drawZone(state);
      stage.replayPitch(openPitch); // fly that pitch again in the 3D scene
    } else if (hit("[data-hist]")) {
      const id = Number(hit("[data-hist]").dataset.hist);
      openHist.has(id) ? openHist.delete(id) : openHist.add(id);
      drawHistory(state);
    }
  });

  // Keyboard shortcuts for computers. Ignored while typing in a field or holding Ctrl/Cmd/Alt.
  function onKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    if (!source.isReplay) return;
    if (key === " " && event.target === document.body) {
      event.preventDefault(); // stop the page scrolling
      $("pause").click();
    } else if (key === "arrowright") { $("rb-next").click(); }
    else if (key === "arrowleft") { $("rb-prev").click(); }
  }
  document.addEventListener("keydown", onKey);

  // History rows are focusable: Enter or Space opens them, like a tap.
  root.addEventListener("keydown", (event) => {
    const row = event.target.closest?.("[data-hist]");
    if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); row.click(); }
  });

  source.start();
  return () => { clearInterval(clock); stage.dispose(); document.removeEventListener("keydown", onKey); wide.removeEventListener("change", placeMeter); source.stop(); }; // called when leaving this screen
}
