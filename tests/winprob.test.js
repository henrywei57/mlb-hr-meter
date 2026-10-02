import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seriesFromList, wpBefore, wpAtStart, wpAfterAll, wpText, chartPoints } from "../src/winprob.js";

const feed = JSON.parse(readFileSync(new URL("../public/data/demo_game.json", import.meta.url)));
const series = feed._winProb;

test("the saved demo game carries MLB's win probability for every play", () => {
  assert.equal(series.length, 75);
  assert.ok(series.every((p) => p.home >= 0 && p.home <= 100));
  assert.equal(series.at(-1).home, 0);            // the White Sox won, so the Astros end at 0%
});

test("win chance at the start of a play is the chance after the play before it", () => {
  assert.equal(wpBefore(series, 5), series[4].home);
  assert.ok(Math.abs(wpBefore(series, 0) - 50) < 0.5); // before the first pitch it is about 50-50
});

test("wpAtStart only includes plays that already happened, and home + away = 100", () => {
  const s = wpAtStart(series, 10);
  assert.equal(s.series.length, 10);
  assert.ok(Math.abs(s.home + s.away - 100) < 1e-9);
  const end = wpAfterAll(series);
  assert.equal(end.series.length, 75);
  assert.equal(end.away, 100);
});

test("seriesFromList reshapes MLB's list and drops entries without a probability", () => {
  const out = seriesFromList([
    { about: { atBatIndex: 0, inning: 1, isTopInning: true }, homeTeamWinProbability: 44.1, homeTeamWinProbabilityAdded: -5.9, result: { event: "Double" } },
    { about: { atBatIndex: 1, inning: 1, isTopInning: true }, result: { event: "Walk" } },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { i: 0, inning: 1, isTop: true, home: 44.1, added: -5.9, event: "Double" });
});

test("percent text: never 100% or 0% until the game is decided", () => {
  assert.equal(wpText(62.4), "62%");
  assert.equal(wpText(99.9), "99%");
  assert.equal(wpText(0.2), "1%");
  assert.equal(wpText(100, true), "100%");
  assert.equal(wpText(0, true), "0%");
  assert.equal(wpText(NaN), "–");
});

test("the chart starts from the opening 50-50 and adds one point per play", () => {
  const pts = chartPoints(series.slice(0, 3));
  assert.equal(pts.length, 4);
  assert.ok(Math.abs(pts[0].home - 50) < 0.5);
});
