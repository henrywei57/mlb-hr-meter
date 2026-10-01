// The home-run model. A plain function: numbers in, numbers out. No browser code here,
// so it can be unit tested with `npm test` and explained on a whiteboard.
//
// Big idea: start from the league-average HR chance (about 3% per plate appearance),
// then ask "does each thing about this at-bat make a homer MORE or LESS likely?"
// Each answer is a multiplier (2.0x = twice as likely, 0.5x = half as likely).

import { MAX_PROBABILITY } from "./config.js";

// ---------------------------------------------------------------------------
// log5: how to combine a batter and a pitcher into ONE chance.
//
// Problem: a power hitter (6% HR rate) faces a stingy pitcher (2% allowed).
// You can't just average them, because a rate only means something compared to the
// league (3%). log5 (Bill James) fixes that: it asks "how much better than average is
// the batter, how much better than average is the pitcher, and what happens when both
// push on the same plate appearance?" Sanity check: if the pitcher is exactly league
// average, log5 hands back the batter's own rate unchanged.
// ---------------------------------------------------------------------------
export function log5(batterRate, pitcherRate, leagueRate) {
  const homerOdds = (batterRate * pitcherRate) / leagueRate;
  const noHomerOdds = ((1 - batterRate) * (1 - pitcherRate)) / (1 - leagueRate);
  return homerOdds / (homerOdds + noHomerOdds);
}

// Look up a player's rate against one hand ("L" or "R"). If we have no data for the
// player, quietly use the league average; the caller labels the result an "estimate".
function playerRates(player, oppositeHand, leagueRate) {
  if (!player) return { overall: leagueRate, split: leagueRate, found: false };
  const split = player["vs" + oppositeHand]; // e.g. player.vsL = rate against lefties
  return {
    overall: player.rate,
    split: split ? split.rate : player.rate, // build_rates.py already shrank small samples
    found: true,
  };
}

/**
 * Chance of a home run in this plate appearance.
 *
 * @param rates     the contents of public/data/rates.json
 * @param situation { batterId, pitcherId, batSide: "L"|"R", pitchHand: "L"|"R",
 *                    venueId, balls, strikes }
 * @returns { probability, leagueRate, timesLeague, isEstimate, factors: {...multipliers} }
 *   factors multiply together: league * batter * pitcher * platoon * count * park = probability
 */
export function predictHomeRun(rates, situation) {
  const league = rates.league.hr_per_pa;

  // STEP 1: Get the batter's HR rate against this pitcher's hand (lefty or righty), and the
  // pitcher's HR rate allowed against this batter's hand. (Small samples were already
  // pulled toward the player's overall rate by scripts/build_rates.py.)
  const batter = playerRates(rates.batters[situation.batterId], situation.pitchHand, league);
  const pitcher = playerRates(rates.pitchers[situation.pitcherId], situation.batSide, league);

  // STEP 2: Combine the two with log5. We measure against the league rate for THIS handedness
  // matchup (e.g. lefty batters vs righty pitchers), because both players' splits already
  // include the lefty/righty effect; using the all-league rate would count it twice.
  // This is the chance in a "normal" ballpark on the first pitch.
  const leagueMatchup = rates.league.matchup?.[situation.batSide]?.[situation.pitchHand] ?? league;
  const base = log5(batter.split, pitcher.split, leagueMatchup);

  // STEP 3: Park. A park factor of 120 means 20% more homers than an average park.
  const parkFactor = rates.park_hr_factors[situation.venueId] ?? 100; // unknown park = average
  const park = parkFactor / 100;

  // STEP 4: Count. Hitters get more homers after 3-1 than after 0-2. The table holds
  // "HR rate of plate appearances that reached this count / overall HR rate".
  const countKey = `${Math.min(situation.balls, 3)}-${Math.min(situation.strikes, 2)}`;
  const count = rates.count_multipliers[countKey]?.multiplier ?? 1;

  // STEP 5: Multiply it all together (and cap it so nothing silly is ever shown).
  const probability = Math.min(base * park * count, MAX_PROBABILITY);

  // STEP 6: Work out each factor so the "Why" list can show them. Each one is "x times the
  // league average". batter and pitcher use their OVERALL skill; "platoon" is whatever is
  // left over: the league-wide lefty/righty effect plus this batter's and pitcher's own
  // splits (and log5's small rounding effect), so that
  //   league * batter * pitcher * platoon * count * park  ==  probability   (before the cap)
  const batterFactor = batter.overall / league;
  const pitcherFactor = pitcher.overall / league;
  const platoonFactor = base / league / (batterFactor * pitcherFactor);

  return {
    probability,
    leagueRate: league,
    timesLeague: probability / league,
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
