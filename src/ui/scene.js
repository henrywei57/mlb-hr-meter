// The matchup scene: the pitcher and batter, with their real MLB headshots, reacting to the count.
// When a batter gets a hit, the same scene plays the swing and the ball flying out.
//
// Camera: behind home plate, looking out at the mound (the "catcher's view").
//   - The pitcher faces us from the mound. A RIGHT-handed pitcher holds the ball in his right hand,
//     which is on the viewer's LEFT. A left-hander holds it on the viewer's RIGHT.
//   - A RIGHT-handed batter stands on the viewer's LEFT of the plate, a LEFT-handed batter on the
//     viewer's RIGHT. Either way the bat is held up on the side away from the plate.
// Everything is drawn from `batSide` and `pitchHand`, so it always matches the data.
//
// Headshots are loaded from MLB's image server by player id; if one can't load (offline, or no
// photo), the plain cartoon face drawn underneath it stays visible.

// ---------------------------------------------------------------- how the count changes the mood
// Moods: batter "aggressive" | "ready" | "defensive" | "patient" | "tense"
//        pitcher "confident" | "neutral" | "worried" | "tense"
const MOODS = {
  "0-0": ["Fresh at-bat", "Nobody has the edge yet.", "ready", "neutral"],
  "1-0": ["Hitter ahead", "The batter is slightly ahead.", "ready", "neutral"],
  "2-0": ["Hitter's count", "The pitcher has to throw a strike.", "aggressive", "worried"],
  "3-0": ["Hitter's count", "3-0: the batter can afford to be patient.", "patient", "worried"],
  "2-1": ["Hitter's count", "The pitcher is under pressure.", "aggressive", "worried"],
  "3-1": ["Hitter's count", "The pitcher can't afford another ball.", "aggressive", "worried"],
  "0-1": ["Pitcher ahead", "The pitcher has the early edge.", "ready", "confident"],
  "0-2": ["Pitcher's count", "The batter is just trying to survive.", "defensive", "confident"],
  "1-2": ["Pitcher's count", "Two strikes: the batter protects the plate.", "defensive", "confident"],
  "1-1": ["Even count", "Anyone's at-bat.", "ready", "neutral"],
  "2-2": ["Two strikes", "Even count, but the batter must protect.", "defensive", "neutral"],
  "3-2": ["Full count", "Everything is on the line.", "tense", "tense"],
};

export function countMood(balls, strikes) {
  const [label, text, batter, pitcher] = MOODS[`${Math.min(balls, 3)}-${Math.min(strikes, 2)}`] || MOODS["0-0"];
  return { label, text, batter, pitcher };
}

// The little label by each player's head, and the color of the ring around his photo
// (green = has the edge, orange = under pressure, white = even).
const TAGS = {
  batter: { aggressive: "Aggressive", ready: "Ready", defensive: "Protecting", patient: "Patient", tense: "Tense" },
  pitcher: { confident: "Confident", neutral: "Steady", worried: "Pressured", tense: "Tense" },
};
const RING = {
  aggressive: "#4bd37b", patient: "#4bd37b", confident: "#4bd37b",
  ready: "#ffffff", neutral: "#ffffff", defensive: "#7fb8ff",
  worried: "#ffb14a", tense: "#ffb14a",
};

// ---------------------------------------------------------------- small helpers
const SKIN = "#e0ac80";
const PANTS = "#d9dde3";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// MLB's headshot for a player id. The "d_" part is MLB's own generic silhouette for unknown ids.
export const headshotUrl = (id) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${id}/headshot/67/current`;

// A round photo with a fallback cartoon face underneath. (cx, cy) is the center, r the radius.
function avatar(id, clipId, cx, cy, r, ring) {
  return `
    <clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${SKIN}"/>
    <circle cx="${cx - r * 0.33}" cy="${cy - r * 0.1}" r="1.5" class="eye"/><circle cx="${cx + r * 0.33}" cy="${cy - r * 0.1}" r="1.5" class="eye"/>
    <path d="M${cx - r * 0.3} ${cy + r * 0.38} Q${cx} ${cy + r * 0.55} ${cx + r * 0.3} ${cy + r * 0.38}" class="mouth"/>
    <image href="${headshotUrl(id)}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}"
           preserveAspectRatio="xMidYMin slice" clip-path="url(#${clipId})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="2.6"/>`;
}

// A small text label ("Aggressive") with a white background. `flip` undoes a mirrored parent.
function pill(text, x, y, flip = 1) {
  const w = text.length * 4.9 + 12;
  return `<g transform="translate(${x} ${y}) scale(${flip} 1)" class="pill"><rect x="${-w / 2}" y="-7" width="${w}" height="14" rx="7"/><text y="3.4" text-anchor="middle">${text}</text></g>`;
}

// ---------------------------------------------------------------- the batter
// Drawn with the plate toward +x and the bat toward -x, then mirrored for lefties.
// `swing` = hit mode: the bat swings (a SMIL animation that starts when playResult() is called).
function batter(o, mood, flip, swing) {
  const stance = { aggressive: 12, ready: 9, defensive: 7, patient: 8, tense: 8 }[mood];
  const crouch = mood === "defensive" || mood === "tense" ? 5 : 0;
  const pose = {
    aggressive: { hand: [-14, -64], tip: [-36, -108] },
    ready: { hand: [-13, -62], tip: [-24, -106] },
    defensive: { hand: [-10, -57], tip: [-16, -94] },
    patient: { hand: [-13, -60], tip: [-21, -90] },
    tense: { hand: [-11, -58], tip: [-16, -96] },
  }[mood];
  const [hx, hy] = pose.hand;
  const sweat = mood === "tense" ? `<path d="M19 -86 q-3 5 0 7 q3 -2 0 -7z" class="sweat"/>` : "";

  // In hit mode the bat starts cocked back and swings forward (clockwise) through the plate.
  const batGroup = `
    <g id="batswing">
      <line x1="${hx + 2}" y1="${hy + 2}" x2="${pose.tip[0]}" y2="${pose.tip[1]}" class="bat ${o.spike ? "glow" : ""}"/>
      <circle cx="${hx}" cy="${hy + 1}" r="3.4" fill="${SKIN}"/>
      ${swing ? `<animateTransform attributeName="transform" type="rotate" from="0 ${hx} ${hy}" to="132 ${hx} ${hy}" dur="0.17s" begin="indefinite" data-begin="${swing.swingAt}" fill="freeze"/>` : ""}
    </g>`;

  return `
    <g transform="translate(0 ${crouch})"><g class="${swing ? "" : "bob"}">
      <line x1="-4" y1="-30" x2="${-stance}" y2="${-crouch}" class="leg"/>
      <line x1="4" y1="-30" x2="${stance}" y2="${-crouch}" class="leg"/>
      <rect x="-11" y="-60" width="22" height="32" rx="5" fill="${o.batColor}" class="body"/>
      <line x1="-8" y1="-54" x2="${hx}" y2="${hy}" class="arm" stroke="${o.batColor}"/>
      <line x1="4" y1="-54" x2="${hx + 2}" y2="${hy + 3}" class="arm" stroke="${o.batColor}"/>
      ${batGroup}
      ${avatar(o.batterId, "clip-bat", 1, -76, 17, RING[mood])}
      ${sweat}
      ${pill(TAGS.batter[mood], 1, -106, flip)}
    </g></g>`;
}

// ---------------------------------------------------------------- the pitcher (faces the camera)
// `side` = +1 when his ball hand is on the viewer's right (a lefty), -1 when it's on the left.
function pitcher(o, mood, side) {
  const slump = { confident: -3, neutral: 0, worried: 4, tense: 2 }[mood];
  const armUp = { confident: -78, neutral: -72, worried: -62, tense: -70 }[mood];
  const sweat = mood === "worried" || mood === "tense"
    ? `<path d="M-20 ${-74 + slump} q-3 5 0 7 q3 -2 0 -7z" class="sweat"/><path d="M20 ${-70 + slump} q-3 5 0 7 q3 -2 0 -7z" class="sweat"/>` : "";
  return `
    <g class="bob ${mood === "tense" ? "shake" : ""}">
      <rect x="-7" y="-28" width="6" height="28" rx="2" fill="${PANTS}"/><rect x="1" y="-28" width="6" height="28" rx="2" fill="${PANTS}"/>
      <rect x="-11" y="${-58 + slump}" width="22" height="${34 - slump}" rx="5" fill="${o.pitchColor}" class="body"/>
      <line x1="${-side * 10}" y1="${-52 + slump}" x2="${-side * 16}" y2="${-38 + slump}" class="arm" stroke="${o.pitchColor}"/>
      <circle cx="${-side * 18}" cy="${-36 + slump}" r="6" fill="#8a5a2b" class="glove"/>
      <line x1="${side * 10}" y1="${-52 + slump}" x2="${side * 19}" y2="${armUp + slump}" class="arm" stroke="${o.pitchColor}"/>
      <circle cx="${side * 20}" cy="${armUp - 3 + slump}" r="3.6" class="ball-in-hand"/>
      ${avatar(o.pitcherId, "clip-pit", 0, -74 + slump, 16, RING[mood])}
      ${sweat}
      ${pill(TAGS.pitcher[mood], -side * 36, -92 + slump)}
    </g>`;
}

// ---------------------------------------------------------------- where a hit ball goes
/**
 * Path of a batted ball on screen (behind-home-plate camera: out toward the outfield is UP,
 * left field is on the viewer's left). Uses the real batted-ball data when the feed has it.
 * @param hit   { dist (feet), angle (launch angle), x, y (where it landed, MLB field coordinates) }
 * @param event "single" | "double" | "triple" | "home_run"
 */
export function flightPath(hit = {}, event, batSide = "R") {
  const defaultDist = { single: 140, double: 290, triple: 360, home_run: 400 }[event] ?? 150;
  const dist = hit.dist ?? defaultDist;

  // Spray angle: 0 = straight up the middle, negative = left field. MLB's field coordinates put
  // home plate near (125, 198) with x growing toward right field and y shrinking toward center.
  let spray = (batSide === "R" ? -1 : 1) * 15; // no data: assume he pulled it
  if (hit.x != null && hit.y != null) spray = (Math.atan2(hit.x - 125.42, 198.27 - hit.y) * 180) / Math.PI;
  spray = clamp(spray, -45, 45);

  const frac = clamp(dist / 450, 0.15, 1); // how far, 0-1
  const x0 = 180, y0 = 186;                // the plate area
  const x1 = clamp(x0 + Math.sin((spray * Math.PI) / 180) * frac * 230, 10, 350);
  const y1 = event === "home_run" ? 6 : y0 - frac * 160; // a homer leaves the picture over the wall
  const arc = clamp(hit.angle ?? 15, 2, 50) * 2.4;       // higher launch angle = higher arc
  return {
    x0, y0, x1, y1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2 - arc,
    seconds: 0.8 + frac * 0.9,
    r0: 5.4,
    r1: Math.max(1.4, 5.4 * (1 - 0.75 * frac)), // the ball looks smaller as it flies away
  };
}

const EVENT_LABEL = { single: "SINGLE", double: "DOUBLE", triple: "TRIPLE", home_run: "HOME RUN" };

// ---------------------------------------------------------------- the whole scene
function field(inner, label) {
  return `
    <svg class="scene-svg" viewBox="0 0 360 230" role="img" aria-label="${label}">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1220"/><stop offset="1" stop-color="#1d2b4a"/></linearGradient>
        <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4a30"/><stop offset="1" stop-color="#17381f"/></linearGradient>
        <pattern id="crowd" width="9" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#ffffff" opacity=".18"/><circle cx="6.5" cy="5" r="1.3" fill="#ffd27a" opacity=".16"/></pattern>
      </defs>
      <rect width="360" height="230" fill="url(#sky)"/>
      <rect y="14" width="360" height="40" fill="url(#crowd)"/>
      <rect y="54" width="360" height="176" fill="url(#grass)"/>
      <ellipse cx="180" cy="202" rx="118" ry="30" fill="#6b4a2e"/>
      <ellipse cx="180" cy="98" rx="38" ry="9" fill="#7a5636"/>
      <rect x="172" y="95" width="16" height="3" rx="1" fill="#f4f4f0"/>
      <rect x="116" y="170" width="46" height="46" rx="2" class="box"/><rect x="198" y="170" width="46" height="46" rx="2" class="box"/>
      <polygon points="168,198 192,198 192,205 180,213 168,205" fill="#f4f4f0"/>
      ${inner}
    </svg>`;
}

// Positions shared by both versions of the scene.
function layout(o) {
  const ballSide = o.pitchHand === "L" ? 1 : -1; // lefty: ball hand on the viewer's right
  const batterX = o.batSide === "R" ? 128 : 232; // righty stands on the viewer's left
  const plateDir = o.batSide === "R" ? 1 : -1;   // +1 = the plate is to his right on screen
  const startX = 180 + ballSide * 14;            // where a pitch leaves the pitcher's hand
  return { ballSide, batterX, plateDir, startX };
}

const figures = (o, mood, L, swing) => `
  <g transform="translate(180 106) scale(0.82)">${pitcher(o, mood.pitcher, L.ballSide)}</g>
  <g transform="translate(${L.batterX} 218) scale(${L.plateDir * 1.25} 1.25)">${batter(o, mood.batter, L.plateDir, swing)}</g>`;

const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<circle cx="${i * 13}" cy="0" r="4.6" class="dot ${cls} ${i < n ? "on" : ""}"/>`).join("");

const countDots = (o) => `
  <g transform="translate(14 22)" class="count-dots"><text x="0" y="-9" class="dot-label">BALLS</text><g transform="translate(5 0)">${dots(o.balls, 3, "ball-dot")}</g></g>
  <g transform="translate(14 52)" class="count-dots"><text x="0" y="-9" class="dot-label">STRIKES</text><g transform="translate(5 0)">${dots(o.strikes, 2, "strike-dot")}</g></g>
  <g transform="translate(346 22)" class="count-dots"><text x="0" y="-9" text-anchor="end" class="dot-label">OUTS</text><g transform="translate(-31 0)">${dots(o.outs, 2, "out-dot")}</g></g>`;

const pitchedBall = (L) => `<circle cx="${L.startX}" cy="52" r="4" class="ball" style="--dx:${180 - L.startX}px;--dy:${176 - 52}px"/>`;

const handsRow = (o) => `
    <div class="scene-hands">
      <span>Bats <b>${o.batSide === "L" ? "left" : "right"}</b></span>
      <span>Pitcher throws <b>${o.pitchHand === "L" ? "left" : "right"}</b></span>
    </div>`;

/**
 * The normal scene for the at-bat in progress.
 * @param o { batSide, pitchHand, batterId, pitcherId, balls, strikes, outs, batColor, pitchColor, spike }
 * @returns { html, key }  `key` changes only when something visible changes, so the caller can skip
 *                         redrawing (which would restart the animations) on every refresh.
 */
export function sceneHtml(o) {
  const mood = countMood(o.balls, o.strikes);
  const L = layout(o);
  const key = [o.batSide, o.pitchHand, o.batterId, o.pitcherId, o.balls, o.strikes, o.outs, o.batColor, o.pitchColor, !!o.spike].join("|");
  const label = `${o.batSide === "L" ? "Left" : "Right"}-handed batter facing a ${o.pitchHand === "L" ? "left" : "right"}-handed pitcher. ${mood.label}. ${mood.text}`;
  const html = `
    ${field(`${figures(o, mood, L, null)}${pitchedBall(L)}${countDots(o)}`, label)}
    <div class="scene-caption"><b>${mood.label}</b> <span>${mood.text}</span></div>
    ${handsRow(o)}`;
  return { html, key };
}

/**
 * The replay for a hit: the pitch comes in, the batter swings, and the ball flies out.
 * @param o  same as sceneHtml, plus hit: { event, dist, speed, angle, x, y } and batterName
 * Call playResult(container) after putting this html on the page to start the animation.
 */
export function resultSceneHtml(o) {
  const mood = countMood(0, 0);
  const L = layout(o);
  const f = flightPath(o.hit, o.hit.event, o.batSide);
  const swingAt = 0.78;                 // seconds after the scene appears (the pitch takes ~0.8s)
  const flightAt = swingAt + 0.1;       // the ball leaves just after contact
  const bannerAt = flightAt + f.seconds * 0.55;
  const isHr = o.hit.event === "home_run";
  const detail = [o.hit.dist ? `${Math.round(o.hit.dist)} ft` : null, o.hit.speed ? `${Math.round(o.hit.speed)} mph` : null].filter(Boolean).join("  ·  ");

  const label = `${EVENT_LABEL[o.hit.event] || "Hit"}: the batter swings and the ball flies out.`;
  const flight = `
    <circle r="${f.r0}" class="hit-ball" opacity="0">
      <animateMotion path="M ${f.x0} ${f.y0} Q ${f.cx} ${f.cy} ${f.x1} ${f.y1}" dur="${f.seconds}s" begin="indefinite" data-begin="${flightAt}" fill="freeze"/>
      <animate attributeName="r" values="${f.r0};${f.r1}" dur="${f.seconds}s" begin="indefinite" data-begin="${flightAt}" fill="freeze"/>
      <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.9;1" dur="${f.seconds}s" begin="indefinite" data-begin="${flightAt}" fill="freeze"/>
    </circle>`;
  const banner = `
    <g opacity="0" class="hit-banner ${isHr ? "hr" : ""}">
      <text x="180" y="152" text-anchor="middle" class="banner-main">${EVENT_LABEL[o.hit.event] || "HIT"}</text>
      ${detail ? `<text x="180" y="170" text-anchor="middle" class="banner-sub">${detail}</text>` : ""}
      <animate attributeName="opacity" from="0" to="1" dur="0.25s" begin="indefinite" data-begin="${bannerAt}" fill="freeze"/>
    </g>`;

  const html = `
    ${field(`${figures({ ...o, spike: isHr }, { batter: "aggressive", pitcher: mood.pitcher }, L, { swingAt })}${pitchedBall(L)}${flight}${banner}${countDots(o)}`, label)}
    <div class="scene-caption"><b>${EVENT_LABEL[o.hit.event] || "Hit"}</b> <span>${o.batterName || "The batter"} gets it done.</span></div>
    ${handsRow(o)}`;
  return { html, durationMs: Math.round((bannerAt + 1.2) * 1000) };
}

// Start the swing / flight / banner animations (they wait for this call so they all start together).
export function playResult(container) {
  // (A plain timer is used instead of beginElementAt(), which didn't reliably start every animation.)
  for (const el of container.querySelectorAll("[data-begin]")) {
    setTimeout(() => {
      try { el.beginElement(); } catch { /* old browser, or the scene was already replaced: ignore */ }
    }, parseFloat(el.dataset.begin) * 1000);
  }
}
