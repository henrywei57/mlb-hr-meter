"""
build_rates.py - precompute every number the app needs and write public/data/rates.json

Run it from the project root:

    pip install pybaseball pandas
    python scripts/build_rates.py

The first run downloads a full season of Statcast pitch data (slow, ~30-60 min per
season). Downloads are cached in scripts/cache/ so later runs take seconds.
The app NEVER runs this script. It only reads the JSON file this script writes.

What goes into rates.json
  league.*_per_pa          league-average home runs, strikeouts and total bases per plate appearance
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
MIN_PA = 25                    # players with fewer PA/BF than this are left out (app uses league avg)

# The three things we predict. For each one, "pretend PA" (see shrink()) say how hard to pull a
# small sample toward the prior. Rare, noisy things (HR) need more; strikeouts settle down fast.
#   col      = column of the plate-appearance table holding the value (HR/K are 0 or 1; TB is 0-4)
#   k_*      = pretend PA for a batter's overall rate / a pitcher's overall rate / each lefty-righty split
STATS = {
    "hr": {"col": "is_hr", "k_batter": 170, "k_pitcher": 700, "k_split": 300},
    "k":  {"col": "is_k",  "k_batter": 60,  "k_pitcher": 100, "k_split": 200},
    "tb": {"col": "tb",    "k_batter": 250, "k_pitcher": 500, "k_split": 400},
}

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
    """Collapse pitch rows into one row per plate appearance, with is_hr, is_k and tb (total bases)."""
    last = pitches.sort_values(["game_pk", "at_bat_number", "pitch_number"])
    last = last.groupby(["game_pk", "at_bat_number"], as_index=False).last()
    ended = last["events"].notna() & ~last["events"].fillna("").str.startswith(NOT_A_PLATE_APPEARANCE)
    pa = last[ended].copy()
    pa["is_hr"] = (pa["events"] == "home_run").astype(int)
    pa["is_k"] = pa["events"].isin(["strikeout", "strikeout_double_play"]).astype(int)
    # total bases: single 1, double 2, triple 3, home run 4, everything else 0 (walks don't count)
    pa["tb"] = pa["events"].map({"single": 1, "double": 2, "triple": 3, "home_run": 4}).fillna(0).astype(int)
    return pa


# ---------------------------------------------------------------- step 2: the maths
def shrink(total, pa, prior, k):
    """Pull a raw per-PA rate toward `prior` by adding k pretend PA of that prior."""
    return (total + k * prior) / (pa + k)


def league_platoon(pa, hand_col, other_col, col):
    """
    How much the league rate of `col` moves when `hand_col` player faces `other_col` hand.
    Returns {"L": {"L": ratio, "R": ratio}, "R": {...}}: ratio = rate in that matchup
    divided by the rate of that hand against everyone.
    """
    out = {}
    for hand, rows in pa.groupby(hand_col):
        if hand not in ("L", "R"):
            continue
        overall = rows[col].mean()
        out[hand] = {}
        for other, sub in rows.groupby(other_col):
            if other in ("L", "R"):
                out[hand][other] = round(float(sub[col].mean() / overall), 4)
    return out


def league_matchup_rates(pa, col):
    """League rate for each handedness matchup: matchup["L"]["R"] = lefty batters vs righty pitchers.
    The model compares against THIS rate (not the all-league rate) so the lefty/righty effect
    is counted once, not twice."""
    out = {}
    for (bat, throw), rows in pa.groupby(["stand", "p_throws"]):
        if bat in ("L", "R") and throw in ("L", "R"):
            out.setdefault(bat, {})[throw] = round(float(rows[col].mean()), 5)
    return out


def count_tables(pitches_last_season):
    """For each stat: ball-strike count -> multiplier, using PAs that REACHED each count."""
    pa = to_plate_appearances(pitches_last_season)
    keys = ["game_pk", "at_bat_number"]
    flags = pa.set_index(keys)[[cfg["col"] for cfg in STATS.values()]]
    pitches = pitches_last_season.join(flags, on=keys).dropna(subset=["is_hr"])
    # `balls`/`strikes` on a pitch row are the count BEFORE that pitch, i.e. a count the PA reached
    reached = pitches.drop_duplicates(keys + ["balls", "strikes"])
    tables = {}
    for stat, cfg in STATS.items():
        col = cfg["col"]
        overall = pa[col].mean()
        table = {}
        for (balls, strikes), rows in reached.groupby(["balls", "strikes"]):
            if balls <= 3 and strikes <= 2:
                table[f"{int(balls)}-{int(strikes)}"] = {
                    "multiplier": round(float(rows[col].mean() / overall), 4),
                    "pa": int(len(rows)),
                }
        tables[stat] = table
    return tables


def stat_block(rows, stat, lg_rate, prior_k, hand, opp_col, platoon):
    """One player's rates for one stat: overall, plus vs LHP/LHB and vs RHP/RHB."""
    cfg = STATS[stat]
    col = cfg["col"]
    n = len(rows)
    overall = shrink(rows[col].sum(), n, lg_rate, prior_k)
    block = {stat: int(rows[col].sum()), "rate": round(overall, 5)}
    for opp in ("L", "R"):
        sub = rows[rows[opp_col] == opp]
        # League matchup adjustment for the prior. A switch hitter bats from the side opposite
        # the pitcher's arm (batting left vs a righty), so use that side for them.
        my_side = hand
        if my_side == "S":
            my_side = "L" if opp == "R" else "R"
        ratio = platoon[stat].get(my_side, {}).get(opp, 1.0)
        split_rate = shrink(sub[col].sum(), len(sub), overall * ratio, cfg["k_split"])
        block[f"vs{opp}"] = {"pa": int(len(sub)), stat: int(sub[col].sum()), "rate": round(split_rate, 5)}
    return block


def player_table(pa, id_col, hand_col, opp_col, overall_k_key, platoon, mine_is_batter):
    """Per-player dict for batters (id_col='batter') or pitchers (id_col='pitcher').
    Home run rates sit at the top level of each player; strikeout and total-bases rates sit
    under "k" and "tb"."""
    lg = {stat: pa[cfg["col"]].mean() for stat, cfg in STATS.items()}
    players = {}
    for pid, rows in pa.groupby(id_col):
        if len(rows) < MIN_PA:
            continue

        # handedness of this player (switch hitters appear on both sides)
        hands = rows[hand_col].value_counts(normalize=True)
        if mine_is_batter:
            hand = "S" if hands.get("L", 0) >= 0.1 and hands.get("R", 0) >= 0.1 else hands.idxmax()
        else:
            hand = hands.idxmax()

        entry = {"pa": int(len(rows)), "hand": hand}
        for stat, cfg in STATS.items():
            block = stat_block(rows, stat, lg[stat], cfg[overall_k_key], hand, opp_col, platoon)
            if stat == "hr":
                entry.update(block)
            else:
                entry[stat] = block
        players[str(int(pid))] = entry
    return players


# ---------------------------------------------------------------- player names
def fetch_names(ids):
    """{player id: full name} from the MLB Stats API (100 ids per request), cached on disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / "names.json"
    names = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    missing = [i for i in sorted(ids) if i not in names]
    for start in range(0, len(missing), 100):
        chunk = missing[start:start + 100]
        url = "https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(chunk)
        try:
            for person in json.load(urllib.request.urlopen(url))["people"]:
                names[str(person["id"])] = person["fullName"]
        except Exception as err:  # noqa: BLE001 - a failed batch just leaves those players unnamed
            print(f"  could not fetch names for a batch: {err}")
    path.write_text(json.dumps(names), encoding="utf-8")
    return names


# ---------------------------------------------------------------- step 3: park factors
def fetch_park_factors(year, pa):
    """
    Scrape the JSON Baseball Savant embeds in its park factor page (100 = average).
    Returns (hr, strikeout, total_bases) dicts keyed by MLB venue id, plus the year range.
    Savant has no total-bases index, so we blend its 1B/2B/3B/HR indexes, weighting each by
    how many total bases that kind of hit contributes league-wide.
    """
    url = ("https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=year"
           f"&year={year}&batSide=&stat=index_hr&condition=All&rolling=3&parks=mlb")
    html = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})).read().decode()
    match = re.search(r"var data = (\[.*?\]);", html, re.S)
    if not match:
        raise RuntimeError("Could not find park factor data on the Savant page")
    rows = json.loads(match.group(1))

    bases_by_kind = {"index_1b": 1 * (pa["tb"] == 1).sum(), "index_2b": 2 * (pa["tb"] == 2).sum(),
                     "index_3b": 3 * (pa["tb"] == 3).sum(), "index_hr": 4 * (pa["tb"] == 4).sum()}
    total = sum(bases_by_kind.values())

    names = {r["venue_id"]: r["venue_name"] for r in rows}
    hr = {r["venue_id"]: int(r["index_hr"]) for r in rows}
    k = {r["venue_id"]: int(r["index_so"]) for r in rows}
    tb = {r["venue_id"]: round(sum(float(r[key]) * w for key, w in bases_by_kind.items()) / total)
          for r in rows}
    return hr, k, tb, names, rows[0].get("year_range", "")


# ---------------------------------------------------------------- main
def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(OUT_PATH))
    args = parser.parse_args()

    season_data = {s: download_season(s) for s in sorted(set(PLAYER_SEASONS + [COUNT_SEASON]))}

    pa = pd.concat([to_plate_appearances(season_data[s]) for s in PLAYER_SEASONS], ignore_index=True)
    print(f"{len(pa):,} plate appearances, {int(pa['is_hr'].sum()):,} HR, "
          f"{int(pa['is_k'].sum()):,} strikeouts, {int(pa['tb'].sum()):,} total bases")

    # {stat: {hand: {other hand: ratio}}}
    platoon_bat = {st: league_platoon(pa, "stand", "p_throws", c["col"]) for st, c in STATS.items()}
    platoon_pit = {st: league_platoon(pa, "p_throws", "stand", c["col"]) for st, c in STATS.items()}

    park_hr, park_k, park_tb, park_names, park_range = fetch_park_factors(PARK_YEAR, pa)
    counts = count_tables(season_data[COUNT_SEASON])

    result = {
        "meta": {
            "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "player_seasons": PLAYER_SEASONS,
            "count_season": COUNT_SEASON,
            "park_factor_years": park_range,
            "pretend_pa": {stat: {k: v for k, v in cfg.items() if k != "col"} for stat, cfg in STATS.items()},
            "min_pa": MIN_PA,
        },
        "league": {
            "hr_per_pa": round(float(pa["is_hr"].mean()), 5),
            "k_per_pa": round(float(pa["is_k"].mean()), 5),
            "tb_per_pa": round(float(pa["tb"].mean()), 5),
            "xbh_per_pa": round(float((pa["tb"] >= 2).mean()), 5),  # extra-base hits (2+ bases) per PA
            "pa": int(len(pa)),
            "matchup": league_matchup_rates(pa, "is_hr"),
            "matchup_k": league_matchup_rates(pa, "is_k"),
            "matchup_tb": league_matchup_rates(pa, "tb"),
        },
        "count_multipliers": counts["hr"],
        "k_count_multipliers": counts["k"],
        "tb_count_multipliers": counts["tb"],
        "park_hr_factors": park_hr,
        "park_k_factors": park_k,
        "park_tb_factors": park_tb,
        "park_names": park_names,
        "batters": player_table(pa, "batter", "stand", "p_throws", "k_batter", platoon_bat, True),
        "pitchers": player_table(pa, "pitcher", "p_throws", "stand", "k_pitcher", platoon_pit, False),
    }

    names = fetch_names(set(result["batters"]) | set(result["pitchers"]))
    for group in ("batters", "pitchers"):
        for pid, entry in result[group].items():
            if pid in names:
                entry["name"] = names[pid]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    lg = result["league"]
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB): {len(result['batters'])} batters, "
          f"{len(result['pitchers'])} pitchers; league per PA: HR {lg['hr_per_pa']}, K {lg['k_per_pa']}, TB {lg['tb_per_pa']}")


if __name__ == "__main__":
    main()
