// The matchup scene: a little cartoon of the pitcher and batter that reacts to the count.
//
// Camera: the center-field camera you see on TV, looking in at home plate.
//   - The pitcher is on the mound in the back, seen from behind. His ball hand is on the side he
//     throws with (right-handed pitcher = ball in the viewer's right hand, left-handed = left).
//   - The batter stands beside the plate. From this camera a RIGHT-handed batter stands on the
//     viewer's RIGHT of the plate and a LEFT-handed batter on the viewer's LEFT. His bat is held
//     up on the side AWAY from the plate.
// Everything below is drawn from `batSide` and `pitchHand`, so it always matches the data.

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

const BUBBLE = {
  batter: { aggressive: "😤", ready: "🙂", defensive: "🧐", patient: "😌", tense: "😬", spike: "🔥" },
  pitcher: { confident: "😎", neutral: "😐", worried: "😰", tense: "😬" },
};

// Darken a #rrggbb color (for caps and helmets).
function darken(hex, amount = 0.3) {
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)));
  return `rgb(${r},${g},${b})`;
}

const SKIN = "#e0ac80";
const PANTS = "#d9dde3";

// ---------------------------------------------------------------- the batter
// Drawn with the plate toward +x and the bat toward -x, then mirrored if needed.
function batter(mood, batColor, spike, flip) {
  const stance = { aggressive: 12, ready: 9, defensive: 7, patient: 8, tense: 8 }[mood];
  const crouch = mood === "defensive" || mood === "tense" ? 5 : 0;
  // bat: where the hands are and where the tip points (shorter and more upright when choked up)
  const bat = {
    aggressive: { hand: [-14, -66], tip: [-36, -108] },
    ready: { hand: [-13, -64], tip: [-24, -108] },
    defensive: { hand: [-10, -58], tip: [-16, -96] },
    patient: { hand: [-13, -62], tip: [-21, -92] },
    tense: { hand: [-11, -60], tip: [-16, -98] },
  }[mood];

  const face = {
    aggressive: `<path d="M-6 -78 L-1 -75 M4 -75 L9 -78" class="brow"/><path d="M-1 -66 Q3 -61 8 -66" class="mouth"/>`,
    ready: `<path d="M0 -65 Q4 -62 8 -65" class="mouth"/>`,
    defensive: `<path d="M-5 -76 L0 -76 M4 -76 L9 -76" class="brow"/><path d="M1 -64.5 L7 -64.5" class="mouth"/>`,
    patient: `<path d="M0 -65 Q4 -63 8 -65" class="mouth"/>`,
    tense: `<path d="M-6 -77 L-1 -76 M4 -76 L9 -77" class="brow"/><path d="M-1 -65 q2 -3 4 0 t4 0" class="mouth"/>`,
  }[mood];
  const sweat = mood === "tense" ? `<path d="M15 -80 q-3 5 0 7 q3 -2 0 -7z" class="sweat"/>` : "";
  const squint = mood === "defensive" || mood === "tense";

  return `
    <g transform="translate(0 ${crouch})"><g class="bob">
      <line x1="-4" y1="-30" x2="${-stance}" y2="${-crouch}" class="leg"/>
      <line x1="4" y1="-30" x2="${stance}" y2="${-crouch}" class="leg"/>
      <rect x="-11" y="-60" width="22" height="32" rx="5" fill="${batColor}" class="body"/>
      <line x1="-8" y1="-54" x2="${bat.hand[0]}" y2="${bat.hand[1]}" class="arm" stroke="${batColor}"/>
      <line x1="4" y1="-54" x2="${bat.hand[0] + 2}" y2="${bat.hand[1] + 3}" class="arm" stroke="${batColor}"/>
      <line x1="${bat.hand[0] + 2}" y1="${bat.hand[1] + 2}" x2="${bat.tip[0]}" y2="${bat.tip[1]}" class="bat ${spike ? "glow" : ""}"/>
      <circle cx="${bat.hand[0]}" cy="${bat.hand[1] + 1}" r="3.4" fill="${SKIN}"/>
      <circle cx="1" cy="-71" r="9.5" fill="${SKIN}"/>
      <path d="M-8.5 -71 A9.5 9.5 0 0 1 10.5 -71 L10.5 -73 L-8.5 -73 Z" fill="${darken(batColor)}"/>
      <rect x="8" y="-75" width="8" height="3" rx="1.5" fill="${darken(batColor)}"/>
      <circle cx="-2" cy="-71.5" r="${squint ? 1.1 : 1.6}" class="eye"/><circle cx="6" cy="-71.5" r="${squint ? 1.1 : 1.6}" class="eye"/>
      ${face}${sweat}
      <g class="bubble" transform="translate(30 -92) scale(${flip} 1)"><circle r="11"/><text y="5" text-anchor="middle">${spike ? BUBBLE.batter.spike : BUBBLE.batter[mood]}</text></g>
    </g></g>`;
}

// ---------------------------------------------------------------- the pitcher (seen from behind)
// `side` = +1 when he throws with his right hand (the viewer's right), -1 for left.
function pitcher(mood, pitchColor, side) {
  const slump = { confident: -3, neutral: 0, worried: 4, tense: 2 }[mood];
  const armUp = { confident: -78, neutral: -72, worried: -62, tense: -70 }[mood];
  const sweat = mood === "worried" || mood === "tense"
    ? `<path d="M-13 ${-66 + slump} q-3 5 0 7 q3 -2 0 -7z" class="sweat"/><path d="M13 ${-60 + slump} q-3 5 0 7 q3 -2 0 -7z" class="sweat"/>` : "";
  return `
    <g class="bob ${mood === "tense" ? "shake" : ""}">
      <rect x="-7" y="-28" width="6" height="28" rx="2" fill="${PANTS}"/><rect x="1" y="-28" width="6" height="28" rx="2" fill="${PANTS}"/>
      <rect x="-11" y="${-58 + slump}" width="22" height="${34 - slump}" rx="5" fill="${pitchColor}" class="body"/>
      <line x1="${-side * 10}" y1="${-52 + slump}" x2="${-side * 16}" y2="${-38 + slump}" class="arm" stroke="${pitchColor}"/>
      <circle cx="${-side * 18}" cy="${-36 + slump}" r="6" fill="#8a5a2b" class="glove"/>
      <line x1="${side * 10}" y1="${-52 + slump}" x2="${side * 19}" y2="${armUp + slump}" class="arm" stroke="${pitchColor}"/>
      <circle cx="${side * 20}" cy="${armUp - 3 + slump}" r="3.6" class="ball-in-hand"/>
      <circle cx="0" cy="${-67 + slump}" r="9" fill="${darken(pitchColor, 0.35)}"/>
      ${sweat}
      <g class="bubble" transform="translate(${-side * 30} ${-86 + slump}) scale(1.5)"><circle r="11"/><text y="5" text-anchor="middle">${BUBBLE.pitcher[mood]}</text></g>
    </g>`;
}

// ---------------------------------------------------------------- the whole scene
/**
 * @param o { batSide: "L"|"R", pitchHand: "L"|"R", balls, strikes, outs,
 *            batColor, pitchColor, spike }
 * @returns { html, key }  `key` changes only when something visible changes, so the caller can
 *                         skip redrawing (and avoid restarting the animations) on every poll.
 */
export function sceneHtml(o) {
  const mood = countMood(o.balls, o.strikes);
  const batterMood = mood.batter;
  const side = o.pitchHand === "R" ? 1 : -1;      // ball hand: viewer's right for a righty
  const plateDir = o.batSide === "R" ? -1 : 1;    // righty stands on the viewer's right, so the plate is toward -x
  const batterX = o.batSide === "R" ? 232 : 128;

  // Where the pitched ball starts (pitcher's ball hand) and ends (just in front of the plate).
  const startX = 180 + side * 12;
  const startY = 36;
  const dx = 180 - startX;
  const dy = 176 - startY;

  const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<circle cx="${i * 13}" cy="0" r="4.6" class="dot ${cls} ${i < n ? "on" : ""}"/>`).join("");

  const key = [o.batSide, o.pitchHand, o.balls, o.strikes, o.outs, o.batColor, o.pitchColor, !!o.spike].join("|");
  const html = `
    <svg class="scene-svg" viewBox="0 0 360 230" role="img"
         aria-label="${o.batSide === "L" ? "Left" : "Right"}-handed batter facing a ${o.pitchHand === "L" ? "left" : "right"}-handed pitcher. ${mood.label}. ${mood.text}">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1220"/><stop offset="1" stop-color="#1d2b4a"/></linearGradient>
        <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4a30"/><stop offset="1" stop-color="#17381f"/></linearGradient>
        <pattern id="crowd" width="9" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#ffffff" opacity=".18"/><circle cx="6.5" cy="5" r="1.3" fill="#ffd27a" opacity=".16"/></pattern>
      </defs>
      <rect width="360" height="230" fill="url(#sky)"/>
      <rect y="14" width="360" height="40" fill="url(#crowd)"/>
      <rect y="54" width="360" height="176" fill="url(#grass)"/>
      <ellipse cx="180" cy="202" rx="118" ry="30" fill="#6b4a2e"/>
      <ellipse cx="180" cy="94" rx="36" ry="9" fill="#7a5636"/>
      <rect x="172" y="91" width="16" height="3" rx="1" fill="#f4f4f0"/>
      <rect x="116" y="170" width="46" height="46" rx="2" class="box"/><rect x="198" y="170" width="46" height="46" rx="2" class="box"/>
      <polygon points="168,198 192,198 192,205 180,213 168,205" fill="#f4f4f0"/>

      <g transform="translate(180 96) scale(0.68)">${pitcher(mood.pitcher, o.pitchColor, side)}</g>
      <g transform="translate(${batterX} 218) scale(${plateDir * 1.3} 1.3)">${batter(batterMood, o.batColor, o.spike, plateDir)}</g>

      <circle cx="${startX}" cy="${startY}" r="3.2" class="ball" style="--dx:${dx}px;--dy:${dy}px"/>

      <g transform="translate(14 22)" class="count-dots"><text x="0" y="-9" class="dot-label">BALLS</text>
        <g transform="translate(5 0)">${dots(o.balls, 3, "ball-dot")}</g></g>
      <g transform="translate(14 52)" class="count-dots"><text x="0" y="-9" class="dot-label">STRIKES</text>
        <g transform="translate(5 0)">${dots(o.strikes, 2, "strike-dot")}</g></g>
      <g transform="translate(346 22)" class="count-dots"><text x="0" y="-9" text-anchor="end" class="dot-label">OUTS</text>
        <g transform="translate(-31 0)">${dots(o.outs, 2, "out-dot")}</g></g>
    </svg>
    <div class="scene-caption"><b>${mood.label}</b> <span>${mood.text}</span></div>
    <div class="scene-hands">
      <span>Bats <b>${o.batSide === "L" ? "left" : "right"}</b></span>
      <span>Pitcher throws <b>${o.pitchHand === "L" ? "left" : "right"}</b></span>
    </div>`;
  return { html, key };
}
