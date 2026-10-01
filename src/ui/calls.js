// Screen 3: "My calls". Your record of calls, compared with what the model expected.

import { esc, pct } from "../util.js";

// A rate of 0 should read "0%", not the "<1%" that pct() uses for tiny chances.
const rate = (r) => Math.round(r * 100) + "%";
import { loadCalls, saveCalls, computeStats, pointsFor, KINDS } from "../calls.js";

export function showCalls(root) {
  let includeDemo = true;

  function draw() {
    const all = loadCalls();
    const calls = all.filter((c) => includeDemo || !c.isDemo);
    const s = computeStats(calls);

    const tile = (value, label) => `<div class="tile"><b>${value}</b><span>${label}</span></div>`;
    const verdict = s.total === 0
      ? "Make a call on any at-bat and it will show up here."
      : `You've hit <b>${s.hits}</b> of <b>${s.total}</b> (${rate(s.hitRate)}). The model expected about <b>${s.expectedHits.toFixed(1)}</b> hits from those calls (avg ${pct(s.avgChance)} each).`
        + (s.total < 5 ? "" : s.hits > s.expectedHits + 0.5 ? " You're beating the odds." : s.hits < s.expectedHits - 0.5 ? " Running a bit cold so far." : "");

    // One line per kind of call: how you do on home runs vs strikeouts vs extra-base hits.
    const byKind = Object.entries(KINDS).map(([kind, info]) => {
      const k = computeStats(calls.filter((c) => c.kind === kind));
      return `<tr><td>${esc(info.label)}</td><td>${k.hits}/${k.total}</td><td>${k.total ? rate(k.hitRate) : "–"}</td><td>${k.total ? k.expectedHits.toFixed(1) : "–"}</td><td>${k.points}</td></tr>`;
    }).join("");

    const rows = [...calls].sort((a, b) => b.madeAt - a.madeAt).map((c) => `
      <li class="call-row ${c.status}">
        <div>
          <div class="hist-batter">${esc(c.batterName)} <span class="tag">${esc(KINDS[c.kind].short)}</span>${c.isDemo ? ' <span class="tag">demo</span>' : ""}</div>
          <div class="hist-sub">vs ${esc(c.pitcherName)} · ${pct(c.chance)} chance when called</div>
        </div>
        <div class="call-outcome">
          ${c.status === "pending"
            ? `<span class="muted">Waiting…</span>${c.isDemo ? "" : `<a href="#/game/${esc(c.gamePk)}">Open game</a>`}`
            : `<b>${c.status === "hit" ? "Hit" : "Miss"}</b><small>${esc(c.resultText)} · ${pointsFor(c) > 0 ? "+" : ""}${pointsFor(c)} pts</small>`}
        </div>
      </li>`).join("");

    root.innerHTML = `
      <header class="top"><a class="back" href="#/">‹ Games</a><h1>My calls</h1><span></span></header>
      <div class="calls-grid"><div class="col">
      <section class="card">
        <div class="tiles">
          ${tile(s.points, "Points")}
          ${tile(s.total ? rate(s.hitRate) : "–", "Hit rate")}
          ${tile(s.hits + "/" + s.total, "Hits / calls")}
          ${tile(s.bestStreak, "Best streak")}
        </div>
        <p class="verdict">${verdict}</p>
        ${s.bestCall ? `<p class="note">Best call: <b>${esc(s.bestCall.batterName)}</b> (${esc(KINDS[s.bestCall.kind].label)}) at ${pct(s.bestCall.chance)} (+${pointsFor(s.bestCall)} pts).</p>` : ""}
        ${s.pending ? `<p class="note">${s.pending} call${s.pending === 1 ? "" : "s"} waiting for the at-bat to finish.</p>` : ""}
        <p class="note">Scoring: a hit pays 1 ÷ the chance (a 4% long shot = +25), a miss costs 1 point.</p>
      </section>
      <section class="card">
        <h2>By type of call</h2>
        <table class="kind-table">
          <thead><tr><th></th><th>Hits</th><th>Rate</th><th>Expected</th><th>Pts</th></tr></thead>
          <tbody>${byKind}</tbody>
        </table>
      </section>
      </div><div class="col">
      <section class="card">
        <div class="row-between">
          <h2>All calls</h2>
          <label class="check"><input type="checkbox" id="demo-toggle" ${includeDemo ? "checked" : ""}> Include demo</label>
        </div>
        ${rows ? `<ul class="call-list">${rows}</ul>` : `<p class="muted">Nothing yet.</p>`}
        ${all.length ? `<button type="button" id="reset" class="ghost danger">Reset all my calls</button>` : ""}
      </section>
      </div></div>`;
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("#reset") && confirm("Delete all your calls and points? This can't be undone.")) {
      saveCalls([]);
      draw();
    }
  });
  root.addEventListener("change", (event) => {
    if (event.target.id === "demo-toggle") { includeDemo = event.target.checked; draw(); }
  });

  draw();
  return () => {};
}
