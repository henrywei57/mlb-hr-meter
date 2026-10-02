// Screen 4: Saved pitches. The pitches you saved from games, grouped by game and inning. Tap
// Replay to fly one again in 3D with its flight path. Everything needed is stored with the pitch,
// so this works offline and after the game is over.

import { esc } from "../util.js";
import { loadSaved, storeSaved, groupSaved } from "../saved.js";
import { resultText, typeColor } from "../pitchdata.js";
import { createStage } from "./stage.js";
import { showPitchDialog } from "./pitchdialog.js";

export function showSaved(root, { colors }) {
  let list = loadSaved();
  let selected = null; // id of the pitch in the viewer

  root.innerHTML = `
    <header class="top"><a class="back" href="#/">‹ Games</a><h1>Saved pitches</h1><span></span></header>
    <div class="saved-grid">
      <div class="col">
        <section id="sv-stage" class="card scene"></section>
        <section id="sv-detail" class="card" hidden></section>
      </div>
      <div class="col"><section id="sv-list" class="card"></section></div>
    </div>`;
  const $ = (sel) => root.querySelector(sel);

  const stage = createStage($("#sv-stage"), { colors, compact: true });
  const find = (id) => list.find((x) => x.id === id);

  async function play(id) {
    const item = find(id);
    if (!item) return;
    selected = id;
    const { pitch } = item;
    $("#sv-detail").hidden = false;
    $("#sv-detail").innerHTML = `
      <div class="lab-label">${esc(item.game.away.name)} @ ${esc(item.game.home.name)} · ${esc(item.game.date)}</div>
      <h2 class="spaced">${esc(item.batter.name)} vs ${esc(item.pitcher.name)}</h2>
      <p class="hint">${esc(item.inning)} · pitch ${pitch.n} · count ${pitch.balls}-${pitch.strikes}</p>
      <p><i class="chip-dot" style="background:${typeColor(pitch.typeCode)}"></i><b>${esc(pitch.type || "Pitch")}</b>${pitch.speed ? ` ${pitch.speed.toFixed(1)} mph` : ""} · ${esc(resultText(pitch, item.atBatResult))}</p>
      ${pitch.path ? "" : `<p class="note">MLB has no flight tracking for this pitch, so the ball just flies straight to where it crossed the plate.</p>`}`;
    drawList();
    await stage.whenReady();
    const ctx = { batter: item.batter, pitcher: item.pitcher, battingTeamId: item.battingTeamId, fieldingTeamId: item.fieldingTeamId };
    if (!stage.replayFull(ctx, pitch)) {
      showPitchDialog({ title: `${item.batter.name} vs ${item.pitcher.name}`, subtitle: `${item.inning} · pitch ${pitch.n}`, pitch, atBatResult: item.atBatResult });
    }
  }

  function drawList() {
    const el = $("#sv-list");
    if (!list.length) {
      $("#sv-stage").hidden = true;
      el.innerHTML = `<h2>Saved pitches</h2><p class="muted">Nothing saved yet. Open a game, find a pitch in the <b>Pitch finder</b>, and tap <b>Save</b>. The pitches you save show up here, by game and inning.</p>`;
      return;
    }
    el.innerHTML = `<h2>${list.length} saved pitch${list.length === 1 ? "" : "es"}</h2>` + groupSaved(list).map((g) => `
      <div class="saved-game">
        <div class="saved-game-title"><b>${esc(g.game.away.name)} @ ${esc(g.game.home.name)}</b><span class="muted">${esc(g.game.date)}</span></div>
        ${g.innings.map((inn) => `
          <div class="inning-block">
            <div class="inning-head static"><b>${esc(inn.label)}</b><span>${inn.items.length} saved</span></div>
            <ul class="pitch-list">${inn.items.map((it) => `
              <li class="pitch-row ${it.id === selected ? "selected" : ""}">
                <span class="pr-num">#${it.pitch.n}<small>${it.pitch.balls}-${it.pitch.strikes}</small></span>
                <span class="pr-main"><i class="chip-dot" style="background:${typeColor(it.pitch.typeCode)}"></i><b>${esc(it.pitch.type || "Pitch")}</b>${it.pitch.speed ? ` ${it.pitch.speed.toFixed(1)} mph` : ""}
                  <small>${esc(it.batter.name)} vs ${esc(it.pitcher.name)} · ${esc(resultText(it.pitch, it.atBatResult))}</small></span>
                <span class="pr-btns"><button type="button" class="mini" data-play="${esc(it.id)}">Replay</button><button type="button" class="mini" data-remove="${esc(it.id)}">Remove</button></span>
              </li>`).join("")}</ul>
          </div>`).join("")}
      </div>`).join("") + `<button type="button" class="ghost danger" id="sv-clear">Remove all saved pitches</button>`;
  }

  root.addEventListener("click", (e) => {
    const playBtn = e.target.closest("[data-play]");
    if (playBtn) {
      play(playBtn.dataset.play);
      const box = $("#sv-stage").getBoundingClientRect();
      if (box.top < 0) $("#sv-stage").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      list = list.filter((x) => x.id !== removeBtn.dataset.remove);
      storeSaved(list);
      if (selected === removeBtn.dataset.remove) { selected = null; $("#sv-detail").hidden = true; }
      drawList();
      return;
    }
    if (e.target.closest("#sv-clear") && confirm("Remove all your saved pitches? This can't be undone.")) {
      list = []; storeSaved(list); selected = null; $("#sv-detail").hidden = true; drawList();
    }
  });

  drawList();
  if (list.length) { stage.init(); play(list[0].id); }
  return () => stage.dispose();
}
