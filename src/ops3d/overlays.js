/* Safepipe Ops 3D — src/ops3d/overlays.js · digital-twin data overlays.
 * Modes: 'weather' (drifting wind streaks + cloud-shadow wash),
 *   'tectonic' (pulsing amber stress arrows along PIPE-02 fault trace),
 *   'forecast' (3 expanding plume rings at the fault site, 6h spread).
 * All subtle (opacity <= 0.5), all hidden when mode is null.
 * Contract: buildOverlays(scene, {layout}) → {group, setMode, update, dispose}.
 */

import * as THREE from 'three';
import { getLayout } from './health-feed.js';

const R = 19; // world disc radius (km), matches health-feed clampR19
const STREAKS = 120;

/* Point along an [x,z] polyline at fraction t. */
function polyPoint(points, t, y = 0) {
  let total = 0;
  const lens = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(len);
    total += len;
  }
  let target = Math.min(Math.max(t, 0), 1) * (total || 1);
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : target / lens[i];
      return new THREE.Vector3(
        points[i][0] + (points[i + 1][0] - points[i][0]) * f, y,
        points[i][1] + (points[i + 1][1] - points[i][1]) * f,
      );
    }
    target -= lens[i];
  }
  const last = points[points.length - 1];
  return new THREE.Vector3(last[0], y, last[1]);
}

function segDir(points, t) {
  const a = polyPoint(points, Math.max(t - 0.01, 0));
  const b = polyPoint(points, Math.min(t + 0.01, 1));
  return b.sub(a).setY(0).normalize();
}

export function buildOverlays(scene, opts = {}) {
  const L = opts.layout ?? getLayout();
  const trace = (L.pipelines.find((p) => p.assetId === 'PIPE-02') ?? L.pipelines[1] ?? L.pipelines[0]).points;
  const faultSite = L.faultSite
    ? new THREE.Vector3(L.faultSite[0], 0.07, L.faultSite[1])
    : polyPoint(trace, 0.55, 0.07);

  const group = new THREE.Group();
  group.name = 'ops-overlays';
  scene.add(group);
  const disposables = [];

  // — Weather: drifting wind-streak line segments + cloud-shadow wash —
  const weather = new THREE.Group();
  weather.name = 'overlay-weather';
  const wpos = new Float32Array(STREAKS * 6);
  const seeds = [];
  for (let i = 0; i < STREAKS; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    seeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.5 + Math.random() * 0.9, v: 1.2 + Math.random() * 1.6 });
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  const wmat = new THREE.LineBasicMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.28, depthWrite: false });
  const streaks = new THREE.LineSegments(wgeo, wmat);
  streaks.frustumCulled = false;
  weather.add(streaks);
  const washMat = new THREE.MeshBasicMaterial({ color: 0x1a2b3a, transparent: true, opacity: 0.22, depthWrite: false });
  const wash = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 40), washMat);
  wash.rotation.x = -Math.PI / 2;
  wash.position.y = 0.03;
  weather.add(wash);
  disposables.push(wgeo, wmat, wash.geometry, washMat);

  // — Tectonic: pulsing amber arrows along the fault trace —
  const tectonic = new THREE.Group();
  tectonic.name = 'overlay-tectonic';
  const arrows = [];
  const arrowGeo = new THREE.ConeGeometry(0.16, 0.55, 8);
  disposables.push(arrowGeo);
  const N_ARROWS = 8;
  for (let i = 0; i < N_ARROWS; i++) {
    const t = 0.12 + (i / (N_ARROWS - 1)) * 0.76;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0.5, depthWrite: false });
    const m = new THREE.Mesh(arrowGeo, mat);
    m.position.copy(polyPoint(trace, t, 0.35));
    const d = segDir(trace, t);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().setY(0.25).normalize());
    m.userData.phase = (i / N_ARROWS) * Math.PI * 2;
    tectonic.add(m);
    arrows.push(m);
    disposables.push(mat);
  }

  // — Forecast: 3 expanding plume rings at the fault site —
  const forecast = new THREE.Group();
  forecast.name = 'overlay-forecast';
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(faultSite);
    m.userData.phase = i / 3;
    forecast.add(m);
    rings.push(m);
    disposables.push(m.geometry, mat);
  }

  group.add(weather, tectonic, forecast);

  let mode = null;
  function applyVis() {
    weather.visible = mode === 'weather';
    tectonic.visible = mode === 'tectonic';
    forecast.visible = mode === 'forecast';
  }
  applyVis();

  function setMode(m) {
    mode = m === 'weather' || m === 'tectonic' || m === 'forecast' ? m : null;
    applyVis();
  }

  const wrap = (v, lo, hi) => (v < lo ? hi - (lo - v) : v > hi ? lo + (v - hi) : v);

  function update(t) {
    if (mode === 'weather') {
      const pos = wgeo.attributes.position.array;
      for (let i = 0; i < STREAKS; i++) {
        const s = seeds[i];
        const x = wrap(s.x + t * s.v, -R, R);
        const o = i * 6;
        pos[o] = x - 0.35; pos[o + 1] = s.y; pos[o + 2] = s.z;
        pos[o + 3] = x + 0.35; pos[o + 4] = s.y; pos[o + 5] = s.z;
      }
      wgeo.attributes.position.needsUpdate = true;
      wash.position.x = Math.sin(t * 0.07) * 4;
      wash.position.z = Math.cos(t * 0.05) * 4;
    } else if (mode === 'tectonic') {
      for (const a of arrows) {
        const p = 0.5 + 0.5 * Math.sin(t * 3 + a.userData.phase);
        a.scale.setScalar(0.85 + p * 0.45);
        a.material.opacity = 0.25 + p * 0.25; // <= 0.5
      }
    } else if (mode === 'forecast') {
      for (const r of rings) {
        const f = (t * 0.18 + r.userData.phase) % 1; // staggered 6h spread phase
        const rad = 0.6 + f * 4.2;
        r.scale.setScalar(rad);
        r.material.opacity = 0.42 * (1 - f); // fade out, <= 0.5
      }
    }
  }

  function dispose() {
    scene.remove(group);
    for (const d of disposables) d.dispose?.();
  }

  return { group, setMode, update, dispose };
}
