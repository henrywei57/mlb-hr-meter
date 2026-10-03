// Everything that talks to the network or loads a data file lives here.
// The MLB Stats API allows requests straight from the browser (CORS is open), so no proxy needed.

import { MLB_API, RATES_FILE, TEAM_COLORS_FILE, DEMO_GAME_FILE } from "./config.js";
import { seriesFromList } from "./winprob.js";

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

// Every game of a season (optionally just one team's): the regular season and the postseason.
export async function fetchSeasonSchedule({ season, teamId = null, gameTypes = "R,F,D,L,W" }) {
  const team = teamId ? `&teamId=${teamId}` : "";
  const url = `${MLB_API}/v1/schedule?sportId=1&season=${season}&gameType=${gameTypes}${team}&hydrate=team,linescore`;
  const data = await getJson(url);
  return data.dates.flatMap((d) => d.games);
}

// The most recent day (up to `today`) that had a finished game, looking back about six weeks.
export async function fetchLatestGameDate(today, startDate) {
  const data = await getJson(`${MLB_API}/v1/schedule?sportId=1&startDate=${startDate}&endDate=${today}`);
  const days = data.dates.filter((d) => d.games.some((g) => g.status.abstractGameState === "Final")).map((d) => d.date);
  return days.at(-1) || null;
}

// The 30 teams of a season (franchises change names: "Cleveland Indians" became "Guardians").
export async function fetchTeams(season) {
  const data = await getJson(`${MLB_API}/v1/teams?sportId=1&season=${season}`);
  return data.teams.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));
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

// Regular-season AVG / HR / OPS for several batters at once (one request instead of one each).
export async function fetchBatterLines(ids, season) {
  const lines = {};
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    try {
      const hydrate = `stats(group=[hitting],type=[season],season=${season},gameType=R)`;
      const data = await getJson(`${MLB_API}/v1/people?personIds=${chunk.join(",")}&hydrate=${hydrate}`);
      for (const person of data.people) {
        const stat = person.stats?.[0]?.splits?.[0]?.stat;
        if (stat) lines[String(person.id)] = { avg: stat.avg, hr: stat.homeRuns, ops: stat.ops };
      }
    } catch { /* a missing batch just means dashes on the screen */ }
  }
  return lines;
}

// Any finished game from the Statcast era, ready to replay: its feed, MLB's win probability for every
// play, and its batters' season lines. (Same shape as the saved demo game.)
export async function loadHistoricalGame(gamePk) {
  const [feed, wpList] = await Promise.all([fetchFeed(gamePk), getJson(`${MLB_API}/v1/game/${gamePk}/winProbability`).catch(() => [])]);
  feed._winProb = seriesFromList(wpList);
  const ids = [...new Set(feed.liveData.plays.allPlays.map((p) => String(p.matchup.batter.id)))];
  feed._batterLines = await fetchBatterLines(ids, feed.gameData.game.season);
  return feed;
}

// ---- Files shipped with the app ----
// Which seasons have their own rates file (public/data/rates/<season>.json), and one of those files.
export const loadRatesIndex = () => getJson("public/data/rates/index.json").catch(() => ({ seasons: [] }));
export const loadRatesFile = (file) => getJson(file);
// The curated list of famous games shown in the browser.
export const loadClassics = () => getJson("public/data/classics.json").catch(() => []);
export const loadRates = () => getJson(RATES_FILE);
export const loadTeamColors = () => getJson(TEAM_COLORS_FILE);
export const loadDemoFeed = () => getJson(DEMO_GAME_FILE);
