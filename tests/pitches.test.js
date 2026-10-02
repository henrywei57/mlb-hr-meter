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
