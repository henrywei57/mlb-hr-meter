"""
build_demo.py - saves a finished 2026 postseason game with 2+ home runs for the "Demo game" button.

    python scripts/build_demo.py              # picks the postseason game with the most home runs
    python scripts/build_demo.py --game-pk 849846

Writes public/data/demo_game.json: the game's full MLB "feed/live" JSON, plus a "_batterLines"
map (regular-season AVG/HR/OPS for every batter) and a "_winProb" list so the demo works fully offline.
Uses only the Python standard library.
"""

import argparse
import json
import urllib.request
from pathlib import Path

API = "https://statsapi.mlb.com/api"
OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "demo_game.json"
POSTSEASON = "F,D,L,W"  # wild card, division series, league championship, world series
SEASON = 2026


def get(url):
    return json.load(urllib.request.urlopen(url))


def count_homers(feed):
    plays = feed["liveData"]["plays"]["allPlays"]
    return sum(1 for p in plays if p["result"].get("eventType") == "home_run")


def find_game():
    url = f"{API}/v1/schedule?sportId=1&startDate={SEASON}-09-01&endDate={SEASON}-11-30&gameType={POSTSEASON}"
    games = [g for d in get(url)["dates"] for g in d["games"] if g["status"]["abstractGameState"] == "Final"]
    best = None
    for g in games:
        homers = count_homers(get(f"{API}/v1.1/game/{g['gamePk']}/feed/live"))
        print(g["gamePk"], g["gameType"], g["teams"]["away"]["team"]["name"], "@", g["teams"]["home"]["team"]["name"], homers, "HR")
        if homers >= 2 and (best is None or homers > best[1]):
            best = (g["gamePk"], homers)
    if not best:
        raise SystemExit("No postseason game with 2+ home runs found yet.")
    return best[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-pk", type=int)
    args = parser.parse_args()

    game_pk = args.game_pk or find_game()
    feed = get(f"{API}/v1.1/game/{game_pk}/feed/live")
    print(f"using game {game_pk} with {count_homers(feed)} home runs, game type {feed['gameData']['game']['type']}")

    batter_ids = sorted({p["matchup"]["batter"]["id"] for p in feed["liveData"]["plays"]["allPlays"]})
    ids = ",".join(map(str, batter_ids))
    hydrate = f"stats(group=[hitting],type=[season],season={SEASON},gameType=R)"
    people = get(f"{API}/v1/people?personIds={ids}&hydrate={hydrate}")["people"]
    lines = {}
    for person in people:
        splits = person.get("stats", [{}])[0].get("splits", [])
        if splits:
            stat = splits[0]["stat"]
            lines[str(person["id"])] = {"avg": stat["avg"], "hr": stat["homeRuns"], "ops": stat["ops"]}
    feed["_batterLines"] = lines

    # MLB's win probability after every play (home team, 0-100), so the demo can show it offline
    wp = get(f"{API}/v1/game/{game_pk}/winProbability")
    feed["_winProb"] = [
        {"i": p["about"]["atBatIndex"], "inning": p["about"]["inning"], "isTop": p["about"]["isTopInning"],
         "home": p["homeTeamWinProbability"], "added": p["homeTeamWinProbabilityAdded"], "event": p["result"].get("event", "")}
        for p in wp
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(feed, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB), batter lines for {len(lines)} of {len(batter_ids)} batters")


if __name__ == "__main__":
    main()
