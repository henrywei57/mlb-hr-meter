// The model. A plain function: numbers in, numbers out. No browser code here,
// so it can be unit tested with `npm test` and explained on a whiteboard.
//
// Big idea: start from the league-average rate (for home runs, about 3% per plate appearance),
// then ask "does each thing about this at-bat make it MORE or LESS likely?"
// Each answer is a multiplier (2.0x = twice as likely, 0.5x = half as likely).
//
// The same recipe predicts three things:
//   "hr" = home run chance,  "k" = strikeout chance,  "tb" = expected total bases
// (total bases: single 1, double 2, triple 3, home run 4, anything else 0).

import { MAX_PROBABILITY } from "./config.js";

// Where each stat lives inside rates.json, and the biggest value we'll ever show.
const STATS = {
  hr: {
    league: (r) => r.league.hr_per_pa, matchup: (r) => r.league.matchup,
    count: (r) => r.count_multipliers, park: (r) => r.park_hr_factors,
    player: (p) => p, cap: MAX_PROBABILITY,
  },
  k: {
    league: (r) => r.league.k_per_pa, matchup: (r) => r.league.matchup_k,
    count: (r) => r.k_count_multipliers, park: (r) => r.park_k_factors,
    player: (p) => p.k, cap: 0.95,
  },
  tb: {
    league: (r) => r.league.tb_per_pa, matchup: (r) => r.league.matchup_tb,
    count: (r) => r.tb_count_multipliers, park: (r) => r.park_tb_factors,
    player: (p) => p.tb, cap: 4,
  },
};

// ---------------------------------------------------------------------------
// log5: how to combine a batter and a pitcher into ONE chance.
//
// Problem: a power hitter (6% HR rate) faces a stingy pitcher (2% allowed).
// You can't just average them, because a rate only means something compared to the
// league (3%). log5 (Bill James) fixes that: it asks "how much better than average is
// the batter, how much better than average is the pitcher, and what happens when both
// push on the same plate appearance?" Sanity check: if the pitcher is exactly league
// average, log5 hands back the batter's own rate unchanged.
// (For total bases, a rate per plate appearance rather than a true chance, this is an
// approximation, but it behaves the same way: average pitcher in, batter's own rate out.)
// ---------------------------------------------------------------------------
export function log5(batterRate, pitcherRate, leagueRate) {
  const homerOdds = (batterRate * pitcherRate) / leagueRate;
  const noHomerOdds = ((1 - batterRate) * (1 - pitcherRate)) / (1 - leagueRate);
  return homerOdds / (homerOdds + noHomerOdds);
}

// Look up a player's rate against one hand ("L" or "R"). If we have no data for the
// player, quietly use the league average; the caller labels the result an "estimate".
function playerRates(block, oppositeHand, leagueRate) {
  if (!block) return { overall: leagueRate, split: leagueRate, found: false };
  const split = block["vs" + oppositeHand]; // e.g. block.vsL = rate against lefties
  return {
    overall: block.rate,
    split: split ? split.rate : block.rate, // build_rates.py already shrank small samples
    found: true,
  };
}

/**
 * Predict one stat for this plate appearance.
 *
 * @param rates     the contents of public/data/rates.json
 * @param situation { batterId, pitcherId, batSide: "L"|"R", pitchHand: "L"|"R",
 *                    venueId, balls, strikes }
 * @param stat      "hr" (default), "k" or "tb"
 * @returns { value, probability, leagueRate, timesLeague, isEstimate, missing, factors }
 *   factors multiply together: league * batter * pitcher * platoon * count * park = value
 *   (`probability` is the same number as `value`, kept so older code keeps working)
 */
export function predictStat(rates, situation, stat = "hr") {
  const cfg = STATS[stat];
  const league = cfg.league(rates);

  // STEP 1: Get the batter's rate against this pitcher's hand (lefty or righty), and the
  // pitcher's rate allowed against this batter's hand. (Small samples were already
  // pulled toward the player's overall rate by scripts/build_rates.py.)
  const batterEntry = rates.batters[situation.batterId];
  const pitcherEntry = rates.pitchers[situation.pitcherId];
  const batter = playerRates(batterEntry && cfg.player(batterEntry), situation.pitchHand, league);
  const pitcher = playerRates(pitcherEntry && cfg.player(pitcherEntry), situation.batSide, league);

  // STEP 2: Combine the two with log5. We measure against the league rate for THIS handedness
  // matchup (e.g. lefty batters vs righty pitchers), because both players' splits already
  // include the lefty/righty effect; using the all-league rate would count it twice.
  // This is the value in a "normal" ballpark on the first pitch.
  const leagueMatchup = cfg.matchup(rates)?.[situation.batSide]?.[situation.pitchHand] ?? league;
  const base = log5(batter.split, pitcher.split, leagueMatchup);

  // STEP 3: Park. A park factor of 120 means 20% more of this thing than an average park.
  const parkFactor = cfg.park(rates)?.[situation.venueId] ?? 100; // unknown park = average
  const park = parkFactor / 100;

  // STEP 4: Count. Hitters homer more after 3-1 than after 0-2, and strike out far more
  // after 0-2. The table holds "rate for plate appearances that reached this count / overall rate".
  const countKey = `${Math.min(situation.balls, 3)}-${Math.min(situation.strikes, 2)}`;
  const count = cfg.count(rates)?.[countKey]?.multiplier ?? 1;

  // STEP 5: Multiply it all together (and cap it so nothing silly is ever shown).
  const value = Math.min(base * park * count, cfg.cap);

  // STEP 6: Work out each factor so the "Why" list can show them. Each one is "x times the
  // league average". batter and pitcher use their OVERALL skill; "platoon" is whatever is
  // left over: the league-wide lefty/righty effect plus this batter's and pitcher's own
  // splits (and log5's small rounding effect), so that
  //   league * batter * pitcher * platoon * count * park  ==  value   (before the cap)
  const batterFactor = batter.overall / league;
  const pitcherFactor = pitcher.overall / league;
  const platoonFactor = base / league / (batterFactor * pitcherFactor);

  return {
    value,
    probability: value,
    leagueRate: league,
    timesLeague: value / league,
    isEstimate: !batter.found || !pitcher.found, // missing player => league average stand-in
    missing: { batter: !batter.found, pitcher: !pitcher.found },
    factors: {
      batter: batterFactor,
      pitcher: pitcherFactor,
      platoon: platoonFactor,
      count,
      park,
    },
  };
}

// Home run chance. (The original entry point; same as predictStat(..., "hr").)
export const predictHomeRun = (rates, situation) => predictStat(rates, situation, "hr");

// Chance of an extra-base hit (double, triple or home run: 2+ total bases).
// We don't model each kind of hit separately. Instead: the league-wide extra-base-hit rate,
// scaled up or down by how many total bases this matchup is expected to produce compared
// with an average one. It's an approximation, and it's what the "Call 2+ bases" payout uses.
export function extraBaseChance(rates, totalBasesPrediction) {
  const league = rates.league.xbh_per_pa;
  if (!league) return null;
  return Math.min(league * totalBasesPrediction.timesLeague, 0.9);
}
