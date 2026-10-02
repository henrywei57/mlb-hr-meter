// A small pop-up that shows ONE pitch on a flat strike zone, with its details. Used when the 3D
// scene isn't available (an older browser, or 3D switched off), so Replay still shows something.

import { esc } from "../util.js";
import { zoneHtml } from "./zone.js";
import { resultText } from "../pitchdata.js";

export function showPitchDialog({ title, subtitle, pitch, atBatResult }) {
  const dialog = document.createElement("dialog");
  dialog.className = "pitch-dialog";
  dialog.innerHTML = `
    <h2>${esc(title)}</h2>
    <p class="hint">${esc(subtitle || "")}</p>
    ${zoneHtml([pitch], pitch.n)}
    <p class="note">${esc(resultText(pitch, atBatResult))}${pitch.path ? "" : " · no flight tracking for this pitch"}</p>
    <button type="button" class="chip-btn" data-close>Close</button>`;
  const dismiss = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.addEventListener("click", (event) => { if (event.target.closest("[data-close]") || event.target === dialog) dismiss(); });
  dialog.addEventListener("close", dismiss); // (Escape closes it too)
  document.body.appendChild(dialog);
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
}
