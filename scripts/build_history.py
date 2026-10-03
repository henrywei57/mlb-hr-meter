"""
build_history.py - builds a rates file for EVERY Statcast season, so a game from 2016 is predicted
with the players' 2015-16 numbers instead of today's.

    python scripts/build_history.py              # all seasons 2015 .. 2025 (2026 is rates.json)
    python scripts/build_history.py --from 2022  # only 2022 .. 2025

For season S, each player's rates use pitches from S-1 and S (just S for 2015, the first Statcast
year); the count table uses S-1 (or S in 2015); park factors are Savant's 3-year window ending in S.
Output: public/data/rates/<S>.json, plus public/data/rates/index.json listing the seasons built.

The first run downloads about ten seasons of Statcast pitches, which takes HOURS. Every season is
cached in scripts/cache/, so a stopped run picks up where it left off. The app uses a season's file
when you open a game from that season, and falls back to rates.json when a file is missing.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_rates as br  # noqa: E402  (the same maths as the main rates file)

FIRST_STATCAST_SEASON = 2015
OUT_DIR = br.ROOT / "public" / "data" / "rates"


def seasons_for(season):
    """The seasons of pitches that feed season S's rates."""
    prior = season - 1
    return [prior, season] if prior >= FIRST_STATCAST_SEASON else [season]


def update_index():
    built = sorted(int(p.stem) for p in OUT_DIR.glob("[0-9][0-9][0-9][0-9].json"))
    (OUT_DIR / "index.json").write_text(json.dumps({"seasons": built}), encoding="utf-8")
    return built


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="first", type=int, default=FIRST_STATCAST_SEASON)
    parser.add_argument("--to", dest="last", type=int, default=2025)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # newest first: recent seasons matter most, and a stopped run still leaves useful files
    for season in range(args.last, args.first - 1, -1):
        out = OUT_DIR / f"{season}.json"
        if out.exists():
            print(f"{season}: already built", flush=True)
            continue
        player = seasons_for(season)
        print(f"=== {season}: player seasons {player} ===", flush=True)
        br.build(player, player[0], season, out, with_names=False)
        print("seasons built so far:", update_index(), flush=True)


if __name__ == "__main__":
    main()
