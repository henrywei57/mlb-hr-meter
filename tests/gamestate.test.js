// Checks the demo replay logic against the real saved game (public/data/demo_game.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDemoFrames, demoStateAt, scoreState, stateFromLiveFeed, ordinal } from "../src/gamestate.js";

const feed = JSON.parse(readFileSync(new URL("../public/data/demo_game.json", import.meta.url)));
const rates = JSON.parse(readFileSync(new URL("../public/data/rates.json", import.meta.url)));
const frames = buildDemoFrames(feed);

test("ordinal numbers", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
});

test("the demo game has at least two home runs (the point of the demo)", () => {
  const homers = frames.filter((f) => f.play.result.eventType === "home_run");
  assert.ok(homers.length >= 2);
});

test("every replay step is a sensible state", () => {
  for (let step = 0; step <= frames.length; step++) {
    const s = demoStateAt(feed, frames, step);
    assert.equal(s.history.length, step);
    if (step < frames.length) {
      assert.ok(s.outs >= 0 && s.outs <= 2, `outs ${s.outs} at step ${step}`);
      assert.ok(s.balls <= 3 && s.strikes <= 2, `count ${s.balls}-${s.strikes} at step ${step}`);
      assert.ok(s.current.batter.id && s.current.pitcher.hand);
    } else {
      assert.equal(s.isFinal, true);
      assert.equal(s.current, null);
    }
    scoreState(s, rates); // must never throw
    if (s.current) {
      const p = s.current.prediction.probability;
      assert.ok(p > 0 && p < 0.6, `probability ${p}`);
    }
  }
});

test("the replay's final score matches the real final score", () => {
  const final = demoStateAt(feed, frames, frames.length);
  assert.equal(final.away.score, feed.liveData.linescore.teams.away.runs);
  assert.equal(final.home.score, feed.liveData.linescore.teams.home.runs);
});

test("history rows flag exactly the real home runs", () => {
  const final = demoStateAt(feed, frames, frames.length);
  const real = feed.liveData.plays.allPlays.filter((p) => p.result.eventType === "home_run").length;
  assert.equal(final.history.filter((r) => r.isHR).length, real);
});

test("a finished game read as a live feed has no current at-bat", () => {
  const s = stateFromLiveFeed(feed);
  assert.equal(s.isLive, false);
  assert.equal(s.current, null);
  assert.equal(s.history.length, frames.length);
});
