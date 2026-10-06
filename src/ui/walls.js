// The painted outfield wall of each ballpark: one wide picture that wraps the whole wall from the
// left field line to the right field line. It is drawn on a canvas, so every park gets its own
// look (padding, signboards, painted distance numbers, and the famous ones: the Green Monster,
// Wrigley's ivy, Oracle Park's brick arches). A real photo can replace any of them: put it at
// public/venues/walls/<venue id>.jpg (see the README there).

const W = 2048, H = 256;
const psiToU = (psi) => (psi + 46) / 92;   // the wall mesh runs from -46 to +46 degrees

// small seeded random numbers, so a park always looks the same
function rng(seed) {
  let s = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const shade = (hex, k) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const f = (c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
};

// What makes each park's wall its own. `base` = wall colour, `trim` = the colour of the top edge,
// `stripe` = a painted line along the wall, `features` = special sections (from/to are angles in
// degrees, negative = left field): brick, stone, rocks, pool. The Monster, ivy and arches are
// handled separately below. Colours follow each team's look; none of this is a real logo.
const SPECIAL = {
  "1":    { base: "#0e2a52", trim: "#c8102e", stripe: "#c8102e", features: [{ kind: "rocks", from: -14, to: 14 }] },   // Angel Stadium: the rock pile
  "10":   { base: "#1b4d2e", trim: "#ffd23f", stripe: "#ffd23f" },                                                    // Oakland Coliseum
  "12":   { base: "#12315a", trim: "#8fbce6", stripe: "#8fbce6" },                                                    // Tropicana Field
  "14":   { base: "#1c4a8c", trim: "#ffffff", stripe: "#e8e8e8" },                                                    // Rogers Centre
  "15":   { base: "#1b1b22", trim: "#a71930", stripe: "#e3d4ad", features: [{ kind: "pool", from: -9, to: 9 }] },       // Chase Field: the pool
  "17":   { ivy: true },                                                                                              // Wrigley Field
  "19":   { base: "#1f4d34", trim: "#33006f", stripe: "#33006f" },                                                    // Coors Field
  "2":    { base: "#123a2a", trim: "#df4601", stripe: "#df4601", features: [{ kind: "brick", from: 6, to: 46, color: "#8a3b2a" }] }, // Camden Yards: the warehouse
  "22":   { base: "#18417a", trim: "#ffffff", stripe: "#ffffff" },                                                    // Dodger Stadium
  "2392": { base: "#14382c", trim: "#eb6e1f", stripe: "#eb6e1f" },                                                    // Daikin Park
  "2394": { base: "#0c2340", trim: "#fa4616", stripe: "#fa4616" },                                                    // Comerica Park
  "2395": { base: "#8a3b2a", arches: [8, 46], trim: "#fd5a1e" },                                                      // Oracle Park
  "2602": { base: "#1a4a2e", trim: "#c6011f", stripe: "#c6011f" },                                                    // Great American Ball Park
  "2680": { base: "#2d2216", trim: "#ffc425", stripe: "#ffc425", features: [{ kind: "brick", from: -46, to: -30, color: "#b99a6b" }] }, // Petco Park: the warehouse in left
  "2681": { base: "#1d4d2f", trim: "#e81828", stripe: "#e81828" },                                                    // Citizens Bank Park
  "2889": { base: "#1a4a2e", trim: "#c41e3a", stripe: "#c41e3a" },                                                    // Busch Stadium
  "3":    { base: "#1d5a3a", seams: [-46, -10], board: -31 },                                                         // Fenway Park: the Green Monster
  "31":   { base: "#1b4a30", trim: "#fdb827", stripe: "#fdb827", features: [{ kind: "stone", from: 10, to: 46 }] },   // PNC Park: stone right field wall
  "32":   { base: "#12284c", trim: "#ffc52f", stripe: "#ffc52f" },                                                    // American Family Field
  "3289": { base: "#0e2a5b", trim: "#ff5910", stripe: "#ff5910" },                                                    // Citi Field
  "3309": { base: "#5a1020", trim: "#ffffff", stripe: "#14225a" },                                                    // Nationals Park
  "3312": { base: "#0c2340", trim: "#d31145", stripe: "#d31145", features: [{ kind: "stone", from: -46, to: 46, band: [0.0, 0.2] }] }, // Target Field: limestone top
  "3313": { base: "#14263f", trim: "#c4ced4", stripe: "#c4ced4" },                                                    // Yankee Stadium
  "4":    { base: "#17171c", trim: "#c4ced4", stripe: "#c4ced4" },                                                    // Rate Field
  "4169": { base: "#10151c", trim: "#ff6600", stripe: "#00a3e0" },                                                    // loanDepot park
  "4705": { base: "#10224a", trim: "#ce1141", stripe: "#ce1141" },                                                    // Truist Park
  "5":    { base: "#0f2142", trim: "#e31937", stripe: "#e31937" },                                                    // Progressive Field
  "5325": { base: "#0b2a55", trim: "#c0111f", stripe: "#c0111f" },                                                    // Globe Life Field
  "680":  { base: "#0f2a44", trim: "#00a5a5", stripe: "#00a5a5" },                                                    // T-Mobile Park
  "7":    { base: "#0f3f8a", trim: "#bd9b60", stripe: "#bd9b60" },                                                    // Kauffman Stadium
};

// special sections of the wall face
function drawFeature(ctx, f, rand) {
  const x0 = psiToU(f.from) * W, x1 = psiToU(f.to) * W;
  const [ya, yb] = (f.band || [0.02, 0.56]).map((v) => v * H);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, ya, x1 - x0, yb - ya); ctx.clip();
  if (f.kind === "brick") {
    ctx.fillStyle = f.color || "#8a3b2a"; ctx.fillRect(x0, ya, x1 - x0, yb - ya);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = ya; y < yb; y += 14) { ctx.fillRect(x0, y, x1 - x0, 2); for (let x = x0 + ((y / 14) % 2) * 20; x < x1; x += 40) ctx.fillRect(x, y, 2, 14); }
  } else if (f.kind === "stone") {
    ctx.fillStyle = "#c8b58a"; ctx.fillRect(x0, ya, x1 - x0, yb - ya);
    for (let y = ya; y < yb; y += 22) for (let x = x0; x < x1; x += 46 + rand() * 40) {
      ctx.fillStyle = `rgba(${90 + rand() * 40},${75 + rand() * 30},${50 + rand() * 20},0.22)`; ctx.fillRect(x, y, 40 + rand() * 30, 20);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x, y, 2, 22); ctx.fillRect(x, y, 80, 2);
    }
  } else if (f.kind === "rocks") {
    ctx.fillStyle = "#6b5f52"; ctx.fillRect(x0, ya, x1 - x0, yb - ya);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = ["#8a7c6a", "#5a4f44", "#a39580", "#463d34"][Math.floor(rand() * 4)];
      ctx.beginPath(); ctx.ellipse(x0 + rand() * (x1 - x0), ya + rand() * (yb - ya), 14 + rand() * 26, 8 + rand() * 14, rand() * 3, 0, 7); ctx.fill();
    }
  } else if (f.kind === "pool") {
    ctx.fillStyle = "#4fb3d9"; ctx.fillRect(x0, ya, x1 - x0, yb - ya);
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;
    for (let y = ya + 10; y < yb; y += 14) { ctx.beginPath(); for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, y + Math.sin(x / 9) * 3); ctx.stroke(); }
  }
  ctx.restore();
}

function drawNumbers(ctx, venue) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "800 54px -apple-system, Segoe UI, sans-serif";
  for (const [psi, feet] of [[-45, venue.lf], [-22.5, venue.lcf], [0, venue.cf], [22.5, venue.rcf], [45, venue.rf]]) {
    const x = psiToU(psi) * W;
    ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.strokeText(String(feet), x, H * 0.3);
    ctx.fillStyle = "#fff8d6"; ctx.fillText(String(feet), x, H * 0.3);
  }
}

export function paintWall(venue, { width = W, height = H } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.scale(width / W, height / H);
  const rand = rng(venue.id);
  const sp = SPECIAL[venue.id] || {};
  const base = sp.base || venue.wallColor || "#174a31";

  // the wall face
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,255,255,0.10)"); g.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  if (sp.ivy) {
    // Wrigley: brick behind a thick coat of ivy
    ctx.fillStyle = "#7a3b2c"; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = ["#2f6b2f", "#3f8a3a", "#245a28", "#5aa24a"][Math.floor(rand() * 4)];
      ctx.beginPath(); ctx.ellipse(rand() * W, rand() * H * 0.92, 6 + rand() * 8, 4 + rand() * 6, rand() * 3, 0, 7); ctx.fill();
    }
  } else if (sp.arches) {
    // Oracle Park's brick right field wall with its arches
    const [a, b] = sp.arches.map(psiToU);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < H; y += 16) ctx.fillRect(0, y, W, 2);
    for (let x = a * W; x < b * W; x += 74) {
      ctx.fillStyle = "#3a1a14"; ctx.beginPath(); ctx.moveTo(x + 10, H * 0.6); ctx.lineTo(x + 10, H * 0.28); ctx.arc(x + 37, H * 0.28, 27, Math.PI, 0); ctx.lineTo(x + 64, H * 0.6); ctx.fill();
    }
  } else {
    // padding along the bottom, signboards above it
    ctx.fillStyle = "rgba(8,10,16,0.62)"; ctx.fillRect(0, H * 0.56, W, H * 0.44);
    const palette = [shade(base, 0.25), "#e8e4d4", "#c9a227", "#d8d8d8", shade(base, -0.4), "#2b6cb0", "#b83232"];
    let x = 0;
    while (x < W) {
      const w = 90 + rand() * 170;
      ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
      ctx.globalAlpha = 0.85; ctx.fillRect(x + 4, H * 0.58, w - 8, H * 0.34); ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (let k = 0; k < 2; k++) ctx.fillRect(x + 14, H * (0.64 + k * 0.13), (w - 28) * (0.5 + rand() * 0.5), 10); // stand-in for lettering
      x += w;
    }
  }

  for (const f of sp.features || []) drawFeature(ctx, f, rand);
  if (sp.stripe) { ctx.fillStyle = sp.stripe; ctx.globalAlpha = 0.9; ctx.fillRect(0, H * 0.545, W, 8); ctx.globalAlpha = 1; }

  // panel seams (the Green Monster is built from tin panels)
  if (sp.seams) {
    const [a, b] = sp.seams.map(psiToU);
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 3;
    for (let x = a * W; x < b * W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    // the hand-operated scoreboard
    const sx = psiToU(sp.board) * W;
    ctx.fillStyle = "#0e1410"; ctx.fillRect(sx - 150, H * 0.18, 300, H * 0.5);
    ctx.fillStyle = "#e9efe0";
    for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) ctx.fillRect(sx - 130 + c * 30, H * 0.24 + r * 24, 18, 12);
  }

  // yellow top edge and painted distance numbers
  ctx.fillStyle = sp.trim || "#ffd23f"; ctx.fillRect(0, 0, W, 10);
  drawNumbers(ctx, venue);
  return canvas;
}

// A real photo of the wall, if one was added to public/venues/walls. Calls back only on success.
export function loadWallPhoto(venueId, onLoad) {
  const tryExt = (exts) => {
    if (!exts.length) return;
    const img = new Image();
    img.onload = () => onLoad(img);
    img.onerror = () => tryExt(exts.slice(1));
    img.src = `public/venues/walls/${venueId}.${exts[0]}`;
  };
  tryExt(["jpg", "png"]);
}
