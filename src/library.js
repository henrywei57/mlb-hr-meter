// Helpers for the game browser ("Find a game") and replays. Pure functions, no browser code, so
// they are unit tested.

// Statcast pitch tracking starts with the 2015 season (the 2015 opener was April 5).
export const STATCAST_START = "2015-04-05";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---------------------------------------------------------------- dates
export function shiftDate(dateString, days) {
  const d = new Date(dateString + "T12:00:00Z"); // noon UTC, so daylight saving can't move the day
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Keep a YYYY-MM-DD date between the start of Statcast and `latest`. Bad input becomes `latest`. */
export function clampDate(dateString, latest) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) return latest;
  if (dateString < STATCAST_START) return STATCAST_START;
  return dateString > latest ? latest : dateString;
}

/** Seasons to choose from, newest first: [2026, 2025, ... 2015]. */
export function seasonOptions(latestSeason) {
  return Array.from({ length: latestSeason - 2015 + 1 }, (_, i) => latestSeason - i);
}

export const seasonOf = (dateString) => Number(String(dateString).slice(0, 4));

// ---------------------------------------------------------------- games from the schedule
const isFinal = (game) => game.status?.abstractGameState === "Final";

/** Where tapping a game should go: a replay for finished games, the live screen for the rest. */
export const gameLink = (game) => (isFinal(game) ? `#/replay/${game.gamePk}` : `#/game/${game.gamePk}`);

/** "W 6-1" or "L 2-5" from one team's point of view (or "" if the game isn't final). */
export function teamResult(game, teamId) {
  if (!isFinal(game)) return "";
  const { away, home } = game.teams;
  const mine = away.team.id === teamId ? away : home;
  const theirs = mine === away ? home : away;
  if (mine.score == null || theirs.score == null) return "";
  return `${mine.score > theirs.score ? "W" : mine.score < theirs.score ? "L" : "T"} ${mine.score}-${theirs.score}`;
}

/** Group games by month, in date order: [{ label: "April 2016", games: [...] }]. */
const dayOf = (game) => game.officialDate || (game.gameDate || "").slice(0, 10);
// Sort by the official date first (a rescheduled game keeps its original start time in gameDate).
const byDay = (a, b) => dayOf(a).localeCompare(dayOf(b)) || (a.gameDate || "").localeCompare(b.gameDate || "");

export function groupByMonth(games) {
  const sorted = [...games].sort(byDay);
  const groups = [];
  for (const game of sorted) {
    const date = dayOf(game);
    const label = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) { g = { label, games: [] }; groups.push(g); }
    g.games.push(game);
  }
  return groups;
}

// Round order, matched by keyword in MLB's series names ("NL Wild Card Game", "AL Division Series",
// "NL Championship Series", "World Series").
const ROUND_KEYWORDS = ["Wild Card", "Division", "Championship", "World Series"];
const roundRank = (label) => { const i = ROUND_KEYWORDS.findIndex((k) => label.includes(k)); return i < 0 ? 99 : i; };

/** Group postseason games by series, in round order: [{ label, games }]. */
export function groupBySeries(games) {
  const bySeries = new Map();
  for (const game of [...games].sort(byDay)) {
    const key = `${game.seriesDescription || "Postseason"}|${[game.teams.away.team.id, game.teams.home.team.id].sort().join("-")}`;
    if (!bySeries.has(key)) bySeries.set(key, { label: game.seriesDescription || "Postseason", teams: game.teams, games: [] });
    bySeries.get(key).games.push(game);
  }
  return [...bySeries.values()].sort((a, b) => roundRank(a.label) - roundRank(b.label) || byDay(a.games[0], b.games[0]));
}

// ---------------------------------------------------------------- replay controls
/** The innings of a game for the "Jump to inning" menu: [{ label: "Top 3rd", step }] (step = which at-bat). */
export function inningStops(frames, ordinal) {
  const stops = [];
  frames.forEach((f, step) => {
    const label = `${f.play.about.isTopInning ? "Top" : "Bot"} ${ordinal(f.play.about.inning)}`;
    if (!stops.length || stops[stops.length - 1].label !== label) stops.push({ label, step });
  });
  return stops;
}

// ---------------------------------------------------------------- which rates file for which season
/**
 * Choose the rates file for a game's season.
 * @param season     the season the game was played in
 * @param available  seasons that have their own file (from rates/index.json)
 * @param current    the season that rates.json itself covers
 * @returns a URL, or null if there is nothing season-specific (use rates.json as a stand-in)
 */
export function ratesFileFor(season, available, current) {
  if (season >= current) return null;                    // rates.json already is the current season
  return available.includes(season) ? `public/data/rates/${season}.json` : null;
}
