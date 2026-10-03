# HR Meter (prototype)

A phone-first web app for the MLB game you're watching. The big number is **win probability** (for example *White Sox 62% - Astros 38%*), with the home run chance, strikeout chance and expected total bases beside it, a 3D view of the at-bat, and a way to find, replay and save any pitch.
It's an installable PWA (Progressive Web App), so it can live on an iPhone home screen.

**Framework choice:** plain JavaScript (ES modules), no framework and no build step, because you can read every line, edit it in place, and host it as static files.

## Try it

Live site: https://henrywei57.github.io/mlb-hr-meter/ — tap **Demo game** to replay a real playoff game.

## Run it locally

You need [Node.js](https://nodejs.org) (any recent version).

```bash
npm start          # serves the app at http://localhost:8080
npm test           # runs the unit tests (model, game state, 3D data, Matchup Lab)
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

## What's in the app

**Screens:** Today's Games (home), Find a game, the game screen (live, a replay of any game, or the Demo), the Matchup Lab, and Saved pitches.

### Find any game and play it back (`#/browse`, `#/replay/<id>`)
Every game since Statcast began in 2015 can be found and played back pitch by pitch, with everything else in the app (3D scene, win probability, Pitch finder, saving pitches).
- **Find it:** by **date** (a calendar with previous/next day), by a **team's season** (all of a team's games, grouped by month with the result, including its postseason), or by **postseason series** for any year. There is also a **Random game** button and a shelf of **Famous games** (the 2016 and 2019 World Series Game 7s, Judge's 62nd home run, Ohtani's 50-50 game, a perfect game, and more).
- **Play it:** the replay goes one plate appearance at a time like the Demo, with a **scrubber** to drag anywhere in the game, **previous / next at-bat** buttons, **Pause / Resume / Restart / To end**, a **Speed** menu (0.5x to 8x) and a **Jump to inning** menu. Keyboard: Space pauses, the arrow keys step.
- **Where the data comes from:** MLB's game feed, which carries the Statcast pitch tracking for every game since 2015. A game loads in about a second. Finished games on the home screen open as replays too.
- **Predictions use that season's numbers.** The home run, strikeout and total-bases tiles for a 2016 game use each player's 2015-16 Statcast rates (a file per season in `public/data/rates/`, built by `scripts/build_history.py`). Players with too little data, and any season without a file, fall back to the league average and are marked **est.**; a note on the replay bar says which numbers are in use.

### Win probability (the big number)
The card right under the score shows each team's chance to win, as two big percentages, a tug-of-war bar in the team colors, and a **chart of how the game has swung** play by play (the home team's chance, shaded in the team that is ahead, with the innings marked). The numbers come from **MLB's own win probability model**, not ours, so they match what MLB's app shows. They depend on the inning, outs, runners and score.

### Pitch finder and saved pitches
- **Pitch finder** (game screen): every pitch of the game, **grouped by inning** (Top 1st, Bot 1st...). Open an inning to see each at-bat and each pitch with its count, type, speed and what happened. Filter by **Strikes, Balls, In play or the Fastest 10**.
- **Replay:** tap **Replay** on any pitch and the 3D scene puts that at-bat's pitcher and batter on the field and throws it again, drawing the pitch's **flight path** as a glowing line (red = fastballs, blue = breaking balls, green = changeups and splitters).
- **Save:** tap **Save** on a pitch (in the finder, or in the Strike zone card) to keep it. Saved pitches live in **Saved pitches** (button on the home screen): grouped by game and inning, replayable in 3D with the flight path, and removable. Each saved pitch stores everything needed to replay it, so it works offline and after the game is over. They are saved on this device only.

### The 3D stadium (game screen)
A real 3D scene, drawn with [Three.js](https://threejs.org) (a copy is in `public/vendor/`, MIT license, so it works offline). It shows the field from behind home plate, with the strike zone, the pitcher and the batter wearing their team colors and their **real MLB headshots**.
- **Look around:** drag to orbit, scroll or pinch to zoom, double-tap to reset. Buttons jump to **Catcher, Side, Pitcher, Center field and Overhead** views.
- **Reacts to the count:** in a hitter's count (2-0, 2-1, 3-1) the batter stands wide with the bat cocked and the pitcher sweats; in a pitcher's count (0-2, 1-2) the pitcher stands tall and the batter chokes up and crouches; a full count makes both tense. A ring under each player shows who has the edge (green), who is under pressure (orange) or neither (white), with a small label.
- **Real pitches:** each pitch flies along MLB's own tracking of that pitch (release point, speed and break), slowed down so you can follow it, and a **speed gun** shows its speed and type. The pitches of the at-bat sit in the strike zone as colored balls. Tap a pitch in the Strike zone card to throw it again in 3D.
- **Flight paths:** a replayed pitch draws its whole route as a glowing line, and a hit draws the ball's arc, so you can see the break of a slider or the arc of a home run, not just the ball.
- **Hit replay:** when an at-bat ends in a single, double, triple or home run, the scene replays it: the pitch, the **bat swing**, and the **ball flying out** at its real launch angle, in its real direction and for its real distance, with the camera following it. A home run clears the wall and shows its distance and exit speed.
- **Handedness always matches the data:** from behind the plate, a **right-handed batter stands on the viewer's left and a lefty on the right**, and a **right-handed pitcher holds the ball on the viewer's left** and a lefty on the right.
- **Snapshot** saves a PNG of the scene. **Replay pitch / Replay last hit** repeat what you just saw.
- If a browser can't do 3D (or you tap **Switch to 2D**), a flat 2D version of the scene is used instead (`src/ui/scene.js`).

### Themes
Five themes: **Night, Day, Ballpark, Scoreboard** (amber on black) and **High contrast**. Pick one in Settings on the home screen, or tap the Theme button at the top of a game to cycle. The 3D stadium follows the theme (sky, grass and lighting). To add a theme, copy a block in `styles.css` and change its colors, then add it to `THEMES` in `src/theme.js`.

### Matchup Lab (`#/lab`)
Pick **any** batter and **any** pitcher, a ballpark and a count, and see the home run chance, strikeout chance and expected total bases against the league average, plus the "Why" breakdown. Includes ready-made dream matchups, a Surprise me button, and a **share link** (the matchup is in the address).

### Other touches
- **Three small tiles** under the matchup: **Home run chance** (glows on a spike), **Expected total bases** and **Strikeout chance**.
- **Tap a "Why" line** for a plain-English explanation; **Try another count** shows the chance at every count; **tap a history row** for the play-by-play.
- **Sound effects** (off by default; Settings): the crack of the bat and a crowd cheer on hits, made in the browser.
- **Settings:** theme, glow-and-buzz threshold (1.5x to 4x), sound, vibration.

### Phone and computer
- **Phone (under 640 px):** a single column, big tap targets, safe-area padding for the iPhone notch. Designed for 360 px wide.
- **Computer (960 px and up):** a two-column dashboard (the 3D stage and score on the left; win probability, strike zone, Pitch finder, "Why" and history on the right). Today's Games becomes a grid of cards.
- **Mouse** hover highlights; **keyboard:** <kbd>Space</kbd> pauses or resumes the demo, and everything works with Tab and Enter.

## How it works

```
index.html, styles.css, manifest.webmanifest, sw.js   the app shell + install/offline support
src/
  config.js      <- settings you'll edit: SPIKE_MULTIPLE, POLL_MS, DEMO_STEP_MS
  settings.js    saved user preferences       theme.js  themes       audio.js  sound effects
  model.js       the home-run (and K, total bases) math: pure, unit tested, commented step by step
  gamestate.js   turns MLB's giant feed JSON into one small "game state" object
  winprob.js     win probability helpers      pitchdata.js  the pitch log, pitch types and colors
  saved.js       saved-pitch storage and grouping
  sources.js     liveSource (polls MLB) and demoSource (replays a saved game)
  api.js         all network calls     library.js  browser/replay helpers (dates, grouping)
  ui/            home.js (Today's Games), game.js (game screen), lab.js (Matchup Lab),
                 stage.js (picks 3D or 2D), scene3d.js (the 3D stadium), scene.js (2D fallback),
                 wp.js (win probability card), saved.js (Saved pitches), pitchdialog.js, zone.js (strike zone), why.js, diamond.js, gl.js
public/
  data/rates.json         precomputed rates and names (made by scripts/build_rates.py)
  data/demo_game.json     saved playoff game for Demo mode
  data/rates/<season>.json  each Statcast season's own rates (2015-2025), used when replaying old games
  data/classics.json      the Famous games shelf (made by scripts/build_classics.py)
  data/team-colors.json   team ID -> color (edit freely)
  vendor/three.module.min.js   Three.js (MIT)
scripts/         build_rates.py, build_history.py, build_classics.py, build_demo.py, make_icons.py, serve.js
tests/           model, gamestate, scene, lab, winprob, pitches, library
```

The app never calls pybaseball. It only reads `rates.json`. (It holds home run, strikeout and total-bases rates, plus names, for every player, which is why it's about 600 KB.)

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
python scripts/build_history.py   # a rates file for every Statcast season 2015-2025: takes HOURS the first time (cached after)
python scripts/build_classics.py  # re-find the Famous games and check their teams
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

**3D scene**

- **It's a diorama, not a simulation.** Players are built from simple shapes and drawn larger than life (the pitcher especially) so they read on a phone. Stances and the swing are generic poses, not each player's real mechanics. There are no fielders or baserunners.
- **Pitches are real, but slowed down** about 3x so you can follow them. The path comes from MLB's tracking of the pitch; the markers in the strike zone are where MLB says it crossed the front of the plate (a unit test checks that the path really ends there).
- **Batted balls use the real launch angle, direction and distance**, but the flight is a simple arc between those numbers (not full physics with spin and air resistance), and the replay is slowed down. Ground balls just skip along the grass. If MLB has no batted-ball data for a hit, a typical flight for that kind of hit is used.
- **The stadium is generic.** The wall is 330 ft down the lines and 385 ft in center in every park; it is not each park's real shape. The theme sets the lighting, not the real time of day.
- **Performance:** the 3D library (about 670 KB) only loads on the game screen, and drawing stops when the scene is off screen. Older phones may run it slowly; **Switch to 2D** is one tap. Not tested on a real iPhone.
- **Sound** is synthesized, so it is a simple imitation, not a recording. It stays silent until you switch it on in Settings and tap the screen once.

**Win probability and pitches**

- **Win probability is MLB's number**, from their `contextMetrics` and `winProbability` feeds (undocumented, like the rest of the API, so they could change). I don't know exactly how their model works, so I can't explain its math the way I can for the home run model. Each poll adds a tiny (under 1 KB) request; the full game series (about 130 KB compressed) is only fetched when a plate appearance finishes, to draw the chart.
- **The percentages never show 100% or 0% until the game is over**, so a very lopsided game reads 99% / 1%.
- **The Demo's win probability is a saved copy** of MLB's numbers for that game, shown as of the start of each at-bat.
- **Pitch finder, replays and saves use only what MLB's feed has.** A few pitches have no tracking data; those replay as a simple straight flight and say so. Replays are slowed down about 3x.
- **Saved pitches live in this browser** (up to 300). Clearing the site's data deletes them, and they don't sync between devices.

**Replaying old games**

- **Older games are scored with that season's rates, not the rates at that moment.** For a 2016 game a player's numbers come from 2015 and 2016 together, which includes pitches after the game was played (the 2016 file is not "what we knew then"). It's a fair guide to a player's skill in that era, not a true forecast.
- **A few pitches or games may be missing tracking data**, especially around the 2015 start-up. Those pitches replay as a simple straight flight.
- **Replays need a connection** (the game is fetched from MLB when you open it); only the Demo works offline. The per-season rates files are cached after first use.
- **MLB's win probability model changed over the years**, and it is theirs, so older games show MLB's numbers as published today.
- **Parks:** park factors come from Savant's 3-year window ending in that season; a ballpark without a factor counts as average.
- **The Famous games shelf** was checked against MLB's schedule (teams, date and score), but the descriptions are my own summaries.

## How far behind the MLB feed is the app?

The app polls every 7 seconds (`POLL_MS`) and MLB's servers cache each response for up to 10 seconds (`Cache-Control: max-age=10` on the API; I saw an `Age` of 5). So an update can show up on screen roughly:

- **about 5 to 12 seconds after MLB publishes it on average, up to about 18 seconds in the worst case** (7 s polling + up to 10 s server cache + about 1 s download).

That is an estimate from the settings and headers, **not a measured number**: no game was live when I built this. To measure it: open a live game in the app with the browser console open (desktop Chrome/Safari). Every time MLB publishes a new update it logs `[lag] new feed update arrived 6.4s after MLB published it`. That's the app's true lag behind the MLB feed. Separately, the MLB feed itself runs behind what you see on TV or at the park, and I can't measure that.
