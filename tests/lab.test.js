import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchPlayers, dreamMatchups, evaluate } from "../src/ui/lab.js";

const rates = JSON.parse(readFileSync(new URL("../public/data/rates.json", import.meta.url)));

test("every player and ballpark in the data file has a name", () => {
  assert.ok(Object.values(rates.batters).every((p) => p.name));
  assert.ok(Object.values(rates.pitchers).every((p) => p.name));
  assert.ok(Object.keys(rates.park_hr_factors).every((id) => rates.park_names[id]));
});

test("search ignores case and accents, and finds the right player", () => {
  assert.equal(searchPlayers(rates.batters, "judge")[0].name, "Aaron Judge");
  assert.equal(searchPlayers(rates.batters, "JUDGE")[0].name, "Aaron Judge");
  assert.ok(searchPlayers(rates.batters, "pena").some((p) => p.name.includes("Peña")));
  assert.equal(searchPlayers(rates.batters, "zzzzzz").length, 0);
  assert.equal(searchPlayers(rates.batters, "", 5).length, 5);
});

test("dream matchups are sensible: the slugger's dream beats the pitcher's duel", () => {
  const [dream, duel, showdown] = dreamMatchups(rates);
  const hr = (d) => evaluate(rates, { ...d, balls: 0, strikes: 0 }).hr.value;
  assert.ok(hr(dream) > hr(duel));
  assert.ok(hr(dream) > rates.league.hr_per_pa * 2); // a slugger vs a gopher-prone pitcher in a hitter's park is well above average
  const k = evaluate(rates, { ...showdown, balls: 0, strikes: 0 }).k.value;
  assert.ok(k > rates.league.k_per_pa * 1.4);
});

test("evaluate: a switch hitter bats from the side opposite the pitcher; unknown players give nothing", () => {
  const sw = Object.entries(rates.batters).find(([, p]) => p.hand === "S" && p.pa > 300)[0];
  const rhp = Object.entries(rates.pitchers).find(([, p]) => p.hand === "R" && p.pa > 300)[0];
  const lhp = Object.entries(rates.pitchers).find(([, p]) => p.hand === "L" && p.pa > 300)[0];
  assert.equal(evaluate(rates, { b: sw, p: rhp, park: "", balls: 0, strikes: 0 }).situation.batSide, "L");
  assert.equal(evaluate(rates, { b: sw, p: lhp, park: "", balls: 0, strikes: 0 }).situation.batSide, "R");
  assert.equal(evaluate(rates, { b: "nope", p: rhp, park: "", balls: 0, strikes: 0 }), null);
});

test("evaluate: a hitter-friendly park raises the home run chance, and 0-2 raises strikeouts", () => {
  const [dream] = dreamMatchups(rates);
  const base = { b: dream.b, p: dream.p, park: "", balls: 0, strikes: 0 };
  const parks = Object.entries(rates.park_hr_factors).sort((a, b) => b[1] - a[1]);
  assert.ok(evaluate(rates, { ...base, park: parks[0][0] }).hr.value > evaluate(rates, { ...base, park: parks.at(-1)[0] }).hr.value);
  assert.ok(evaluate(rates, { ...base, strikes: 2 }).k.value > evaluate(rates, base).k.value);
});
