// Screen 3: the Matchup Lab. A sandbox: pick ANY batter and ANY pitcher, a ballpark and a count,
// and see what the model says. The state lives in the address (#/lab?b=...&p=...) so a matchup
// can be shared as a link.

import { esc } from "../util.js";
import { predictStat, extraBaseChance } from "../model.js";
import { whyHtml } from "./why.js";
import { headshotUrl } from "./scene.js";

const MIN_BATTER_PA = 300;
const MIN_PITCHER_BF = 300;

// ---------------------------------------------------------------- pure helpers (unit tested)
const plain = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Players whose name contains `query` (accents and case ignored), most plate appearances first. */
export function searchPlayers(group, query, limit = 8) {
  const q = plain(query.trim());
  return Object.entries(group)
    .filter(([, p]) => p.name && (!q || plain(p.name).includes(q)))
    .sort((a, b) => b[1].pa - a[1].pa)
    .slice(0, limit)
    .map(([id, p]) => ({ id, ...p }));
}

const best = (group, minPa, pick, higher = true) => {
  let top = null;
  for (const [id, p] of Object.entries(group)) {
    if (p.pa < minPa || !p.name) continue;
    if (!top || (higher ? pick(p) > pick(top[1]) : pick(p) < pick(top[1]))) top = [id, p];
  }
  return top?.[0];
};
const bestPark = (factors, higher) => Object.entries(factors).sort((a, b) => (higher ? b[1] - a[1] : a[1] - b[1]))[0]?.[0];

/** Ready-made matchups, picked from the data, to try with one tap. */
export function dreamMatchups(rates) {
  const { batters, pitchers } = rates;
  const slugger = best(batters, MIN_BATTER_PA, (p) => p.rate);
  const hrProne = best(pitchers, MIN_PITCHER_BF, (p) => p.rate);
  const stingy = best(pitchers, MIN_PITCHER_BF, (p) => p.rate, false);
  const whiffer = best(batters, MIN_BATTER_PA, (p) => p.k.rate);
  const ace = best(pitchers, MIN_PITCHER_BF, (p) => p.k.rate);
  const hitterPark = bestPark(rates.park_hr_factors, true);
  const pitcherPark = bestPark(rates.park_hr_factors, false);
  const label = (id, group) => group[id]?.name || "?";
  return [
    { title: "Slugger's dream", text: `${label(slugger, batters)} vs ${label(hrProne, pitchers)} in ${rates.park_names[hitterPark]}`, b: slugger, p: hrProne, park: hitterPark },
    { title: "Pitcher's duel", text: `${label(slugger, batters)} vs ${label(stingy, pitchers)} in ${rates.park_names[pitcherPark]}`, b: slugger, p: stingy, park: pitcherPark },
    { title: "Strikeout showdown", text: `${label(whiffer, batters)} vs ${label(ace, pitchers)}`, b: whiffer, p: ace, park: "" },
  ].filter((d) => d.b && d.p);
}

/** The model's three numbers for one matchup. */
export function evaluate(rates, { b, p, park, balls, strikes }) {
  const batter = rates.batters[b], pitcher = rates.pitchers[p];
  if (!batter || !pitcher) return null;
  const pitchHand = pitcher.hand;
  // a switch hitter bats from the side opposite the pitcher's arm
  const batSide = batter.hand === "S" ? (pitchHand === "R" ? "L" : "R") : batter.hand;
  const situation = { batterId: b, pitcherId: p, batSide, pitchHand, venueId: park || "none", balls, strikes };
  const hr = predictStat(rates, situation, "hr");
  const k = predictStat(rates, situation, "k");
  const tb = predictStat(rates, situation, "tb");
  return { situation, hr, k, tb, extraBase: extraBaseChance(rates, tb) };
}

// ---------------------------------------------------------------- reading and writing the address
function readHash() {
  const query = location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const [balls, strikes] = (params.get("c") || "0-0").split("-").map(Number);
  return { b: params.get("b"), p: params.get("p"), park: params.get("park") || "", balls: balls || 0, strikes: strikes || 0 };
}

// ---------------------------------------------------------------- the screen
export function showLab(root, { rates }) {
  const defaults = () => {
    const [d] = dreamMatchups(rates);
    return { b: d?.b, p: best(rates.pitchers, MIN_PITCHER_BF, (p) => Math.abs(p.rate - rates.league.hr_per_pa), false), park: "", balls: 0, strikes: 0 };
  };
  const fromUrl = readHash();
  let state = { ...defaults(), ...(rates.batters[fromUrl.b] ? { b: fromUrl.b } : {}), ...(rates.pitchers[fromUrl.p] ? { p: fromUrl.p } : {}), park: fromUrl.park, balls: fromUrl.balls, strikes: fromUrl.strikes };
  const openWhy = new Set();
 

  const parkNames = Object.entries(rates.park_names).sort((a, b) => a[1].localeCompare(b[1]));
  const rate = (r, d = 1) => (r * 100).toFixed(d) + "%";

  root.innerHTML = `
    <header class="top"><a class="back" href="#/">‹ Games</a><h1>Matchup Lab</h1><span></span></header>
    <p class="hint lab-intro">Pick any batter and pitcher, a ballpark and a count. The model shows what to expect.</p>
    <div class="lab-grid">
      <div class="col">
        <section class="card" data-picker="b"><h2>Batter</h2><div class="picked"></div>
          <input type="search" class="lab-search" placeholder="Search batters…" autocomplete="off" aria-label="Search batters"><ul class="picker-list"></ul></section>
        <section class="card" data-picker="p"><h2>Pitcher</h2><div class="picked"></div>
          <input type="search" class="lab-search" placeholder="Search pitchers…" autocomplete="off" aria-label="Search pitchers"><ul class="picker-list"></ul></section>
        <section class="card">
          <h2>Ballpark</h2>
          <select id="lab-park" aria-label="Ballpark"><option value="">Average park</option>${parkNames.map(([id, name]) => `<option value="${id}">${esc(name)} (HR ${rates.park_hr_factors[id]})</option>`).join("")}</select>
          <h2 class="spaced">Count</h2><div class="count-grid" id="lab-counts"></div>
        </section>
      </div>
      <div class="col">
        <section class="card" id="lab-results"></section>
        <section class="card"><h2>Try a dream matchup</h2><div id="lab-dreams"></div>
          <div class="lab-actions"><button type="button" class="chip-btn" data-lab="random">Surprise me</button><button type="button" class="chip-btn" data-lab="swap">Swap sides</button><button type="button" class="chip-btn" data-lab="share">Share this matchup</button></div>
          <p class="note" id="lab-copied" hidden>Link copied.</p></section>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  $("#lab-park").value = state.park;

  // ---------------- the pickers
  const group = (kind) => (kind === "b" ? rates.batters : rates.pitchers);
  function playerRow(id, p, kind) {
    const detail = kind === "b" ? `${p.hand === "S" ? "Switch" : p.hand + "HB"} · HR ${rate(p.rate)} · K ${rate(p.k.rate, 0)}` : `${p.hand}HP · HR allowed ${rate(p.rate)} · K ${rate(p.k.rate, 0)}`;
    return `<li><button type="button" class="pick-row" data-pick="${kind}" data-id="${id}">
      <img src="${headshotUrl(id)}" alt="" loading="lazy" width="40" height="40" onerror="this.style.visibility='hidden'">
      <span><b>${esc(p.name)}</b><small>${esc(detail)}</small></span></button></li>`;
  }
  function drawPicked(kind) {
    const id = state[kind], p = group(kind)[id];
    $(`[data-picker="${kind}"] .picked`).innerHTML = p ? `<div class="picked-card">
      <img src="${headshotUrl(id)}" alt="" width="64" height="64" onerror="this.style.visibility='hidden'">
      <div><b>${esc(p.name)}</b><small>${kind === "b" ? (p.hand === "S" ? "Switch hitter" : p.hand === "L" ? "Bats left" : "Bats right") : p.hand === "L" ? "Throws left" : "Throws right"} · ${p.pa} PA sampled</small></div></div>` : "";
  }
  function drawList(kind, query = "") {
    $(`[data-picker="${kind}"] .picker-list`).innerHTML = searchPlayers(group(kind), query).map((p) => playerRow(p.id, p, kind)).join("") || `<li class="muted pad-s">No players match.</li>`;
  }

  // ---------------- the count grid
  function drawCounts() {
    const cells = [];
    for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) {
      const res = evaluate(rates, { ...state, balls: b, strikes: s });
      cells.push(`<button type="button" class="count-cell ${b === state.balls && s === state.strikes ? "now" : ""}" data-lab-count="${b}-${s}">${b}-${s}<b>${res ? rate(res.hr.value) : ""}</b></button>`);
    }
    $("#lab-counts").innerHTML = cells.join("");
  }

  // ---------------- the results
  const barHtml = (value, league, max) => `<div class="bar" aria-hidden="true"><i style="width:${Math.min(value / max, 1) * 100}%"></i><u style="left:${Math.min(league / max, 1) * 100}%"></u></div>`;
  function drawResults() {
    const res = evaluate(rates, state);
    const el = $("#lab-results");
    if (!res) { el.innerHTML = `<p class="muted">Pick a batter and a pitcher.</p>`; return; }
    const b = rates.batters[state.b], p = rates.pitchers[state.p];
    const park = state.park ? rates.park_names[state.park] : "an average park";
    const tile = (label, value, league, max, times) => `
      <div class="lab-tile"><div class="lab-label">${label}</div><div class="lab-number">${value}</div>${barHtml(res[times.key].value, league, max)}
        <div class="lab-ref">${times.text}</div></div>`;
    const hrTimes = res.hr.timesLeague, kTimes = res.k.timesLeague, tbTimes = res.tb.timesLeague;
    el.innerHTML = `
      <h2>${esc(b.name)} vs ${esc(p.name)}</h2>
      <p class="hint">${res.situation.batSide === "L" ? "Left" : "Right"}-handed batter, ${p.hand === "L" ? "left" : "right"}-handed pitcher, at ${esc(park)}, ${state.balls}-${state.strikes} count.</p>
      <div class="lab-tiles">
        ${tile("Home run chance", rate(res.hr.value), res.hr.leagueRate, Math.max(res.hr.value, res.hr.leagueRate) * 1.5, { key: "hr", text: `${hrTimes.toFixed(1)}x the league average (${rate(res.hr.leagueRate)})` })}
        ${tile("Strikeout chance", rate(res.k.value), res.k.leagueRate, Math.max(res.k.value, res.k.leagueRate) * 1.5, { key: "k", text: `${kTimes.toFixed(1)}x the league average (${rate(res.k.leagueRate)})` })}
        ${tile("Expected total bases", res.tb.value.toFixed(2), res.tb.leagueRate, Math.max(res.tb.value, res.tb.leagueRate) * 1.5, { key: "tb", text: `${tbTimes.toFixed(1)}x the league average (${res.tb.leagueRate.toFixed(2)})` })}
      </div>
      ${res.hr.isEstimate ? `<p class="note">One of these players has too little data, so the league average was used for him.</p>` : ""}
      <div class="lab-why">${whyHtml(res.hr, res.situation, openWhy)}</div>`;
  }

  function drawDreams() {
    $("#lab-dreams").innerHTML = dreamMatchups(rates).map((d, i) => `<button type="button" class="dream" data-dream="${i}"><b>${esc(d.title)}</b><small>${esc(d.text)}</small></button>`).join("");
  }

  function syncAddress() {
    const q = new URLSearchParams({ b: state.b, p: state.p, c: `${state.balls}-${state.strikes}` });
    if (state.park) q.set("park", state.park);
    history.replaceState(null, "", `#/lab?${q}`); // (replaceState doesn't trigger the router)
  }

  function redraw() { drawPicked("b"); drawPicked("p"); drawCounts(); drawResults(); syncAddress(); }
  drawList("b"); drawList("p"); drawDreams(); redraw();

  // ---------------- events
  root.addEventListener("input", (e) => {
    const box = e.target.closest(".lab-search");
    if (box) drawList(box.closest("[data-picker]").dataset.picker, box.value);
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "lab-park") { state.park = e.target.value; redraw(); }
  });
  root.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { state[pick.dataset.pick] = pick.dataset.id; const box = $(`[data-picker="${pick.dataset.pick}"] .lab-search`); box.value = ""; drawList(pick.dataset.pick); redraw(); return; }
    const count = e.target.closest("[data-lab-count]");
    if (count) { [state.balls, state.strikes] = count.dataset.labCount.split("-").map(Number); redraw(); return; }
    const dream = e.target.closest("[data-dream]");
    if (dream) { const d = dreamMatchups(rates)[Number(dream.dataset.dream)]; state = { ...state, b: d.b, p: d.p, park: d.park }; $("#lab-park").value = state.park; redraw(); return; }
    const why = e.target.closest("[data-why]");
    if (why) { const key = why.dataset.why; openWhy.has(key) ? openWhy.delete(key) : openWhy.add(key); drawResults(); return; }
    const action = e.target.closest("[data-lab]")?.dataset.lab;
    if (action === "random") {
      const pickOne = (g, min) => { const ids = Object.keys(g).filter((id) => g[id].pa >= min && g[id].name); return ids[Math.floor(Math.random() * ids.length)]; };
      const parks = Object.keys(rates.park_names);
      state = { b: pickOne(rates.batters, MIN_BATTER_PA), p: pickOne(rates.pitchers, MIN_PITCHER_BF), park: parks[Math.floor(Math.random() * parks.length)], balls: Math.floor(Math.random() * 4), strikes: Math.floor(Math.random() * 3) };
      $("#lab-park").value = state.park; redraw();
    } else if (action === "swap") {
      // the batter becomes a pitcher and vice versa, when both exist (many players only appear on one side)
      if (rates.pitchers[state.b] && rates.batters[state.p]) { state = { ...state, b: state.p, p: state.b }; redraw(); }
      else { const note = $("#lab-copied"); note.textContent = "Only players who both bat and pitch can swap sides (like Shohei Ohtani)."; note.hidden = false; setTimeout(() => { note.hidden = true; }, 3500); }
    } else if (action === "share") {
      const url = location.href;
      try {
        if (navigator.share) await navigator.share({ title: "HR Meter matchup", url });
        else { await navigator.clipboard.writeText(url); const note = $("#lab-copied"); note.textContent = "Link copied."; note.hidden = false; setTimeout(() => { note.hidden = true; }, 2500); }
      } catch { /* the person closed the share sheet: nothing to do */ }
    }
  });
  return () => {};
}
