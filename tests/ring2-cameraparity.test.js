// tests/ring2-cameraparity.test.js — Phase 00 camera-parity guard.
//
// OWNER REPORT: top-down twin coincides with Esri satellite, but any
// rotate/tilt breaks alignment; the mix fade must read real->twin at EVERY
// angle. PRIME SUSPECT (verified): twin PerspectiveCamera FOV 60 vs the
// MapLibre camera's true vertical fov (~36.87deg). Same
// center+zoom+bearing+pitch under different fovs can only agree at nadir.
// FIX DIRECTION: the Map class exposes getVerticalFieldOfView() with NO
// public setter, so the TWIN adopts the map's fov (never private
// _transform hacks), live viewportPx is wired, and twin tilt clamps to the
// map maxPitch via one shared constant.
// [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-00]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mapPoseForTwin,
  groundResForZoom,
  zoomForRange,
  rangeForZoom,
  aspectMismatch,
  assertAspectParity,
  MAP_FOV_RAD,
  MAP_TRUE_FOV_DEG,
  MAP_MAX_PITCH_DEG,
} from '../src/ring2/sync.js';
import { SANGACHAL } from '../src/ring2/site.js';

const srcOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const rad = (d) => (d * Math.PI) / 180;

/* ---- local pinhole re-implementation, pinned to installed-version constants.
 * MapLibre camera model (transform_helper.ts _calcMatrices): camera distance
 * = 0.5 * heightPx / tan(fov/2); the twin three.js PerspectiveCamera is the
 * same pinhole given the same eye/target/fov/aspect. Both sides reduce to
 * this NDC projection, so parity == same NDC for the same ground point. */
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
function ndcFor(eye, target, ground, fovDeg, aspect) {
  const f = norm(sub(target, eye));
  let up = { x: 0, y: 1, z: 0 };
  if (Math.abs(dot(f, up)) > 0.999) up = { x: 0, y: 0, z: -1 }; // exact nadir
  const s = norm(cross(f, up));
  const u = cross(s, f);
  const d = sub(ground, eye);
  const zc = dot(d, f);
  if (!(zc > 0)) return null; // behind the camera
  const t = Math.tan(rad(fovDeg) / 2);
  return [dot(d, s) / (zc * t * aspect), dot(d, u) / (zc * t)];
}
/* MapLibre eye reconstruction: jumpTo(center, zoom, pitch, bearing) parks
 * the camera at cameraToCenterDistance px along the view ray; px -> m via
 * the zoom's ground resolution. Bearing 0 here (eye due south, +z). */
function mapEyeFor(mp, heightPx) {
  const distPx = (0.5 * heightPx) / Math.tan(rad(MAP_TRUE_FOV_DEG) / 2);
  const distM = distPx * groundResForZoom(mp.zoom, SANGACHAL.lat);
  return {
    eye: {
      x: 0,
      y: distM * Math.cos(rad(mp.pitch)),
      z: distM * Math.sin(rad(mp.pitch)),
    },
    distM,
  };
}
const twinEyeAt = (rangeM, pitchDeg) => ({
  x: 0,
  y: rangeM * Math.cos(rad(pitchDeg)),
  z: rangeM * Math.sin(rad(pitchDeg)),
});
function ringPoints() {
  const pts = [];
  for (const gx of [-8000, -4000, 0, 4000, 8000]) {
    for (const gz of [-8000, -4000, 0, 4000, 8000]) {
      pts.push({ x: gx, y: 0, z: gz }); // full 10 km ring ground disc
      pts.push({ x: gx, y: 300, z: gz }); // + relief (exaggerated DEM/structure)
    }
  }
  return pts;
}

test('MAP_TRUE_FOV_DEG is the installed maplibre true fov (not lore)', () => {
  const helper = srcOf('../node_modules/maplibre-gl/src/geo/transform_helper.ts');
  const m = helper.match(/_fovInRadians\s*=\s*([\d.]+)/);
  assert.ok(m, 'installed transform_helper.ts must declare _fovInRadians');
  assert.equal(Number(m[1]), MAP_FOV_RAD, 'sync MAP_FOV_RAD must equal the installed constant');
  assert.ok(
    Math.abs(MAP_TRUE_FOV_DEG - 36.86989764584402) < 1e-9,
    `twin fov must be ~36.8699deg (got ${MAP_TRUE_FOV_DEG})`,
  );
});

test('fix direction is twin-adopts-map: Map has no public fov setter', () => {
  const mapSrc = srcOf('../node_modules/maplibre-gl/src/ui/map.ts');
  assert.ok(!/setFov\s*\(/.test(mapSrc), 'Map must expose no setFov (else revisit fix direction)');
});

test('unified fov: same ground point -> same NDC at pitch 0/30/60', () => {
  const H = 800; // live viewport height (any H works; the call site wires it live)
  const ASP = 16 / 9;
  const R = 12000;
  for (const pitch of [0, 30, 60]) {
    const eye = twinEyeAt(R, pitch);
    const target = { x: 0, y: 0, z: 0 };
    const mp = mapPoseForTwin({ eye, target }, { viewportPx: H, fovDeg: MAP_TRUE_FOV_DEG });
    const { eye: mapEye, distM } = mapEyeFor(mp, H);
    assert.ok(
      Math.abs(distM - R) / R < 1e-9,
      `pitch ${pitch}: map eye distance must reconstruct the twin range (got ${distM} vs ${R})`,
    );
    let worst = 0;
    for (const g of ringPoints()) {
      const a = ndcFor(eye, target, g, MAP_TRUE_FOV_DEG, ASP);
      const b = ndcFor(mapEye, target, g, MAP_TRUE_FOV_DEG, ASP);
      if (!a || !b) continue;
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    assert.ok(worst < 1e-9, `pitch ${pitch}: residual NDC must be ~0 (got ${worst})`);
  }
});

test('bug quantified: old FOV-60 pipeline shears oblique (nadir agrees)', () => {
  const H = 800;
  const ASP = 16 / 9;
  const PX = H / 2; // NDC 2.0 == full viewport height
  const R = 12000;
  const worstPxAt = (pitch) => {
    const eye = twinEyeAt(R, pitch);
    const target = { x: 0, y: 0, z: 0 };
    // Old code: twin fov 60, zoom derived assuming 60, map rendering 36.87.
    const mp60 = mapPoseForTwin({ eye, target }, { viewportPx: H, fovDeg: 60 });
    const distPx = (0.5 * H) / Math.tan(rad(MAP_TRUE_FOV_DEG) / 2);
    const distM = distPx * groundResForZoom(mp60.zoom, SANGACHAL.lat);
    const mapEye = {
      x: 0,
      y: distM * Math.cos(rad(mp60.pitch)),
      z: distM * Math.sin(rad(mp60.pitch)),
    };
    let worst = 0;
    for (const g of ringPoints()) {
      const c = ndcFor(eye, target, g, 60, ASP);
      const d = ndcFor(mapEye, target, g, MAP_TRUE_FOV_DEG, ASP);
      if (!c || !d) continue;
      if (Math.abs(c[0]) > 1.5 || Math.abs(c[1]) > 1.5) continue; // in-frame only
      worst = Math.max(worst, Math.hypot(c[0] - d[0], c[1] - d[1]) * PX);
    }
    return worst;
  };
  const p0 = worstPxAt(0);
  const p30 = worstPxAt(30);
  const p60 = worstPxAt(60);
  assert.ok(p0 < 10, `nadir must ~agree under old fov (got ${p0.toFixed(1)}px)`);
  assert.ok(p30 > 20, `pitch 30 must shear under old fov (got ${p30.toFixed(1)}px)`);
  assert.ok(p60 > 100, `pitch 60 must shear badly under old fov (got ${p60.toFixed(1)}px)`);
});

test('aspect parity helper flags shear, passes identical boxes', () => {
  assert.equal(aspectMismatch(1600, 900, 1600, 900), 0, 'identical boxes mismatch 0');
  assert.ok(assertAspectParity(1600, 900, 1600, 900), 'identical boxes pass');
  assert.ok(aspectMismatch(1600, 900, 800, 600) > 0.2, '16:9 vs 4:3 must flag');
  assert.throws(
    () => assertAspectParity(1600, 900, 800, 600),
    /mismatch/,
    '16:9 vs 4:3 must throw',
  );
});

test('tilt clamp is shared: twin maxPolar == map maxPitch == MAP_MAX_PITCH_DEG', () => {
  assert.equal(MAP_MAX_PITCH_DEG, 85, 'shared clamp stays 85');
  const overlays = srcOf('../src/ring2/overlays.js');
  const mapbase = srcOf('../src/ring2/mapbase.js');
  assert.ok(/maxPolarAngle\s*=\s*\(MAP_MAX_PITCH_DEG/.test(overlays), 'twin tilt must use the shared clamp');
  assert.ok(/maxPitch:\s*MAP_MAX_PITCH_DEG/.test(mapbase), 'map maxPitch must use the shared clamp');
});

test('wiring: live viewportPx + unified fov, no stale 60 literal', () => {
  const main = srcOf('../src/ring2/main.js');
  assert.ok(/MAP_TRUE_FOV_DEG/.test(main), 'main.js must drive the twin off MAP_TRUE_FOV_DEG');
  assert.ok(
    /applyTwinToMap\(map, pose, \{\s*viewportPx, fovDeg: FOV_DEG \}\)/.test(main),
    'sync call must pass the LIVE viewportPx (twinDiv.clientHeight), not a 600 literal',
  );
  for (const [name, rel] of [
    ['sync', '../src/ring2/sync.js'],
    ['main', '../src/ring2/main.js'],
    ['overlays', '../src/ring2/overlays.js'],
  ]) {
    assert.ok(!/fovDeg:\s*60\b/.test(srcOf(rel)), `${name}.js must not pin fovDeg 60 anymore`);
    assert.ok(!/fovDeg \?\? 60\b/.test(srcOf(rel)), `${name}.js must not default fov 60 anymore`);
  }
});

test('zoom/range round-trip holds under the unified default fov', () => {
  for (const r of [800, 5000, 12000, 26000, 32000]) {
    const z = zoomForRange(r); // defaults now carry MAP_TRUE_FOV_DEG
    const back = rangeForZoom(z);
    assert.ok(Math.abs(back - r) / r < 1e-9, `range ${r} round-trips (got ${back})`);
  }
});
