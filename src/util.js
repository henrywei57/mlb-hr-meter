// Small helpers shared by the screens.

// Escape text before putting it inside HTML so a weird name can never break the page.
export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 0.0912 -> "9%". Anything under half a percent reads "<1%".
export function pct(probability) {
  const rounded = Math.round(probability * 100);
  return rounded < 1 ? "<1%" : rounded + "%";
}

// "Updated 12 seconds ago"
export function timeAgo(timestampMs, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

// Pick white or near-black text so it stays readable on a team-colored background.
// Uses the WCAG "relative luminance" formula: brighter backgrounds get dark text.
export function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#10131a" : "#ffffff";
}

export function teamColor(colors, teamId) {
  return colors[teamId] || "#3a4252"; // neutral grey if a team is missing from the JSON
}

export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// MLB dates its schedule by US Eastern time, not the user's time zone. Someone in Asia or Europe
// would otherwise ask for "tomorrow" and miss games that are live right now.
export function mlbDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts; // en-CA formats as YYYY-MM-DD
}

// localStorage can throw (private mode, storage full), so every use goes through these.
export function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
export function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
