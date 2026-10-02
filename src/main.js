// Entry point: a tiny router. The URL hash decides which screen to show.
//   #/            -> Today's Games
//   #/game/12345  -> live game with that gamePk
//   #/demo        -> replay of the saved demo game

import { loadRates, loadTeamColors } from "./api.js";
import { liveSource, demoSource } from "./sources.js";
import { showHome } from "./ui/home.js";
import { showGame } from "./ui/game.js";
import { applyTheme } from "./theme.js";

// An earlier version saved "calls" on the device. That feature is gone, so tidy the leftovers.
try { localStorage.removeItem("hr:calls"); } catch { /* storage unavailable: nothing to clean */ }

applyTheme(); // the saved theme (or Night)

const app = document.getElementById("app");
let leaveScreen = null; // cleanup function of the screen currently shown (stops timers / polling)
let routeToken = 0;     // lets us ignore a slow load if the user already went somewhere else

// rates.json and team colors are only loaded when a game screen needs them.
let dataPromise = null;
const loadData = () => (dataPromise ??= Promise.all([loadRates(), loadTeamColors()]).catch((error) => {
  dataPromise = null; // allow a retry next time
  throw error;
}));

// Every screen gets its own fresh container, so event listeners from the previous screen
// can never pile up on the shared #app element.
function freshScreen() {
  const el = document.createElement("div");
  app.replaceChildren(el);
  return el;
}

async function route() {
  const token = ++routeToken;
  if (leaveScreen) { leaveScreen(); leaveScreen = null; }
  window.scrollTo(0, 0);

  const hash = location.hash || "#/";
  const game = hash.match(/^#\/game\/(\d+)$/);
  const isDemo = hash === "#/demo";

  if (!game && !isDemo) {
    leaveScreen = showHome(freshScreen());
    return;
  }

  app.innerHTML = `<p class="hint pad">Loading…</p>`;
  let rates, colors;
  try {
    [rates, colors] = await loadData();
  } catch {
    if (token === routeToken) {
      app.innerHTML = `<p class="hint pad">Couldn't load the app's data files. Check your connection, then <a href="#/">go back</a> and try again.</p>`;
    }
    return;
  }
  if (token !== routeToken) return; // user navigated away while data was loading

  const gamePk = isDemo ? "demo" : game[1];
  leaveScreen = showGame(freshScreen(), {
    gamePk,
    rates,
    colors,
    makeSource: (callbacks) => (isDemo ? demoSource(rates, callbacks) : liveSource(gamePk, rates, callbacks)),
  });
}

window.addEventListener("hashchange", route);
route();

// Makes the app installable and lets it open offline.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* app still works without it */ });
}
