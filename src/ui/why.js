// The "Why" list: turns the model's multipliers into plain words.
// Each row = a label + "how many times more/less likely than average".

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
    { label: "Batter power", multiplier: f.batter, suffix: " avg" },
    {
      label: f.pitcher < 1 - NEARLY_NEUTRAL ? "Pitcher allows few HR"
        : f.pitcher > 1 + NEARLY_NEUTRAL ? "Pitcher allows many HR" : "Pitcher: average HR allowed",
      multiplier: f.pitcher,
    },
    { label: `${handWord(situation.batSide)} vs ${handWord(situation.pitchHand).toLowerCase()}`, multiplier: f.platoon },
    { label: `${situation.balls}-${situation.strikes} count`, multiplier: f.count },
    {
      label: f.park > 1 + NEARLY_NEUTRAL ? "Hitter-friendly park"
        : f.park < 1 - NEARLY_NEUTRAL ? "Pitcher-friendly park" : "Neutral park",
      multiplier: f.park,
    },
  ];
  return rows.map((row) => ({ ...row, direction: direction(row.multiplier) }));
}

const ARROWS = { up: "▲", down: "▼", flat: "•" };

export function whyHtml(prediction, situation) {
  const rows = whyRows(prediction, situation)
    .map((r) => `
      <li class="why-row ${r.direction}">
        <span class="why-arrow" aria-hidden="true">${ARROWS[r.direction]}</span>
        <span class="why-label">${esc(r.label)}</span>
        <span class="why-value">${r.multiplier.toFixed(1)}x${r.suffix || ""}</span>
      </li>`)
    .join("");

  const notes = [];
  if (prediction.missing.batter) notes.push("No data for this batter, so we used the league average.");
  if (prediction.missing.pitcher) notes.push("No data for this pitcher, so we used the league average.");

  return `
    <h2>Why this number</h2>
    <p class="hint">Each line multiplies the league-average chance. 2.0x means twice as likely, 0.5x means half as likely.</p>
    <ul class="why-list">${rows}</ul>
    ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}`;
}
