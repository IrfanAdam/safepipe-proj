/* Safepipe Ops 3D — src/ops3d/beacons.js · flow pulses + fault beacons + halo.
 * Arkham-night-vision readability over the dotted-trace network: (1) pulse
 * beads stream along each pipeline toward its end, tinted by line health;
 * (2) every fault chainage gets an additive light pillar + expanding ground
 * rings (red critical / amber watch); (3) the selected asset gets a halo ring.
 * Cheap materials only: MeshBasicMaterial + AdditiveBlending, no MRT.
 * Contract: buildBeacons(scene, feed, layout) → {update, setSelection, tick, dispose}.
 */

import * as THREE from 'three';
import { getLayout } from './health-feed.js';

const SPAN = 8.4; // nominal line length in km (matches feed chainage scale)
const FLOW_COLOR = { nominal: 0x8f9797, watch: 0xff8c39, critical: 0xff2a2a };
const BEAD_SIZE = 0.13;
const PILLAR_H = 1.6;

let glowTex = null;
function getGlowTexture() {
  if (glowTex) return glowTex;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

/* Arc-length position on an [x,z] polyline at fraction t. */
function polyPoint(points, t, y = 0.06) {
  let total = 0;
  const lens = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(len);
    total += len;
  }
  let target = Math.min(Math.max(t, 0), 1) * total;
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

const colorFor = (h) => new THREE.Color(FLOW_COLOR[h] ?? FLOW_COLOR.nominal);
const sevColor = (fault, fallback) =>
  colorFor(fault.severity === 'critical' || fault.severity === 'watch' ? fault.severity : fallback);

export function buildBeacons(scene, feed, layout) {
  const L = layout ?? getLayout();
  const healthById = new Map((feed ?? []).map((f) => [f.assetId, f]));
  const pipeById = new Map(L.pipelines.map((p) => [p.assetId, p]));
  const facById = new Map(L.facilities.map((f) => [f.assetId, f]));
  const senById = new Map(L.sensors.map((s) => [s.assetId, s]));

  const group = new THREE.Group();
  group.name = 'ops-beacons';
  scene.add(group);

  let selected = null;
  const flows = []; // {pipeId, pts, cum, total, beads, pos, mat, count, speed}
  let faults = []; // {assetId, mat, rings:[{mesh,mat,phase}], baseOp}
  let halo = null;

  /* --- (1) trunk-and-lateral flow: bead Points streaming toward line end --- */
  function buildFlows() {
    for (const pipe of L.pipelines) {
      const item = healthById.get(pipe.assetId);
      const health = item?.health ?? 'nominal';
      const dense = [];
      for (let i = 1; i < pipe.points.length; i++) {
        const [x0, z0] = pipe.points[i - 1];
        const [x1, z1] = pipe.points[i];
        const n = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.12));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const f = k / n;
          dense.push(new THREE.Vector3(x0 + (x1 - x0) * f, 0.09, z0 + (z1 - z0) * f));
        }
      }
      const cum = [0];
      for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
      const total = cum[cum.length - 1] || 1;
      const count = Math.min(10, Math.max(4, Math.round(total / 1.4)));
      const pos = new Float32Array(count * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.PointsMaterial({
        color: colorFor(health), size: BEAD_SIZE, sizeAttenuation: true,
        map: getGlowTexture(), transparent: true, opacity: health === 'nominal' ? 0.65 : 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const beads = new THREE.Points(geo, mat);
      beads.frustumCulled = false;
      group.add(beads);
      flows.push({ pipeId: pipe.assetId, pts: dense, cum, total, beads, pos, mat, count, speed: 0.05 });
    }
  }

  /* --- (2) fault beacons: additive pillar + two expanding ground rings --- */
  const pillarGeo = new THREE.CylinderGeometry(0.09, 0.17, PILLAR_H, 12, 1, true);
  const ringGeo = new THREE.RingGeometry(0.18, 0.26, 40);
  function faultAnchor(assetId) {
    if (pipeById.has(assetId)) {
      const item = healthById.get(assetId);
      const ch = item?.faults?.[0]?.chainage ?? SPAN / 2;
      return polyPoint(pipeById.get(assetId).points, ch / SPAN);
    }
    if (facById.has(assetId)) { const [x, z] = facById.get(assetId).position; return new THREE.Vector3(x, 0.06, z); }
    if (senById.has(assetId)) { const [x, z] = senById.get(assetId).position; return new THREE.Vector3(x, 0.06, z); }
    return null;
  }
  function buildFaults() {
    for (const f of faults) {
      group.remove(f.pillar); group.remove(...f.rings.map((r) => r.mesh));
      f.mat.dispose(); for (const r of f.rings) { r.mesh.geometry.dispose(); r.mat.dispose(); }
    }
    faults = [];
    for (const [assetId, item] of healthById) {
      if (!item?.faults?.length) continue;
      for (const fault of item.faults) {
        let p = null;
        if (pipeById.has(assetId)) p = polyPoint(pipeById.get(assetId).points, (fault.chainage ?? 0) / SPAN);
        else p = faultAnchor(assetId);
        if (!p) continue;
        const col = sevColor(fault, item.health);
        const mat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const pillar = new THREE.Mesh(pillarGeo, mat);
        pillar.position.set(p.x, PILLAR_H / 2, p.z);
        group.add(pillar);
        const rings = [0, 0.5].map((phase) => {
          const rm = new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(ringGeo, rm);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(p.x, 0.03, p.z);
          group.add(mesh);
          return { mesh, mat: rm, phase };
        });
        faults.push({ assetId, pillar, mat, rings, baseOp: 0.35, crit: fault.severity === 'critical' });
      }
    }
  }

  /* --- (3) selection halo: single pulsing ring at the asset anchor --- */
  const haloGeo = new THREE.RingGeometry(0.42, 0.52, 48);
  function buildHalo() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfefff, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    halo = new THREE.Mesh(haloGeo, mat);
    halo.rotation.x = -Math.PI / 2;
    halo.visible = false;
    group.add(halo);
  }

  function placeHalo() {
    if (!halo) return;
    if (!selected || !(pipeById.has(selected) || facById.has(selected) || senById.has(selected))) {
      halo.visible = false;
      return;
    }
    let p;
    if (pipeById.has(selected)) p = polyPoint(pipeById.get(selected).points, 0.5);
    else p = faultAnchor(selected);
    halo.position.set(p.x, 0.04, p.z);
    halo.visible = true;
  }

  buildFlows();
  buildFaults();
  buildHalo();

  return {
    update(next) {
      healthById.clear();
      for (const f of next ?? []) healthById.set(f.assetId, f);
      for (const fl of flows) {
        const h = healthById.get(fl.pipeId)?.health ?? 'nominal';
        fl.mat.color.copy(colorFor(h));
        fl.mat.opacity = h === 'nominal' ? 0.65 : 0.95;
      }
      buildFaults();
      placeHalo();
    },
    setSelection(id) {
      selected = id ?? null;
      placeHalo();
    },
    tick(t) {
      for (const fl of flows) {
        for (let b = 0; b < fl.count; b++) {
          const frac = (t * fl.speed + b / fl.count) % 1;
          const target = frac * fl.total;
          let lo = 0;
          while (lo < fl.cum.length - 2 && fl.cum[lo + 1] < target) lo++;
          const seg = fl.cum[lo + 1] - fl.cum[lo] || 1;
          const f = (target - fl.cum[lo]) / seg;
          const a = fl.pts[lo], c = fl.pts[Math.min(lo + 1, fl.pts.length - 1)];
          fl.pos[b * 3] = a.x + (c.x - a.x) * f;
          fl.pos[b * 3 + 1] = a.y;
          fl.pos[b * 3 + 2] = a.z + (c.z - a.z) * f;
        }
        fl.beads.geometry.attributes.position.needsUpdate = true;
      }
      for (const f of faults) {
        const isSel = f.assetId === selected;
        const rate = (f.crit ? 3.2 : 2.0) * (isSel ? 1.8 : 1);
        f.mat.opacity = (isSel ? f.baseOp * 1.9 : f.baseOp) * (0.72 + 0.28 * Math.sin(t * rate));
        for (const r of f.rings) {
          const s = (t * (isSel ? 0.9 : 0.55) + r.phase) % 1;
          const sc = 1 + s * 1.5;
          r.mesh.scale.setScalar(sc);
          r.mat.opacity = (1 - s) * (isSel ? 0.95 : 0.65);
        }
      }
      if (halo?.visible) {
        const s = 1 + 0.12 * Math.sin(t * 3);
        halo.scale.setScalar(s);
        halo.material.opacity = 0.65 + 0.25 * Math.sin(t * 3);
      }
    },
    dispose() {
      scene.remove(group);
      for (const fl of flows) { fl.beads.geometry.dispose(); fl.mat.dispose(); }
      for (const f of faults) { f.mat.dispose(); for (const r of f.rings) r.mat.dispose(); }
      pillarGeo.dispose(); ringGeo.dispose(); haloGeo.dispose(); halo?.material.dispose();
      flows.length = 0; faults = [];
    },
  };
}
