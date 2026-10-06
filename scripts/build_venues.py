"""
build_venues.py - saves each ballpark's real dimensions to public/data/venues.json so the 3D
stadium can be drawn differently for every park (fence distances, grass or turf, roof, size).

    python scripts/build_venues.py

Reads the park ids from the rates files (every park that appears in a season we have data for),
asks MLB's venues API for each, and writes one entry per park id. Uses only the standard library.
"""

import glob
import json
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
API = "https://statsapi.mlb.com/api/v1/venues?venueIds={ids}&hydrate=fieldInfo,location"


def get(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def main():
    ids = set()
    for path in glob.glob(str(DATA / "rates" / "*.json")) + [str(DATA / "rates.json")]:
        ids |= set(json.load(open(path)).get("park_names", {}).keys())
    ids = sorted(ids, key=int)

    out = {}
    for venue in get(API.format(ids=",".join(ids)))["venues"]:
        f = venue.get("fieldInfo") or {}
        keys = ["leftLine", "leftCenter", "center", "rightCenter", "rightLine"]
        if not all(f.get(k) for k in keys):
            print("no dimensions for", venue["id"], venue["name"])
            continue
        out[str(venue["id"])] = {
            "name": venue["name"],
            "lf": f["leftLine"], "lcf": f["leftCenter"], "cf": f["center"], "rcf": f["rightCenter"], "rf": f["rightLine"],
            "turf": f.get("turfType") or "Grass",
            "roof": f.get("roofType") or "Open",
            "capacity": f.get("capacity"),
        }
    (DATA / "venues.json").write_text(json.dumps(out, indent=1, sort_keys=True))
    print(f"wrote {len(out)} parks")


main()
