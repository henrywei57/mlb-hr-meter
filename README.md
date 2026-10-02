# HR Meter (prototype)

A phone-first web app that shows **one number** while you watch an MLB game: *"Home run chance, this at-bat: 9%"*.
It's an installable PWA (Progressive Web App), so it can live on an iPhone home screen.

**Framework choice:** plain JavaScript (ES modules), no framework and no build step, because you can read every line, edit it in place, and host it as static files.

## Try it

Live site: https://henrywei57.github.io/mlb-hr-meter/ — tap **Demo game** to replay a real playoff game.

## Run it locally

You need [Node.js](https://nodejs.org) (any recent version).

```bash
npm start          # serves the app at http://localhost:8080
npm test           # runs the unit tests (model + game-state logic)
```

Open `http://localhost:8080` in a browser. Use `localhost`, not a file path: service workers only run on `localhost` or HTTPS. No Node? `python -m http.server 8080` in this folder also works.

## Deploy (GitHub Pages)

The site is the repo root, no build needed.

1. Push to GitHub.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
3. After about a minute it's live at `https://<your-username>.github.io/<repo-name>/` over HTTPS.

After changing code, push again. If you **add a new file** that should work offline, add it to `APP_FILES` in `sw.js` and bump `CACHE_NAME`.

## Add it to an iPhone home screen

1. Open the site in **Safari** (it has to be Safari, not Chrome).
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open it from the new "HR Meter" icon. It launches full-screen with no Safari bars.

To pick up a new version, close the app fully and reopen it while online.

## Phone and computer

One layout that adapts to the screen:
- **Phone (under 640 px):** a single column, big tap targets, safe-area padding for the iPhone notch. Designed for 360 px wide.
- **Tablet (640 px and up):** the same column, a little wider.
- **Computer (960 px and up):** a two-column dashboard. The game screen puts the score, scene, meters and calls on the left and the "Why" list, count what-if grid and history on the right. Today's Games becomes a grid of cards, and My calls puts your stats beside the list.
- **Mouse:** hover highlights and pointer cursors.
- **Keyboard (computer):** <kbd>Space</kbd> pauses or resumes the demo. History rows and every button work with Tab and Enter.

The layout rules are the last section of `styles.css`.

## Interactive features

- **Matchup scene:** the pitcher and batter with their **real MLB headshots** (loaded from MLB's image server by player id; if a photo can't load, a plain cartoon face shows instead), in team-color uniforms, reacting to the count. In a hitter's count (2-0, 2-1, 3-1) the batter swings loose and the pitcher sweats; in a pitcher's count (0-2, 1-2) the pitcher looks confident and the batter chokes up; a full count makes both tense. A ring around each photo shows who has the edge (green), who is under pressure (orange) or neither (white), with a small label. A ball is thrown whenever the count changes.
- **Hit replay:** when an at-bat ends in a single, double, triple or home run, the scene replays it: the pitch comes in, the **bat swings**, and the **ball flies out**. The flight uses the real batted-ball data from MLB's feed (distance, launch angle and where it landed), so a ball hit to left field goes to the left. Home runs fly out of the park and show the distance and exit speed.
- **Handedness always matches the data.** The scene uses the catcher's view from behind home plate: a **right-handed batter stands on the viewer's left of the plate and a lefty on the right**, with the bat held away from the plate. The pitcher faces you, so a **right-handed pitcher holds the ball on the viewer's left** and a lefty on the right. Code: `src/ui/scene.js`.
- **Two smaller meters** under the home run meter: **Expected total bases** (single = 1, double = 2, triple = 3, home run = 4) and **Strikeout chance**. They use the same recipe as the home run number: league average, then batter, pitcher, lefty/righty, count and park.
- **Tap a "Why" line** for a plain-English explanation of that factor.
- **Try another count**: a grid showing the chance at every count for the current batter and pitcher; tap one for a what-if.
- **Tap a history row** to read the play-by-play.
- **Settings** (home screen): choose the spike threshold (1.5x to 4x) and turn vibration on or off.


## How it works

```
index.html, styles.css, manifest.webmanifest, sw.js   the app shell + install/offline support
src/
  config.js      <- settings you'll edit: SPIKE_MULTIPLE, POLL_MS, DEMO_STEP_MS
  settings.js    saved user preferences
  model.js       the home-run math (pure function, unit tested, commented step by step)
  gamestate.js   turns MLB's giant feed JSON into one small "game state" object
  sources.js     liveSource (polls MLB) and demoSource (replays a saved game)
  api.js         all network calls
  ui/            home.js (Today's Games), game.js (game screen), scene.js (batter/pitcher cartoon), why.js, diamond.js
public/
  data/rates.json         precomputed rates (made by scripts/build_rates.py)
  data/demo_game.json     saved playoff game for Demo mode
  data/team-colors.json   team ID -> color (edit freely)
scripts/         build_rates.py, build_demo.py, make_icons.py, serve.js
tests/           model.test.js, gamestate.test.js
```

The app never calls pybaseball. It only reads `rates.json`. (It holds home run, strikeout and total-bases rates for every player, which is why it's about 670 KB.)

### The model (`src/model.js`)

Start from the league-average HR chance per plate appearance (about 3.1%), then multiply:

1. Look up the **batter's HR rate vs this pitcher's hand** and the **pitcher's HR rate vs this batter's hand**.
2. Combine them with **log5** (Bill James' method for "good batter vs good pitcher"), measured against the league rate for that lefty/righty matchup.
3. Multiply by **park factor / 100**.
4. Multiply by the **count multiplier** for the current balls-strikes count.

The function returns the final probability *and* each factor (batter, pitcher, lefty/righty, count, park) so the "Why this number" list can show them. They multiply back to the final number exactly (a unit test checks this).

### Rebuilding the data (`scripts/build_rates.py`)

```bash
pip install pybaseball pandas
python scripts/build_rates.py     # first run downloads Statcast: slow (tens of minutes). Cached after that.
python scripts/build_demo.py      # re-pick/re-save the demo game
```

**Shrinkage (small samples).** A raw rate like "1 HR in 12 PA = 8%" is mostly luck, so every rate is pulled toward a sensible prior by adding pretend plate appearances of that prior:

`shrunk rate = (HR + K × prior) / (PA + K)`

- Overall rate: prior is the league average (K = 170 PA for batters, 700 BF for pitchers).
- Split rate (vs lefties / vs righties): prior is the player's own overall rate, adjusted by how the league's HR rate changes for that lefty/righty matchup (K = 300).

With 0 PA in a split you get exactly the prior (the "fall back to overall" rule); with 300 PA you trust the split 50/50; with thousands you mostly trust the split. The K values are judgment calls, not fitted. They're at the top of the script.

## Demo mode

`#/demo` replays a saved game: White Sox @ Astros, Wild Card game on 2026-09-30 (4 home runs). Each plate appearance takes 4 seconds (`DEMO_STEP_MS`): the batter steps in at 0-0, then 2 seconds later the count moves, like a live feed. Pause and Restart are in the bar at the top.

## Things to double-check (assumptions)

**Headshots.** The player photos are MLB's images, loaded live from `img.mlbstatic.com` (they are not stored in this repo). They are MLB's property and this is a public site, so check MLB's terms before sharing the app widely. This is also an exception to the "no MLB trademarks" rule in the original brief. If a photo can't load (offline, or a very new call-up), a plain cartoon face is shown instead. To turn photos off, delete the `<image ...>` line in `avatar()` in `src/ui/scene.js`.

**Data script**

1. **The count table doesn't match the intuition "3-1 is a hitter's count = bigger HR chance".** I built it exactly as specified: HR rate of plate appearances *that reach* each count ÷ overall rate. Because many PAs that reach 3-1 end in a walk (no chance of a HR), the value for 3-1 is **0.79x**, not above 1. Only 1-0 (1.04x) is above 1; 0-2 is 0.56x. The numbers are right for "chance of a HR in the *rest of this PA*", but the "why" list will mostly show counts as ▼. If you want hitter's counts to look like ▲, a different definition (HR per swing/pitch at that count) is needed.
2. **Seasons.** Batter/pitcher rates use 2025 + 2026 regular-season Statcast (through 2026-10-01). The count table uses 2025 only ("last season"). Postseason games are excluded, so the demo game is not in the training data.
3. **Shrinkage constants** (170 / 700 / 300) are my judgment, not fitted. I first tried 100 for splits and it made the lefty/righty factor swing from 0.4x to 1.6x from noise alone, so I raised it.
4. **Plate appearances** exclude events Statcast logs mid-PA (steals, pickoffs, wild pitches, truncated PAs). Walks, hit-by-pitch and sacrifices count as PAs.
5. **Park factors** are Baseball Savant's 3-year rolling HR index (2024-2026), scraped from the JSON embedded in their page, so the page layout could change. **The Athletics' park (venue 2529) is missing**, so it uses 100 (average). Park factors aren't split by batter handedness.
6. **Players under 25 PA** (2025-26 combined) are left out; the app then uses league average and shows an **"estimate"** label. This also happens for rookies.
7. **Switch hitters** are handled per plate appearance (they bat from the side opposite the pitcher's arm).

**Strikeouts, total bases and 2+ bases**

- **Total bases** are an expected *value* per plate appearance (about 0.36 league-wide), not a probability. The log5 step is designed for probabilities, so using it here is an approximation, though it behaves the same way (an average pitcher returns the batter's own rate). Walks and hit-by-pitches count as 0 bases. The "Expected total bases" number is only for that one plate appearance, not bases advanced on the bases afterwards.
- **"2+ bases" chance is an approximation.** I don't model singles, doubles and triples separately. It's the league extra-base-hit rate (7.6% of plate appearances) scaled by how many total bases the matchup is expected to produce compared with average, capped at 90%. This is also what the Call 2+ bases payout uses.
- **Park factors for total bases** are my own blend of Savant's 1B, 2B, 3B and HR indexes, weighted by how many bases each kind of hit contributes. Savant doesn't publish a total-bases index. Strikeouts use Savant's strikeout index.
- **Shrinkage strength differs per stat** (my judgment, in the `STATS` table at the top of `build_rates.py`): strikeouts settle quickly so need less pulling toward average (60 / 100 / 200 pretend PA), home runs need the most (170 / 700 / 300), total bases sit in between (250 / 500 / 400).
- **The "Why this number" list only explains the home run number.** The two smaller meters don't have their own breakdown yet.
- Quick check on the demo game (75 plate appearances): expected total bases 26.2 vs 26 actual; expected strikeouts 20 vs 28 actual (one game, so mostly noise).

**Model**

8. The count multiplier is applied *after* log5, as a simple multiplication. That's an approximation: it assumes the count effect is the same for every hitter.
9. **History rows show the chance before the first pitch (0-0)**, not what the meter said during the at-bat. The meter itself is not stored, so nothing is "logged" (no prediction logging in this prototype).
10. Chances are capped at 60% as a safety net (`MAX_PROBABILITY`).

**App**

11. **Spikes are rare by design.** 2x the league average is about 6%, which only elite hitters in hitter-friendly spots reach. In the demo game it happens in 4 of 150 screens (Alvarez, Murakami). To see it more, lower the threshold in Settings (or `SPIKE_MULTIPLE` in `src/config.js`).
12. **Team colors** in `team-colors.json` are my best recall of each team's primary color, not checked against an official source. Several are dark navy; text color is chosen automatically for contrast. Edit freely.
13. **Batter stat line** (AVG/HR/OPS) comes from the MLB API's regular-season stats, because during the playoffs the feed's own "season stats" are playoff-only and tiny.
14. **Phone data use:** each poll downloads the whole game feed, about 130 KB compressed. At one poll every 7 seconds that's roughly 65 MB per hour. Cutting this (the API's `fields` filter or diff endpoint) is a good next step.
15. **Not tested on a real iPhone**, and not yet on a *live* game (none was on when I built this). Live-mode parsing was tested by feeding it a trimmed copy of the demo game made to look mid-game; the "between batters" branch and unusual statuses (delays, warm-up) are untested. `navigator.vibrate` does nothing on iPhone by design, so there you only get the glow.
16. **CORS:** the MLB API sends `Access-Control-Allow-Origin: *`, so browsers can call it directly and **no Cloudflare Worker proxy is needed**.

## How far behind the MLB feed is the app?

The app polls every 7 seconds (`POLL_MS`) and MLB's servers cache each response for up to 10 seconds (`Cache-Control: max-age=10` on the API; I saw an `Age` of 5). So an update can show up on screen roughly:

- **about 5 to 12 seconds after MLB publishes it on average, up to about 18 seconds in the worst case** (7 s polling + up to 10 s server cache + about 1 s download).

That is an estimate from the settings and headers, **not a measured number**: no game was live when I built this. To measure it: open a live game in the app with the browser console open (desktop Chrome/Safari). Every time MLB publishes a new update it logs `[lag] new feed update arrived 6.4s after MLB published it`. That's the app's true lag behind the MLB feed. Separately, the MLB feed itself runs behind what you see on TV or at the park, and I can't measure that.
