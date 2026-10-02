// Themes. A theme is just a name on the <html> element (data-theme="day"); styles.css has one
// block of color variables per theme. The 3D stadium reads the same variables, so it matches.

import { getSettings, saveSettings } from "./settings.js";

// `swatch` is only for the little preview dots in Settings: [page, card, accent].
export const THEMES = {
  night: { label: "Night", swatch: ["#0f1218", "#1a1f2a", "#ffcf4a"] },
  day: { label: "Day", swatch: ["#e9eef5", "#ffffff", "#f5b301"] },
  ballpark: { label: "Ballpark", swatch: ["#0b1f14", "#14301f", "#f4d35e"] },
  scoreboard: { label: "Scoreboard", swatch: ["#000000", "#0b0a05", "#ffc83a"] },
  contrast: { label: "High contrast", swatch: ["#000000", "#000000", "#ffe600"] },
};

export function currentTheme() {
  const saved = getSettings().theme;
  return THEMES[saved] ? saved : "night";
}

// Apply a theme to the page (and remember it if `save` is true).
export function applyTheme(name = currentTheme(), save = false) {
  if (!THEMES[name]) name = "night";
  document.documentElement.dataset.theme = name;
  if (save) saveSettings({ theme: name });
  // Color the browser's address bar / the iPhone status bar to match the page.
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#0f1218");
  window.dispatchEvent(new CustomEvent("themechange", { detail: name }));
}

// The next theme in the list (used by the quick-switch button on the game screen).
export function nextTheme() {
  const names = Object.keys(THEMES);
  return names[(names.indexOf(currentTheme()) + 1) % names.length];
}

// Read a color variable (e.g. "--sky-top") from the current theme, for the 3D scene.
export const themeVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
