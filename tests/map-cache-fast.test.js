// tests/map-cache-fast.test.js — CACHE-FAST lane: boot/prefetch speed in
// wall-clock terms. The shell boot dominates, then the first-frame tile
// stream, then arrival tiles mid-dive — so the shell boots on page idle,
// hotspot tiles warm one level below the mask arm, every patch orders
// center-first, and boot->grant wall-clock is instrumented on the probe.
// Own file — sibling lanes own lock/pan, iso-pose, and their own tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Z_CENTER,
  Z_FAR_INTENT,
  CACHE_FAST_IDLE_DELAY_MS,
  CACHE_FAST_IDLE_TTL_MS,
  CACHE_FAST_SLOW_FIRST_FRAME_MS,
  readyByArm,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

// Load->gate arm on a steady dive: the fingers travel home (z~6.4) to the
// handoff gate in about 5 s. The slow-network first-frame cost (shell doc +
// JS compile + first tile paint) runs ~2.5 s — longer than the mask-arm
// lead (~z7 to gate, <1 s), so intent-only boots always miss the arm.
const DIVE_LOAD_TO_ARM_MS = 5000;
const MASK_ARM_LEAD_MS = 700;

test('far-intent threshold sits one level below the mask arm', () => {
  assert.equal(Z_FAR_INTENT, Z_CENTER - 1);
  assert.equal(Z_FAR_INTENT, 6);
});

test('far-intent warms current-level hotspot tiles, never boots or flips state', () => {
  const main = srcOf('../src/map/main.js');
  const at = main.indexOf('// CACHE-FAST: far-intent tile warm');
  assert.ok(at !== -1, 'the far-intent block exists');
  const block = main.slice(at, main.indexOf('// INTENT-PRECACHE', at));
  assert.ok(block.includes('z >= Z_FAR_INTENT'), 'the far threshold is below the mask arm');
  assert.ok(block.includes('prefetchSatTiles(SITE_LNGLAT, fz)'), 'it warms the current-level site patch');
  const code = block.replace(/\/\/[^\n]*/g, ''); // comments may describe; code must not flip
  for (const flip of ['earlyBootTwin', 'flyToSectorThenTwin', 'prewarmThenReveal', 'openTwin(', 'twinOpen = true', 'setMaxZoom', 'pushState', 'pendingReveal = {']) {
    assert.ok(!code.includes(flip), `far-intent never ${flip} — tiles only`);
  }
});

test('page-idle shell preload is scheduled at init with a TTL release', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('requestIdleCallback'), 'idle callback preferred');
  assert.ok(main.includes('CACHE_FAST_IDLE_DELAY_MS'), 'the idle delay is the shared constant');
  const at = main.indexOf('function preloadTwinShellIdle()');
  assert.ok(at !== -1, 'the idle preload exists');
  const body = main.slice(at, main.indexOf('/** Handoff-4 Lane A seeded reveal', at));
  assert.ok(body.includes("setFrameUrl(ov.frame, twinUrl(h3, frame))"), 'idle boot navigates the shell once');
  assert.ok(body.includes('twinBootKey = h3'), 'the idle shell registers its key');
  assert.ok(body.includes('CACHE_FAST_IDLE_TTL_MS'), 'an unarmed idle shell is released by TTL');
  const code = body.replace(/\/\/[^\n]*/g, '');
  assert.ok(!code.includes('earlyTwinArmed = true'), 'the idle shell stays UNARMED — the abort lifecycle is untouched');
  assert.ok(!code.includes('twinOpen = true'), 'idle never opens');
});

test('intent and takeover adopt the idle shell — no second navigation', () => {
  const main = srcOf('../src/map/main.js');
  const at = main.indexOf('function earlyBootTwin()');
  const body = main.slice(at, main.indexOf('function abortEarlyBootTwin()', at));
  assert.ok(body.includes('twinBootKey === h3'), 'adoption keys on the live shell');
  assert.ok(body.includes('earlyTwinArmed = true'), 'adoption arms the shell for arrival reuse');
  assert.equal(body.match(/setFrameUrl\(/g)?.length ?? 0, 1, 'adoption navigates nothing — the one site still boots');
});

test('every tile patch orders hotspot-first with priority hints', () => {
  const main = srcOf('../src/map/main.js');
  const at = main.indexOf('function prefetchSatTiles(');
  const body = main.slice(at, main.indexOf('function trackAndPrecache', at));
  const orderAt = body.indexOf('[[0, 0]');
  assert.ok(orderAt !== -1, 'the patch order starts at the center tile');
  assert.ok(body.indexOf('[1, 1]') > orderAt, 'the ring follows the center');
  assert.ok(body.includes("opts.lowPriority ? 'low' : (hot ? 'high' : 'low')"), 'hotspot high, ring deprioritized (outbound all low)');
});

test('boot->grant wall-clock is instrumented on the probe', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('bootTiming: { idleArmed'), 'the probe carries bootTiming');
  for (const f of ['idleFiredMs', 'intentMs', 'bootMs', 'firstBootMs', 'armMs', 'readyMs', 'paintedMs', 'bootToReadyMs', 'bootToPaintedMs', 'readyByArm']) {
    assert.ok(main.includes(f), `bootTiming records ${f}`);
  }
  assert.ok(main.includes("stampGrant('ready')"), 'ready grants stamp');
  assert.ok(main.includes("stampGrant('painted')"), 'painted grants stamp');
  assert.ok(main.includes('stampArm()'), 'arrival arms stamp');
  assert.ok(main.includes('shellRetargetable(h3)'), 'reuse is gated on the retarget window');
  assert.ok(main.includes('resetGrantStampsForFreshShell()'), 'fresh shells reset the race');
});

test('retarget gate: hold pre-release reuses, everything else navigates fresh', () => {
  const main = srcOf('../src/map/main.js');
  const at = main.indexOf('function shellRetargetable(h3)');
  assert.ok(at !== -1, 'the retarget gate exists');
  const body = main.slice(at, main.indexOf('function reuseWarmTwin', at));
  assert.ok(body.includes("probe.handoffPhase() !== 'hold'"), 'only hold-phase shells retarget');
  // CONTENT-READY (2026-10-25, map-content-ready lane): a shell that matched
  // an earlier pin re-arms on retarget (twin-side resets the post + settle
  // count), so readiness no longer blocks reuse — a pre-arm ready post used
  // to seal the warmest shell and force a 7s fresh navigation at arrival.
  assert.ok(!body.includes('probe.ready()'), 'matched shells reuse too (re-armed twin-side), no fresh-nav seal');
  assert.ok(body.includes('__ring2'), 'the gate reads the live shell probe');
  const reuse = main.slice(main.indexOf('function reuseWarmTwin('), main.indexOf('function abortEarlyBootTwin'));
  assert.ok(reuse.includes('if (!shellRetargetable(h3)) return false'), 'reuse obeys the gate');
});

test('replacing a live unarmed idle shell arms the stale-echo guard on both arrival paths', () => {
  const main = srcOf('../src/map/main.js');
  const arrival = main.slice(main.indexOf('function prewarmThenReveal('), main.indexOf('/* Unstaged + staged fallback reveal'));
  assert.ok(arrival.includes('if (!warmReused && !earlyTwinArmed && twinBootKey)'), 'arrival guards the idle-shell replace');
  const open = main.slice(main.indexOf('function openTwin('), main.indexOf('function doCloseTwin'));
  assert.ok(open.includes('if (!warmReused && !earlyTwinArmed && twinBootKey)'), 'direct opens guard the idle-shell replace');
  assert.ok(arrival.includes('if (earlyTwinArmed && !warmReused)'), 'the armed-shell guard is untouched');
});

test('arrival replays a pre-arm first frame: paint-log poll + direct-open arm stamp', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('__ring2paintOut'), 'the arm stamp polls the shell paint log read-only');
  const at = main.indexOf('function openTwin(');
  assert.ok(at !== -1, 'direct opens exist');
  const body = main.slice(at, main.indexOf('function doCloseTwin', at));
  assert.ok(body.includes('stampArm()'), 'direct opens stamp the arm too');
});

test('vector + sat tile hosts preconnect in <head>', () => {
  const html = srcOf('../ops3d-map.html');
  assert.ok(html.includes('https://server.arcgisonline.com'), 'sat host preconnects');
  assert.ok(html.includes('https://basemaps.cartocdn.com'), 'vector host preconnects');
});

test('slow network: page-idle boot is ready by the arm', () => {
  assert.equal(
    readyByArm({
      bootAtMs: CACHE_FAST_IDLE_DELAY_MS,
      armAtMs: DIVE_LOAD_TO_ARM_MS,
      firstFrameCostMs: CACHE_FAST_SLOW_FIRST_FRAME_MS,
    }),
    true,
    `idle boot (${CACHE_FAST_IDLE_DELAY_MS}ms) + slow first frame (${CACHE_FAST_SLOW_FIRST_FRAME_MS}ms) lands before the ${DIVE_LOAD_TO_ARM_MS}ms arm`,
  );
});

test('slow network: intent-only boot misses the arm (the owner-reported wait)', () => {
  assert.equal(
    readyByArm({
      bootAtMs: DIVE_LOAD_TO_ARM_MS - MASK_ARM_LEAD_MS,
      armAtMs: DIVE_LOAD_TO_ARM_MS,
      firstFrameCostMs: CACHE_FAST_SLOW_FIRST_FRAME_MS,
    }),
    false,
    `mask-arm boot (lead ${MASK_ARM_LEAD_MS}ms) + slow first frame (${CACHE_FAST_SLOW_FIRST_FRAME_MS}ms) misses the arm — the idle preload is load-bearing`,
  );
  assert.equal(CACHE_FAST_IDLE_TTL_MS > DIVE_LOAD_TO_ARM_MS, true, 'the idle TTL outlives a normal dive');
});

test('readyByArm withholds on non-finite or negative input', () => {
  for (const bad of [
    { bootAtMs: NaN, armAtMs: 5000, firstFrameCostMs: 2500 },
    { bootAtMs: 1500, armAtMs: NaN, firstFrameCostMs: 2500 },
    { bootAtMs: 1500, armAtMs: 5000, firstFrameCostMs: NaN },
    { bootAtMs: -1, armAtMs: 5000, firstFrameCostMs: 2500 },
    { bootAtMs: 5000, armAtMs: 5000, firstFrameCostMs: 1 },
  ]) {
    assert.equal(readyByArm(bad), false, `withholds for ${JSON.stringify(bad)}`);
  }
  assert.equal(
    readyByArm({ bootAtMs: 2500, armAtMs: 5000, firstFrameCostMs: 2500 }),
    true,
    'exact-fit (boot + cost == arm) counts as ready',
  );
});
