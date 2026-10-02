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

// ---- 3D data: MLB's pitch tracking and the pitch that ended each at-bat ----
test("pitches carry MLB's tracking path, and finished at-bats remember their last pitch", () => {
  const s = demoStateAt(feed, frames, 1);
  const withPath = s.history.flatMap((r) => (r.lastPitch ? [r.lastPitch] : [])).filter((p) => p.path);
  assert.ok(withPath.length > 0);
  const p = withPath[0].path;
  for (const key of ["x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "plateTime"]) assert.ok(Number.isFinite(p[key]), key);
  assert.ok(p.y0 > 40 && p.y0 < 60); // the tracking starts about 50 ft from the plate
  assert.ok(p.plateTime > 0.3 && p.plateTime < 0.6); // and takes roughly 0.4 s to arrive
});

test("a pitch's tracked path crosses the front of the plate exactly where MLB says it did", () => {
  const rows = demoStateAt(feed, frames, frames.length).history.filter((r) => r.lastPitch?.path && Number.isFinite(r.lastPitch.x));
  assert.ok(rows.length > 20);
  for (const { lastPitch: { path: c, x, z } } of rows) {
    const at = (t) => ({
      x: c.x0 + c.vX0 * t + 0.5 * c.aX * t * t,
      y: c.y0 + c.vY0 * t + 0.5 * c.aY * t * t,   // distance from the plate, in feet
      z: c.z0 + c.vZ0 * t + 0.5 * c.aZ * t * t,   // height, in feet
    });
    // find the moment the ball is 17 inches from the plate's tip (the front edge, where MLB measures)
    let lo = 0, hi = c.plateTime;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (at(mid).y > 17 / 12) lo = mid; else hi = mid; }
    const p = at(lo);
    assert.ok(Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.05, `path (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) vs MLB (${x}, ${z})`);
    // plateTime is when it reaches the catcher's mitt, a couple of feet behind the plate
    assert.ok(at(c.plateTime).y < 0 && at(c.plateTime).y > -3);
  }
});
