// Real ballpark dimensions, so every park can be drawn differently (see ui/scene3d.js).
// public/data/venues.json ships the parks we have rates for; for any other park (a new stadium, or
// an old game) we ask MLB's venues API once and remember the answer.

import { MLB_API, VENUES_FILE } from "./config.js";

let bundled = null;               // { "22": { name, lf, lcf, cf, rcf, rf, turf, roof, capacity } }
const fetched = new Map();        // venue id -> entry or null (asked already)

async function loadBundled() {
  if (!bundled) {
    try { bundled = await (await fetch(VENUES_FILE)).json(); } catch { bundled = {}; }
  }
  return bundled;
}

// One park's entry, or null if MLB doesn't publish its dimensions. Never throws.
export async function getVenue(id) {
  id = String(id);
  const known = (await loadBundled())[id];
  if (known) return { id, ...known };
  if (fetched.has(id)) return fetched.get(id);
  let entry = null;
  try {
    const data = await (await fetch(`${MLB_API}/v1/venues/${id}?hydrate=fieldInfo`)).json();
    const v = data.venues?.[0];
    const f = v?.fieldInfo;
    if (f?.leftLine && f.center && f.rightLine) {
      entry = {
        id, name: v.name, lf: f.leftLine, lcf: f.leftCenter || f.center - 10, cf: f.center, rcf: f.rightCenter || f.center - 10, rf: f.rightLine,
        turf: f.turfType || "Grass", roof: f.roofType || "Open", capacity: f.capacity,
      };
    }
  } catch { /* offline: the default park is drawn instead */ }
  fetched.set(id, entry);
  return entry;
}

// The outfield wall takes a dark shade of the home team's color (Wrigley's is ivy).
export function wallColor(venueId, teamHex) {
  if (String(venueId) === "17") return "#2f6b2f";
  if (!/^#[0-9a-f]{6}$/i.test(teamHex || "")) return "#174a31";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(teamHex.slice(i, i + 2), 16));
  const mix = (c) => Math.round(c * 0.42 + 18).toString(16).padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}
