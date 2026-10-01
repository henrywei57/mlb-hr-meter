// Turns MLB's huge "feed/live" JSON into one small, simple object (a "game state") that the
// screens draw. Live games and the demo replay both produce the SAME shape, so the UI never
// needs to know which one it is showing.
//
// A game state looks like:
// {
//   gamePk, venueId, statusLabel, isLive, isFinal,
//   away: { id, name, abbr, score }, home: { ... },
//   inningLabel: "Top 3rd", outs, balls, strikes, runners: { first, second, third },
//   current: { situation, batter: {id,name,side}, pitcher: {id,name,hand} } | null,
//   history: [ { id, inning, teamId, batterName, result, isHR, situation } ],
// }
// scoreState() then attaches predictions (from model.js) to `current` and to every history row:
//   .prediction = home run chance, .predictions = { hr, k, tb }, .extraBase = chance of 2+ bases

import { predictStat, extraBaseChance } from "./model.js";

// Events that are NOT the end of a plate appearance (a steal, a pickoff...). Same idea as
// NOT_A_PLATE_APPEARANCE in scripts/build_rates.py.
const NOT_A_PA = ["caught_stealing", "pickoff", "stolen_base", "wild_pitch", "passed_ball", "balk", "other_advance", "runner_"];

const BASES_BY_EVENT = { single: 1, double: 2, triple: 3, home_run: 4 };

export function isPlateAppearance(play) {
  const type = play.result?.eventType || "";
  return play.about.isComplete && !NOT_A_PA.some((prefix) => type.startsWith(prefix));
}

// 1 -> "1st", 2 -> "2nd", 11 -> "11th"
export function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const lastTwo = n % 100;
  return n + (suffixes[(lastTwo - 20) % 10] || suffixes[lastTwo] || suffixes[0]);
}

const otherHand = (hand) => (hand === "L" ? "R" : "L");

// A switch hitter ("S") bats from the opposite side of the pitcher's throwing hand.
function batSideFor(player, pitchHand) {
  const code = player?.batSide?.code;
  return code === "S" || !code ? otherHand(pitchHand) : code;
}

function teamInfo(gameTeam, score) {
  return { id: gameTeam.id, name: gameTeam.teamName || gameTeam.name, abbr: gameTeam.abbreviation, score };
}

// One completed plate appearance -> one row of the history list.
function historyRow(play, venueId) {
  const isTop = play.about.isTopInning;
  return {
    id: play.atBatIndex,
    inning: `${isTop ? "Top" : "Bot"} ${ordinal(play.about.inning)}`,
    isTop,
    batterName: play.matchup.batter.fullName,
    pitcherName: play.matchup.pitcher.fullName,
    result: play.result.event,
    description: play.result.description,
    isHR: play.result.eventType === "home_run",
    isK: (play.result.eventType || "").startsWith("strikeout"),
    bases: BASES_BY_EVENT[play.result.eventType] || 0, // total bases the batter got
    // The history shows the chance BEFORE the first pitch, so every row is judged at 0-0.
    situation: {
      batterId: String(play.matchup.batter.id),
      pitcherId: String(play.matchup.pitcher.id),
      batSide: play.matchup.batSide.code,
      pitchHand: play.matchup.pitchHand.code,
      venueId: String(venueId),
      balls: 0,
      strikes: 0,
    },
  };
}

function baseState(feed) {
  const gd = feed.gameData;
  return {
    gamePk: feed.gamePk,
    venueId: String(gd.venue.id),
    away: teamInfo(gd.teams.away, 0),
    home: teamInfo(gd.teams.home, 0),
    outs: 0, balls: 0, strikes: 0,
    runners: { first: false, second: false, third: false },
    inningLabel: "",
    statusLabel: gd.status.detailedState,
    isLive: false,
    isFinal: gd.status.abstractGameState === "Final",
    current: null,
    history: [],
  };
}

// ------------------------------------------------------------------ live games
export function stateFromLiveFeed(feed) {
  const gd = feed.gameData;
  const ld = feed.liveData;
  const line = ld.linescore;
  const state = baseState(feed);

  state.away.score = line.teams.away.runs ?? 0;
  state.home.score = line.teams.home.runs ?? 0;
  state.isLive = gd.status.abstractGameState === "Live";
  state.history = ld.plays.allPlays.filter(isPlateAppearance).map((p) => historyRow(p, gd.venue.id));
  if (!state.isLive) return state;

  state.inningLabel = `${line.inningState || line.inningHalf} ${line.currentInningOrdinal}`;
  state.runners = { first: !!line.offense?.first, second: !!line.offense?.second, third: !!line.offense?.third };

  const play = ld.plays.currentPlay;
  if (play && !play.about.isComplete) {
    // A plate appearance is in progress: everything comes from currentPlay.
    state.outs = play.count.outs;
    state.balls = play.count.balls;
    state.strikes = play.count.strikes;
    state.current = {
      atBatIndex: play.atBatIndex,
      batter: { id: String(play.matchup.batter.id), name: play.matchup.batter.fullName, side: play.matchup.batSide.code },
      pitcher: { id: String(play.matchup.pitcher.id), name: play.matchup.pitcher.fullName, hand: play.matchup.pitchHand.code },
    };
  } else if (line.offense?.batter && line.defense?.pitcher) {
    // Between batters: show the next batter at a fresh 0-0 count.
    const batter = line.offense.batter;
    const pitcher = line.defense.pitcher;
    const pitchHand = gd.players["ID" + pitcher.id]?.pitchHand?.code || "R";
    state.outs = Math.min(line.outs ?? 0, 2);
    state.current = {
      atBatIndex: (play?.atBatIndex ?? -1) + 1, // the at-bat after the one that just finished
      batter: { id: String(batter.id), name: batter.fullName, side: batSideFor(gd.players["ID" + batter.id], pitchHand) },
      pitcher: { id: String(pitcher.id), name: pitcher.fullName, hand: pitchHand },
    };
  }
  return state;
}

// ------------------------------------------------------------------ demo replay
// Walks through a finished game's plays and records the situation at the start of every plate
// appearance (score, outs, runners). Returns the list of "frames" the replay steps through.
export function buildDemoFrames(feed) {
  const gd = feed.gameData;
  const plays = feed.liveData.plays.allPlays;
  const frames = [];
  let bases = { "1B": false, "2B": false, "3B": false };
  let outs = 0;
  let score = { away: 0, home: 0 };
  let half = null;

  for (const play of plays) {
    const halfKey = `${play.about.inning}-${play.about.isTopInning}`;
    if (halfKey !== half) { half = halfKey; bases = { "1B": false, "2B": false, "3B": false }; outs = 0; }

    if (isPlateAppearance(play)) {
      // Count BEFORE the final pitch: this is the "decisive" count that makes the meter move.
      const pitches = play.playEvents.filter((e) => e.isPitch);
      const countBefore = pitches.length >= 2 ? pitches[pitches.length - 2].count : { balls: 0, strikes: 0 };
      frames.push({ play, outs, bases: { ...bases }, score: { ...score }, countBefore });
    }

    // Update running state from what happened on this play.
    for (const r of play.runners || []) if (r.movement.start in bases) bases[r.movement.start] = false;
    for (const r of play.runners || []) if (r.movement.end in bases) bases[r.movement.end] = true;
    outs = play.count.outs;
    score = { away: play.result.awayScore ?? score.away, home: play.result.homeScore ?? score.home };
  }
  return frames;
}

// Game state "step" of the replay: step 0 = first batter up, step N = game over.
// phase 0 = the batter has just stepped in (0-0); phase 1 = the count later in the at-bat.
// Two phases per plate appearance make the replay move like a live feed: the number changes
// as the count changes, instead of only when the batter changes.
export function demoStateAt(feed, frames, step, phase = 1) {
  const gd = feed.gameData;
  const state = baseState(feed);
  state.isFinal = step >= frames.length;
  state.isLive = !state.isFinal;
  state.statusLabel = state.isFinal ? "Final" : "Demo game";
  state.history = frames.slice(0, step).map((f) => historyRow(f.play, gd.venue.id));

  if (state.isFinal) {
    const last = frames[frames.length - 1].play;
    state.away.score = last.result.awayScore;
    state.home.score = last.result.homeScore;
    state.inningLabel = "Final";
    return state;
  }

  const f = frames[step];
  const p = f.play;
  state.away.score = f.score.away;
  state.home.score = f.score.home;
  state.inningLabel = `${p.about.isTopInning ? "Top" : "Bot"} ${ordinal(p.about.inning)}`;
  state.outs = f.outs;
  state.balls = phase === 0 ? 0 : f.countBefore.balls;
  state.strikes = phase === 0 ? 0 : f.countBefore.strikes;
  state.runners = { first: f.bases["1B"], second: f.bases["2B"], third: f.bases["3B"] };
  state.current = {
    atBatIndex: p.atBatIndex,
    batter: { id: String(p.matchup.batter.id), name: p.matchup.batter.fullName, side: p.matchup.batSide.code },
    pitcher: { id: String(p.matchup.pitcher.id), name: p.matchup.pitcher.fullName, hand: p.matchup.pitchHand.code },
  };
  return state;
}

// ------------------------------------------------------------------ predictions
function attachPredictions(target, rates, situation) {
  const predictions = {
    hr: predictStat(rates, situation, "hr"),
    k: predictStat(rates, situation, "k"),
    tb: predictStat(rates, situation, "tb"),
  };
  target.predictions = predictions;
  target.prediction = predictions.hr; // the headline number
  target.extraBase = extraBaseChance(rates, predictions.tb);
}

// Attach predictions (home run, strikeout, total bases) to the current at-bat and to every row of history.
export function scoreState(state, rates) {
  if (state.current) {
    state.current.situation = {
      batterId: state.current.batter.id,
      pitcherId: state.current.pitcher.id,
      batSide: state.current.batter.side,
      pitchHand: state.current.pitcher.hand,
      venueId: state.venueId,
      balls: state.balls,
      strikes: state.strikes,
    };
    attachPredictions(state.current, rates, state.current.situation);
  }
  for (const row of state.history) attachPredictions(row, rates, row.situation);
  return state;
}
