// tests/map-center-settle.test.js — REF GATE 3 rev 2026-10-26 (owner: "make
// sure the hotspot becomes locked to the center by animating it to the center
// even sooner"). The mask/ring used to reach canvas centre only at z9.65 after
// arming at 7.04 (measured 154.5px off centre at the arm, still 16.4px at
// z8.84) — the owner saw the ring off-centre for most of the visible approach.
//
// Laws pinned here:
//   1. centerSettleForZoom — the settle is a span of ZOOM (frame-rate
//      independent, no per-tick factor, no timer), at rest at both ends (no
//      snap, no pop, no overshoot) and exactly 1 (dead centre) from arm+span
//      through the commit.
//   2. centerSettleOffsetPx — the site's screen offset the ring and the camera
//      both ride: arm offset -> 0 inside CENTER_SETTLE_SPAN_Z, ≤10px by 0.42
//      levels, monotone, direction-free (so zoom-out retraces it exactly).
//   3. centerForSiteOffset — the px->camera conversion agrees with
//      metersPerPixel on the same mercator grid (the round-trip is what makes
//      "off by N px" mean the same thing to the ring writer and the camera
//      writer), with the sign that puts the SITE off-centre, not the camera.
//   4. The writers: one arm capture on the mask edge, one law applied before
//      the enclosure write, and the flip anchored on the canvas centre while
//      armed (the law owns the pan).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CENTER_SETTLE_SPAN_Z,
  centerSettleForZoom,
  centerSettleOffsetPx,
  centerForSiteOffset,
  degreesPerPixel,
  metersPerPixel,
  TILE_SIZE_PX,
  EARTH_MPP,
  Z_CENTER,
  Z_HANDOFF,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const ARM_Z = 7.04; // measured mask-arm zoom on the gallery dive
const ARM_PX = 154.5; // measured site offset from canvas centre at the arm

test('centre settle: 0 at the arm, 1 at arm+span, at rest at both ends', () => {
  assert.equal(CENTER_SETTLE_SPAN_Z, 0.45, 'the settle spends under half a zoom level');
  assert.equal(centerSettleForZoom(ARM_Z, ARM_Z), 0, 'the arm frame is the law zero');
  assert.equal(centerSettleForZoom(ARM_Z - 1, ARM_Z), 0, 'below the arm stays parked (no negative pan)');
  assert.equal(centerSettleForZoom(ARM_Z + CENTER_SETTLE_SPAN_Z, ARM_Z), 1, 'dead centre exactly at arm+span');
  assert.equal(centerSettleForZoom(ARM_Z + 3, ARM_Z), 1, 'clamped past the span (through the commit)');
  // Monotone: the pan never reverses on the way in.
  let prev = -1;
  for (let z = ARM_Z - 0.5; z <= ARM_Z + 1.5; z += 0.01) {
    const v = centerSettleForZoom(z, ARM_Z);
    assert.ok(v >= prev - 1e-12, `z=${z.toFixed(2)} never steps back`);
    assert.ok(v >= 0 && v <= 1, `z=${z.toFixed(2)} stays in [0,1]`);
    prev = v;
  }
  // At rest at both ends: the smoothstep's zero end slopes are what make the
  // pan read as one motion instead of a snap at either boundary.
  const eps = 0.005;
  const startSlope = centerSettleForZoom(ARM_Z + eps, ARM_Z) - centerSettleForZoom(ARM_Z, ARM_Z);
  const endSlope = centerSettleForZoom(ARM_Z + CENTER_SETTLE_SPAN_Z, ARM_Z)
    - centerSettleForZoom(ARM_Z + CENTER_SETTLE_SPAN_Z - eps, ARM_Z);
  const midSlope = centerSettleForZoom(ARM_Z + 0.25 + eps, ARM_Z) - centerSettleForZoom(ARM_Z + 0.25, ARM_Z);
  assert.ok(startSlope < midSlope / 10, `eases in (start ${startSlope} vs mid ${midSlope})`);
  assert.ok(endSlope < midSlope / 10, `eases out (end ${endSlope} vs mid ${midSlope})`);
  // Never overshoots: a smoothstep cannot leave [0,1], so the camera can never
  // pass the hotspot and come back.
  for (let z = ARM_Z; z <= ARM_Z + 1; z += 0.02) {
    assert.ok(centerSettleForZoom(z, ARM_Z) <= 1, 'no overshoot');
  }
  // Non-finite / degenerate input parks at 0 rather than throwing.
  assert.equal(centerSettleForZoom(NaN, ARM_Z), 0);
  assert.equal(centerSettleForZoom(ARM_Z + 0.2, NaN), 0);
  assert.equal(centerSettleForZoom(ARM_Z + 0.2, ARM_Z, 0), 0, 'a zero span cannot divide by zero');
});

test('centre settle offset: ≤10px inside 0.42 levels, exactly 0 by 0.5 (was 2.6 levels)', () => {
  assert.equal(centerSettleOffsetPx(ARM_PX, ARM_Z, ARM_Z), ARM_PX, 'the arm frame keeps its offset');
  assert.ok(centerSettleOffsetPx(ARM_PX, ARM_Z + 0.42, ARM_Z) <= 10, 'within 10px of centre 0.42 levels in');
  assert.equal(centerSettleOffsetPx(ARM_PX, ARM_Z + 0.5, ARM_Z), 0, 'exactly centred at arm+span');
  assert.equal(centerSettleOffsetPx(ARM_PX, Z_HANDOFF, ARM_Z), 0, 'still dead centre at the commit');
  assert.equal(centerSettleOffsetPx(ARM_PX, Z_CENTER + 0.02, ARM_Z), ARM_PX,
    'below the arm the law parks on the arm offset — the camera IS the arm frame when the mask disarms');
  // Monotone non-increasing: the ring only ever approaches the centre.
  let prev = Infinity;
  for (let z = ARM_Z; z <= Z_HANDOFF; z += 0.02) {
    const v = centerSettleOffsetPx(ARM_PX, z, ARM_Z);
    assert.ok(v <= prev + 1e-9, `z=${z.toFixed(2)} offset ${v} must not grow`);
    prev = v;
  }
  // The owner's measured samples: off-centre for 2.6 levels before, dead
  // centre from 0.5 levels after the arm now.
  const at = (z) => +centerSettleOffsetPx(ARM_PX, z, ARM_Z).toFixed(1);
  assert.ok(at(7.64) <= 10, `z7.64 reads ${at(7.64)}px (was 103.3)`);
  assert.equal(at(8.5), 0, `z8.5 reads ${at(8.5)}px (was ~40)`);
  assert.equal(at(9.65), 0, `z9.65 reads ${at(9.65)}px (was 0 — but 2.6 levels late)`);
  // Direction-free: the same z always gives the same offset, so the way out
  // retraces the pan and lands back on the exact arm frame.
  for (const z of [7.1, 7.2, 7.35, 7.49]) {
    assert.equal(centerSettleOffsetPx(ARM_PX, z, ARM_Z), centerSettleOffsetPx(ARM_PX, z, ARM_Z), 'retrace symmetric');
  }
  // A zero/NaN arm offset is a no-op (an already-centred arm never pans).
  assert.equal(centerSettleOffsetPx(0, ARM_Z + 0.1, ARM_Z), 0);
  assert.equal(centerSettleOffsetPx(NaN, ARM_Z + 0.1, ARM_Z), 0);
});

test('centre px->camera conversion agrees with the map projector (and its sign)', () => {
  assert.equal(TILE_SIZE_PX, 512, 'MapLibre tile grid the projector rides');
  // degreesPerPixel is the same grid metersPerPixel projects on.
  for (const z of [3, 6.4, 7.04, 9, 11.5, 14]) {
    const k = degreesPerPixel(z);
    const mpp = metersPerPixel(z, 40.201262);
    const lat = 40.201262;
    const mPerDegLng = (EARTH_MPP * TILE_SIZE_PX) / 360; // metres per degree of longitude on the equator
    const fromDeg = k * mPerDegLng * Math.cos((lat * Math.PI) / 180);
    assert.ok(Math.abs(fromDeg - mpp) < mpp * 1e-9, `z=${z}: ${fromDeg} vs ${mpp} m/px`);
  }
  // Round-trip: a centre computed for `offPx` puts the SITE `offPx` from the
  // canvas centre (screen space), for every direction.
  const siteLng = 49.48127;
  const siteLat = 40.201262;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.28, -0.96]];
  for (const z of [7.04, 8.5, 11.5]) {
    for (const offPx of [10, 154.5]) {
      for (const [ux, uy] of dirs) {
        const c = centerForSiteOffset({ siteLng, siteLat, ux, uy, offPx, zoom: z });
        assert.ok(Array.isArray(c), 'centre resolves');
        const k = degreesPerPixel(z);
        const dLng = c[0] - siteLng;
        const dLat = c[1] - siteLat;
        // Back to px: the site sits at -(centre - site) in screen space.
        const pxX = -dLng / k;
        const pxY = dLat / (k * Math.cos((siteLat * Math.PI) / 180));
        assert.ok(Math.abs(pxX - ux * offPx) < 0.05, `z=${z} off=${offPx} ux=${ux}: ${pxX}`);
        assert.ok(Math.abs(pxY - uy * offPx) < 0.05, `z=${z} off=${offPx} uy=${uy}: ${pxY}`);
      }
    }
  }
  // Sign sanity: a site RIGHT of centre (ux>0) means the camera sits WEST of
  // the site — the bug that made the first measurement diverge.
  const right = centerForSiteOffset({ siteLng, siteLat, ux: 1, uy: 0, offPx: 100, zoom: 8 });
  assert.ok(right[0] < siteLng, 'camera centre is west of a site that reads right of centre');
  const below = centerForSiteOffset({ siteLng, siteLat, ux: 0, uy: 1, offPx: 100, zoom: 8 });
  assert.ok(below[1] > siteLat, 'camera centre is north of a site that reads below centre');
  // Degenerate input parks instead of throwing.
  assert.equal(centerForSiteOffset(), null);
  assert.equal(centerForSiteOffset({ siteLng, siteLat, ux: NaN, uy: 0, offPx: 10, zoom: 8 }), null);
  assert.equal(centerForSiteOffset({ siteLng, siteLat, ux: 1, uy: 0, offPx: 10, zoom: NaN }), null);
});

test('the map writers ride the one law: arm on the mask edge, apply before the ring write', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('let centerArm = null;'), 'the arm frame is state, captured once per mask');
  assert.ok(main.includes('function noteCenterArm('), 'arm capture exists');
  assert.ok(main.includes('function centerSettleTargetFor('), 'the camera law exists');
  assert.ok(main.includes('function applyCenterSettle('), 'the camera writer exists');
  assert.ok(main.includes('centerSettleOffsetPx(centerArm.offPx, zz, centerArm.z, CENTER_SETTLE_SPAN_Z)'),
    'the writer evaluates the pure settle law (no local easing)');
  assert.ok(main.includes('clearCenterArm(\'mask-down\')'), 'the arm releases when the mask goes down');
  assert.ok(main.includes('clearCenterArm(\'twin\')'), 'the arm dies with the frame when the twin opens');
  // Ordering: the camera moves BEFORE the enclosure reads it, or the ring is
  // one frame behind the frame it is drawn on.
  const dStart = main.indexOf('function onNativeZoomStep(');
  const driver = main.slice(dStart, main.indexOf('\nfunction ', dStart + 10));
  const settleAt = driver.indexOf('if (blend > 0 && applyCenterSettle(z)) {');
  const ringAt = driver.indexOf('if (!writeEnclosureEllipse(proxUse, z)) parkEnclosureEllipse();');
  assert.ok(settleAt > 0 && ringAt > 0, 'both writers live in the driver pass');
  assert.ok(settleAt < ringAt, 'the centre settles before the enclosure writes');
  assert.ok(driver.includes('frameProxCache = null; // the pass memo predates the camera jump'),
    'the pass re-reads proximity after the jump (no stale ring centre)');
  // The takeover carries the same law synchronously on its tick — and it
  // arms on the FIRST site-in-view tick, not on the mask band: every scroll
  // aims, with one arm snapshot and the zoom-keyed settle.
  assert.ok(main.includes('const t = centerSettleTargetFor(target);'), 'the band takeover carries the law');
  assert.ok(main.includes('if (prox && prox.armed) {'), 'the takeover aims whenever the site is armed');
  assert.ok(main.includes('if (prox.armed) {\n          noteCenterArm(prox, z);'), 'the driver arms on view, not on blend');
  assert.ok(main.includes('armed: cursorNear || centerNear || inView'), 'one armed gate feeds every predicate');
  // Flights keep the camera: the law must never steer a programmatic flight.
  const apply = main.slice(main.indexOf('function applyCenterSettle('), main.indexOf('function updateRingClip('));
  assert.ok(apply.includes('transitId'), 'flights are exempt from the settle');
  assert.ok(apply.includes('stagedActive'), 'the staged hold keeps its own SITE pin');
  // The flip anchors the native zoom on the canvas centre while armed — the
  // law owns the pan, so a beyond-spot phantom would fight it tick by tick.
  // It must measure the MAP container: the canvas container collapses to h=0
  // in this layout, which put the anchor 50px above the true centre and
  // drifted the site 41px over the last level.
  const flip = main.slice(main.indexOf('function installWheelFlip('), main.indexOf('function installAnchorGuard('));
  assert.ok(flip.includes('lockAroundPoint(+H.x, +H.y, r.width / 2, r.height / 2, false)'),
    'the flip asks for the true canvas-centre anchor in both directions');
  assert.ok(flip.includes('ctx.map.getContainer && ctx.map.getContainer()'),
    'the centre comes from the map container, not the collapsed canvas container');
  assert.ok(!flip.includes('(r.height || 600) / 2'), 'no 600px fallback centre');
  assert.ok(!flip.includes('lockAroundPoint(+H.x, +H.y, r.width / 2, r.height / 2, dy > 0)'),
    'no beyond-spot phantom for zoom-in (it moved the spot the law had just placed)');
});
