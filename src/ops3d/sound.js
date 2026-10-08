/* Safepipe Ops 3D — src/ops3d/sound.js · tiny WebAudio feedback synth.
 * Oscillators only, no assets. Master gain 0.15.
 * Contract: ensureAudio() (call-safe, resumes on gesture),
 *   play(name) with 'select' | 'hover' | 'alert' | 'toggle',
 *   setMuted(b) + isMuted(). Hover is caller-throttled.
 */

let ctx = null;
let master = null;
let muted = false;

const MASTER_GAIN = 0.15;

function ac() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  return AC;
}

export function ensureAudio() {
  const AC = ac();
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setMuted(b) {
  muted = !!b;
}

export function isMuted() {
  return muted;
}

/* True only when a context exists and is actually producing sound. */
export function audioLive() {
  return !!ctx && ctx.state === 'running' && !muted;
}

/* Single enveloped tone; slideTo enables two-tone sweeps. */
function tone(freq, durMs, { type = 'sine', vol = 1, slideTo = null, delayMs = 0 } = {}) {
  const c = ensureAudio();
  if (!c || muted) return;
  const t0 = c.currentTime + delayMs / 1000;
  const dur = durMs / 1000;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0001), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const VOICES = {
  select: () => tone(660, 80, { type: 'sine', vol: 0.9 }),
  hover: () => tone(440, 30, { type: 'sine', vol: 0.35 }),
  alert: () => tone(220, 260, { type: 'triangle', vol: 1, slideTo: 180 }),
  toggle: () => tone(520, 50, { type: 'square', vol: 0.4 }),
};

export function play(name) {
  const voice = VOICES[name];
  if (!voice) return;
  voice();
}
