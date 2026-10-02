// Saved pitches: the pitches you chose to keep from games. Each one is stored with everything needed
// to replay it later (its tracked flight path, the players and their handedness), so it works
// offline and after the game is gone. Saved on this device only. No UI code here.

import { loadLocal, saveLocal } from "./util.js";

const KEY = "hr:saved";
const MAX = 300; // keep the list from growing without limit

export const loadSaved = () => loadLocal(KEY) || [];
export const storeSaved = (list) => saveLocal(KEY, list);

export const pitchId = (gamePk, atBatIndex, n) => `${gamePk}-${atBatIndex}-${n}`;
export const isSaved = (list, id) => list.some((item) => item.id === id);

/**
 * Build the item to store.
 * @param game  { pk, date, away: {id,name,abbr}, home: {...} }
 * @param row   one at-bat of the pitch log (batter, pitcher, label, atBatIndex, result)
 * @param pitch the pitch itself (from pitchesOf)
 */
export function makeSaved(game, row, pitch) {
  return {
    id: pitchId(game.pk, row.atBatIndex, pitch.n),
    savedAt: Date.now(),
    game,
    inning: row.label,
    inningNumber: row.inning,
    isTop: row.isTop,
    atBatIndex: row.atBatIndex,
    atBatResult: row.result,
    batter: row.batter,
    pitcher: row.pitcher,
    // the batting team is the away team in the top of an inning
    battingTeamId: row.isTop ? game.away.id : game.home.id,
    fieldingTeamId: row.isTop ? game.home.id : game.away.id,
    pitch,
  };
}

/** Save the pitch if it isn't saved yet, or remove it if it is. Returns a new list. */
export function toggleSaved(list, item) {
  if (isSaved(list, item.id)) return list.filter((x) => x.id !== item.id);
  return [item, ...list].slice(0, MAX);
}

/** Group for the Saved screen: newest game first, innings in order, pitches in order. */
export function groupSaved(list) {
  const games = new Map();
  for (const item of list) {
    const key = String(item.game.pk);
    if (!games.has(key)) games.set(key, { game: item.game, newest: item.savedAt, innings: new Map() });
    const g = games.get(key);
    g.newest = Math.max(g.newest, item.savedAt);
    const order = item.inningNumber * 2 + (item.isTop ? 0 : 1);
    if (!g.innings.has(item.inning)) g.innings.set(item.inning, { label: item.inning, order, items: [] });
    g.innings.get(item.inning).items.push(item);
  }
  return [...games.values()]
    .sort((a, b) => b.newest - a.newest)
    .map((g) => ({
      game: g.game,
      innings: [...g.innings.values()].sort((a, b) => a.order - b.order)
        .map((i) => ({ ...i, items: i.items.sort((a, b) => a.atBatIndex - b.atBatIndex || a.pitch.n - b.pitch.n) })),
    }));
}
