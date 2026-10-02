// The strike zone card: the batter's real zone, seen from the catcher's view, with every pitch of
// the current at-bat plotted where it crossed the plate.
// Units are feet. Home plate is 17 inches wide; the zone's top and bottom come from the batter.

import { esc } from "../util.js";

const PX = 100;                       // pixels per foot
const X_MIN = -2, X_MAX = 2;          // feet left/right of the middle of the plate
const Z_MIN = 0.4, Z_MAX = 4.6;       // feet above the ground
const HALF_PLATE = 17 / 12 / 2;       // 0.708 ft
const BALL_R = 1.45 / 12;             // a baseball is about 2.9 inches across

const sx = (x) => (x - X_MIN) * PX;
const sz = (z) => (Z_MAX - z) * PX;

// colour + short label for each kind of result
function look(pitch) {
  if (pitch.inPlay) return { color: "#ffffff", text: "In play" };
  switch (pitch.code) {
    case "C": return { color: "#ff5b6e", text: "Called strike" };
    case "S": case "W": case "T": case "M": return { color: "#ff9d4d", text: "Swinging strike" };
    case "F": case "L": return { color: "#ffcf4a", text: "Foul" };
    case "B": case "*B": case "P": case "I": case "H": return { color: "#6cb4ff", text: "Ball" };
    default: return { color: "#a3acbd", text: pitch.call || "Pitch" };
  }
}

export function zoneHtml(pitches, openPitch) {
  const shown = (pitches || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
  const last = pitches?.find((p) => Number.isFinite(p.top));
  const top = last?.top ?? 3.4, bottom = last?.bottom ?? 1.6; // average zone if MLB hasn't measured one yet
  const w = (X_MAX - X_MIN) * PX, h = (Z_MAX - Z_MIN) * PX;
  const zx = sx(-HALF_PLATE), zw = HALF_PLATE * 2 * PX, zy = sz(top), zh = (top - bottom) * PX;
  const pad = BALL_R * PX;

  const grid = [1, 2].map((i) =>
    `<line x1="${zx + (zw * i) / 3}" y1="${zy}" x2="${zx + (zw * i) / 3}" y2="${zy + zh}"/>` +
    `<line x1="${zx}" y1="${zy + (zh * i) / 3}" x2="${zx + zw}" y2="${zy + (zh * i) / 3}"/>`).join("");

  // home plate drawn flat on the ground, seen from behind
  const py = sz(Z_MIN) - 8;
  const plate = `<polygon class="zone-plate" points="${sx(-HALF_PLATE)},${py - 14} ${sx(HALF_PLATE)},${py - 14} ${sx(HALF_PLATE)},${py - 6} ${sx(0)},${py + 4} ${sx(-HALF_PLATE)},${py - 6}"/>`;

  const dots = shown.map((p) => {
    const { color } = look(p);
    const cx = sx(p.x), cy = sz(p.z);
    const isLast = p.n === pitches[pitches.length - 1].n;
    return `<g class="zone-pitch ${isLast ? "latest" : ""}" data-pitch="${p.n}" tabindex="0" role="button">
      <circle cx="${cx}" cy="${cy}" r="${BALL_R * PX + 3}" fill="${color}" stroke="#10131a" stroke-width="1.5"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle">${p.n}</text></g>`;
  }).join("");

  const picked = shown.find((p) => p.n === openPitch) || shown[shown.length - 1];
  const detail = picked
    ? `<p class="zone-detail"><b>Pitch ${picked.n}</b> · ${esc(look(picked).text)}${picked.type ? ` · ${esc(picked.type)}` : ""}${picked.speed ? ` · ${Math.round(picked.speed)} mph` : ""}</p>`
    : `<p class="zone-detail muted">No pitches yet this at-bat.</p>`;

  return `
    <h2>Strike zone</h2>
    <svg class="zone-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Strike zone with this at-bat's pitches">
      <rect x="${zx - pad}" y="${zy - pad}" width="${zw + pad * 2}" height="${zh + pad * 2}" class="zone-shadow"/>
      <rect x="${zx}" y="${zy}" width="${zw}" height="${zh}" class="zone-box"/>
      <g class="zone-grid">${grid}</g>
      ${plate}${dots}
    </svg>
    ${detail}
    <p class="zone-legend"><i style="background:#ff5b6e"></i>Called strike <i style="background:#ff9d4d"></i>Swinging <i style="background:#ffcf4a"></i>Foul <i style="background:#6cb4ff"></i>Ball <i style="background:#fff"></i>In play</p>
    <p class="note">Catcher's view. The box is this batter's real zone; the dashed edge is one ball width outside it. Tap a pitch for details.</p>`;
}
