import { test } from "node:test";
import assert from "node:assert/strict";
import { pointsFor, resolveCalls, computeStats, withCall, withoutPending } from "../src/calls.js";

const call = (over) => ({
  id: "1-5", gamePk: "1", atBatIndex: 5, batterId: "10", batterName: "A", pitcherName: "P",
  chance: 0.05, madeAt: 1, isDemo: false, status: "pending", resultText: "", ...over,
});
const row = (id, batterId, isHR, result = "Strikeout") => ({ id, isHR, result, situation: { batterId } });

test("a hit pays 1/chance points, a miss costs 1", () => {
  assert.equal(pointsFor(call({ status: "hit", chance: 0.05 })), 20);
  assert.equal(pointsFor(call({ status: "hit", chance: 0.2 })), 5);
  assert.equal(pointsFor(call({ status: "miss" })), -1);
  assert.equal(pointsFor(call()), 0);
});

test("a call settles as a hit when that batter homers", () => {
  const { calls, settled } = resolveCalls([call()], "1", [row(5, "10", true, "Home Run")]);
  assert.equal(calls[0].status, "hit");
  assert.equal(settled.length, 1);
});

test("a call settles as a miss on any other result", () => {
  assert.equal(resolveCalls([call()], "1", [row(5, "10", false)]).calls[0].status, "miss");
});

test("a call stays pending until its at-bat finishes, and ignores other batters and games", () => {
  assert.equal(resolveCalls([call()], "1", [row(4, "10", true)]).calls[0].status, "pending"); // earlier at-bat
  assert.equal(resolveCalls([call()], "1", [row(5, "99", true)]).calls[0].status, "pending"); // other batter
  assert.equal(resolveCalls([call()], "2", [row(5, "10", true)]).calls[0].status, "pending"); // other game
});

test("calling again on the same at-bat replaces the old call; pending calls can be undone", () => {
  assert.equal(withCall([call()], call({ chance: 0.1 })).length, 1);
  assert.equal(withoutPending([call()], "1-5").length, 0);
  assert.equal(withoutPending([call({ status: "hit" })], "1-5").length, 1); // can't undo a settled call
});

test("stats: hit rate, expected hits, points, streaks, best call", () => {
  const calls = [
    call({ id: "a", status: "hit", chance: 0.1, madeAt: 1 }),
    call({ id: "b", status: "hit", chance: 0.04, madeAt: 2 }),
    call({ id: "c", status: "miss", chance: 0.06, madeAt: 3 }),
    call({ id: "d", status: "pending", madeAt: 4 }),
  ];
  const s = computeStats(calls);
  assert.equal(s.total, 3);
  assert.equal(s.pending, 1);
  assert.equal(s.hits, 2);
  assert.ok(Math.abs(s.hitRate - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s.expectedHits - 0.2) < 1e-9);
  assert.equal(s.points, 10 + 25 - 1);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.currentStreak, 0);
  assert.equal(s.bestCall.id, "b");
});

test("stats with no calls are all zero and don't divide by zero", () => {
  const s = computeStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.hitRate, 0);
  assert.equal(s.bestCall, null);
});

// ---- strikeout and extra-base calls ----
import { newCall, callId, KINDS } from "../src/calls.js";

test("strikeout calls win on a strikeout; extra-base calls win on 2+ total bases", () => {
  const k = call({ kind: "k" });
  assert.equal(resolveCalls([k], "1", [{ ...row(5, "10", false), isK: true }]).calls[0].status, "hit");
  assert.equal(resolveCalls([k], "1", [row(5, "10", false, "Single")]).calls[0].status, "miss");
  const x = call({ kind: "xbh" });
  assert.equal(resolveCalls([x], "1", [{ ...row(5, "10", false, "Double"), bases: 2 }]).calls[0].status, "hit");
  assert.equal(resolveCalls([x], "1", [{ ...row(5, "10", true, "Home Run"), isHR: true, bases: 4 }]).calls[0].status, "hit");
  assert.equal(resolveCalls([x], "1", [{ ...row(5, "10", false, "Single"), bases: 1 }]).calls[0].status, "miss");
});

test("different kinds of call on the same at-bat don't replace each other", () => {
  const current = { atBatIndex: 5, batter: { id: "10", name: "A" }, pitcher: { name: "P" } };
  const hr = newCall({ gamePk: 1, current, chance: 0.05, kind: "hr" });
  const k = newCall({ gamePk: 1, current, chance: 0.2, kind: "k" });
  assert.equal(hr.id, "1-5"); // original id format, so older saved calls still match
  assert.equal(k.id, callId(1, 5, "k"));
  assert.equal(withCall([hr], k).length, 2);
});

test("every kind has a label", () => {
  for (const kind of Object.values(KINDS)) assert.ok(kind.label && kind.short && kind.verb);
});
