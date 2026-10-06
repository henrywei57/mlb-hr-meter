import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDemoFrames, demoStateAt } from "../src/gamestate.js";
import { pitchKind, resultText, fastestKeys, typeColor, groupByInning, pitchLogFromPlays } from "../src/pitchdata.js";
import { makeSaved, toggleSaved, isSaved, groupSaved, pitchId } from "../src/saved.js";

const feed = JSON.parse(readFileSync(new URL("../public/data/demo_game.json", import.meta.url)));
const frames = buildDemoFrames(feed);
const full = demoStateAt(feed, frames, frames.length);

test("the pitch log covers every pitch of the game, grouped by inning in order", () => {
  const totalPitches = feed.liveData.plays.allPlays.flatMap((p) => p.playEvents).filter((e) => e.isPitch).length;
  const logged = full.pitchLog.flatMap((g) => g.rows).reduce((n, r) => n + r.pitches.length, 0);
  assert.equal(logged, totalPitches);
  assert.equal(full.pitchLog[0].label, "Top 1st");
  assert.equal(full.pitchLog[1].label, "Bot 1st");
  assert.equal(full.pitchLog.at(-1).label, "Bot 9th");
  const order = full.pitchLog.map((g) => g.inning * 2 + (g.isTop ? 0 : 1));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const g of full.pitchLog) assert.equal(g.count, g.rows.reduce((n, r) => n + r.pitches.length, 0));
});

test("each pitch knows the count before it, its type and speed", () => {
  const first = full.pitchLog[0].rows[0].pitches;
  assert.deepEqual([first[0].balls, first[0].strikes], [0, 0]);
  assert.ok(first.every((p) => p.type && Number.isFinite(p.speed) && p.typeCode));
  for (let i = 1; i < first.length; i++) {
    // the count before pitch i can never be smaller than the count before pitch i-1
    assert.ok(first[i].balls >= first[i - 1].balls && first[i].strikes >= first[i - 1].strikes);
  }
});

test("in the demo, the log grows with the replay and shows only pitches already thrown", () => {
  const early = demoStateAt(feed, frames, 3, 0);   // batter just stepped in: no pitches of his at-bat yet
  const later = demoStateAt(feed, frames, 3, 1);
  const n = (s) => s.pitchLog.flatMap((g) => g.rows).reduce((c, r) => c + r.pitches.length, 0);
  assert.ok(n(later) >= n(early));
  assert.ok(n(full) > n(later));
  // the at-bat in progress has no result yet
  assert.equal(later.pitchLog.flatMap((g) => g.rows).at(-1).result === null || n(later) === n(early), true);
});

test("pitches are classified: strikes, balls and balls in play", () => {
  const kinds = new Set(full.pitchLog.flatMap((g) => g.rows.flatMap((r) => r.pitches.map(pitchKind))));
  assert.ok(kinds.has("strike") && kinds.has("ball") && kinds.has("play"));
  assert.equal(pitchKind({ code: "C" }), "strike");
  assert.equal(pitchKind({ code: "B" }), "ball");
  assert.equal(pitchKind({ code: "X", inPlay: true }), "play");
  assert.equal(resultText({ inPlay: true }, "Home Run"), "In play: Home Run");
  assert.equal(resultText({ call: "Called Strike" }), "Called Strike");
});

test("the ten fastest pitches are found, and pitch types have colors", () => {
  const keys = fastestKeys(full.pitchLog, 10);
  assert.equal(keys.size, 10);
  const speeds = full.pitchLog.flatMap((g) => g.rows.flatMap((r) => r.pitches.map((p) => ({ key: `${r.atBatIndex}-${p.n}`, speed: p.speed }))));
  const cutoff = [...speeds].sort((a, b) => b.speed - a.speed)[9].speed;
  for (const k of keys) assert.ok(speeds.find((s) => s.key === k).speed >= cutoff);
  assert.equal(typeColor("FF"), "#ff5b6e");
  assert.equal(typeColor("SL"), "#6cb4ff");
  assert.equal(typeColor("CH"), "#4bd37b");
});

test("groupByInning merges consecutive at-bats of the same half-inning", () => {
  const rows = [
    { label: "Top 1st", inning: 1, isTop: true, pitches: [1, 2] },
    { label: "Top 1st", inning: 1, isTop: true, pitches: [1] },
    { label: "Bot 1st", inning: 1, isTop: false, pitches: [1, 2, 3] },
  ];
  const groups = groupByInning(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.count), [3, 3]);
  assert.deepEqual(pitchLogFromPlays([]), []);
});

// ---- saving pitches ----
const game = { pk: 849846, date: "2026-09-30", away: { id: 145, name: "White Sox", abbr: "CWS" }, home: { id: 117, name: "Astros", abbr: "HOU" } };
const row = full.pitchLog[1].rows[0];
const pitch = row.pitches[0];

test("a saved pitch keeps what is needed to replay it, and the right teams for the half-inning", () => {
  const top = makeSaved(game, full.pitchLog[0].rows[0], full.pitchLog[0].rows[0].pitches[0]);
  assert.equal(top.battingTeamId, 145); // the away team bats in the top
  const bottom = makeSaved(game, row, pitch);
  assert.equal(bottom.battingTeamId, 117);
  assert.equal(bottom.fieldingTeamId, 145);
  assert.equal(bottom.id, pitchId(849846, row.atBatIndex, pitch.n));
  assert.ok(bottom.pitch.path && bottom.batter.side && bottom.pitcher.hand);
});

test("toggleSaved adds a pitch once and removes it the second time", () => {
  const item = makeSaved(game, row, pitch);
  let list = toggleSaved([], item);
  assert.equal(list.length, 1);
  assert.ok(isSaved(list, item.id));
  list = toggleSaved(list, item);
  assert.equal(list.length, 0);
});

test("saved pitches are grouped by game (newest first), then inning in order", () => {
  const a = makeSaved(game, full.pitchLog[4].rows[0], full.pitchLog[4].rows[0].pitches[0]);   // a later inning, saved first
  const b = makeSaved(game, full.pitchLog[0].rows[0], full.pitchLog[0].rows[0].pitches[1]);
  const other = makeSaved({ ...game, pk: 1 }, row, pitch);
  other.savedAt = Date.now() + 1000;                                                          // a different game, saved most recently
  const groups = groupSaved([a, b, other]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].game.pk, 1);
  const innings = groups[1].innings.map((i) => i.label);
  assert.deepEqual(innings, ["Top 1st", full.pitchLog[4].label]);
});

// ---- ABS challenges and the umpire's call
import { absBoard, callKind } from "../src/pitchdata.js";

test("callKind: what the umpire signals", () => {
  assert.equal(callKind({ code: "C" }), "strike");
  assert.equal(callKind({ code: "S" }), "strike");
  assert.equal(callKind({ code: "B" }), "ball");
  assert.equal(callKind({ code: "F" }), "foul");
  assert.equal(callKind({ code: "X", isInPlay: true }), null);
});

test("absBoard: a won challenge is kept, a lost one is spent", () => {
  const pitch = (teamId, overturned) => ({ n: 1, challenge: { teamId, overturned, inProgress: false, from: "strike", to: overturned ? "ball" : "strike", player: "P" } });
  const log = [{ label: "Top 1st", isTop: true, rows: [
    { batter: { name: "B" }, pitcher: { name: "C" }, pitches: [pitch(144, true), pitch(144, false), pitch(143, false)] },
  ] }];
  const board = absBoard(log, { id: 143 }, { id: 144 });
  assert.equal(board.home.left, 1);   // won one, lost one
  assert.equal(board.home.won, 1);
  assert.equal(board.away.left, 1);
  assert.equal(board.log.length, 3);
});

// ---- the pitch tester
import { customPitch, syntheticPath, PITCH_TYPES } from "../src/pitchdata.js";

test("syntheticPath crosses the plate where you asked", () => {
  for (const type of Object.keys(PITCH_TYPES)) {
    const c = syntheticPath(type, 0.4, 2.2, "R");
    const T = c.plateTime;
    const x = c.x0 + c.vX0 * T + 0.5 * c.aX * T * T;
    const z = c.z0 + c.vZ0 * T + 0.5 * c.aZ * T * T;
    const y = c.y0 + c.vY0 * T + 0.5 * c.aY * T * T;
    assert.ok(Math.abs(x - 0.4) < 1e-6 && Math.abs(z - 2.2) < 1e-6 && Math.abs(y) < 1e-6, type);
    assert.ok(T > 0.3 && T < 0.6, `${type} plate time ${T}`);
  }
});

test("customPitch: an overturned challenge means the umpire first called the opposite", () => {
  const p = customPitch({ typeCode: "SL", x: 0.9, z: 2, call: "ball", abs: "overturned" });
  assert.equal(p.umpCall, "strike");
  assert.deepEqual([p.challenge.from, p.challenge.to, p.challenge.overturned], ["strike", "ball", true]);
  const u = customPitch({ typeCode: "FF", x: 0, z: 2.5, call: "strike", abs: "upheld" });
  assert.equal(u.umpCall, "strike");
  assert.equal(u.challenge.overturned, false);
  // swings cannot be challenged
  assert.equal(customPitch({ typeCode: "FF", x: 0, z: 2, call: "swing", abs: "overturned" }).challenge, null);
});
