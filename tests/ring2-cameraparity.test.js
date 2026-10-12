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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mapPoseForTwin,
  groundResForZoom,
  zoomForRange,
  rangeForZoom,
  aspectMismatch,
  assertAspectParity,
  tiltFadeForPitch,
  MAP_FOV_RAD,
  MAP_TRUE_FOV_DEG,
  MAP_MAX_PITCH_DEG,
  TILT_FADE_START_DEG,
  TWIN_MIN_RANGE_M,
  TWIN_MAX_ZOOM,
  SAT_IMAGERY_MAXZOOM,
  TERRAIN_DEM_MAXZOOM,
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
  // Suspect 3 (PRIMARY, owner video): 85 permitted near-grazing edge-on
  // views where any residual DEM difference reads as vertical decoupling.
  // 65 keeps parallax magnification ~tan(p) at ~2.1 (vs 11.4 at 85) and the
  // pitch-60 parity proof inside the legal envelope.
  assert.equal(MAP_MAX_PITCH_DEG, 65, 'shared clamp is 65 — grazing unreachable');
  assert.ok(MAP_MAX_PITCH_DEG <= 70, 'clamp must stay out of the grazing band');
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

test('CLOSE-RANGE pan sweep: range 800-1500m, pitch 60, target +-2km — NDC parity holds', () => {
  // Suspect 2 (projection-breakdown variant): KILLED by this sweep. The
  // pinhole projection has no close-range cliff — same eye/target/fov/
  // aspect reconstructs to ~0 residual at dive ranges with a panned target.
  // Any residual on-device shear at close range is DEM resampling (see the
  // overzoom test below), not projection math.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
  const H = 800;
  const ASP = 16 / 9;
  const PITCH = 60; // inside the 65 clamp; the steepest legal oblique
  let worst = 0;
  let checked = 0;
  for (const rangeM of [800, 1000, 1500]) {
    for (const tx of [-2000, 0, 2000]) {
      for (const tz of [-2000, 0, 2000]) {
        const target = { x: tx, y: 0, z: tz };
        const eye = {
          x: tx,
          y: rangeM * Math.cos(rad(PITCH)),
          z: tz + rangeM * Math.sin(rad(PITCH)),
        };
        const mp = mapPoseForTwin({ eye, target }, { viewportPx: H, fovDeg: MAP_TRUE_FOV_DEG });
        const distPx = (0.5 * H) / Math.tan(rad(MAP_TRUE_FOV_DEG) / 2);
        const distM = distPx * groundResForZoom(mp.zoom, SANGACHAL.lat);
        assert.ok(
          Math.abs(distM - rangeM) / rangeM < 1e-9,
          `range ${rangeM} target (${tx},${tz}): map eye must reconstruct twin range (got ${distM})`,
        );
        const mapEye = {
          x: tx,
          y: distM * Math.cos(rad(mp.pitch)),
          z: tz + distM * Math.sin(rad(mp.pitch)),
        };
        for (const g of ringPoints()) {
          const a = ndcFor(eye, target, g, MAP_TRUE_FOV_DEG, ASP);
          const b = ndcFor(mapEye, target, g, MAP_TRUE_FOV_DEG, ASP);
          if (!a || !b) continue;
          checked++;
          worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
        }
      }
    }
  }
  assert.ok(checked > 0, 'sweep must compare in-frame points');
  assert.ok(worst < 1e-9, `close-range pan sweep residual must be ~0 (got ${worst} over ${checked} pairs)`);
});

test('overzoom quantified: old 800m dive exceeded DEM native by ~2 levels; clamp holds ≤1', () => {
  // Suspect 2 verdict: Esri-overzoom variant KILLED (z19 native never
  // approached at twin ranges); DEM-overzoom variant PROVED (Terrarium z15
  // native exceeded) and clamped by TWIN_MIN_RANGE_M.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
  const opt = (h) => ({ viewportPx: h, fovDeg: MAP_TRUE_FOV_DEG });
  const zOld = zoomForRange(800, SANGACHAL.lat, opt(800));
  assert.ok(
    zOld > TERRAIN_DEM_MAXZOOM + 1,
    `old 800m dive must exceed one DEM-overzoom level (got z${zOld.toFixed(2)} vs native ${TERRAIN_DEM_MAXZOOM}+1)`,
  );
  assert.ok(
    zOld < SAT_IMAGERY_MAXZOOM,
    `old dive must still stay under Esri native (got z${zOld.toFixed(2)} vs ${SAT_IMAGERY_MAXZOOM})`,
  );
  // The clamp: zoom ≤16 for viewport heights ≤ ~1096px (every owner device).
  for (const h of [600, 800, 1000, 1096]) {
    const z = zoomForRange(TWIN_MIN_RANGE_M, SANGACHAL.lat, opt(h));
    assert.ok(
      z <= TWIN_MAX_ZOOM + 1e-9,
      `clamped dive must hold zoom ≤${TWIN_MAX_ZOOM} at H=${h} (got z${z.toFixed(3)})`,
    );
  }
  // Comment-math proof: the clamp radius IS rangeForZoom(16) at H=1096.
  const derived = rangeForZoom(TWIN_MAX_ZOOM, SANGACHAL.lat, opt(1096));
  assert.ok(
    Math.abs(derived - TWIN_MIN_RANGE_M) / TWIN_MIN_RANGE_M < 0.01,
    `TWIN_MIN_RANGE_M must equal rangeForZoom(16)@H1096 (got ${derived.toFixed(0)} vs ${TWIN_MIN_RANGE_M})`,
  );
  // Wired single-source: overlays dives on the constant, mapbase style on
  // the native ceilings (no bare maxzoom literals left).
  const overlays = srcOf('../src/ring2/overlays.js');
  const mapbase = srcOf('../src/ring2/mapbase.js');
  assert.ok(/controls\.minDistance\s*=\s*TWIN_MIN_RANGE_M/.test(overlays), 'twin dive must use TWIN_MIN_RANGE_M');
  assert.ok(!/controls\.minDistance\s*=\s*800/.test(overlays), 'bare 800 dive must be gone');
  assert.ok(/maxzoom:\s*TERRAIN_DEM_MAXZOOM/.test(mapbase), 'DEM sources must use TERRAIN_DEM_MAXZOOM');
  assert.ok(/maxzoom:\s*SAT_IMAGERY_MAXZOOM/.test(mapbase), 'imagery sources must use SAT_IMAGERY_MAXZOOM');
  assert.ok(!/maxzoom:\s*1[59],/.test(mapbase), 'bare maxzoom literals must be gone from mapbase');
});

test('tilt fade law: full to 50deg, gone at the clamp, monotonic between', () => {
  assert.equal(TILT_FADE_START_DEG, 50, 'fade starts at 50deg');
  assert.equal(tiltFadeForPitch(0), 1, 'nadir is full opacity');
  assert.equal(tiltFadeForPitch(50), 1, 'fade start is still full');
  assert.equal(tiltFadeForPitch(MAP_MAX_PITCH_DEG), 0, 'clamp is zero — no linework at max tilt');
  assert.equal(tiltFadeForPitch(90), 0, 'past-clamp stays zero');
  const mid = tiltFadeForPitch((TILT_FADE_START_DEG + MAP_MAX_PITCH_DEG) / 2);
  assert.ok(mid > 0.4 && mid < 0.6, `mid-ramp must be ~0.5 smoothstep (got ${mid})`);
  let prev = 1;
  for (let p = 50; p <= 65; p += 1) {
    const k = tiltFadeForPitch(p);
    assert.ok(k <= prev + 1e-12, `fade must be monotonic (pitch ${p}: ${k} > ${prev})`);
    prev = k;
  }
});

test('tilt fade is wired: overlays exposes setTiltFade, main loop drives it per frame', () => {
  const overlays = srcOf('../src/ring2/overlays.js');
  const main = srcOf('../src/ring2/main.js');
  assert.ok(/function setTiltFade\(pitchDeg\)/.test(overlays), 'overlays must define setTiltFade');
  assert.ok(/setTiltFade,\s*setTakeover/.test(overlays), 'twin handle must export setTiltFade');
  assert.ok(/tiltFadeForPitch\(pitchDeg\)/.test(overlays), 'fade must use the pure sync.js law');
  assert.ok(/twin\.setTiltFade\?\.\(pitch\)/.test(main), 'main loop must drive setTiltFade per frame');
});

test('input-path audit: one map, no enablers, twin canvas owns Shift+drag', () => {
  // Audit verdict: exactly ONE `new maplibregl.Map` (mapbase.js); ZERO
  // `.enable(` calls anywhere in src/ring2 (nothing can re-arm a handler
  // behind the sync); boxZoom stays in the disabled+probed handler list; the
  // twin canvas sits above the map (z-index) with pointer-events auto, so
  // Shift+drag (MapLibre boxZoom's trigger) can never reach the map —
  // OrbitControls owns it and the map follows via authoritative sync.
  // [plan:2026-10-11_202541-ops3d-v3-realworld-iteration.md#phase-01]
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ring2');
  const files = readdirSync(root).filter((f) => f.endsWith('.js'));
  let mapCtors = 0;
  let enablers = 0;
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    mapCtors += (src.match(/new maplibregl\.Map\(/g) ?? []).length;
    enablers += (src.match(/\.\s*enable\s*\(/g) ?? []).length;
  }
  assert.equal(mapCtors, 1, `exactly one map constructor in src/ring2 (got ${mapCtors})`);
  assert.equal(enablers, 0, `zero .enable( calls in src/ring2 (got ${enablers})`);
  const mapbase = srcOf('../src/ring2/mapbase.js');
  assert.ok(/map\[name\]\?\.disable\?\.\(\)/.test(mapbase), 'mapbase must disable every handler post-construction');
  assert.ok(/assertMapNonInteractive\(map\)/.test(mapbase), 'mapbase must probe non-interactive (fail closed)');
  const html = srcOf('../ops3d-ring2.html');
  const zMap = Number(html.match(/\.ring2-map\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  const zTwin = Number(html.match(/\.ring2-twin\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(zMap) && Number.isFinite(zTwin) && zTwin > zMap,
    `twin layer must sit above the map (got map z${zMap} twin z${zTwin})`);
  assert.ok(/\.ring2-twin canvas\s*\{\s*pointer-events:\s*auto/.test(html),
    'twin canvas must take pointer events (Shift+drag reaches OrbitControls, never the map)');
});
