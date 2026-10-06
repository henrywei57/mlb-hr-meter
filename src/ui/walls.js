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

// What makes each famous wall special. `from`/`to` are angles (degrees, negative = left field).
const SPECIAL = {
  "3":    { base: "#1d5a3a", seams: [-46, -10], board: -31, label: "GREEN MONSTER" },   // Fenway
  "17":   { ivy: true },                                                                 // Wrigley
  "2395": { base: "#8a3b2a", arches: [8, 46] },                                          // Oracle Park
  "2":    { base: "#123a2a" },                                                           // Camden Yards
  "3313": { base: "#14263f" },                                                           // Yankee Stadium
  "22":   { base: "#18417a" },                                                           // Dodger Stadium
};

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
  ctx.fillStyle = "#ffd23f"; ctx.fillRect(0, 0, W, 10);
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
