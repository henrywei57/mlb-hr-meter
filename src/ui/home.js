// Screen 1: Today's Games. Live games first, then upcoming, then finished.

import { fetchSchedule } from "../api.js";
import { esc, mlbDateString, saveLocal, loadLocal } from "../util.js";
import { getSettings, saveSettings } from "../settings.js";
import { THEMES, currentTheme, applyTheme } from "../theme.js";

const REFRESH_MS = 30000;

function statusInfo(game) {
  const state = game.status.abstractGameState; // "Live", "Preview" or "Final"
  const line = game.linescore;
  if (state === "Live") {
    const where = line?.currentInningOrdinal ? `${line.inningState || line.inningHalf} ${line.currentInningOrdinal}` : "In progress";
    return { rank: 0, text: where, kind: "live" };
  }
  if (state === "Final") return { rank: 2, text: game.status.detailedState, kind: "final" };
  const time = new Date(game.gameDate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const odd = ["Postponed", "Suspended", "Cancelled"].includes(game.status.detailedState);
  return { rank: 1, text: odd ? game.status.detailedState : time, kind: "upcoming" };
}

function sortGames(games) {
  return games
    .map((game) => ({ game, status: statusInfo(game) }))
    .sort((a, b) => a.status.rank - b.status.rank || new Date(a.game.gameDate) - new Date(b.game.gameDate));
}

function gameCard({ game, status }) {
  const away = game.teams.away;
  const home = game.teams.home;
  const showScore = status.kind !== "upcoming";
  return `
    <a class="game-card ${status.kind}" href="#/game/${game.gamePk}">
      <span class="teams">
        <span class="team-line"><span>${esc(away.team.teamName || away.team.name)}</span>${showScore ? `<b>${away.score ?? 0}</b>` : ""}</span>
        <span class="team-line"><span>${esc(home.team.teamName || home.team.name)}</span>${showScore ? `<b>${home.score ?? 0}</b>` : ""}</span>
      </span>
      <span class="status ${status.kind}">${status.kind === "live" ? '<i class="dot"></i>' : ""}${esc(status.text)}</span>
    </a>`;
}

export function showHome(root) {
  const today = mlbDateString();
  const yesterday = mlbDateString(new Date(Date.now() - 24 * 3600 * 1000));
  const cacheKey = `hr:schedule:${today}`;
  let timer = null;
  let stopped = false;

  root.innerHTML = `
    <header class="top"><h1>Today's Games</h1></header>
    <div class="actions">
      <a class="demo-button" href="#/demo">Demo game <small>replay a real playoff game with 4 home runs</small></a>
    </div>
    <details class="card settings">
      <summary>Settings</summary>
      <div class="setting">Theme
        <div class="theme-picker" role="radiogroup" aria-label="Theme">
          ${Object.entries(THEMES).map(([key, t]) => `
            <button type="button" class="theme-swatch ${key === currentTheme() ? "on" : ""}" role="radio" aria-checked="${key === currentTheme()}" data-theme-pick="${key}">
              <span class="swatch-dots">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join("")}</span>${t.label}
            </button>`).join("")}
        </div>
      </div>
      <label class="setting">Glow and buzz when the chance is at least
        <select id="spike-select">
          ${[1.5, 2, 3, 4].map((m) => `<option value="${m}" ${getSettings().spikeMultiple === m ? "selected" : ""}>${m}x the league average</option>`).join("")}
        </select>
      </label>
      <label class="check setting"><input type="checkbox" id="vibrate-toggle" ${getSettings().vibrate ? "checked" : ""}> Vibrate (Android only; iPhone doesn't support it)</label>
    </details>
    <div id="notice" class="banner" hidden></div>
    <div id="games"><p class="hint">Loading games…</p></div>`;
  root.querySelector(".theme-picker").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-theme-pick]");
    if (!pick) return;
    applyTheme(pick.dataset.themePick, true);
    for (const b of root.querySelectorAll(".theme-swatch")) {
      const on = b === pick;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    }
  });
  root.querySelector("#spike-select").addEventListener("change", (e) => saveSettings({ spikeMultiple: Number(e.target.value) }));
  root.querySelector("#vibrate-toggle").addEventListener("change", (e) => saveSettings({ vibrate: e.target.checked }));
  const gamesEl = root.querySelector("#games");
  const noticeEl = root.querySelector("#notice");

  function draw(games) {
    if (!games.length) { gamesEl.innerHTML = `<p class="hint">No MLB games today. Try the demo game above.</p>`; return; }
    gamesEl.innerHTML = sortGames(games).map(gameCard).join("");
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      // Also load yesterday's slate: late games can still be live after midnight Eastern.
      const [todays, earlier] = await Promise.all([fetchSchedule(today), fetchSchedule(yesterday).catch(() => [])]);
      const seen = new Set(todays.map((g) => g.gamePk));
      const games = todays.concat(earlier.filter((g) => g.status.abstractGameState === "Live" && !seen.has(g.gamePk)));
      if (stopped) return;
      saveLocal(cacheKey, games);
      noticeEl.hidden = true;
      draw(games);
    } catch {
      if (stopped) return;
      const cached = loadLocal(cacheKey);
      if (cached) draw(cached);
      noticeEl.hidden = false;
      noticeEl.textContent = "No connection. Showing the last list we loaded. Retrying…";
      if (!cached) gamesEl.innerHTML = `<p class="hint">Can't load games right now. You can still try the demo game.</p>`;
    }
    if (!stopped) timer = setTimeout(refresh, REFRESH_MS);
  }
  refresh();

  return () => { stopped = true; clearTimeout(timer); }; // called when leaving this screen
}
