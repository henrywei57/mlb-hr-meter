// A "source" feeds game states to the game screen. There are two kinds:
//   liveSource  - polls the MLB API every few seconds
//   demoSource  - replays a saved game, one plate appearance at a time
// Both have start() / stop() and call onUpdate(state, time) when there is something new.
// The game screen doesn't care which one it has.

import { POLL_MS, DEMO_STEP_MS } from "./config.js";
import { fetchFeed, fetchBatterLine, loadDemoFeed, fetchContextMetrics, fetchWinProbabilityList } from "./api.js";
import { stateFromLiveFeed, buildDemoFrames, demoStateAt, scoreState } from "./gamestate.js";
import { seriesFromList, wpAtStart, wpAfterAll, NEUTRAL } from "./winprob.js";

// MLB stamps every feed update, e.g. "20261001_001630" (UTC). When the stamp changes we log how
// many seconds passed between MLB publishing that update and the app receiving it. That IS the
// app's lag behind the MLB feed. Read it in the browser console (look for "[lag]").
function logLag(feed, lastStamp) {
  const stamp = feed.metaData?.timeStamp;
  if (!stamp || stamp === lastStamp) return lastStamp;
  const [, y, mo, d, h, mi, sec] = stamp.match(/(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)/) || [];
  if (y) {
    const published = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
    console.info(`[lag] new feed update arrived ${((Date.now() - published) / 1000).toFixed(1)}s after MLB published it`);
  }
  return stamp;
}

export function liveSource(gamePk, rates, { onUpdate, onError }) {
  let timer = null;
  let stopped = false;
  let lastStamp = null;
  let wp = { ...NEUTRAL, series: [] };   // win probability: the latest we know
  let seriesFor = -1;                    // how many finished at-bats the series was fetched for

  async function poll() {
    clearTimeout(timer);
    if (stopped) return;
    // Don't spend data/battery while the phone screen is off or the app is in the background.
    if (document.hidden) { schedule(); return; }
    try {
      // The game feed and MLB's (tiny) current win probability, together. A failure of the second
      // one is not fatal: we just keep the last win probability.
      const [feed, context] = await Promise.all([fetchFeed(gamePk), fetchContextMetrics(gamePk).catch(() => null)]);
      lastStamp = logLag(feed, lastStamp);
      const state = stateFromLiveFeed(feed);
      if (state.current) {
        state.current.batterLine = await fetchBatterLine(state.current.batter.id, feed.gameData.game.season);
      }
      scoreState(state, rates);

      if (Number.isFinite(context?.homeWinProbability)) wp = { ...wp, home: context.homeWinProbability, away: context.awayWinProbability };
      if (state.history.length !== seriesFor) {
        // a play finished since we last looked: fetch the whole win probability series for the chart
        try { wp = { ...wp, series: seriesFromList(await fetchWinProbabilityList(gamePk)) }; seriesFor = state.history.length; } catch { /* keep the old chart */ }
      }
      state.wp = wp;
      if (!stopped) onUpdate(state, Date.now());
      if (state.isFinal) return; // nothing more will change; stop polling
    } catch (error) {
      if (!stopped) onError(error); // offline or API hiccup: the screen keeps the old numbers
    }
    schedule();
  }

  function schedule() {
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }

  // Refresh immediately when the user comes back to the app or the network returns.
  const wake = () => { if (!document.hidden) poll(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  return {
    isDemo: false,
    start: poll,
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    },
  };
}

export function demoSource(rates, { onUpdate, onError }) {
  // One plate appearance takes DEMO_STEP_MS. It is shown in two halves: the batter stepping in
  // at 0-0, then the count later in the at-bat. Then the next batter comes up.
  const HALF_STEP_MS = DEMO_STEP_MS / 2;
  let feed, frames;
  let step = 0;   // which plate appearance we're on
  let phase = 0;  // 0 = batter just stepped in, 1 = later count
  let paused = false;
  let timer = null;
  let stopped = false;

  function show() {
    const state = demoStateAt(feed, frames, step, phase);
    if (state.current) state.current.batterLine = feed._batterLines?.[state.current.batter.id] ?? null;
    scoreState(state, rates);
    // the win chance at the start of this at-bat (from the saved copy of MLB's numbers)
    const series = feed._winProb || [];
    state.wp = state.current ? wpAtStart(series, state.current.atBatIndex) : wpAfterAll(series);
    onUpdate(state, Date.now());
  }

  function schedule() {
    clearTimeout(timer);
    if (!stopped && !paused && step < frames.length) timer = setTimeout(tick, HALF_STEP_MS);
  }

  function tick() {
    if (stopped || paused) return;
    if (phase === 0) {
      phase = 1;
    } else {
      step += 1; // next plate appearance (or the final screen after the last one)
      phase = 0;
    }
    show();
    schedule();
  }

  return {
    isDemo: true,
    get paused() { return paused; },
    async start() {
      try {
        feed = await loadDemoFeed();
        frames = buildDemoFrames(feed);
        step = 0;
        phase = 0;
        show();
        schedule();
      } catch (error) {
        onError(error);
      }
    },
    pause() { paused = true; clearTimeout(timer); },
    resume() { paused = false; schedule(); },
    restart() {
      step = 0;
      phase = 0;
      paused = false;
      show();
      schedule();
    },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
