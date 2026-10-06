import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wallColor } from "../src/venues.js";

const venues = JSON.parse(readFileSync(new URL("../public/data/venues.json", import.meta.url)));

test("every ballpark ships with five fence distances", () => {
  assert.ok(Object.keys(venues).length >= 30);
  for (const v of Object.values(venues)) {
    for (const k of ["lf", "lcf", "cf", "rcf", "rf"]) assert.ok(v[k] > 280 && v[k] < 460, `${v.name} ${k}`);
  }
});

test("parks really differ", () => {
  assert.equal(venues["3"].name, "Fenway Park");
  assert.equal(venues["3"].cf, 420);
  assert.equal(venues["22"].cf, 395);
  assert.match(venues["12"].turf, /turf/i);
  assert.equal(venues["12"].roof, "Dome");
});

test("wall color: ivy at Wrigley, dark team color elsewhere, safe default", () => {
  assert.equal(wallColor(17, "#cc3433"), "#2f6b2f");
  assert.match(wallColor(22, "#005a9c"), /^#[0-9a-f]{6}$/);
  assert.equal(wallColor(22, undefined), "#174a31");
});
