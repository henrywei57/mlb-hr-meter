// Optional sound effects, made from scratch with the browser's Web Audio (no sound files):
// the crack of the bat, and a crowd cheer that is bigger for a home run.
// They only play if "Sound effects" is switched on in Settings. Browsers only allow sound after
// the person has tapped or clicked something, so the audio engine starts on the first tap.

import { getSettings } from "./settings.js";

let ctx = null;

// Start (or wake up) the audio engine. Called from a tap.
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch { ctx = null; } // no Web Audio here: sounds are just skipped
}

const ready = () => getSettings().sound && ctx && ctx.state === "running";

// A buffer of random noise: the raw material for a bat crack and a crowd.
function noise(seconds) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** The crack of a bat: a very short burst of bright noise plus a low thump. */
export function playCrack() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const click = ctx.createBufferSource(); click.buffer = noise(0.12);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  click.connect(hp).connect(g).connect(ctx.destination); click.start(t);

  const thump = ctx.createOscillator(); thump.type = "sine"; thump.frequency.setValueAtTime(220, t); thump.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  const tg = ctx.createGain(); tg.gain.setValueAtTime(0.6, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  thump.connect(tg).connect(ctx.destination); thump.start(t); thump.stop(t + 0.2);
}

/** A crowd cheer: filtered noise that swells and fades. `big` = longer and louder (a home run). */
export function playCheer(big = false) {
  if (!ready()) return;
  const t = ctx.currentTime, length = big ? 3.2 : 1.6, peak = big ? 0.5 : 0.22;
  const src = ctx.createBufferSource(); src.buffer = noise(length);
  const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = big ? 1100 : 900; band.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(band).connect(g).connect(ctx.destination); src.start(t);
}
