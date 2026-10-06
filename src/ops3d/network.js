/* Safepipe Ops 3D — src/ops3d/network.js · dotted-trace network layer.
 * Pipelines render as dotted THREE.Points traces (sampled polyline dots, not
 * tubes), colored by feed health: faint bone nominal, amber #ff8c39 watch,
 * red #e31919 critical at 1.5× dot size. Fault chainages get brighter beads;
 * the selected asset's faults get a ground ring. Facilities are wireframe
 * boxes at line junctions, colored by own health; sensors are small diamonds.
 * Picking raycasts invisible fat-tube/box proxies (never the dots).
 * Contract: buildNetwork(scene, feed) → {update, setSelection, setHover, pick, setSize, stats}.
 */

import * as THREE from 'three';
import { getLayout } from './health-feed.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const HEALTH_COLOR = {
  nominal: 0x8a857a, // dim bone — recedes
  watch: 0xff8c39, // signal amber
  critical: 0xe31919, // fault red
};
const DOT_Y = 0.06;
const BASE_DOT_SIZE = 0.16;
const CRITICAL_GAIN = 2.2;
const DIM_FACTOR = 0.3;
const HOVER_GAIN = 1.25;

let dotTexture = null;
/* Soft round sprite so dots stay circular at any zoom (untextured Points
 * render as squares, which read as pixelation up close). */
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  dotTexture = new THREE.CanvasTexture(cv);
  return dotTexture;
}

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

function pipeLen(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total || 1;
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
  const beadMats = []; // fault beads dim independently at NEAR (kit takes over)
  const resMats = []; // resolution-dependent fat-line materials (see setSize)
  const raycaster = new THREE.Raycaster();
  let dotTotal = 0;
  let beadTotal = 0;
  let selected = null;
  let hovered = null;
  let detailF = 1; // view-driven dot scale (TOP 1 → NEAR 0.35)
  const ringHolder = new THREE.Group();
  group.add(ringHolder);

  const track = (assetId, mat, baseOpacity) => {
    mat.transparent = true;
    mat.opacity = baseOpacity;
    let entry = byId.get(assetId);
    if (!entry) {
      entry = { mats: [], dots: null, nodes: [] };
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
      map: getDotTexture(),
      transparent: true,
      opacity: health === 'nominal' ? 0.4 : 1,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.name = pipe.assetId;
    group.add(points);
    track(pipe.assetId, mat, mat.opacity);
    byId.get(pipe.assetId).dots = points;
    dotTotal += dots.length;

    // Fault beads: brighter spheres at fault chainage fractions.
    const beadGeo = new THREE.SphereGeometry(0.05, 12, 10);
    for (const fault of item?.faults ?? []) {
      const span = pipeLen(pipe.points); // per-pipe true length in km
      const bead = new THREE.Mesh(
        beadGeo,
        new THREE.MeshBasicMaterial({ color: colorFor(fault.severity === 'critical' ? 'critical' : health) }),
      );
      bead.position.copy(polyPoint(pipe.points, (fault.chainage ?? 0) / span));
      bead.position.y = DOT_Y + 0.04;
      bead.userData.assetId = pipe.assetId;
      group.add(bead);
      track(pipe.assetId, bead.material, 1);
      beadMats.push(bead.material);
      beadTotal += 1;
    }

    // Fat-tube picking proxy: invisible, raycastable.
    const curve = new THREE.CatmullRomCurve3(
      pipe.points.map(([x, z]) => new THREE.Vector3(x, DOT_Y, z)),
    );
    const proxy = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.6, 8, false),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.userData.assetId = pipe.assetId;
    proxy.userData.kind = 'pipeline';
    group.add(proxy);
    proxies.push(proxy);
  }

  /* --- facilities: wireframe boxes + invisible pick boxes --- */
  for (const fac of layout.facilities) {
    const health = healthById.get(fac.assetId)?.health ?? 'nominal';
    const [w, h, d] = fac.size;
    const [fx, fz] = fac.position;
    // Fat lines (resolution-independent width) so box edges stay crisp close up —
    // 1px LineSegments rasterize into staircases at glancing zoom angles.
    const edgePos = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)).getAttribute('position');
    const segGeo = new LineSegmentsGeometry();
    segGeo.setPositions(Array.from(edgePos.array));
    const edgeMat = new LineMaterial({
      color: colorFor(health).getHex(),
      linewidth: 2.5,
      transparent: true,
      opacity: 0.9,
    });
    edgeMat.resolution.set(1280, 720);
    resMats.push(edgeMat);
    const edges = new LineSegments2(segGeo, edgeMat);
    edges.position.set(fx, h / 2 + 0.02, fz);
    group.add(edges);
    track(fac.assetId, edges.material, 0.9);
    byId.get(fac.assetId).nodes.push(edges);

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.5, h + 0.5, d + 0.5),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.copy(edges.position);
    proxy.userData.assetId = fac.assetId;
    proxy.userData.kind = 'facility';
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
    byId.get(sen.assetId).nodes.push(mesh);

    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.copy(mesh.position);
    proxy.userData.assetId = sen.assetId;
    proxy.userData.kind = 'sensor';
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
    // TOP-only landmark: at ISO/NEAR the anchor ring + kit own the fault —
    // this 600 m washer would fill the frame.
    if (!assetId || detailF < 1) return;
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
      const p = polyPoint(pipe.points, (fault.chainage ?? 0) / pipeLen(pipe.points));
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
        else if (hovered === id) s *= HOVER_GAIN;
        entry.dots.material.size = s * detailF;
      }
      // Hovered boxes/diamonds swell slightly so the click target is obvious.
      const hs = hovered === id && selected !== id ? 1.15 : 1;
      for (const n of entry.nodes) n.scale.setScalar(hs);
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
    setSize(w, h) {
      for (const m of resMats) m.resolution.set(w, h);
    },
    // Level-driven declutter: TOP-sized dots would read as boulders at NEAR —
    // ghost the dotted trace down there so the physical pipe + fault kit lead.
    setDetail(name) {
      const f = name === 'asset' ? 0.12 : name === 'segment' ? 0.6 : 1;
      detailF = name === 'asset' ? 0.25 : name === 'segment' ? 0.7 : 1;
      for (const [, entry] of byId) {
        for (const { m, base } of entry.mats) {
          if (m.isPointsMaterial) m.opacity = base * f;
        }
      }
      for (const m of beadMats) m.opacity = name === 'asset' ? 0.2 : 1;
      applySelection();
    },
    setHover(id) {
      const next = id ?? null;
      if (next === hovered) return false;
      hovered = next;
      applySelection();
      return true;
    },
    pick(ndc, camera) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(proxies, false);
      if (!hits.length) return null;
      // Discrete assets (sensor/facility) win over a pipeline tube when the
      // hits overlap — a box sitting on a line otherwise loses to the tube wall.
      const near = hits.filter((h) => h.distance - hits[0].distance < 1.0);
      const rank = { sensor: 0, facility: 1, pipeline: 2 };
      near.sort((a, b) => rank[a.object.userData.kind] - rank[b.object.userData.kind]);
      return near[0].object.userData.assetId;
    },
  };
}
