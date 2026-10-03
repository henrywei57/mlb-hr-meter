"""
build_classics.py - looks up a few famous games in MLB's schedule and writes public/data/classics.json,
the "Famous games" shortcuts in the game browser.

    python scripts/build_classics.py

Each entry gives a date plus the two teams; the script finds the real gamePk on that date and checks
the teams match (so a wrong guess is reported instead of linking to the wrong game). Edit CLASSICS
to add your own. Uses only the Python standard library.
"""

import json
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "classics.json"
API = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={date}&hydrate=team,linescore"

# (date, away team contains, home team contains, title, why it's worth watching[, which game that day: 1 or 2])
CLASSICS = [
    ("2016-11-02", "Cubs", "Indians", "World Series Game 7 (2016)", "Extra innings, a rain delay, and the Cubs end a 108-year drought."),
    ("2019-10-30", "Nationals", "Astros", "World Series Game 7 (2019)", "The road team won every game of the series, ending in Houston."),
    ("2017-10-29", "Dodgers", "Astros", "World Series Game 5 (2017)", "13-12 in 11 innings: five lead changes and a wild slugfest."),
    ("2018-10-26", "Red Sox", "Dodgers", "World Series Game 3 (2018)", "18 innings, the longest World Series game ever by time."),
    ("2020-10-27", "Rays", "Dodgers", "World Series Game 6 (2020)", "The Dodgers clinch, after a famous pitching change."),
    ("2024-10-30", "Dodgers", "Yankees", "World Series Game 5 (2024)", "The Dodgers come back from 5-0 down to win the title."),
    ("2022-10-04", "Yankees", "Rangers", "Aaron Judge's 62nd home run (2022)", "He breaks the American League single-season record (game 2 of a doubleheader).", 2),
    ("2024-09-19", "Dodgers", "Marlins", "Shohei Ohtani's 50-50 game (2024)", "Three home runs and two steals to become the first 50-50 player."),
    ("2015-10-14", "Rangers", "Blue Jays", "Bautista's bat flip game (2015)", "ALDS Game 5: the seventh inning, and one of baseball's most famous home runs."),
    ("2023-06-28", "Yankees", "Athletics", "Domingo German's perfect game (2023)", "27 up, 27 down: a perfect game."),
    ("2015-04-06", "Blue Jays", "Yankees", "Opening Day 2015", "The first day of the first Statcast season."),
]


def get(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def main():
    found = []
    for date, away, home, title, blurb, *which in CLASSICS:
        games = [g for d in get(API.format(date=date))["dates"] for g in d["games"]]
        matches = [g for g in sorted(games, key=lambda g: g["gameDate"]) if away in g["teams"]["away"]["team"]["name"] and home in g["teams"]["home"]["team"]["name"]]
        match = matches[(which[0] if which else 1) - 1] if len(matches) >= (which[0] if which else 1) else None
        if not match:
            print(f"NOT FOUND  {date} {away} @ {home}: {title}  (found: {[(g['teams']['away']['team']['name'], g['teams']['home']['team']['name']) for g in games]})")
            continue
        a, h = match["teams"]["away"], match["teams"]["home"]
        print(f"ok  {date}  {a['team']['name']} {a.get('score')} @ {h['team']['name']} {h.get('score')}  gamePk {match['gamePk']}  {title}")
        found.append({
            "gamePk": match["gamePk"], "date": date, "title": title, "blurb": blurb,
            "away": a["team"]["name"], "home": h["team"]["name"], "awayScore": a.get("score"), "homeScore": h.get("score"),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(found, indent=1), encoding="utf-8")
    print(f"wrote {OUT} with {len(found)} of {len(CLASSICS)} games")


if __name__ == "__main__":
    main()
