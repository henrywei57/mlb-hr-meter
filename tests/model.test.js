// Run with: npm test   (uses Node's built-in test runner, nothing to install)
import { test } from "node:test";
import assert from "node:assert/strict";
import { log5, predictHomeRun } from "../src/model.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

// A tiny fake rates.json: league 3%, one slugger, one stingy pitcher, one hitter-friendly park.
const rates = {
  league: { hr_per_pa: 0.03 },
  count_multipliers: {
    "0-0": { multiplier: 1 },
    "3-1": { multiplier: 1.5 },
    "0-2": { multiplier: 0.6 },
  },
  park_hr_factors: { 1: 100, 2: 120 },
  batters: {
    slugger: { rate: 0.06, vsL: { rate: 0.06 }, vsR: { rate: 0.066 } },
    average: { rate: 0.03, vsL: { rate: 0.03 }, vsR: { rate: 0.03 } },
  },
  pitchers: {
    stingy: { rate: 0.02, vsL: { rate: 0.02 }, vsR: { rate: 0.02 } },
    average: { rate: 0.03, vsL: { rate: 0.03 }, vsR: { rate: 0.03 } },
  },
};

const base = { batterId: "average", pitcherId: "average", batSide: "R", pitchHand: "R", venueId: 1, balls: 0, strikes: 0 };

test("log5: a league-average pitcher leaves the batter's rate unchanged", () => {
  close(log5(0.06, 0.03, 0.03), 0.06);
});

test("log5: a league-average batter leaves the pitcher's rate unchanged", () => {
  close(log5(0.03, 0.02, 0.03), 0.02);
});

test("log5: slugger vs stingy pitcher lands between the two rates", () => {
  const p = log5(0.06, 0.02, 0.03);
  assert.ok(p > 0.02 && p < 0.06);
});

test("average batter, average pitcher, average park, 0-0 = the league rate", () => {
  close(predictHomeRun(rates, base).probability, 0.03);
});

test("a hitter-friendly park (120) scales the chance by 1.2", () => {
  const r = predictHomeRun(rates, { ...base, venueId: 2 });
  close(r.probability, 0.03 * 1.2);
  close(r.factors.park, 1.2);
});

test("a 3-1 count multiplies by the 3-1 table value; 0-2 shrinks it", () => {
  close(predictHomeRun(rates, { ...base, balls: 3, strikes: 1 }).probability, 0.03 * 1.5);
  close(predictHomeRun(rates, { ...base, balls: 0, strikes: 2 }).probability, 0.03 * 0.6);
});

test("unknown count or park falls back to a neutral 1.0x", () => {
  const r = predictHomeRun(rates, { ...base, venueId: 999, balls: 2, strikes: 2 });
  close(r.probability, 0.03);
});

test("a slugger beats the league average and shows the right batter factor", () => {
  const r = predictHomeRun(rates, { ...base, batterId: "slugger" });
  assert.ok(r.probability > 0.05);
  close(r.factors.batter, 2);
});

test("a stingy pitcher lowers the chance", () => {
  const r = predictHomeRun(rates, { ...base, pitcherId: "stingy" });
  assert.ok(r.probability < 0.03);
  close(r.factors.pitcher, 2 / 3);
});

test("platoon: the slugger does better against righties, so the factor is above 1", () => {
  const r = predictHomeRun(rates, { ...base, batterId: "slugger", pitchHand: "R" });
  assert.ok(r.factors.platoon > 1);
});

test("the shown factors multiply back to the final probability", () => {
  const r = predictHomeRun(rates, {
    ...base, batterId: "slugger", pitcherId: "stingy", venueId: 2, balls: 3, strikes: 1,
  });
  const f = r.factors;
  close(r.leagueRate * f.batter * f.pitcher * f.platoon * f.count * f.park, r.probability);
});

test("the league handedness matchup rate is the baseline, and shows up as the platoon factor", () => {
  // Lefty batters hit 3.6% of PAs for homers against righties; everyone else is at 3.0%.
  const withMatchup = {
    ...rates,
    league: { hr_per_pa: 0.03, matchup: { L: { R: 0.036 } } },
    batters: { avgLefty: { rate: 0.03, vsR: { rate: 0.036 }, vsL: { rate: 0.03 } } },
    pitchers: { avgRighty: { rate: 0.03, vsL: { rate: 0.036 }, vsR: { rate: 0.03 } } },
  };
  const r = predictHomeRun(withMatchup, { ...base, batterId: "avgLefty", pitcherId: "avgRighty", batSide: "L", pitchHand: "R" });
  close(r.probability, 0.036); // average lefty vs average righty = the matchup's league rate, not counted twice
  close(r.factors.platoon, 1.2); // 0.036 / 0.03
});

test("missing player: uses league average and is flagged as an estimate", () => {
  const r = predictHomeRun(rates, { ...base, batterId: "nobody" });
  assert.equal(r.isEstimate, true);
  assert.equal(r.missing.batter, true);
  close(r.probability, 0.03);
});

test("known players are not flagged as estimates", () => {
  assert.equal(predictHomeRun(rates, base).isEstimate, false);
});

test("probability is capped so it can never be absurd", () => {
  const wild = { ...rates, park_hr_factors: { 1: 100000 } };
  assert.ok(predictHomeRun(wild, base).probability <= 0.6);
});
