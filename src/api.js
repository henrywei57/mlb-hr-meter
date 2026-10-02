// Everything that talks to the network or loads a data file lives here.
// The MLB Stats API allows requests straight from the browser (CORS is open), so no proxy needed.

import { MLB_API, RATES_FILE, TEAM_COLORS_FILE, DEMO_GAME_FILE } from "./config.js";

// `fresh` = skip the browser's HTTP cache (used for live data so we never see a stale copy).
async function getJson(url, fresh = false) {
  const response = await fetch(url, fresh ? { cache: "no-store" } : undefined);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

// ---- MLB Stats API ----

// Today's games. `date` is "YYYY-MM-DD" in the user's local time.
export async function fetchSchedule(date) {
  const url = `${MLB_API}/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore`;
  const data = await getJson(url, true);
  return data.dates[0]?.games ?? [];
}

// The full live feed for one game (big JSON: every pitch of the game).
export function fetchFeed(gamePk) {
  return getJson(`${MLB_API}/v1.1/game/${gamePk}/feed/live`, true);
}

// Win probability from MLB: the current chance (tiny), and the whole game's play-by-play series
// (about 130 KB compressed, so we only ask for it when a play has finished).
export const fetchContextMetrics = (gamePk) => getJson(`${MLB_API}/v1/game/${gamePk}/contextMetrics`, true);
export const fetchWinProbabilityList = (gamePk) => getJson(`${MLB_API}/v1/game/${gamePk}/winProbability`, true);

// Regular-season AVG / HR / OPS for a batter. Cached so we only ask once per player.
// (The live feed's own "season stats" are postseason-only in October, so we ask separately.)
const lineCache = new Map();
export async function fetchBatterLine(playerId, season) {
  if (lineCache.has(playerId)) return lineCache.get(playerId);
  try {
    const hydrate = `stats(group=[hitting],type=[season],season=${season},gameType=R)`;
    const data = await getJson(`${MLB_API}/v1/people?personIds=${playerId}&hydrate=${hydrate}`);
    const stat = data.people[0]?.stats?.[0]?.splits?.[0]?.stat;
    const line = stat ? { avg: stat.avg, hr: stat.homeRuns, ops: stat.ops } : null;
    lineCache.set(playerId, line);
    return line;
  } catch {
    return null; // not fatal; the screen just shows dashes
  }
}

// ---- Files shipped with the app ----
export const loadRates = () => getJson(RATES_FILE);
export const loadTeamColors = () => getJson(TEAM_COLORS_FILE);
export const loadDemoFeed = () => getJson(DEMO_GAME_FILE);
