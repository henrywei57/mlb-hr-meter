import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftDate, clampDate, seasonOptions, seasonOf, gameLink, teamResult, groupByMonth, groupBySeries, inningStops, ratesFileFor, STATCAST_START } from "../src/library.js";
import { ordinal } from "../src/util.js";

const team = (id, name) => ({ team: { id, name } });
const game = (over) => ({ gamePk: 1, gameDate: "2016-04-04T20:05:00Z", officialDate: "2016-04-04", status: { abstractGameState: "Final" },
  teams: { away: { ...team(112, "Cubs"), score: 9 }, home: { ...team(108, "Angels"), score: 0 } }, ...over });

test("dates shift across month and year boundaries", () => {
  assert.equal(shiftDate("2016-03-31", 1), "2016-04-01");
  assert.equal(shiftDate("2016-01-01", -1), "2015-12-31");
  assert.equal(shiftDate("2016-02-28", 1), "2016-02-29"); // a leap year
});

test("dates are kept inside the Statcast era", () => {
  assert.equal(clampDate("2010-05-05", "2026-10-03"), STATCAST_START);
  assert.equal(clampDate("2030-01-01", "2026-10-03"), "2026-10-03");
  assert.equal(clampDate("2019-10-30", "2026-10-03"), "2019-10-30");
  assert.equal(clampDate("nonsense", "2026-10-03"), "2026-10-03");
});

test("seasons run from the latest back to 2015", () => {
  const s = seasonOptions(2026);
  assert.equal(s[0], 2026); assert.equal(s.at(-1), 2015); assert.equal(s.length, 12);
  assert.equal(seasonOf("2019-10-30"), 2019);
});

test("finished games open as a replay, unfinished ones open live", () => {
  assert.equal(gameLink(game({ gamePk: 7 })), "#/replay/7");
  assert.equal(gameLink(game({ gamePk: 8, status: { abstractGameState: "Live" } })), "#/game/8");
  assert.equal(gameLink(game({ gamePk: 9, status: { abstractGameState: "Preview" } })), "#/game/9");
});

test("a team's result is written from that team's side", () => {
  assert.equal(teamResult(game(), 112), "W 9-0");   // the Cubs (away) won
  assert.equal(teamResult(game(), 108), "L 0-9");   // the Angels (home) lost
  assert.equal(teamResult(game({ status: { abstractGameState: "Live" } }), 112), "");
});

test("a season's games are grouped by month in date order", () => {
  const games = [game({ gameDate: "2016-05-02T20:00:00Z", officialDate: "2016-05-02" }), game({}), game({ gameDate: "2016-04-20T20:00:00Z", officialDate: "2016-04-20" })];
  const groups = groupByMonth(games);
  assert.deepEqual(groups.map((g) => g.label), ["April 2016", "May 2016"]);
  assert.equal(groups[0].games.length, 2);
  assert.ok(groups[0].games[0].officialDate < groups[0].games[1].officialDate);
});

test("postseason games are grouped by series in round order", () => {
  const g = (series, away, home, day) => ({ ...game({ officialDate: `2016-10-${day}`, gameDate: `2016-10-${day}T20:00:00Z`, seriesDescription: series }), teams: { away: team(away, "A"), home: team(home, "H") } });
  // (the names are the real ones MLB uses, with the league in front)
  const groups = groupBySeries([g("World Series", 112, 114, 25), g("AL Division Series", 1, 2, 7), g("World Series", 114, 112, 26), g("NL Championship Series", 3, 4, 15), g("AL Wild Card Game", 5, 6, 4)]);
  assert.deepEqual(groups.map((x) => x.label), ["AL Wild Card Game", "AL Division Series", "NL Championship Series", "World Series"]);
  assert.equal(groups[3].games.length, 2);
});

test("innings for the jump menu come from the at-bats in order", () => {
  const frame = (inning, isTopInning) => ({ play: { about: { inning, isTopInning } } });
  const stops = inningStops([frame(1, true), frame(1, true), frame(1, false), frame(2, true)], ordinal);
  assert.deepEqual(stops, [{ label: "Top 1st", step: 0 }, { label: "Bot 1st", step: 2 }, { label: "Top 2nd", step: 3 }]);
});

test("a game uses its own season's rates when there is a file for it", () => {
  assert.equal(ratesFileFor(2016, [2015, 2016, 2017], 2026), "public/data/rates/2016.json");
  assert.equal(ratesFileFor(2016, [2017], 2026), null);     // no file for that season: use rates.json
  assert.equal(ratesFileFor(2026, [2025], 2026), null);     // the current season is rates.json itself
});

test("a rescheduled game is filed under its official date, not its original start time", () => {
  const moved = game({ gameDate: "2016-04-12T20:00:00Z", officialDate: "2016-08-02" }); // postponed in April, played in August
  const groups = groupByMonth([moved, game({}), game({ gameDate: "2016-06-01T20:00:00Z", officialDate: "2016-06-01" })]);
  assert.deepEqual(groups.map((g) => g.label), ["April 2016", "June 2016", "August 2016"]); // in order, each month once
});
