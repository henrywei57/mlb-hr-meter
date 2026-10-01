"""
build_rates.py - precompute every number the app needs and write public/data/rates.json

Run it from the project root:

    pip install pybaseball pandas
    python scripts/build_rates.py

The first run downloads a full season of Statcast pitch data (slow, ~30-60 min per
season). Downloads are cached in scripts/cache/ so later runs take seconds.
The app NEVER runs this script. It only reads the JSON file this script writes.

What goes into rates.json
  league.hr_per_pa         league-average home runs per plate appearance
  league.matchup           league HR/PA for each batter-hand vs pitcher-hand matchup (L/R)
  league.platoon_*         how much the league HR rate moves for each handedness matchup
  count_multipliers        "balls-strikes" -> (HR rate of PAs reaching that count) / (overall rate)
  park_hr_factors          MLB venue id -> Baseball Savant HR park factor (100 = average)
  batters / pitchers       per-player HR rates, overall and by opposing hand

Shrinkage (how we handle small samples) - see shrink() below:
  A raw rate like "1 HR in 12 PA = 8%" is mostly luck. So every rate is pulled toward a
  "prior guess" by adding pretend plate appearances of that prior:

      shrunk = (HR + K * prior) / (PA + K)

  - Overall rate: prior = league average.        K = K_BATTER_OVERALL / K_PITCHER_OVERALL
  - Split rate (vs LHP, vs RHB, ...): prior = the player's own shrunk overall rate,
    adjusted by how the league's HR rate changes for that handedness matchup.  K = K_SPLIT
  With 0 PA in a split you get exactly the prior (the "fall back to overall" rule). With
  K_SPLIT PA you trust the split 50/50. With many PA you mostly trust the split.
"""

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------- settings you can edit
PLAYER_SEASONS = [2025, 2026]  # seasons used for batter/pitcher rates (more PA = steadier)
COUNT_SEASON = 2025            # "last season" for the ball-strike count table
PARK_YEAR = 2026               # Savant park factor year (3-year rolling window ending here)
K_BATTER_OVERALL = 170         # pretend PA of league average added to a batter's overall rate
K_PITCHER_OVERALL = 700        # same for pitchers (pitcher HR rates are noisier, so a bigger K)
K_SPLIT = 300                  # pretend PA of the player's overall rate added to each split (HR splits are very noisy)
MIN_PA = 25                    # players with fewer PA/BF than this are left out (app uses league avg)

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "scripts" / "cache"
OUT_PATH = ROOT / "public" / "data" / "rates.json"

# Statcast puts an "events" value on a pitch when something happens. These are NOT the end of
# a plate appearance (a runner got caught stealing, etc.), so we skip them.
NOT_A_PLATE_APPEARANCE = ("caught_stealing", "pickoff", "stolen_base", "wild_pitch",
                          "passed_ball", "balk", "other_out", "runner_", "truncated_pa")


# ---------------------------------------------------------------- step 1: download Statcast
def download_season(season):
    """Return one season of regular-season pitch rows, using the on-disk cache."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"statcast_{season}.csv.gz"
    if path.exists():
        print(f"{season}: using cache {path.name}")
        return pd.read_csv(path)

    import pybaseball  # imported here so the rest of the script can be read without it
    pybaseball.cache.enable()
    keep = ["game_pk", "at_bat_number", "pitch_number", "batter", "pitcher", "stand",
            "p_throws", "events", "balls", "strikes", "game_type"]
    pieces = []
    # one month at a time so a network hiccup only costs a month, not the whole season
    last = min(date(season, 10, 1), date.today())
    ranges = []
    for month in range(3, 11):
        first = date(season, month, 15 if month == 3 else 1)
        end = date(season, month + 1, 1) - pd.Timedelta(days=1) if month < 12 else last
        ranges.append((first, min(end, last)))
    for first, end in ranges:
        if first > end:
            continue
        for attempt in range(3):
            try:
                print(f"{season}: downloading {first} -> {end}", flush=True)
                chunk = pybaseball.statcast(str(first), str(end), verbose=False)
                break
            except Exception as err:  # noqa: BLE001 - network errors vary a lot
                print(f"  retry {attempt + 1} after error: {err}", flush=True)
                time.sleep(10)
        else:
            sys.exit("Statcast download kept failing; try again later.")
        if chunk is not None and len(chunk):
            pieces.append(chunk[keep])
    df = pd.concat(pieces, ignore_index=True)
    df = df[df["game_type"] == "R"].drop_duplicates(["game_pk", "at_bat_number", "pitch_number"])
    df.to_csv(path, index=False)
    return df


def to_plate_appearances(pitches):
    """Collapse pitch rows into one row per plate appearance, with an is_hr flag."""
    last = pitches.sort_values(["game_pk", "at_bat_number", "pitch_number"])
    last = last.groupby(["game_pk", "at_bat_number"], as_index=False).last()
    ended = last["events"].notna() & ~last["events"].fillna("").str.startswith(NOT_A_PLATE_APPEARANCE)
    pa = last[ended].copy()
    pa["is_hr"] = (pa["events"] == "home_run").astype(int)
    return pa


# ---------------------------------------------------------------- step 2: the maths
def shrink(hr, pa, prior, k):
    """Pull a raw HR/PA rate toward `prior` by adding k pretend PA of that prior."""
    return (hr + k * prior) / (pa + k)


def split_stats(group_pa, group_hr, prior, k):
    return {"pa": int(group_pa), "hr": int(group_hr), "rate": round(shrink(group_hr, group_pa, prior, k), 5)}


def league_platoon(pa, hand_col, other_col):
    """
    How much the league HR rate moves when `hand_col` player faces `other_col` hand.
    Returns {"L": {"L": ratio, "R": ratio}, "R": {...}}: ratio = HR rate in that matchup
    divided by the HR rate of that hand against everyone.
    """
    out = {}
    for hand, rows in pa.groupby(hand_col):
        if hand not in ("L", "R"):
            continue
        overall = rows["is_hr"].mean()
        out[hand] = {}
        for other, sub in rows.groupby(other_col):
            if other in ("L", "R"):
                out[hand][other] = round(float(sub["is_hr"].mean() / overall), 4)
    return out


def league_matchup_rates(pa):
    """League HR/PA for each handedness matchup: matchup["L"]["R"] = lefty batters vs righty pitchers.
    The model compares against THIS rate (not the all-league rate) so the lefty/righty effect
    is counted once, not twice."""
    out = {}
    for (bat, throw), rows in pa.groupby(["stand", "p_throws"]):
        if bat in ("L", "R") and throw in ("L", "R"):
            out.setdefault(bat, {})[throw] = round(float(rows["is_hr"].mean()), 5)
    return out


def count_table(pitches_last_season):
    """Ball-strike count -> HR multiplier, using PAs that REACHED each count."""
    pa = to_plate_appearances(pitches_last_season)
    overall = pa["is_hr"].mean()
    flag = pa.set_index(["game_pk", "at_bat_number"])["is_hr"]
    pitches = pitches_last_season.join(flag.rename("is_hr"), on=["game_pk", "at_bat_number"])
    pitches = pitches.dropna(subset=["is_hr"])
    # `balls`/`strikes` on a pitch row are the count BEFORE that pitch, i.e. a count the PA reached
    reached = pitches.drop_duplicates(["game_pk", "at_bat_number", "balls", "strikes"])
    table = {}
    for (balls, strikes), rows in reached.groupby(["balls", "strikes"]):
        if balls <= 3 and strikes <= 2:
            table[f"{int(balls)}-{int(strikes)}"] = {
                "multiplier": round(float(rows["is_hr"].mean() / overall), 4),
                "pa": int(len(rows)),
            }
    return table


def player_table(pa, id_col, hand_col, opp_col, prior_k, platoon, mine_is_batter):
    """Build the per-player dict for batters (id_col='batter') or pitchers (id_col='pitcher')."""
    lg_rate = pa["is_hr"].mean()
    players = {}
    for pid, rows in pa.groupby(id_col):
        n = len(rows)
        if n < MIN_PA:
            continue
        overall = shrink(rows["is_hr"].sum(), n, lg_rate, prior_k)
        entry = {"pa": int(n), "hr": int(rows["is_hr"].sum()), "rate": round(overall, 5)}

        # handedness of this player (switch hitters appear on both sides)
        hands = rows[hand_col].value_counts(normalize=True)
        if mine_is_batter:
            entry["hand"] = "S" if hands.get("L", 0) >= 0.1 and hands.get("R", 0) >= 0.1 else hands.idxmax()
        else:
            entry["hand"] = hands.idxmax()

        for opp in ("L", "R"):
            sub = rows[rows[opp_col] == opp]
            # League matchup adjustment for the prior. A switch hitter bats from the side opposite
            # the pitcher's arm (batting left vs a righty), so use that side for them.
            my_side = entry["hand"]
            if my_side == "S":
                my_side = "L" if opp == "R" else "R"
            ratio = platoon.get(my_side, {}).get(opp, 1.0)
            entry[f"vs{opp}"] = split_stats(len(sub), sub["is_hr"].sum(), overall * ratio, K_SPLIT)
        players[str(int(pid))] = entry
    return players


# ---------------------------------------------------------------- step 3: park factors
def fetch_park_factors(year):
    """Scrape the JSON Baseball Savant embeds in its park factor page. 100 = average."""
    url = ("https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=year"
           f"&year={year}&batSide=&stat=index_hr&condition=All&rolling=3&parks=mlb")
    html = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})).read().decode()
    match = re.search(r"var data = (\[.*?\]);", html, re.S)
    if not match:
        raise RuntimeError("Could not find park factor data on the Savant page")
    rows = json.loads(match.group(1))
    return {r["venue_id"]: int(r["index_hr"]) for r in rows}, rows[0].get("year_range", "")


# ---------------------------------------------------------------- main
def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(OUT_PATH))
    args = parser.parse_args()

    season_data = {s: download_season(s) for s in sorted(set(PLAYER_SEASONS + [COUNT_SEASON]))}

    pa = pd.concat([to_plate_appearances(season_data[s]) for s in PLAYER_SEASONS], ignore_index=True)
    print(f"{len(pa):,} plate appearances, {int(pa['is_hr'].sum()):,} home runs")

    platoon_bat = league_platoon(pa, "stand", "p_throws")    # batter hand -> pitcher hand
    platoon_pit = league_platoon(pa, "p_throws", "stand")    # pitcher hand -> batter hand

    park, park_range = fetch_park_factors(PARK_YEAR)
    counts = count_table(season_data[COUNT_SEASON])

    result = {
        "meta": {
            "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "player_seasons": PLAYER_SEASONS,
            "count_season": COUNT_SEASON,
            "park_factor_years": park_range,
            "k_batter_overall": K_BATTER_OVERALL,
            "k_pitcher_overall": K_PITCHER_OVERALL,
            "k_split": K_SPLIT,
            "min_pa": MIN_PA,
        },
        "league": {"hr_per_pa": round(float(pa["is_hr"].mean()), 5), "pa": int(len(pa)),
                   "matchup": league_matchup_rates(pa),
                   "platoon_batter": platoon_bat, "platoon_pitcher": platoon_pit},
        "count_multipliers": counts,
        "park_hr_factors": park,
        "batters": player_table(pa, "batter", "stand", "p_throws", K_BATTER_OVERALL, platoon_bat, True),
        "pitchers": player_table(pa, "pitcher", "p_throws", "stand", K_PITCHER_OVERALL, platoon_pit, False),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB): "
          f"{len(result['batters'])} batters, {len(result['pitchers'])} pitchers, league HR/PA {result['league']['hr_per_pa']}")


if __name__ == "__main__":
    main()
