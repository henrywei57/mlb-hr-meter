import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flightPath, sceneHtml, resultSceneHtml, headshotUrl } from "../src/ui/scene.js";
import { buildDemoFrames, demoStateAt } from "../src/gamestate.js";

test("a ball landing in left field flies to the viewer's left; right field to the right", () => {
  assert.ok(flightPath({ x: 40, y: 90 }, "single").x1 < 180);
  assert.ok(flightPath({ x: 210, y: 90 }, "single").x1 > 180);
  assert.ok(Math.abs(flightPath({ x: 125.4, y: 90 }, "single").x1 - 180) < 1); // up the middle
});

test("farther hits go higher up the picture, and a home run leaves the top", () => {
  assert.ok(flightPath({ dist: 300 }, "double").y1 < flightPath({ dist: 100 }, "single").y1);
  assert.equal(flightPath({ dist: 400 }, "home_run").y1, 6);
});

test("a higher launch angle makes a higher arc", () => {
  assert.ok(flightPath({ angle: 40 }, "double").cy < flightPath({ angle: 5 }, "double").cy);
});

test("with no batted-ball data, a hit is assumed pulled: right-handers to left field", () => {
  assert.ok(flightPath({}, "single", "R").x1 < 180);
  assert.ok(flightPath({}, "single", "L").x1 > 180);
});

const o = { batterId: "1", pitcherId: "2", balls: 0, strikes: 0, outs: 0, batColor: "#EB6E1F", pitchColor: "#C4CED4" };

test("batter and pitcher sides match their handedness", () => {
  // From behind the plate: righty batter on the left (x=128), lefty batter on the right (x=232)
  assert.match(sceneHtml({ ...o, batSide: "R", pitchHand: "R" }).html, /translate\(128 218\) scale\(1\.25 1\.25\)/);
  assert.match(sceneHtml({ ...o, batSide: "L", pitchHand: "R" }).html, /translate\(232 218\) scale\(-1\.25 1\.25\)/);
  // Pitcher faces us: a righty's ball hand (cx = side * 20) is on the viewer's left, a lefty's on the right
  assert.match(sceneHtml({ ...o, batSide: "R", pitchHand: "R" }).html, /<circle cx="-20" cy="-\d+" r="3\.6" class="ball-in-hand"/);
  assert.match(sceneHtml({ ...o, batSide: "R", pitchHand: "L" }).html, /<circle cx="20" cy="-\d+" r="3\.6" class="ball-in-hand"/);
});

test("the scene shows each player's own MLB headshot and contains no emoji", () => {
  const html = sceneHtml({ ...o, batSide: "L", pitchHand: "R", batterId: "592450", pitcherId: "686613" }).html;
  assert.ok(html.includes(headshotUrl("592450")) && html.includes(headshotUrl("686613")));
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
});

test("the scene only redraws when something visible changes", () => {
  const a = sceneHtml({ ...o, batSide: "R", pitchHand: "R" }).key;
  assert.equal(a, sceneHtml({ ...o, batSide: "R", pitchHand: "R" }).key);
  assert.notEqual(a, sceneHtml({ ...o, batSide: "R", pitchHand: "R", strikes: 1 }).key);
});

test("every real hit in the demo game produces a swing and a flight", () => {
  const feed = JSON.parse(readFileSync(new URL("../public/data/demo_game.json", import.meta.url)));
  const frames = buildDemoFrames(feed);
  const rows = demoStateAt(feed, frames, frames.length).history;
  const hits = rows.filter((r) => r.hit);
  assert.equal(hits.length, 13);
  assert.equal(rows.filter((r) => r.isHR).length, 4);
  for (const row of hits) {
    const { html, durationMs } = resultSceneHtml({ ...o, batSide: row.situation.batSide, pitchHand: row.situation.pitchHand, hit: row.hit });
    assert.match(html, /<animateTransform/);   // the bat swing
    assert.match(html, /<animateMotion/);      // the ball flight
    assert.ok(durationMs > 1500 && durationMs < 4500);
  }
  assert.ok(rows.every((r) => !r.hit || ["single", "double", "triple", "home_run"].includes(r.hit.event)));
});
