// Screen 2: the game screen. Top to bottom:
//   score + situation  ->  batter vs pitcher  ->  Home Run Meter  ->  "Why"  ->  at-bat history
//
// This file only DRAWS. The numbers come from a "source" (src/sources.js) that hands us a
// game state each time something changes, and from model.js via scoreState().

import { esc, pct, timeAgo, textOn, teamColor, saveLocal, loadLocal } from "../util.js";
import { predictHomeRun } from "../model.js";
import { getSettings } from "../settings.js";
import { loadCalls, saveCalls, newCall, withCall, withoutPending, resolveCalls, pointsFor, callId, KINDS } from "../calls.js";
import { diamondSvg } from "./diamond.js";
import { whyHtml } from "./why.js";
import { sceneHtml, resultSceneHtml, playResult } from "./scene.js";

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
      <span class="header-right"><a class="calls-link" href="#/calls">My calls</a><span id="chip" class="chip"></span></span>
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
    <section id="scene" class="card scene" hidden></section>
    <section id="matchup" class="card"></section>
    <section id="meter" class="card meter">
      <div class="meter-number" id="m-num">–</div>
      <div class="meter-label">Home run chance, this at-bat <span id="m-est" class="estimate" hidden>estimate</span></div>
      <div class="meter-times" id="m-times"></div>
      <div class="meter-ref" id="m-ref"></div>
      <div class="meter-updated" id="m-updated"></div>
    </section>
    <section id="call-box" class="card call-box" hidden></section>
    <section id="extras" class="extras" hidden></section>
    <div id="toast" class="toast" role="status" hidden></div>
    <p class="kbd-hint">Keyboard: <kbd>H</kbd> call home run · <kbd>B</kbd> call 2+ bases · <kbd>K</kbd> call strikeout · <kbd>Space</kbd> pause demo</p>
    </div><div class="col-side">
    <section id="why" class="card" hidden></section>
    <section id="history" class="card"></section>
    </div></div>`;

  const $ = (id) => root.querySelector("#" + id);
  const meterEl = $("meter");
  const leagueText = `League average: about ${pct(rates.league.hr_per_pa)}`;
  $("m-ref").textContent = leagueText;

  let state = null;
  let lastUpdate = 0; // when we last got fresh data
  let offline = false;
  let lastSpikeKey = null;
  let calls = loadCalls();        // the player's home run calls (saved on the phone)
  const openWhy = new Set();      // "Why" rows whose tip is expanded
  const openHist = new Set();     // history rows that are expanded
  let whatIfCount = null;         // count picked in the "try another count" grid, e.g. "3-1"
  let toastTimer = null;

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

  // The pitcher/batter cartoon. Only redrawn when something visible changes, so its animations
  // (the pitch, the idle bobbing) aren't restarted by every 7-second refresh.
  let sceneKey = null;
  let sceneBusyUntil = 0;   // while a hit replay is playing, leave the scene alone
  let sceneTimer = null;
  let seenHistory = null;   // how many finished at-bats we'd already seen (to spot new ones)

  function drawScene(s) {
    const el = $("scene");
    if (Date.now() < sceneBusyUntil) return;
    if (!s.current || !s.isLive) { el.hidden = true; sceneKey = null; return; }
    const awayBats = /^Top/.test(s.inningLabel);
    const battingTeam = awayBats ? s.away : s.home;
    const fieldingTeam = awayBats ? s.home : s.away;
    const scene = sceneHtml({
      batSide: s.current.batter.side,
      pitchHand: s.current.pitcher.hand,
      batterId: s.current.batter.id,
      pitcherId: s.current.pitcher.id,
      balls: s.balls, strikes: s.strikes, outs: s.outs,
      batColor: teamColor(colors, battingTeam.id),
      pitchColor: teamColor(colors, fieldingTeam.id),
      spike: s.current.prediction.timesLeague >= getSettings().spikeMultiple,
    });
    el.hidden = false;
    if (scene.key !== sceneKey) { el.innerHTML = scene.html; sceneKey = scene.key; }
  }

  // When a new at-bat finishes with a hit, replay it in the scene: the swing and the ball flying out.
  function checkForNewHit(s) {
    if (seenHistory === null || s.history.length < seenHistory) { seenHistory = s.history.length; return; } // first load or demo restart
    const fresh = s.history.slice(seenHistory);
    seenHistory = s.history.length;
    const row = [...fresh].reverse().find((r) => r.hit);
    if (!row) return;
    const battingTeam = row.isTop ? s.away : s.home;
    const fieldingTeam = row.isTop ? s.home : s.away;
    const replay = resultSceneHtml({
      batSide: row.situation.batSide, pitchHand: row.situation.pitchHand,
      batterId: row.situation.batterId, pitcherId: row.situation.pitcherId, batterName: row.batterName,
      balls: 0, strikes: 0, outs: s.outs,
      batColor: teamColor(colors, battingTeam.id), pitchColor: teamColor(colors, fieldingTeam.id),
      hit: row.hit,
    });
    const el = $("scene");
    el.hidden = false;
    el.innerHTML = replay.html;
    sceneKey = null; // the normal scene must redraw afterwards
    playResult(el);
    sceneBusyUntil = Date.now() + replay.durationMs;
    clearTimeout(sceneTimer);
    sceneTimer = setTimeout(() => { sceneBusyUntil = 0; if (state) drawScene(state); }, replay.durationMs);
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
    const spike = prediction.timesLeague >= getSettings().spikeMultiple;
    meterEl.classList.toggle("spike", spike);
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

  // ---------------------------------------------------------------- call a homer
  const currentCallId = (s, kind) => callId(gamePk, s.current.atBatIndex, kind);
  const pendingCall = (s, kind) => calls.find((c) => c.id === currentCallId(s, kind) && c.status === "pending");

  // The chance we use to pay out each kind of call.
  function chanceFor(kind, current) {
    if (kind === "hr") return current.prediction.value;
    if (kind === "k") return current.predictions.k.value;
    return current.extraBase; // "xbh" (null if the data file has no extra-base rate)
  }
  const payoutFor = (chance) => Math.round(1 / Math.max(chance, 0.01));

  // Tap handler for every Call button: make the call, or undo it if it's already made.
  function toggleCall(kind) {
    if (!state?.current) return;
    const existing = pendingCall(state, kind);
    if (existing) {
      calls = withoutPending(calls, existing.id);
    } else {
      const chance = chanceFor(kind, state.current);
      if (chance == null) return;
      calls = withCall(calls, newCall({ gamePk, current: state.current, chance, isDemo: source.isDemo, kind }));
      buzz([60]);
    }
    saveCalls(calls);
    drawCallBox(state);
    drawExtras(state);
  }

  // The two smaller tiles under the home run meter: expected total bases and strikeout chance.
  function drawExtras(s) {
    const box = $("extras");
    if (!s.current?.predictions || !s.isLive) { box.hidden = true; return; } // (older saved copies have no extras)
    box.hidden = false;
    const { tb, k } = s.current.predictions;
    const callButton = (kind, text) => {
      const chance = chanceFor(kind, s.current);
      if (chance == null) return "";
      return pendingCall(s, kind)
        ? `<button type="button" class="call-small made" data-call="${kind}">Called · tap to undo</button>`
        : `<button type="button" class="call-small" data-call="${kind}">${text}<small>+${payoutFor(chance)} pts if right</small></button>`;
    };
    const xbh = s.current.extraBase;
    box.innerHTML = `
      <div class="extra-tile">
        <div class="extra-label">Expected total bases</div>
        <div class="extra-number">${tb.value.toFixed(2)}</div>
        <div class="extra-ref">League avg ${tb.leagueRate.toFixed(2)}${xbh != null ? ` · 2+ bases about ${pct(xbh)}` : ""}</div>
        ${callButton("xbh", "Call 2+ bases")}
      </div>
      <div class="extra-tile">
        <div class="extra-label">Strikeout chance</div>
        <div class="extra-number">${pct(k.value)}</div>
        <div class="extra-ref">League avg ${pct(k.leagueRate)}</div>
        ${callButton("k", "Call strikeout")}
      </div>`;
  }

  function drawCallBox(s) {
    const box = $("call-box");
    if (!s.current || !s.isLive || !s.current.predictions) { box.hidden = true; return; }
    box.hidden = false;
    const mine = pendingCall(s, "hr");
    const payout = payoutFor(s.current.prediction.value);
    if (mine) {
      box.innerHTML = `
        <div class="call-made">You called a <b>home run</b> for ${esc(s.current.batter.name)}.
          <span class="muted">Locked in at ${pct(mine.chance)} chance, worth +${Math.round(1 / Math.max(mine.chance, 0.01))} pts.</span></div>
        <button type="button" class="ghost" data-call="hr">Undo call</button>`;
    } else {
      box.innerHTML = `
        <button type="button" class="call-button" data-call="hr">Call a home run<small>+${payout} pts if ${esc(s.current.batter.name)} homers, −1 if not</small></button>
        ${source.isDemo ? `<p class="note">Tip: pause the demo to take your time.</p>` : ""}`;
    }
  }

  function showToast(settled) {
    // Several calls can settle at once (e.g. a double settles a strikeout call and a 2+ bases call).
    // Celebrate a win if there was one; otherwise show the last result.
    const call = settled.find((c) => c.status === "hit") || settled[settled.length - 1];
    const points = pointsFor(call);
    const toast = $("toast");
    toast.className = "toast " + (call.status === "hit" ? "win" : "lose");
    const kind = KINDS[call.kind] || KINDS.hr;
    toast.textContent = call.status === "hit"
      ? `You called it! ${call.batterName} ${kind.verb}. +${points} pts`
      : `${call.batterName}: ${call.resultText}. Your ${kind.label} call missed (${points} pt).`;
    toast.hidden = false;
    if (call.status === "hit") buzz([100, 60, 100, 60, 300]);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
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
      const mine = calls.filter((c) => c.gamePk === String(gamePk) && c.atBatIndex === row.id && c.status !== "pending");
      const p = row.predictions;
      return `
        <li class="hist-row ${row.isHR ? "hr" : ""} ${open ? "open" : ""}" style="--team:${color}" data-hist="${row.id}" tabindex="0" role="button" aria-expanded="${open}">
          <div class="hist-main">
            <div class="hist-batter">${esc(row.batterName)}</div>
            <div class="hist-sub">${esc(row.inning)} · vs ${esc(row.pitcherName)}</div>
          </div>
          <div class="hist-result ${row.isHR ? "hr" : ""}">${row.isHR ? "HOME RUN" : esc(row.result)}</div>
          <div class="hist-pred" title="Predicted chance before the first pitch">${pct(row.prediction.probability)}<small>chance</small></div>
          ${mine.map((c) => `<span class="hist-call ${c.status}">${c.status === "hit" ? "Called" : "Missed"} ${esc(KINDS[c.kind].short)}</span>`).join("")}
          ${open ? `<p class="hist-desc">${esc(row.description)}${p ? `<br>Before the first pitch: HR ${pct(p.hr.value)} · strikeout ${pct(p.k.value)} · ${p.tb.value.toFixed(2)} expected bases` : ""}</p>` : ""}
        </li>`;
    }).join("");
    el.innerHTML = `<h2>At-bat history</h2><p class="hint">The chance shown is the prediction before the first pitch. Tap a row for the play-by-play.</p><ul class="hist-list">${rows}</ul>`;
  }

  function draw() {
    if (!state) return;
    drawScore(state);
    drawScene(state);
    drawMatchup(state);
    drawMeter(state);
    drawCallBox(state);
    drawExtras(state);
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

      // Did any at-bat just finish that the player made a call on?
      const resolved = resolveCalls(calls, gamePk, newState.history);
      if (resolved.settled.length) {
        calls = resolved.calls;
        saveCalls(calls);
        showToast(resolved.settled);
      }
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
    if (hit("[data-call]")) {
      toggleCall(hit("[data-call]").dataset.call);
    } else if (hit("[data-why]")) {
      const key = hit("[data-why]").dataset.why;
      openWhy.has(key) ? openWhy.delete(key) : openWhy.add(key);
      drawMeter(state);
    } else if (hit("[data-count]")) {
      const key = hit("[data-count]").dataset.count;
      whatIfCount = whatIfCount === key ? null : key;
      drawMeter(state);
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
    if (key === "h") toggleCall("hr");
    else if (key === "k") toggleCall("k");
    else if (key === "b") toggleCall("xbh");
    else if (key === " " && source.isDemo && event.target === document.body) {
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
  return () => { clearInterval(clock); clearTimeout(toastTimer); clearTimeout(sceneTimer); document.removeEventListener("keydown", onKey); source.stop(); }; // called when leaving this screen
}
