// "Call a homer": the player predicts a home run before the at-bat ends, and we keep score.
// This file has no browser UI code (just localStorage), so the scoring is easy to read and test.
//
// A call looks like:
// { id, gamePk, atBatIndex, batterId, batterName, pitcherName, chance, madeAt, isDemo,
//   status: "pending" | "hit" | "miss", resultText }
//
// Scoring: a hit pays round(1 / chance) points, a miss costs 1. So calling a 3% long shot that
// lands is worth about 33 points, but calling a 20% batter is only worth 5. Risky calls pay more.

import { loadLocal, saveLocal } from "./util.js";

const STORAGE_KEY = "hr:calls";

export const loadCalls = () => loadLocal(STORAGE_KEY) || [];
export const saveCalls = (calls) => saveLocal(STORAGE_KEY, calls);

export function newCall({ gamePk, current, chance, isDemo }) {
  return {
    id: `${gamePk}-${current.atBatIndex}`,
    gamePk: String(gamePk),
    atBatIndex: current.atBatIndex,
    batterId: current.batter.id,
    batterName: current.batter.name,
    pitcherName: current.pitcher.name,
    chance,
    madeAt: Date.now(),
    isDemo: !!isDemo,
    status: "pending",
    resultText: "",
  };
}

// Points for one resolved call.
export function pointsFor(call) {
  if (call.status === "hit") return Math.round(1 / Math.max(call.chance, 0.01));
  if (call.status === "miss") return -1;
  return 0;
}

// Add a call (replacing any earlier call on the same at-bat).
export const withCall = (calls, call) => [...calls.filter((c) => c.id !== call.id), call];

// Take back a call that hasn't been decided yet.
export const withoutPending = (calls, id) => calls.filter((c) => !(c.id === id && c.status === "pending"));

// Look through the finished at-bats and settle any pending call for this game.
// A call settles on the first finished at-bat at or after its index by the same batter.
// Returns the updated list plus the calls that were just settled (for the pop-up message).
export function resolveCalls(calls, gamePk, history) {
  const settled = [];
  const updated = calls.map((call) => {
    if (call.status !== "pending" || call.gamePk !== String(gamePk)) return call;
    const row = history.find((h) => h.id >= call.atBatIndex && h.situation.batterId === call.batterId);
    if (!row) return call;
    const done = { ...call, status: row.isHR ? "hit" : "miss", resultText: row.result };
    settled.push(done);
    return done;
  });
  return { calls: updated, settled };
}

// Everything the tracker screen shows.
export function computeStats(calls) {
  const done = calls.filter((c) => c.status !== "pending").sort((a, b) => a.madeAt - b.madeAt);
  const hits = done.filter((c) => c.status === "hit");

  let streak = 0;
  let bestStreak = 0;
  for (const c of done) {
    streak = c.status === "hit" ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }

  const expectedHits = done.reduce((sum, c) => sum + c.chance, 0); // what the model thought would happen
  const bestCall = hits.length ? hits.reduce((a, b) => (b.chance < a.chance ? b : a)) : null;

  return {
    total: done.length,
    pending: calls.length - done.length,
    hits: hits.length,
    hitRate: done.length ? hits.length / done.length : 0,
    expectedHits,
    points: done.reduce((sum, c) => sum + pointsFor(c), 0),
    currentStreak: streak,
    bestStreak,
    avgChance: done.length ? expectedHits / done.length : 0,
    bestCall,
  };
}
