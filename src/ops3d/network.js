/* Safepipe Ops 3D — src/ops3d/network.js · dotted-trace network layer.
 * Pipelines render as dotted THREE.Points traces (sampled polyline dots, not
 * tubes), colored by feed health: faint bone nominal, amber #ff8c39 watch,
 * red #e31919 critical at 1.5× dot size. Fault chainages get brighter beads;
 * the selected asset's faults get a ground ring. Facilities are wireframe
 * boxes at line junctions, colored by own health; sensors are small diamonds.
 * Picking raycasts invisible fat-tube/box proxies (never the dots).
 * Contract: buildNetwork(scene, feed) → {update, setSelection, pick, stats}.
 */

import * as THREE from 'three';
import { getLayout } from './health-feed.js';

const HEALTH_COLOR = {
  nominal: 0x8a857a, // dim bone — recedes
  watch: 0xff8c39, // signal amber
  critical: 0xe31919, // fault red
};
const DOT_Y = 0.06;
const BASE_DOT_SIZE = 0.085;
const CRITICAL_GAIN = 1.5;
const DIM_FACTOR = 0.3;

function samplePolyline(points, step = 0.18) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1];
    const [x1, z1] = points[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      out.push(new THREE.Vector3(x0 + (x1 - x0) * f, DOT_Y, z0 + (z1 - z0) * f));
    }
  }
  return out;
}

function polyPoint(points, t) {
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
        points[i][0] + (points[i + 1][0] - points[i][0]) * f,
        DOT_Y,
        points[i][1] + (points[i + 1][1] - points[i][1]) * f,
      );
    }
    target -= lens[i];
  }
  const last = points[points.length - 1];
  return new THREE.Vector3(last[0], DOT_Y, last[1]);
}

export function buildNetwork(scene, feed) {
  const layout = getLayout();
  const pipeById = new Map(layout.pipelines.map((p) => [p.assetId, p]));
  const facById = new Map(layout.facilities.map((f) => [f.assetId, f]));
  const senById = new Map(layout.sensors.map((s) => [s.assetId, s]));
  const healthById = new Map((feed ?? []).map((f) => [f.assetId, f]));

  const group = new THREE.Group();
  group.name = 'ops-network';
  scene.add(group);

  const byId = new Map(); // assetId → {mats:[{m,base}], dots?, setHealth}
  const proxies = [];
  const raycaster = new THREE.Raycaster();
  let dotTotal = 0;
  let beadTotal = 0;
  let selected = null;
  const ringHolder = new THREE.Group();
  group.add(ringHolder);

  const track = (assetId, mat, baseOpacity) => {
    mat.transparent = true;
    mat.opacity = baseOpacity;
    let entry = byId.get(assetId);
    if (!entry) {
      entry = { mats: [], dots: null };
      byId.set(assetId, entry);
    }
    entry.mats.push({ m: mat, base: baseOpacity });
  };

  const colorFor = (health) => new THREE.Color(HEALTH_COLOR[health] ?? HEALTH_COLOR.nominal);

  /* --- pipelines: dotted Points traces + fault beads + fat-tube proxies --- */
  for (const pipe of layout.pipelines) {
    const item = healthById.get(pipe.assetId);
    const health = item?.health ?? 'nominal';
    const dots = samplePolyline(pipe.points);
    const geo = new THREE.BufferGeometry().setFromPoints(dots);
    const mat = new THREE.PointsMaterial({
      color: colorFor(health),
      size: BASE_DOT_SIZE * (health === 'critical' ? CRITICAL_GAIN : 1),
      sizeAttenuation: true,
      transparent: true,
      opacity: health === 'nominal' ? 0.55 : 0.95,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.name = pipe.assetId;
    group.add(points);
    track(pipe.assetId, mat, mat.opacity);
    byId.get(pipe.assetId).dots = points;
    dotTotal += dots.length;

    // Fault beads: brighter spheres at fault chainage fractions.
    const beadGeo = new THREE.SphereGeometry(0.085, 12, 10);
    for (const fault of item?.faults ?? []) {
      const span = 8.4; // nominal line length in km (matches feed chainage scale)
      const bead = new THREE.Mesh(
        beadGeo,
        new THREE.MeshBasicMaterial({ color: colorFor(fault.severity === 'critical' ? 'critical' : health) }),
      );
      bead.position.copy(polyPoint(pipe.points, (fault.chainage ?? 0) / span));
      bead.position.y = DOT_Y + 0.04;
      bead.userData.assetId = pipe.assetId;
      group.add(bead);
      track(pipe.assetId, bead.material, 1);
      beadTotal += 1;
    }

    // Fat-tube picking proxy: invisible, raycastable.
    const curve = new THREE.CatmullRomCurve3(
      pipe.points.map(([x, z]) => new THREE.Vector3(x, DOT_Y, z)),
    );
    const proxy = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.35, 6, false),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.userData.assetId = pipe.assetId;
    group.add(proxy);
    proxies.push(proxy);
  }

  /* --- facilities: wireframe boxes + invisible pick boxes --- */
  for (const fac of layout.facilities) {
    const health = healthById.get(fac.assetId)?.health ?? 'nominal';
    const [w, h, d] = fac.size;
    const [fx, fz] = fac.position;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: colorFor(health), transparent: true, opacity: 0.9 }),
    );
    edges.position.set(fx, h / 2 + 0.02, fz);
    group.add(edges);
    track(fac.assetId, edges.material, 0.9);

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.5, h + 0.5, d + 0.5),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.copy(edges.position);
    proxy.userData.assetId = fac.assetId;
    group.add(proxy);
    proxies.push(proxy);
  }

  /* --- sensors: small diamonds + invisible pick spheres --- */
  const diamondGeo = new THREE.OctahedronGeometry(0.09);
  for (const sen of layout.sensors) {
    const health = healthById.get(sen.assetId)?.health ?? 'nominal';
    const mesh = new THREE.Mesh(
      diamondGeo,
      new THREE.MeshBasicMaterial({ color: colorFor(health) }),
    );
    mesh.position.set(sen.position[0], 0.16, sen.position[1]);
    mesh.userData.assetId = sen.assetId;
    group.add(mesh);
    track(sen.assetId, mesh.material, health === 'nominal' ? 0.7 : 1);

    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.copy(mesh.position);
    proxy.userData.assetId = sen.assetId;
    group.add(proxy);
    proxies.push(proxy);
  }

  const applyHealth = (assetId, health) => {
    const entry = byId.get(assetId);
    if (!entry) return;
    const color = colorFor(health);
    for (const { m } of entry.mats) {
      if (m.isPointsMaterial) {
        m.color.copy(color);
        m.size = BASE_DOT_SIZE * (health === 'critical' ? CRITICAL_GAIN : 1);
      } else {
        m.color.copy(color);
      }
    }
  };

  const showRings = (assetId) => {
    while (ringHolder.children.length) {
      const child = ringHolder.children.pop();
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    if (!assetId) return;
    const item = healthById.get(assetId);
    const pipe = pipeById.get(assetId);
    if (!item || !pipe || !item.faults?.length) return;
    for (const fault of item.faults) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.3, 40),
        new THREE.MeshBasicMaterial({
          color: colorFor(fault.severity === 'critical' ? 'critical' : item.health),
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const p = polyPoint(pipe.points, (fault.chainage ?? 0) / 8.4);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.03, p.z);
      ringHolder.add(ring);
    }
  };

  const applySelection = () => {
    for (const [id, entry] of byId) {
      const dimmed = selected && id !== selected;
      for (const { m, base } of entry.mats) {
        m.opacity = dimmed ? base * DIM_FACTOR : base;
      }
      if (entry.dots) {
        const h = healthById.get(id)?.health ?? 'nominal';
        let s = BASE_DOT_SIZE * (h === 'critical' ? CRITICAL_GAIN : 1);
        if (selected === id) s *= 1.4;
        entry.dots.material.size = s;
      }
    }
    showRings(selected);
  };

  return {
    stats: {
      assets: byId.size,
      dots: dotTotal,
      beads: beadTotal,
      proxies: proxies.length,
      pipelines: layout.pipelines.length,
      facilities: layout.facilities.length,
      sensors: layout.sensors.length,
    },
    update(next) {
      healthById.clear();
      for (const f of next ?? []) healthById.set(f.assetId, f);
      for (const [id, item] of healthById) applyHealth(id, item.health);
      applySelection();
    },
    setSelection(id) {
      selected = id ?? null;
      applySelection();
    },
    pick(ndc, camera) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(proxies, false);
      return hits.length ? hits[0].object.userData.assetId : null;
    },
  };
}
