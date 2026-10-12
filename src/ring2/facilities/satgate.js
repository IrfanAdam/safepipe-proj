// src/ring2/facilities/satgate.js — pure-satellite endpoint gate (mix 0).
//
// Facility/backdrop meshes bypass the twin emphasis registry (their mats are
// never passed to twin.addEmphasisMats, so setEmphasis can't dim them — the
// ~33% twin-pixel leak at mix 0). Until a registry wiring lands, each
// facility root built in index.js carries a visibility gate instead: exactly
// at the pure-satellite endpoint the group hides; at mix 1..100 the group is
// untouched. Endpoint-only behavior change — no material, color, export,
// dimension, or tier-stamp changes here.
//
// Driver is the live mix control (window.__ring2.mix.getSatOnly, true exactly
// at effective mix 0 with the map up). Fallback mirrors mix.js effMixNow from
// the stored slider + map presence so pre-mount semantics match (stored 0
// with no map reads visible, the dead-end floor). Updates arrive via the
// mix onMix subscription (immediate) plus a 250 ms backstop tick (the map
// landing flips effective mix silently, with no mix emit). Never throws,
// never breaks boot, node-safe (no window => visible unless overridden).

const MIX_STORE_KEY = 'ring2.mix';
const TICK_MS = 250;

function clampMix(v, fallback = 50) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Stored slider value (mix.js saveMix/loadMix contract). */
export function readStoredMix(fallback = 50) {
  try {
    if (typeof localStorage === 'undefined') return clampMix(fallback);
    const raw = localStorage.getItem(MIX_STORE_KEY);
    if (raw === null) return clampMix(fallback);
    return clampMix(raw);
  } catch {
    return clampMix(fallback);
  }
}

/**
 * True exactly at the pure-satellite endpoint. Explicit boolean override
 * wins (node tests / probes); otherwise the live mix control; otherwise the
 * stored-slider + map-presence mirror of effMixNow.
 */
export function resolveSatOnly(over) {
  if (typeof over === 'boolean') return over;
  try {
    if (typeof window !== 'undefined') {
      const mix = window.__ring2?.mix;
      if (mix && typeof mix.getSatOnly === 'function') return !!mix.getSatOnly();
      const stored = readStoredMix(50);
      const mapUp = !!window.__ring2?.map;
      return (mapUp ? stored : Math.max(stored, 50)) <= 0;
    }
  } catch { /* fall through to visible */ }
  return false;
}

const gated = new Set();
let timer = null;
let subscribed = false;
let suspended = false;

function applyOne(g, satOnly) {
  try {
    g.visible = !satOnly;
  } catch { /* a frozen group never breaks the tick */ }
}

/** Apply one endpoint state to every gated root. Exported for tests/probes. */
export function applySatGate(satOnly) {
  const hide = !!satOnly;
  for (const g of gated) applyOne(g, hide);
  return hide;
}

function trySubscribe() {
  if (subscribed) return;
  try {
    const mix = typeof window !== 'undefined' ? window.__ring2?.mix : null;
    if (mix && typeof mix.onMix === 'function') {
      subscribed = true;
      mix.onMix(() => {
        if (!suspended) applySatGate(resolveSatOnly());
      });
    }
  } catch { /* subscription is best-effort; the tick covers it */ }
}

function tick() {
  trySubscribe();
  if (!suspended) {
    try {
      applySatGate(resolveSatOnly());
    } catch { /* backstop never breaks the frame */ }
  }
}

function ensureTick() {
  if (timer || typeof window === 'undefined') return;
  try {
    timer = setInterval(tick, TICK_MS);
    // Node-lifetime hygiene: a fake-window harness that builds groups must
    // still exit. Browsers return a number (no unref) — guarded.
    if (timer && typeof timer.unref === 'function') timer.unref();
  } catch { /* no timer: onMix + initial state still hold */ }
}

/**
 * Gate a facility root on the pure-satellite endpoint. Marks
 * userData.satGated, snapshots the unique materials into
 * userData.emphasisMats (metadata only — unblocks a future
 * twin.addEmphasisMats wiring with zero behavior change), applies the
 * current endpoint state, and registers the root for mix updates.
 */
export function gateSatOnly(group, opts = {}) {
  if (!group) return group;
  try {
    group.userData.satGated = true;
    const seen = new Set();
    const mats = [];
    try {
      group.traverse?.((o) => {
        const m = o?.material;
        const list = Array.isArray(m) ? m : m ? [m] : null;
        if (!list) return;
        for (const mm of list) {
          if (mm && !seen.has(mm)) {
            seen.add(mm);
            mats.push(mm);
          }
        }
      });
    } catch { /* census is best-effort */ }
    group.userData.emphasisMats = mats;
  } catch { /* marking never breaks the build */ }
  if (!gated.has(group)) gated.add(group);
  applyOne(group, resolveSatOnly(opts?.satOnly));
  ensureTick();
  return group;
}

/** Remove a root from the gate (tests/probes). Restores visibility. */
export function ungateSatOnly(group) {
  if (!group) return group;
  gated.delete(group);
  try {
    group.visible = true;
    delete group.userData.satGated;
  } catch { /* restore is best-effort */ }
  return group;
}

/**
 * Probe hatch: freeze the gate (no mix/tick updates) so a before-state
 * capture can force groups visible without the backstop re-hiding them.
 * Honor-system — production never calls this.
 */
export function suspendSatGate(v = true) {
  suspended = !!v;
  return suspended;
}

export function satGateCount() {
  return gated.size;
}
