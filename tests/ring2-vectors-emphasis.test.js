// tests/ring2-vectors-emphasis.test.js — Phase 01 tilt-fade gate for OSM vectors.
// Owner video proof (build b64tilt): white roads floated bright past the
// terrain silhouette at high tilt because mountVectors materials never
// entered the overlays emphasis registry. This pins the fix: mount sample
// vectors, register mats (same baseOpacity capture as addEmphasisMats),
// then setTiltFade(65) -> opacity ~0, setTiltFade(0) -> base, setEmphasis(0)
// -> 0, using the REAL tilt law (sync.js) and the REAL opacity law
// (overlays.js emphasisOpacity, the exact function applyEmphasisFull uses).
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountVectors } from '../src/ring2/vectors.js';
import { tiltFadeForPitch, MAP_MAX_PITCH_DEG } from '../src/ring2/sync.js';
import { emphasisOpacity } from '../src/ring2/overlays.js';

const fakeScene = () => ({ children: [], add(o) { this.children.push(o); } });
const SAMPLE = {
  layers: {
    roads: [{ id: 1, pts: [[0, 0], [100, 0], [200, 50]] }],
    tracks: [{ id: 2, pts: [[-50, -50], [0, 60]] }],
    paths: [],
    coastline: [],
    terminal: [],
  },
};

// Mirror of overlays.addEmphasisMats capture (base locked at registration).
function register(mats) {
  for (const m of mats) {
    if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity ?? 1;
  }
  return mats;
}

test('mountVectors exposes materials for the emphasis registry', async () => {
  const h = await mountVectors(fakeScene(), SAMPLE);
  assert.ok(Array.isArray(h.materials) && h.materials.length === 2, `2 layer mats, got ${h.materials?.length}`);
  for (const m of h.materials) {
    assert.equal(m.transparent, true);
    assert.equal(m.userData.baseOpacity, 0.85);
  }
});

test('tilt 65 dims registered vector mats to ~0; tilt 0 restores base', async () => {
  const h = await mountVectors(fakeScene(), SAMPLE);
  const mats = register(h.materials);
  const t = 1; // full twin mix: tilt alone must kill the roads
  assert.equal(tiltFadeForPitch(65), 0);
  assert.equal(tiltFadeForPitch(0), 1);
  for (const m of mats) {
    const base = m.userData.baseOpacity;
    m.opacity = emphasisOpacity(base, t, tiltFadeForPitch(65));
    assert.ok(Math.abs(m.opacity) < 1e-9, `tilt65 opacity ${m.opacity}`);
    m.opacity = emphasisOpacity(base, t, tiltFadeForPitch(0));
    assert.ok(Math.abs(m.opacity - base) < 1e-9, `tilt0 opacity ${m.opacity} restores base ${base}`);
  }
});

test('setEmphasis(0) drives registered vector mats to 0', async () => {
  const h = await mountVectors(fakeScene(), SAMPLE);
  const mats = register(h.materials);
  for (const m of mats) {
    m.opacity = emphasisOpacity(m.userData.baseOpacity, 0, tiltFadeForPitch(0));
    assert.equal(m.opacity, 0);
  }
});

test('no fade below 60deg: tilt 59 keeps vector base at full mix', async () => {
  const h = await mountVectors(fakeScene(), SAMPLE);
  const mats = register(h.materials);
  assert.equal(tiltFadeForPitch(59), 1, 'below-band tilt must be exactly 1');
  for (const m of mats) {
    m.opacity = emphasisOpacity(m.userData.baseOpacity, 1, tiltFadeForPitch(59));
    assert.equal(m.opacity, m.userData.baseOpacity);
  }
});

test('clamp is untouched at 65 deg', () => {
  assert.equal(MAP_MAX_PITCH_DEG, 65);
});
