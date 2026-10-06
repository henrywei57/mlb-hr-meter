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
      ...absOf(e),
    };
  });
}

// ---------------------------------------------------------------- ABS (robot umpire) challenges
// MLB marks a challenged pitch with `reviewDetails`. The pitch's own call is the FINAL one, so if
// the challenge was overturned the umpire's original call was the opposite.
function absOf(event) {
  const r = event.reviewDetails;
  if (!r) return { challenge: null, umpCall: callKind(event.details) };
  const final = callKind(event.details);
  const original = r.isOverturned ? (final === "strike" ? "ball" : "strike") : final;
  return {
    challenge: {
      teamId: r.challengeTeamId,
      player: r.player?.fullName || "",
      overturned: !!r.isOverturned,
      inProgress: !!r.inProgress,
      from: original,   // what the umpire called on the field
      to: final,        // what stood after the challenge
    },
    umpCall: original,
  };
}

/** What the plate umpire signals for a pitch: "strike", "ball", "foul", or null (in play, etc.). */
export function callKind(details) {
  if (!details || details.isInPlay) return null;
  switch (details.code) {
    case "C": case "S": case "W": case "T": case "M": case "O": case "Q": return "strike";
    case "F": case "L": return "foul";
    case "B": case "*B": case "P": case "I": case "V": return "ball";
    default: return details.isBall ? "ball" : details.isStrike ? "strike" : null;
  }
}

/**
 * The ABS scoreboard from the pitch log (the groups from groupByInning): each team has 2 challenges, keeps one when it wins and
 * loses it when it doesn't. Returns { away: {left, won, lost}, home: {...}, log: [...] } where
 * `log` lists every challenge so far in order.
 */
export function absBoard(pitchLog, away, home) {
  const tally = () => ({ left: 2, won: 0, lost: 0 });
  const board = { away: tally(), home: tally(), log: [] };
  for (const row of (pitchLog || []).flatMap((g) => g.rows)) {
    for (const p of row.pitches) {
      const c = p.challenge;
      if (!c) continue;
      const side = c.teamId === home.id ? board.home : c.teamId === away.id ? board.away : (row.isTop ? board.away : board.home);
      if (!c.inProgress) {
        if (c.overturned) side.won += 1; else { side.lost += 1; side.left = Math.max(0, side.left - 1); }
      }
      board.log.push({ ...c, label: row.label, batter: row.batter.name, pitcher: row.pitcher.name, team: side === board.home ? "home" : "away", n: p.n });
    }
  }
  board.any = board.log.length > 0;
  return board;
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

// ---------------------------------------------------------------- made-up pitches (the pitch tester)
// For each pitch type: a typical speed (mph) and how much it breaks (inches), measured the way MLB
// does it: `arm` = toward the pitcher's throwing-arm side (negative = away from it), `lift` = up
// (negative = drops more than gravity alone would).
export const PITCH_TYPES = {
  FF: { name: "Four-Seam Fastball", mph: 94, arm: 8, lift: 16 },
  SI: { name: "Sinker", mph: 93, arm: 16, lift: 8 },
  FC: { name: "Cutter", mph: 89, arm: -2, lift: 8 },
  SL: { name: "Slider", mph: 86, arm: -4, lift: 3 },
  ST: { name: "Sweeper", mph: 83, arm: -14, lift: 1 },
  CU: { name: "Curveball", mph: 79, arm: -6, lift: -9 },
  KC: { name: "Knuckle Curve", mph: 81, arm: -5, lift: -8 },
  CH: { name: "Changeup", mph: 85, arm: 14, lift: 7 },
  FS: { name: "Splitter", mph: 86, arm: 8, lift: 3 },
};

/**
 * A flight path (same shape as MLB's tracking, see pathOf) for a made-up pitch that crosses the
 * plate at (x, z) feet. It starts at a normal release point, slows down a little, and curves the
 * way the pitch type does. `hand` is the pitcher's throwing hand.
 */
export function syntheticPath(typeCode, x, z, hand = "R") {
  const t = PITCH_TYPES[typeCode] || PITCH_TYPES.FF;
  const arm = hand === "L" ? 1 : -1;            // a righty's arm side is the catcher's left (x < 0)
  const x0 = arm * 1.6, y0 = 50, z0 = 5.7;      // release point: feet
  const aY = 24, vY0 = -t.mph * 1.467;           // toward the plate, slowing down a little
  // time until it reaches the plate (y = 0): y0 + vY0*T + aY/2*T^2 = 0
  const T = (-vY0 - Math.sqrt(vY0 * vY0 - 2 * aY * y0)) / aY;
  const aX = (2 * ((arm * t.arm) / 12)) / (T * T);
  const aZ = -32.2 + (2 * (t.lift / 12)) / (T * T);
  return {
    x0, y0, z0, aX, aY, aZ, vY0, plateTime: T,
    vX0: (x - x0 - 0.5 * aX * T * T) / T,
    vZ0: (z - z0 - 0.5 * aZ * T * T) / T,
  };
}

/**
 * Build a pitch like the ones pitchesOf returns, from choices on the pitch tester.
 * @param o { typeCode, x, z (feet), call: "strike"|"ball"|"swing"|"foul", abs: "none"|"overturned"|"upheld",
 *            hand, top, bottom, balls, strikes }
 * With an ABS challenge the call must be a taken pitch (called strike or ball); `call` is what
 * STANDS after the challenge, and an overturned challenge means the umpire first called the opposite.
 */
export function customPitch(o) {
  const type = PITCH_TYPES[o.typeCode] || PITCH_TYPES.FF;
  const call = o.call || "strike";
  const code = { strike: "C", ball: "B", swing: "S", foul: "F" }[call] || "C";
  const desc = { strike: "Called Strike", ball: "Ball", swing: "Swinging Strike", foul: "Foul" }[call] || "Pitch";
  const final = callKind({ code });
  const taken = call === "strike" || call === "ball";
  let challenge = null, umpCall = final;
  if (taken && o.abs && o.abs !== "none") {
    const overturned = o.abs === "overturned";
    umpCall = overturned ? (final === "strike" ? "ball" : "strike") : final;
    challenge = { teamId: 0, player: "Test batter", overturned, inProgress: false, from: umpCall, to: final };
  }
  return {
    n: 1, balls: o.balls ?? 0, strikes: o.strikes ?? 0,
    x: o.x, z: o.z, top: o.top ?? 3.4, bottom: o.bottom ?? 1.6,
    speed: type.mph, type: type.name, typeCode: o.typeCode, call: desc, code, inPlay: false,
    path: syntheticPath(o.typeCode, o.x, o.z, o.hand), challenge, umpCall,
  };
}
