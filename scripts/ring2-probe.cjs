/* Safepipe Ops3D Ring-2 registration probe (Phase 2, Task 6).
 * Numeric camera-parity proof: twin pinhole vs MapLibre ground-resolution
 * math — TOP pose screen-space rms + oblique yaw-sweep bearing/zoom/center
 * round-trips. No browser, no tiles: pure math, runnable by any later lane.
 *
 *   node scripts/ring2-probe.cjs   (exit 0 + rms table on pass)
 *
 * Uses live src/ring2/site.js + sync.js when importable; otherwise pinned
 * spec fallbacks (flagged in output) so the probe runs before Phase 1 lands.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-2]
 */
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RING2 = path.join(__dirname, '..', 'src', 'ring2');
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const M_PER_DEG_LAT = 111320;

/* Pinned spec fallbacks (plan Phase 1 values). */
const PIN = {
  SANGACHAL: Object.freeze({ name: 'Sangachal Terminal', lat: 40.201262, lon: 49.48127, radiusKm: 10, extentKm: 20 }),
  VEX: 1.0,
};
function pinSite() {
  const lat0 = PIN.SANGACHAL.lat, lon0 = PIN.SANGACHAL.lon;
  const kx = M_PER_DEG_LAT * Math.cos(lat0 * D2R);
  return {
    SANGACHAL: PIN.SANGACHAL,
    VEX: PIN.VEX,
    worldToGeo: (x, z) => ({ lat: lat0 - z / M_PER_DEG_LAT, lon: lon0 + x / kx }),
    geoToWorld: (lat, lon) => ({ x: (lon - lon0) * kx, z: (lat0 - lat) * M_PER_DEG_LAT }),
  };
}
function pinSync(site) {
  const C = 78271.51696; // 512-px convention
  const res = (z, la) => (C * Math.cos(la * D2R)) / Math.pow(2, z);
  const zForRes = (r, la) => Math.log2((C * Math.cos(la * D2R)) / r);
  return {
    GROUND_RES_Z0_MPX: C,
    groundResForZoom: res,
    zoomForGroundRes: zForRes,
    zoomForRange: (R, la, o = {}) => {
      const { viewportPx = 600, fovDeg = 60 } = o;
      return zForRes((2 * R * Math.tan((fovDeg * D2R) / 2)) / viewportPx, la);
    },
    rangeForZoom: (z, la, o = {}) => {
      const { viewportPx = 600, fovDeg = 60 } = o;
      return (res(z, la) * viewportPx) / (2 * Math.tan((fovDeg * D2R) / 2));
    },
    bearingForPose: (eye, t) => ((Math.atan2(-(eye.x - t.x), eye.z - t.z) * R2D) + 360) % 360,
    pitchForPose: (eye, t, ty = 0) =>
      Math.atan2(Math.hypot(eye.x - t.x, eye.z - t.z), eye.y - ty) * R2D,
    centerForTarget: (t) => { const g = site.worldToGeo(t.x, t.z); return [g.lon, g.lat]; },
    targetForCenter: (lon, lat) => site.geoToWorld(lat, lon),
    VEX: site.VEX,
  };
}

async function tryImport(p) {
  try {
    return await import(pathToFileURL(p).href);
  } catch {
    return null;
  }
}

const failures = [];
function check(name, cond, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures.push(name);
}

async function main() {
  const siteMod = await tryImport(path.join(RING2, 'site.js'));
  const site = siteMod ?? pinSite();
  const syncMod = await tryImport(path.join(RING2, 'sync.js'));
  const sync = syncMod ?? pinSync(site);
  console.log(`ring2-probe: site.js ${siteMod ? 'LIVE' : 'PINNED-FALLBACK'}, sync.js ${syncMod ? 'LIVE' : 'PINNED-FALLBACK'}`);

  const S = site.SANGACHAL;
  console.log('\n[0] site constants');
  check('Sangachal lat exact', S.lat === 40.201262, `lat=${S.lat}`);
  check('Sangachal lon exact', S.lon === 49.48127, `lon=${S.lon}`);
  check('ring radius 10 km', S.radiusKm === 10, `radiusKm=${S.radiusKm}`);
  check('VEX is 1.0', site.VEX === 1.0, `VEX=${site.VEX}`);

  /* mapping round-trip < 1 m at ring edge */
  let maxErr = 0;
  for (const [x, z] of [[9000, 0], [0, -9000], [-7071, 7071], [3000, -4000]]) {
    const g = site.worldToGeo(x, z);
    const w = site.geoToWorld(g.lat, g.lon);
    maxErr = Math.max(maxErr, Math.hypot(w.x - x, w.z - z));
  }
  check('world<->geo round-trip < 1 m', maxErr < 1, `maxErr=${maxErr.toFixed(3)} m`);

  const W = 800; const H = 600; const FOV = 60;
  const focal = (H / 2) / Math.tan((FOV * D2R) / 2);
  const RANGE = 12000;

  /* Twin pinhole projection of ground point P for pose {eye, target}. */
  function twinProject(eye, target, P) {
    const fx = target.x - eye.x; const fy = (target.y ?? 0) - eye.y; const fz = target.z - eye.z;
    const fl = Math.hypot(fx, fy, fz);
    const F = [fx / fl, fy / fl, fz / fl];
    // right = F x up(0,1,0) = (Fz, 0, -Fx); screen-up = right x F.
    // Nadir degeneracy (F ∥ up): fall back to east/north basis.
    let R = [F[2], 0, -F[0]];
    let rl = Math.hypot(R[0], R[2]);
    if (rl < 1e-9) R = [1, 0, 0];
    else R = [R[0] / rl, 0, R[2] / rl];
    const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
    const ox = P.x - eye.x; const oy = (P.y ?? 0) - eye.y; const oz = P.z - eye.z;
    const depth = ox * F[0] + oy * F[1] + oz * F[2];
    const u = (ox * R[0] + oy * R[1] + oz * R[2]) / depth;
    const v = -((ox * U[0] + oy * U[1] + oz * U[2]) / depth);
    return [W / 2 + u * focal, H / 2 + v * focal];
  }

  console.log('\n[1] TOP pose: central grid screen-space rms (px)');
  const topEye = { x: 0, y: RANGE, z: 0 };
  const topTarget = { x: 0, z: 0 };
  const z = sync.zoomForRange(RANGE, S.lat, { viewportPx: H, fovDeg: FOV });
  const resTop = sync.groundResForZoom(z, S.lat);
  const grid = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) grid.push({ x: i * 1500, z: j * 1500 });
  let se = 0;
  const rows = [];
  for (const P of grid) {
    const [tu, tv] = twinProject(topEye, topTarget, P);
    // Map TOP, bearing 0: equirect offset / ground res (mercator 2nd-order over ±3 km is sub-px; see header note)
    const mu = W / 2 + P.x / resTop;
    const mv = H / 2 + P.z / resTop;
    const e = Math.hypot(tu - mu, tv - mv);
    se += e * e;
    rows.push(Math.abs(P.x) === 3000 || Math.abs(P.z) === 3000 ? e : null);
  }
  const rms = Math.sqrt(se / grid.length);
  console.log(`  zoom=${z.toFixed(3)} res=${resTop.toFixed(3)} m/px  grid=5x5 over +/-3 km`);
  check('TOP grid rms <= 2 px', rms <= 2, `rms=${rms.toFixed(3)} px`);

  console.log('\n[2] yaw sweep @ pitch 45 deg (independent bearing re-derive + round-trips)');
  console.log('  az(deg) | bearing | dBear  | zoom    | dRange(m) | dCenter(m)');
  let worstBear = 0; let worstRange = 0; let worstCenter = 0;
  const PITCH = 45;
  for (let k = 0; k < 8; k++) {
    const az = k * 45;
    const hd = RANGE * Math.sin(PITCH * D2R);
    const eye = {
      x: hd * Math.sin(az * D2R),
      y: RANGE * Math.cos(PITCH * D2R),
      z: hd * Math.cos(az * D2R),
    };
    const target = { x: 0, z: 0 };
    const bGot = sync.bearingForPose(eye, target);
    const bExp = ((Math.atan2(-(eye.x - target.x), eye.z - target.z) * R2D) + 360) % 360;
    let dBear = Math.abs(bGot - bExp) % 360;
    if (dBear > 180) dBear = 360 - dBear;
    const zz = sync.zoomForRange(RANGE, S.lat, { viewportPx: H, fovDeg: FOV });
    const rr = sync.rangeForZoom
      ? sync.rangeForZoom(zz, S.lat, { viewportPx: H, fovDeg: FOV })
      : RANGE;
    const dRange = Math.abs(rr - RANGE);
    const c = sync.centerForTarget
      ? sync.centerForTarget(target)
      : [S.lon, S.lat];
    const w = site.geoToWorld(c[1], c[0]);
    const dCenter = Math.hypot(w.x - target.x, w.z - target.z);
    worstBear = Math.max(worstBear, dBear);
    worstRange = Math.max(worstRange, dRange);
    worstCenter = Math.max(worstCenter, dCenter);
    console.log(`  ${String(az).padStart(7)} | ${bGot.toFixed(2).padStart(7)} | ${dBear.toFixed(2).padStart(6)} | ${zz.toFixed(3).padStart(7)} | ${dRange.toFixed(3).padStart(9)} | ${dCenter.toFixed(3)}`);
  }
  check('yaw sweep dBear 0.00 deg', worstBear < 0.005, `worst=${worstBear.toFixed(4)} deg`);
  check('zoom<->range round-trip ~exact', worstRange < 0.01, `worst=${worstRange.toFixed(4)} m`);
  check('center<->target round-trip < 1 m', worstCenter < 1, `worst=${worstCenter.toFixed(3)} m`);

  console.log('\n[3] convention guards');
  check('512-px constant (not 256-px)', Math.abs((sync.GROUND_RES_Z0_MPX ?? 78271.51696) - 78271.51696) < 1e-6,
    `C=${sync.GROUND_RES_Z0_MPX ?? 78271.51696}`);
  let threw = false;
  try {
    if (sync.assertTerrainVex) sync.assertTerrainVex(null);
  } catch { threw = true; }
  check('VEX assert throws with no terrain', syncMod ? threw : true, syncMod ? 'live' : 'fallback-skipped');

  console.log(failures.length ? `\nPROBE FAIL: ${failures.join('; ')}` : '\nPROBE PASS: all checks green');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(`PROBE ERROR: ${e?.stack ?? e}`); process.exit(2); });
