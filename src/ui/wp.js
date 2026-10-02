// The Win Probability card: the biggest thing on the game screen. Two big percentages (one per
// team), a tug-of-war bar, and a chart of how the game has swung. The numbers come from MLB's model
// (see src/winprob.js).

import { esc, teamColor } from "../util.js";
import { wpText, chartPoints, NEUTRAL } from "../winprob.js";

const W = 320, H = 100, TOP = 6, BOTTOM = 6;
const yOf = (home) => TOP + ((100 - home) / 100) * (H - TOP - BOTTOM);

// The chart: the HOME team's win chance after every play. Above the middle line the home team is
// ahead (shaded in its color); below it the away team is ahead.
function chartSvg(series, s, colors) {
  const points = chartPoints(series);
  const span = Math.max(points.length - 1, 20);       // leave room to grow until the game has some plays
  const x = (k) => (k / span) * W;
  const line = points.map((p, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${yOf(p.home).toFixed(1)}`).join(" ");
  const mid = yOf(50);
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${mid} L0 ${mid} Z`;

  // a faint tick where each inning starts
  const ticks = [];
  points.forEach((p, k) => {
    if (k > 0 && p.isTop && (!points[k - 1].isTop || points[k - 1].inning !== p.inning)) {
      ticks.push(`<line x1="${x(k)}" y1="${TOP}" x2="${x(k)}" y2="${H - BOTTOM}" class="wp-tick"/><text x="${x(k) + 2}" y="${H - 1}" class="wp-inning">${p.inning}</text>`);
    }
  });

  const last = points[points.length - 1];
  const home = teamColor(colors, s.home.id), away = teamColor(colors, s.away.id);
  return `
    <svg class="wp-chart" viewBox="0 0 ${W} ${H + 8}" role="img" aria-label="Win probability across the game">
      <defs>
        <clipPath id="wp-above"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath>
        <clipPath id="wp-below"><rect x="0" y="${mid}" width="${W}" height="${H}"/></clipPath>
      </defs>
      ${ticks.join("")}
      <path d="${area}" fill="${home}" opacity="0.55" clip-path="url(#wp-above)"/>
      <path d="${area}" fill="${away}" opacity="0.55" clip-path="url(#wp-below)"/>
      <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" class="wp-mid"/>
      <path d="${line}" class="wp-line"/>
      <circle cx="${x(points.length - 1)}" cy="${yOf(last.home)}" r="3.6" class="wp-dot"/>
      <text x="3" y="${TOP + 8}" class="wp-side">${esc(s.home.abbr || "HOME")}</text>
      <text x="3" y="${H - BOTTOM - 2}" class="wp-side">${esc(s.away.abbr || "AWAY")}</text>
    </svg>`;
}

/** Draw the card into `el`. `s` is the game state (it carries s.wp). */
export function drawWinProbability(el, s, colors) {
  const wp = s.wp || { ...NEUTRAL, series: [] };
  const decided = s.isFinal;
  const homeColor = teamColor(colors, s.home.id), awayColor = teamColor(colors, s.away.id);
  const leader = wp.home === wp.away ? null : wp.home > wp.away ? "home" : "away";
  const side = (team, pct, key) => `
    <div class="wp-team ${key} ${leader === key ? "lead" : ""}">
      <span class="wp-name">${esc(team.name)}</span>
      <b class="wp-pct">${wpText(pct, decided)}</b>
    </div>`;
  el.innerHTML = `
    <div class="wp-title">Win probability</div>
    <div class="wp-teams">${side(s.away, wp.away, "away")}${side(s.home, wp.home, "home")}</div>
    <div class="wp-bar" aria-hidden="true"><i style="width:${wp.away}%;background:${awayColor}"></i><i style="width:${wp.home}%;background:${homeColor}"></i></div>
    ${chartSvg(wp.series || [], s, colors)}
    <div class="wp-foot"><span id="m-updated"></span><span>MLB's win probability model</span></div>`;
}
