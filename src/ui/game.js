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
import { createStage } from "./stage.js";

const handWord = (h) => (h === "L" ? "Left" : "Right");

// Buzz the phone on a spike. iPhone Safari has no navigator.vibrate, so we check first and
// swallow any error: this must never be able to break the screen.
function buzz(pattern = [200, 100, 200]) {
  try {
    if (getSettings().vibrate && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch { /* not supported or blocked: ignore */ }
}

export function showGame(root, { gamePk, rates, colors, makeSource }) {
  root.innerHTML = `
    <header class="top">
      <a class="back" href="#/">‹ Games</a>
      <span class="header-right"><button type="button" id="theme-btn" class="theme-btn" title="Switch theme"></button><span id="chip" class="chip"></span></span>
    </header>
    <div id="demo-bar" class="demo-bar" hidden>
      <span>Demo replay</span>
      <span class="spacer"></span>
      <button id="pause" type="button">Pause</button>
      <button id="restart" type="button">Restart</button>
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
    <p class="kbd-hint">Keyboard: <kbd>Space</kbd> pause or resume the demo</p>
    </div><div class="col-side">
    <section id="zone" class="card zone" hidden></section>
    <section id="why" class="card" hidden></section>
    <section id="history" class="card"></section>
    </div></div>`;

  const $ = (id) => root.querySelector("#" + id);
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
    chip.textContent = s.isFinal ? "Final" : s.isLive ? "Live" : s.statusLabel;
    chip.className = "chip " + (s.isLive ? "live" : "");
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
    if (s.current) el.innerHTML = zoneHtml(s.current.pitches, openPitch);
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
        const p = predictHomeRun(rates, { ...sit, balls, strikes });
        const key = `${balls}-${strikes}`;
        const isNow = balls === sit.balls && strikes === sit.strikes;
        cells.push(`<button type="button" class="count-cell ${isNow ? "now" : ""} ${whatIfCount === key ? "picked" : ""}" data-count="${key}"
          aria-label="${key} count, ${pct(p.probability)}">${key}<b>${pct(p.probability)}</b></button>`);
      }
    }
    let preview = `<p class="hint">Tap a count to see what it would do to the chance.</p>`;
    if (whatIfCount) {
      const [b, st] = whatIfCount.split("-").map(Number);
      const p = predictHomeRun(rates, { ...sit, balls: b, strikes: st });
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
    drawExtras(state);
    drawHistory(state);
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
      if (!source.isDemo) saveLocal(`hr:game:${gamePk}`, { state: newState, time });

      checkForNewHit(newState);
      draw();
    },
    onError() {
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

  // ---------------------------------------------------------------- demo controls
  if (source.isDemo) {
    $("demo-bar").hidden = false;
    const pause = $("pause");
    pause.addEventListener("click", () => {
      if (source.paused) { source.resume(); pause.textContent = "Pause"; }
      else { source.pause(); pause.textContent = "Resume"; }
    });
    $("restart").addEventListener("click", () => { source.restart(); pause.textContent = "Pause"; lastSpikeKey = null; });
  }

  // ---------------------------------------------------------------- taps (one listener for the whole screen)
  root.addEventListener("click", (event) => {
    const hit = (selector) => event.target.closest(selector);
    if (hit("[data-why]")) {
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
    if (key === " " && source.isDemo && event.target === document.body) {
      event.preventDefault(); // stop the page scrolling
      $("pause").click();
    }
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
