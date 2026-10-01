// Screen 2: the game screen. Top to bottom:
//   score + situation  ->  batter vs pitcher  ->  Home Run Meter  ->  "Why"  ->  at-bat history
//
// This file only DRAWS. The numbers come from a "source" (src/sources.js) that hands us a
// game state each time something changes, and from model.js via scoreState().

import { SPIKE_MULTIPLE } from "../config.js";
import { esc, pct, timeAgo, textOn, teamColor, saveLocal, loadLocal } from "../util.js";
import { diamondSvg } from "./diamond.js";
import { whyHtml } from "./why.js";

const handWord = (h) => (h === "L" ? "Left" : "Right");

// Buzz the phone on a spike. iPhone Safari has no navigator.vibrate, so we check first and
// swallow any error: this must never be able to break the screen.
function buzz() {
  try {
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
  } catch { /* not supported or blocked: ignore */ }
}

export function showGame(root, { gamePk, rates, colors, makeSource }) {
  root.innerHTML = `
    <header class="top">
      <a class="back" href="#/">‹ Games</a>
      <span id="chip" class="chip"></span>
    </header>
    <div id="demo-bar" class="demo-bar" hidden>
      <span>Demo replay</span>
      <span class="spacer"></span>
      <button id="pause" type="button">Pause</button>
      <button id="restart" type="button">Restart</button>
    </div>
    <div id="banner" class="banner" hidden></div>
    <section id="score" class="card score"></section>
    <section id="matchup" class="card"></section>
    <section id="meter" class="card meter">
      <div class="meter-number" id="m-num">–</div>
      <div class="meter-label">Home run chance, this at-bat <span id="m-est" class="estimate" hidden>estimate</span></div>
      <div class="meter-times" id="m-times"></div>
      <div class="meter-ref" id="m-ref"></div>
      <div class="meter-updated" id="m-updated"></div>
    </section>
    <section id="why" class="card" hidden></section>
    <section id="history" class="card"></section>`;

  const $ = (id) => root.querySelector("#" + id);
  const meterEl = $("meter");
  const leagueText = `League average: about ${pct(rates.league.hr_per_pa)}`;
  $("m-ref").textContent = leagueText;

  let state = null;
  let lastUpdate = 0; // when we last got fresh data
  let offline = false;
  let lastSpikeKey = null;

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

  function drawMeter(s) {
    const prediction = s.current?.prediction;
    if (!prediction) {
      $("m-num").textContent = "–";
      $("m-times").textContent = "";
      $("m-est").hidden = true;
      meterEl.classList.remove("spike");
      $("why").hidden = true;
      return;
    }
    $("m-num").textContent = pct(prediction.probability);
    $("m-times").textContent = `${prediction.timesLeague.toFixed(1)}x the league average`;
    $("m-est").hidden = !prediction.isEstimate;

    // Spike cue: glow/pulse while the chance is high; buzz once when a new spike starts.
    const spike = prediction.timesLeague >= SPIKE_MULTIPLE;
    meterEl.classList.toggle("spike", spike);
    const key = spike ? `${s.current.batter.id}-${s.balls}-${s.strikes}` : null;
    if (key && key !== lastSpikeKey) buzz();
    lastSpikeKey = key;

    $("why").hidden = false;
    $("why").innerHTML = whyHtml(prediction, s.current.situation);
  }

  function drawHistory(s) {
    const el = $("history");
    if (!s.history.length) {
      el.innerHTML = `<h2>At-bat history</h2><p class="muted">No completed at-bats yet.</p>`;
      return;
    }
    const rows = [...s.history].reverse().map((row) => {
      const color = teamColor(colors, row.isTop ? s.away.id : s.home.id);
      return `
        <li class="hist-row ${row.isHR ? "hr" : ""}" style="--team:${color}">
          <div class="hist-main">
            <div class="hist-batter">${esc(row.batterName)}</div>
            <div class="hist-sub">${esc(row.inning)} · vs ${esc(row.pitcherName)}</div>
          </div>
          <div class="hist-result ${row.isHR ? "hr" : ""}">${row.isHR ? "💥 HOME RUN" : esc(row.result)}</div>
          <div class="hist-pred" title="Predicted chance before the first pitch">${pct(row.prediction.probability)}<small>chance</small></div>
        </li>`;
    }).join("");
    el.innerHTML = `<h2>At-bat history</h2><p class="hint">The chance shown is the prediction before the first pitch.</p><ul class="hist-list">${rows}</ul>`;
  }

  function draw() {
    if (!state) return;
    drawScore(state);
    drawMatchup(state);
    drawMeter(state);
    drawHistory(state);
    tick();
  }

  // Runs every second: keeps "Updated X seconds ago" and the offline banner current.
  function tick() {
    if (!lastUpdate) return;
    $("m-updated").textContent = `Updated ${timeAgo(lastUpdate)}`;
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

  source.start();
  return () => { clearInterval(clock); source.stop(); }; // called when leaving this screen
}
