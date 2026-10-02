// Win probability. The numbers come from MLB's own model (their "contextMetrics" and
// "winProbability" feeds), not from ours: it is the same chance the MLB app shows. It depends on
// the inning, outs, runners and score. We only reshape it for the screen here.
//
// A "series" is the home team's win chance (0-100) after each play of the game, in order:
//   [{ i: atBatIndex, inning, isTop, home, added, event }, ...]

export const NEUTRAL = { home: 50, away: 50 };

/** Turn MLB's per-play list into our compact series. */
export function seriesFromList(list) {
  return (list || []).map((p) => ({
    i: p.about?.atBatIndex ?? p.atBatIndex,
    inning: p.about?.inning,
    isTop: p.about?.isTopInning,
    home: p.homeTeamWinProbability,
    added: p.homeTeamWinProbabilityAdded,
    event: p.result?.event || "",
  })).filter((p) => Number.isFinite(p.home));
}

/**
 * The win chance at the START of play number `atBatIndex`: what it was after the play before.
 * (Before the very first play it is whatever the first play moved it from, about 50-50.)
 */
export function wpBefore(series, atBatIndex) {
  const earlier = series.filter((p) => p.i < atBatIndex);
  if (earlier.length) return earlier[earlier.length - 1].home;
  const first = series[0];
  return first ? first.home - (first.added || 0) : 50;
}

/** The state shown on screen: { home, away, series } for the plays before `atBatIndex`. */
export function wpAtStart(series, atBatIndex) {
  const home = wpBefore(series, atBatIndex);
  return { home, away: 100 - home, series: series.filter((p) => p.i < atBatIndex) };
}

/** The state after all the plays we have (a finished game, or the latest live update). */
export function wpAfterAll(series) {
  const last = series[series.length - 1];
  const home = last ? last.home : 50;
  return { home, away: 100 - home, series };
}

/** "62%", but never "100%" or "0%" while the game is still undecided. */
export function wpText(percent, decided = false) {
  if (!Number.isFinite(percent)) return "–";
  const r = Math.round(percent);
  if (decided) return r + "%";
  return Math.min(99, Math.max(1, r)) + "%";
}

/** Points for the little chart: the home team's chance at each step, starting from the opening 50-50. */
export function chartPoints(series) {
  const start = series.length ? series[0].home - (series[0].added || 0) : 50;
  return [{ i: -1, inning: 1, isTop: true, home: start, event: "Start" }, ...series];
}
