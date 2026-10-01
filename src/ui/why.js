// The "Why" list: turns the model's multipliers into plain words.
// Each row = a label + "how many times more/less likely than average". Tap a row for a tip.

import { esc } from "../util.js";

const NEARLY_NEUTRAL = 0.04; // within 4% of 1.0x we just call it "about average"
const handWord = (h) => (h === "L" ? "Lefty" : "Righty");

function direction(multiplier) {
  if (multiplier > 1 + NEARLY_NEUTRAL) return "up";
  if (multiplier < 1 - NEARLY_NEUTRAL) return "down";
  return "flat";
}

// Returns the rows in a fixed order so the list doesn't jump around between at-bats.
export function whyRows(prediction, situation) {
  const f = prediction.factors;
  const rows = [
    {
      key: "batter", label: "Batter power", multiplier: f.batter, suffix: " avg",
      tip: "How often this hitter homers compared with the average hitter, over the last two seasons.",
    },
    {
      key: "pitcher",
      label: f.pitcher < 1 - NEARLY_NEUTRAL ? "Pitcher allows few HR"
        : f.pitcher > 1 + NEARLY_NEUTRAL ? "Pitcher allows many HR" : "Pitcher: average HR allowed",
      multiplier: f.pitcher,
      tip: "How often this pitcher gives up homers compared with the average pitcher.",
    },
    {
      key: "platoon", label: `${handWord(situation.batSide)} vs ${handWord(situation.pitchHand).toLowerCase()}`,
      multiplier: f.platoon,
      tip: "Lefty/righty matchups change homer rates. This also includes how these two do against that hand.",
    },
    {
      key: "count", label: `${situation.balls}-${situation.strikes} count`, multiplier: f.count,
      tip: "Homer rate for at-bats that reach this count, compared with a fresh 0-0 at-bat. Most counts are below 1.0x because many at-bats end in a walk or strikeout before a chance to homer.",
    },
    {
      key: "park",
      label: f.park > 1 + NEARLY_NEUTRAL ? "Hitter-friendly park"
        : f.park < 1 - NEARLY_NEUTRAL ? "Pitcher-friendly park" : "Neutral park",
      multiplier: f.park,
      tip: "How many more (or fewer) homers this ballpark gives up than an average ballpark.",
    },
  ];
  return rows.map((row) => ({ ...row, direction: direction(row.multiplier) }));
}

const ARROWS = { up: "▲", down: "▼", flat: "•" };

// `openKeys` = a Set of row keys whose tip is currently expanded.
export function whyHtml(prediction, situation, openKeys = new Set()) {
  const rows = whyRows(prediction, situation)
    .map((r) => `
      <li class="why-item">
        <button type="button" class="why-row ${r.direction}" data-why="${r.key}" aria-expanded="${openKeys.has(r.key)}">
          <span class="why-arrow" aria-hidden="true">${ARROWS[r.direction]}</span>
          <span class="why-label">${esc(r.label)}</span>
          <span class="why-value">${r.multiplier.toFixed(1)}x${r.suffix || ""}</span>
        </button>
        ${openKeys.has(r.key) ? `<p class="why-tip">${esc(r.tip)}</p>` : ""}
      </li>`)
    .join("");

  const notes = [];
  if (prediction.missing.batter) notes.push("No data for this batter, so we used the league average.");
  if (prediction.missing.pitcher) notes.push("No data for this pitcher, so we used the league average.");

  return `
    <h2>Why this number</h2>
    <p class="hint">Each line multiplies the league-average chance. 2.0x means twice as likely, 0.5x means half as likely. Tap a line for details.</p>
    <ul class="why-list">${rows}</ul>
    ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}`;
}
