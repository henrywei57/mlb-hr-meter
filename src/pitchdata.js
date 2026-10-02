// Everything about individual PITCHES, taken from MLB's feed: the list of pitches of an at-bat,
// the log of every pitch in the game grouped by inning (for the Pitch finder), and how to color
// and classify a pitch. No browser code here, so it is unit tested.

import { ordinal } from "./util.js";

// MLB's tracking of one pitch's flight (feet, seconds): where it was released from, how fast it
// was going and how it accelerated. We use it to fly the ball along its real path in 3D.
export function pathOf(pitchData) {
  const c = pitchData?.coordinates;
  if (!c || ![c.x0, c.y0, c.z0, c.vX0, c.vY0, c.vZ0, c.aX, c.aY, c.aZ].every(Number.isFinite)) return null;
  return { x0: c.x0, y0: c.y0, z0: c.z0, vX0: c.vX0, vY0: c.vY0, vZ0: c.vZ0, aX: c.aX, aY: c.aY, aZ: c.aZ, plateTime: pitchData.plateTime };
}

/**
 * The pitches of one plate appearance, in order. For each: where it crossed the plate (x, z in
 * feet, x measured from the catcher's view, positive = toward his right), the count BEFORE it was
 * thrown, its speed and type, what the umpire/batter did with it, and its tracked flight path.
 * `limit` keeps only the first N pitches (the demo replays an at-bat part way through).
 */
export function pitchesOf(play, limit = Infinity) {
  const events = (play?.playEvents || []).filter((e) => e.isPitch).slice(0, limit);
  return events.map((e, i) => {
    const before = i ? events[i - 1].count : { balls: 0, strikes: 0 };
    return {
      n: i + 1,
      balls: before.balls,
      strikes: before.strikes,
      x: e.pitchData?.coordinates?.pX,
      z: e.pitchData?.coordinates?.pZ,
      top: e.pitchData?.strikeZoneTop,
      bottom: e.pitchData?.strikeZoneBottom,
      speed: e.pitchData?.startSpeed,
      type: e.details?.type?.description,
      typeCode: e.details?.type?.code,
      call: e.details?.call?.description || e.details?.description,
      code: e.details?.code,
      inPlay: !!e.details?.isInPlay,
      path: pathOf(e.pitchData),
    };
  });
}

// ---------------------------------------------------------------- the pitch log
/**
 * Every pitch of the game as a list of at-bats (only those with pitches so far).
 * @param entries [{ play, limit? }, ...] in game order
 */
export function pitchLogFromPlays(entries) {
  return entries.map(({ play, limit }) => {
    const pitches = pitchesOf(play, limit);
    if (!pitches.length) return null;
    const isTop = play.about.isTopInning;
    return {
      atBatIndex: play.atBatIndex,
      inning: play.about.inning,
      isTop,
      label: `${isTop ? "Top" : "Bot"} ${ordinal(play.about.inning)}`,
      batter: { id: String(play.matchup.batter.id), name: play.matchup.batter.fullName, side: play.matchup.batSide.code },
      pitcher: { id: String(play.matchup.pitcher.id), name: play.matchup.pitcher.fullName, hand: play.matchup.pitchHand.code },
      result: play.about.isComplete && limit === undefined ? play.result.event : null, // null = still in progress
      pitches,
    };
  }).filter(Boolean);
}

/** Group those at-bats by inning half, in order: [{ label, inning, isTop, rows, count }]. */
export function groupByInning(rows) {
  const groups = [];
  for (const row of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.label !== row.label) { g = { label: row.label, inning: row.inning, isTop: row.isTop, rows: [], count: 0 }; groups.push(g); }
    g.rows.push(row);
    g.count += row.pitches.length;
  }
  return groups;
}

// ---------------------------------------------------------------- classifying a pitch
const STRIKE_CODES = new Set(["C", "S", "W", "T", "M", "F", "L", "O", "Q"]); // called, swinging, foul...
const BALL_CODES = new Set(["B", "*B", "P", "I", "H", "V"]);

/** "play" (put in play), "strike" (called, swinging or foul), "ball", or "other". */
export function pitchKind(pitch) {
  if (pitch.inPlay) return "play";
  if (STRIKE_CODES.has(pitch.code)) return "strike";
  if (BALL_CODES.has(pitch.code)) return "ball";
  return "other";
}

/** Short text for what happened to the pitch ("Called Strike", "In play: Home Run"). */
export function resultText(pitch, atBatResult) {
  if (pitch.inPlay) return atBatResult ? `In play: ${atBatResult}` : "In play";
  return pitch.call || "Pitch";
}

/** The ten fastest pitches in the log (by speed), as a Set of "atBatIndex-n" keys. */
export function fastestKeys(groups, count = 10) {
  const all = groups.flatMap((g) => g.rows.flatMap((r) => r.pitches.filter((p) => Number.isFinite(p.speed)).map((p) => ({ key: `${r.atBatIndex}-${p.n}`, speed: p.speed }))));
  return new Set(all.sort((a, b) => b.speed - a.speed).slice(0, count).map((p) => p.key));
}

// One color per kind of pitch, used for the flight path and the legend.
const FASTBALLS = ["FF", "FA", "SI", "FT", "FC"];
const BREAKING = ["SL", "ST", "SV", "CU", "KC", "CS", "GY"];
const OFFSPEED = ["CH", "FS", "FO", "SC"];
export function typeColor(typeCode) {
  if (FASTBALLS.includes(typeCode)) return "#ff5b6e";   // fastballs: red
  if (BREAKING.includes(typeCode)) return "#6cb4ff";    // sliders, curves: blue
  if (OFFSPEED.includes(typeCode)) return "#4bd37b";    // changeups, splitters: green
  if (typeCode === "KN" || typeCode === "EP") return "#ffcf4a"; // knuckleballs, eephus: gold
  return "#ffffff";
}
