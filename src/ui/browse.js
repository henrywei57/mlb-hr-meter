// Screen: Find a game. Every game since Statcast began in 2015 (and today's), found by day, by a
// team's season, or by postseason series, plus a shelf of famous games. Tap any finished game to
// play it back. The choices live in the address (#/browse?mode=...), so a search can be shared.

import { fetchSchedule, fetchSeasonSchedule, fetchTeams, loadClassics, fetchLatestGameDate } from "../api.js";
import { esc, mlbDateString } from "../util.js";
import { STATCAST_START, shiftDate, clampDate, seasonOptions, seasonOf, gameLink, teamResult, groupByMonth, groupBySeries } from "../library.js";

const MODES = [["date", "By date"], ["team", "Team & season"], ["post", "Postseason"]];

// "Final", or "Final/12" when it went extra innings
function statusText(game) {
  const s = game.status;
  if (s.abstractGameState !== "Final") return s.detailedState || "Scheduled";
  const innings = game.linescore?.currentInning;
  return innings && innings !== 9 ? `Final/${innings}` : "Final";
}

export function showBrowse(root, { colors }) {
  const latest = mlbDateString();
  const latestSeason = seasonOf(latest);
  const seasons = seasonOptions(latestSeason);
  const teamCache = new Map(); // season -> [{ id, name }]
  let loadToken = 0;

  // ---- the state (from the address, with sensible defaults)
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const mode = MODES.some(([m]) => m === params.get("mode")) ? params.get("mode") : "date";
  const state = {
    mode,
    date: clampDate(params.get("date") || shiftDate(latest, -1), latest),
    season: seasons.includes(Number(params.get("season"))) ? Number(params.get("season")) : latestSeason - 1,
    teamId: params.get("team") ? Number(params.get("team")) : null,
  };

  root.innerHTML = `
    <header class="top"><a class="back" href="#/">‹ Games</a><h1>Find a game</h1><span></span></header>
    <p class="hint lab-intro">Every game since Statcast began in 2015. Pick a day, a team's season or a postseason, then tap a game to play it back pitch by pitch.</p>
    <div class="browse-grid">
      <div class="col">
        <section class="card">
          <div class="stage-controls filter-row" role="tablist" aria-label="How to find a game">
            ${MODES.map(([m, label]) => `<button type="button" class="chip-btn" role="tab" data-mode="${m}">${label}</button>`).join("")}
            <button type="button" class="chip-btn" data-random>Random game</button>
          </div>
          <div id="controls"></div>
        </section>
        <section class="card" id="results"><p class="hint">Loading…</p></section>
      </div>
      <div class="col"><section class="card" id="classics"><h2>Famous games</h2><p class="hint">Loading…</p></section></div>
    </div>`;
  const $ = (sel) => root.querySelector(sel);

  // ---------------------------------------------------------------- the pieces
  const seasonSelect = () => `<select id="season" aria-label="Season">${seasons.map((y) => `<option value="${y}" ${y === state.season ? "selected" : ""}>${y}</option>`).join("")}</select>`;

  async function teamsFor(season) {
    if (!teamCache.has(season)) teamCache.set(season, await fetchTeams(season));
    return teamCache.get(season);
  }

  async function drawControls() {
    for (const b of root.querySelectorAll("[data-mode]")) {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on);
    }
    const el = $("#controls");
    if (state.mode === "date") {
      el.innerHTML = `<div class="date-row">
        <button type="button" class="chip-btn" data-day="-1" aria-label="Previous day">‹</button>
        <input type="date" id="date" min="${STATCAST_START}" max="${latest}" value="${state.date}" aria-label="Date">
        <button type="button" class="chip-btn" data-day="1" aria-label="Next day">›</button></div>
        <p class="note">Pitch tracking goes back to April 5, 2015.</p>`;
    } else if (state.mode === "post") {
      el.innerHTML = `<div class="select-row"><label>Season ${seasonSelect()}</label></div>`;
    } else {
      el.innerHTML = `<div class="select-row"><label>Season ${seasonSelect()}</label><label>Team <select id="team"><option>Loading…</option></select></label></div>`;
      try {
        const teams = await teamsFor(state.season);
        if (!teams.some((t) => t.id === state.teamId)) state.teamId = teams[0].id;
        const select = $("#team");
        if (select) select.innerHTML = teams.map((t) => `<option value="${t.id}" ${t.id === state.teamId ? "selected" : ""}>${esc(t.name)}</option>`).join("");
      } catch { $("#team")?.replaceChildren(new Option("Couldn't load teams")); }
    }
  }

  // one game as a card
  const gameCard = (g) => {
    const away = g.teams.away, home = g.teams.home;
    const showScore = g.status.abstractGameState === "Final" || g.status.abstractGameState === "Live";
    const extra = g.gameType !== "R" ? `<small class="series-tag">${esc(g.seriesDescription || "Postseason")}${g.seriesGameNumber ? ` · Game ${g.seriesGameNumber}` : ""}</small>` : "";
    return `<a class="game-card ${g.status.abstractGameState === "Final" ? "final" : ""}" href="${gameLink(g)}">
      <span class="teams">
        <span class="team-line"><span>${esc(away.team.teamName || away.team.name)}</span>${showScore ? `<b>${away.score ?? 0}</b>` : ""}</span>
        <span class="team-line"><span>${esc(home.team.teamName || home.team.name)}</span>${showScore ? `<b>${home.score ?? 0}</b>` : ""}</span>
        ${extra}
      </span>
      <span class="status">${esc(statusText(g))}${g.officialDate && state.mode !== "date" ? `<small>${esc(g.officialDate)}</small>` : ""}</span>
    </a>`;
  };

  // a compact row for one team's season: "Apr 4 · @ Angels   W 9-0"
  const teamRow = (g) => {
    const mine = g.teams.away.team.id === state.teamId ? g.teams.away : g.teams.home;
    const theirs = mine === g.teams.away ? g.teams.home : g.teams.away;
    const result = teamResult(g, state.teamId);
    const day = new Date(`${g.officialDate}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
    const post = g.gameType !== "R" ? ` <small class="series-tag">${esc(g.seriesDescription || "Postseason")}</small>` : "";
    return `<a class="game-card compact" href="${gameLink(g)}">
      <span class="teams"><span class="team-line"><span>${day} · ${mine === g.teams.away ? "@" : "vs"} ${esc(theirs.team.teamName || theirs.team.name)}${post}</span>
      <b class="result ${result[0] === "W" ? "win" : result[0] === "L" ? "loss" : ""}">${esc(result || statusText(g))}</b></span></span></a>`;
  };

  const message = (text) => { $("#results").innerHTML = `<p class="hint">${esc(text)}</p>`; };

  // ---------------------------------------------------------------- loading the list
  async function loadResults() {
    const token = ++loadToken;
    syncAddress();
    message("Loading games…");
    try {
      let html = "";
      if (state.mode === "date") {
        const games = await fetchSchedule(state.date);
        html = games.length ? `<h2>${esc(state.date)}</h2><div class="game-grid-list">${games.map(gameCard).join("")}</div>` : "";
        if (!html) html = `<p class="hint">No MLB games on ${esc(state.date)}. Try another day.</p>`;
      } else if (state.mode === "team") {
        if (!state.teamId) await drawControls();
        const games = await fetchSeasonSchedule({ season: state.season, teamId: state.teamId });
        html = groupByMonth(games).map((g) => `<h2 class="spaced">${esc(g.label)}</h2>${g.games.map(teamRow).join("")}`).join("")
          || `<p class="hint">No games found.</p>`;
        html = `<p class="hint">${games.length} games, including the postseason. Tap one to play it.</p>` + html;
      } else {
        const games = (await fetchSeasonSchedule({ season: state.season, gameTypes: "F,D,L,W" })).filter((g) => g.status.abstractGameState === "Final");
        html = groupBySeries(games).map((s) => `<h2 class="spaced">${esc(s.label)}: ${esc(s.teams.away.team.name)} vs ${esc(s.teams.home.team.name)}</h2><div class="game-grid-list">${s.games.map(gameCard).join("")}</div>`).join("")
          || `<p class="hint">No postseason games found for ${state.season}.</p>`;
      }
      if (token === loadToken) $("#results").innerHTML = html;
    } catch {
      if (token === loadToken) message("Couldn't load games from MLB. Check your connection and try again.");
    }
  }

  function syncAddress() {
    const q = new URLSearchParams({ mode: state.mode });
    if (state.mode === "date") q.set("date", state.date);
    else { q.set("season", state.season); if (state.mode === "team" && state.teamId) q.set("team", state.teamId); }
    history.replaceState(null, "", `#/browse?${q}`); // (doesn't trigger the router)
  }

  // ---------------------------------------------------------------- famous games
  async function drawClassics() {
    const list = await loadClassics();
    $("#classics").innerHTML = `<h2>Famous games</h2>` + (list.length ? list.map((c) => `
      <a class="classic" href="#/replay/${c.gamePk}">
        <b>${esc(c.title)}</b>
        <span class="muted">${esc(c.away)} ${c.awayScore ?? ""} @ ${esc(c.home)} ${c.homeScore ?? ""} · ${esc(c.date)}</span>
        <small>${esc(c.blurb)}</small>
      </a>`).join("") : `<p class="hint">Couldn't load the list.</p>`);
  }

  // ---------------------------------------------------------------- a random finished game
  async function randomGame(button) {
    button.disabled = true; button.textContent = "Finding one…";
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const year = 2015 + Math.floor(Math.random() * (latestSeason - 2015 + 1));
        const day = new Date(Date.UTC(year, 3, 5 + Math.floor(Math.random() * 175)));  // April to late September
        const date = clampDate(day.toISOString().slice(0, 10), latest);
        const games = (await fetchSchedule(date)).filter((g) => g.status.abstractGameState === "Final");
        if (games.length) { location.hash = gameLink(games[Math.floor(Math.random() * games.length)]); return; }
      }
      message("Couldn't find a game. Try again.");
    } catch {
      message("Couldn't reach MLB. Try again.");
    }
    button.disabled = false; button.textContent = "Random game";
  }

  // ---------------------------------------------------------------- events
  root.addEventListener("click", async (e) => {
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) { state.mode = modeBtn.dataset.mode; await drawControls(); loadResults(); return; }
    const dayBtn = e.target.closest("[data-day]");
    if (dayBtn) { state.date = clampDate(shiftDate(state.date, Number(dayBtn.dataset.day)), latest); await drawControls(); loadResults(); return; }
    const random = e.target.closest("[data-random]");
    if (random) randomGame(random);
  });
  root.addEventListener("change", async (e) => {
    if (e.target.id === "date") { state.date = clampDate(e.target.value, latest); await drawControls(); loadResults(); }
    else if (e.target.id === "season") { state.season = Number(e.target.value); await drawControls(); loadResults(); }
    else if (e.target.id === "team") { state.teamId = Number(e.target.value); loadResults(); }
  });

  drawClassics();
  (async () => {
    // With no date in the address, start on the most recent day that had games
    if (state.mode === "date" && !params.get("date")) {
      try { state.date = clampDate((await fetchLatestGameDate(latest, shiftDate(latest, -45))) || state.date, latest); } catch { /* keep the default */ }
    }
    await drawControls();
    loadResults();
  })();
  return () => { loadToken++; };
}
