// tests/ring2-twin-start-scale.test.js — owner verdict 2026-10-29 (intent-gated
// handoff UX, acceptance 4): "the twin's opening scale must meet the larger map
// — no too-small start, no double terrain->twin transition".
//
// Three laws pinned here, measured rather than restated:
//   1. RANGE EQUALITY — hold / release start / ring-iso mid / push terminal all
//      ride ONE range derived from the handed gate frame at the live viewport
//      (sector.js handoffRangeForFrame). The retired 18 km constant-metre
//      terminal was a second law: it moved the ground scale at the commit.
//   2. OPENING REGISTRATION — the twin's 10 km ring, projected through its own
//      camera at the hold pose, lands on the map mask's projected ring
//      (scrolltrigger.js projectedRingEllipse) inside 1 px, at every viewport
//      and handed zoom. The old top-down reading (484.5 px at 1122x700) was
//      5.5% inside the 512.5 px mask.
//   3. FIRST-FRAME BASE ZOOM — the twin's satellite base is born on the handed
//      frame and must have APPLIED it before the first visible frame (the
//      reveal/first-paint gates read baseFrameApplied; the wall cap keeps it
//      bounded).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-03]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handoffRangeForFrame,
  terminalPoseForAnchor,
  poseAtAnchor,
  stagedReleaseAnchors,
  buildForwardLegs,
  poseForScrubProgress,
  holdPolarForFrame,
  firstPaintDue,
  frameRange,
  clampHandoffRange,
  TWIN_PAINT_MAX_MS,
  HANDOFF_ISO_POLAR_DEG,
  HANDOFF_END_MIX,
} from '../src/ring2/sector.js';
import { projectedRingEllipse, Z_HANDOFF, ISO_PITCH_DEG } from '../src/map/scrolltrigger.js';
import { RING_RADIUS_M, SANGACHAL } from '../src/ring2/site.js';
import { MAP_TRUE_FOV_DEG } from '../src/ring2/sync.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
const MAIN = srcOf('../src/ring2/main.js');
const SECTOR = srcOf('../src/ring2/sector.js');

const DEG = Math.PI / 180;
const dist = (p) => Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z);
const polarOf = (p) =>
  (Math.atan2(Math.hypot(p.eye.x - p.target.x, p.eye.z - p.target.z), p.eye.y - p.target.y) * 180) / Math.PI;

/* The twin's OWN projection of the ground ring: a pinhole camera at the pose
 * (focal px = 0.5h/tan(fov/2), the map's true fov), 3600 samples around the
 * 10 km circle, widest half-width in screen px. This is what the twin's hard
 * clip draws — measured, not re-derived from the mask law. */
function twinRingHalfWidthPx({ eye, target, heightPx, ringM = RING_RADIUS_M, fovDeg = MAP_TRUE_FOV_DEG }) {
  const f = (0.5 * heightPx) / Math.tan((fovDeg * DEG) / 2);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
  const up = cross(right, fwd);
  let halfW = 0;
  const N = 3600;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const p = { x: target.x + Math.cos(a) * ringM, y: target.y, z: target.z + Math.sin(a) * ringM };
    const v = sub(p, eye);
    const zc = dot(v, fwd);
    if (!(zc > 0)) continue; // behind the camera: not on screen
    const sx = (f * dot(v, right)) / zc;
    if (Math.abs(sx) > halfW) halfW = Math.abs(sx);
  }
  return halfW;
}

/* The map mask at the same pose — the parent's own pure projection law. */
const maskEllipse = (z, heightPx, pitchDeg = ISO_PITCH_DEG, latDeg = SANGACHAL.lat) =>
  projectedRingEllipse({ zoom: z, pitchDeg, heightPx, latDeg, ringM: RING_RADIUS_M });

const gateFrame = (z, extra = {}) => ({
  cx: SANGACHAL.lon,
  cy: SANGACHAL.lat,
  z,
  bearing: 0,
  pitch: ISO_PITCH_DEG,
  ...extra,
});

test('the handoff range is the handed gate frame projected at the live viewport', () => {
  for (const vp of [500, 700, 1025]) {
    for (const z of [Z_HANDOFF, Z_HANDOFF + 0.08, Z_HANDOFF + 0.5]) {
      const f = gateFrame(z);
      const r = handoffRangeForFrame(f, { viewportPx: vp });
      const want = clampHandoffRange(frameRange(z, { viewportPx: vp, lat: f.cy }));
      assert.ok(Number.isFinite(r) && r > 0, `z${z} vp${vp}: finite range`);
      assert.ok(Math.abs(r - want) < 1e-9, `z${z} vp${vp}: range ${r} === frameRange ${want}`);
      // A parent that hands a deeper zoom owns it — never a restated constant.
      const shallower = handoffRangeForFrame(gateFrame(Z_HANDOFF), { viewportPx: vp });
      if (z > Z_HANDOFF) assert.ok(r < shallower, `z${z} vp${vp}: deeper hand-off is a shorter range`);
    }
  }
  // Withhold on garbage, never guess.
  assert.equal(handoffRangeForFrame(null, { viewportPx: 700 }), null);
  assert.equal(handoffRangeForFrame({ z: NaN }, { viewportPx: 700 }), null);
});

test('ONE range: hold, start, mid and terminal — zero scale travel to the commit', () => {
  const vp = 700;
  const f = gateFrame(Z_HANDOFF);
  const r = handoffRangeForFrame(f, { viewportPx: vp });
  const anchor = { x: 120, z: -80 };
  const azim = -0.37;

  // Hold/release start and ring-iso mid at the gate range + iso pole.
  const start = poseAtAnchor(anchor.x, 0, anchor.z, r, HANDOFF_ISO_POLAR_DEG, azim);
  const mid = poseAtAnchor(anchor.x, 0, anchor.z, r, HANDOFF_ISO_POLAR_DEG, azim);
  // Terminal: the SAME derivation the boot/refit path builds (sector.js).
  const to = terminalPoseForAnchor(anchor.x, 0, anchor.z, azim, r);
  assert.ok(start && mid && to, 'every anchor builds');
  assert.equal(to.mix, HANDOFF_END_MIX);

  const locked = stagedReleaseAnchors({ startPose: start, mid, to, range: r });
  assert.ok(locked, 'staged release derives');
  assert.equal(locked.range, r);
  for (const k of ['start', 'mid', 'to']) {
    assert.ok(Math.abs(dist(locked[k]) - r) < 1e-6, `${k} sits on the gate range (${dist(locked[k])})`);
  }

  // The whole forward scrub (swoop + push) carries no ground-scale travel.
  const legs = buildForwardLegs({ startPose: locked.start, mid: locked.mid, to: locked.to });
  assert.ok(legs && legs.length, 'legs build');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const s = poseForScrubProgress(legs, i / 40);
    assert.ok(s, `pose at ${i / 40}`);
    const d = dist(s);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  assert.ok(hi - lo < 1e-6, `scale travel ${hi - lo} m across the reveal`);
  // ... and the commit lands on that same range, so no post-commit push.
  const commit = poseForScrubProgress(legs, 1);
  assert.ok(Math.abs(dist(commit) - r) < 1e-6, `commit range ${dist(commit)} === ${r}`);
  // The hold polar is the handed iso pole: the opening is the projected ring,
  // not a top-down porthole.
  assert.ok(Math.abs(polarOf(commit) - HANDOFF_ISO_POLAR_DEG) < 1e-6, 'commit sits on the iso pole');
  assert.equal(holdPolarForFrame(f), ISO_PITCH_DEG);
});

test('the opening 10 km ring registers to the map mask within 1 px', () => {
  const worst = { px: 0, at: '' };
  for (const vp of [500, 700, 1025]) {
    for (const z of [Z_HANDOFF, Z_HANDOFF + 0.08, Z_HANDOFF + 0.5]) {
      const f = gateFrame(z);
      const r = handoffRangeForFrame(f, { viewportPx: vp });
      const pose = poseAtAnchor(0, 0, 0, r, HANDOFF_ISO_POLAR_DEG, 0);
      const twinPx = twinRingHalfWidthPx({ eye: pose.eye, target: pose.target, heightPx: vp });
      const mask = maskEllipse(z, vp);
      assert.ok(mask && mask.rx > 0, `z${z} vp${vp}: mask exists`);
      const dPx = Math.abs(twinPx - mask.rx);
      if (dPx > worst.px) {
        worst.px = dPx;
        worst.at = `z${z} vp${vp}`;
      }
      assert.ok(dPx <= 1, `z${z} vp${vp}: twin ring ${twinPx.toFixed(2)}px vs mask ${mask.rx.toFixed(2)}px (${dPx.toFixed(2)}px)`);
    }
  }
  assert.ok(worst.px <= 1, `worst registration error ${worst.px.toFixed(3)}px at ${worst.at}`);

  // 1122x700, the audited viewport: the twin's opening is the mask, and the
  // two failure modes this law replaced are measurably gone.
  const vp = 700;
  const r = handoffRangeForFrame(gateFrame(Z_HANDOFF), { viewportPx: vp });
  const pose = poseAtAnchor(0, 0, 0, r, HANDOFF_ISO_POLAR_DEG, 0);
  const twinPx = twinRingHalfWidthPx({ eye: pose.eye, target: pose.target, heightPx: vp });
  const mask = maskEllipse(Z_HANDOFF, vp);
  assert.ok(Math.abs(twinPx - mask.rx) <= 1, `audited pose: ${twinPx.toFixed(1)} vs ${mask.rx.toFixed(1)}`);

  // (a) a TOP-DOWN hold at the same range reads 5.5% small (the old opening).
  const topDown = twinRingHalfWidthPx({
    eye: { x: 0, y: r, z: 0.01 }, target: { x: 0, y: 0, z: 0 }, heightPx: vp,
  });
  assert.ok(mask.rx - topDown > 20, `top-down opening ${topDown.toFixed(1)}px sits ~${(mask.rx - topDown).toFixed(1)}px inside the mask`);
  // (b) the retired 18 km constant-metre terminal would OVERSHOOT the mask by
  //     ~70px and then move the scale 1.14x at the commit — refused outright.
  const stale = twinRingHalfWidthPx({
    eye: poseAtAnchor(0, 0, 0, 18000, HANDOFF_ISO_POLAR_DEG, 0).eye,
    target: { x: 0, y: 0, z: 0 },
    heightPx: vp,
  });
  assert.ok(stale - mask.rx > 40, `an 18 km terminal reads ${stale.toFixed(1)}px vs mask ${mask.rx.toFixed(1)}px`);
});

test('the satellite base is born on, and applies, the handed frame before the first visible frame', () => {
  // Seed parity: the mount call is born on the handed frame's center/zoom.
  assert.match(MAIN, /zoom: \+f\.z/, 'base mount seeds the HANDED zoom, not a literal');
  assert.match(MAIN, /center: \[\+f\.cx, \+f\.cy\]/, 'base mount seeds the handed center');
  // Apply parity: one law decides "applied" and both reveal paths read it.
  assert.match(MAIN, /function baseFrameApplied\(frame = null\)/);
  assert.match(MAIN, /if \(!baseFrameApplied\(handoff\.frame\)\) return false;/, 'ready gate reads the base');
  assert.match(MAIN, /firstPaintDue\(\{ frames: twinFrames, mapIdle, sceneLive, baseApplied, elapsedMs: elapsed \}\)/);
  assert.match(MAIN, /function seedBaseToHandedFrame\(\)/);
  assert.match(MAIN, /seedBaseToHandedFrame\(\);\n    \} catch \{ \/\* adopt seed is best-effort \*\/ \}/, 'adopt re-seeds the base');
  // The loading hold is BOUNDED: a base that never applies still reveals.
  assert.equal(firstPaintDue({ frames: 4, mapIdle: true, sceneLive: true, baseApplied: false }), false, 'withholds on an unapplied base');
  assert.equal(firstPaintDue({ frames: 4, mapIdle: true, sceneLive: true, baseApplied: true }), true, 'reveals on an applied base');
  assert.equal(firstPaintDue({ frames: 4, mapIdle: true, sceneLive: true, baseApplied: null }), true, 'no handed frame = not asserted');
  assert.equal(
    firstPaintDue({ frames: 4, mapIdle: true, sceneLive: true, baseApplied: false, elapsedMs: TWIN_PAINT_MAX_MS }),
    true,
    'wall cap keeps the hold bounded',
  );
});

test('no constant-metre terminal survives in the twin', () => {
  assert.doesNotMatch(SECTOR, /HANDOFF_ISO_RANGE_M\s*=/, 'the 18 km constant is gone');
  assert.doesNotMatch(MAIN, /HANDOFF_ISO_RANGE_M/, 'no caller imports it');
  assert.doesNotMatch(MAIN, /frameRange\(Z_HANDOFF,\s*\{ viewportPx: viewportPxNow\(\), lat: latDeg \}\)/, 'the staged lock is frame-derived');
  assert.match(SECTOR, /export function handoffRangeForFrame\(/);
  assert.match(MAIN, /handoffRangeForFrame\(sectorQ\.frame, \{ viewportPx: vp \}\)/);
  assert.match(MAIN, /handoffRangeForFrame\(\{ z, cy: lat \}, \{ viewportPx: viewportPxNow\(\) \}\)/);
});

test('embed mode demotes the iframe fullscreen button (parent bar owns it)', () => {
  assert.match(MAIN, /function demoteEmbeddedFsButton\(btn\)/);
  assert.match(MAIN, /if \(!embedded\) return false; \/\/ standalone: native self-fullscreen stands\n    \/\/ Demote, never remove/);
  assert.match(MAIN, /demoteEmbeddedFsButton\(btn\);/);
  assert.match(MAIN, /btn\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(MAIN, /btn\.setAttribute\('tabindex', '-1'\)/);
  // The delegated message path stays wired (a parent may still echo state).
  assert.match(MAIN, /buildTwinFullscreenMessage\(next\)/);
});
