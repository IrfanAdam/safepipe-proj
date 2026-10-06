/* Safepipe Ops 3D — src/ops3d/network.js · dotted-trace network layer.
 * Pipelines render as dotted THREE.Points traces (sampled polyline dots, not
 * tubes), colored by feed health: faint bone nominal, amber #ff8c39 watch,
 * red #e31919 critical at 1.5× dot size. Fault chainages get brighter beads;
 * the selected asset's faults get a ground ring. Facilities are wireframe
 * boxes at line junctions, colored by own health; sensors are small diamonds.
 * A subtle dashed warm-yellow flow overlay drifts along each pipe path
 * (tick/update(t) animates dashOffset). Outer runs (first/last 15% of arc
 * length, or radius > 12 km) render buried: sunk, dimmed ~40%, dash-grouped.
 * Picking raycasts invisible fat-tube/box proxies (never the dots).
 * Contract: buildNetwork(scene, feed) →
 *   {update, tick, setSelection, setHover, pick, setSize, setDetail, dispose, stats}.
 */

import * as THREE from 'three';
import { getLayout } from './health-feed.js';
import { field } from './terrain.js'; // drape buried runs onto the surface
const VEX = 3.5; // must match terrain.js vertical exaggeration
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const HEALTH_COLOR = {
  nominal: 0x8a857a, // dim bone — recedes
  watch: 0xff8c39, // signal amber
  critical: 0xe31919, // fault red
};
const DOT_Y = 0.06;
const DIM_FACTOR = 0.3;
const FLOW_COLOR = 0xd8a93c; // warm yellow oil-flow overlay
const FLOW_OPACITY = 0.32;
const FLOW_SPEED = 0.45; // slow drift along the pipe path (world units/s)
const BURIED_EDGE_T = 0.15; // outer 15% of each run dives underground
const BURIED_R = 12; // any stretch past r=12 km is buried too

function smooth01(x) {
  x = Math.min(Math.max(x, 0), 1);
  return x * x * (3 - 2 * x);
}

/* Burial depth 0 (surface) → 1 (buried) at arc fraction t with radius r:
 * the outer 15% of each run dives underground, as does any stretch past
 * r=12 km — both with a short smooth ramp so pipes visibly dive. */
function buryDepth(t, r) {
  let d = 0;
  if (t < BURIED_EDGE_T) d = 1 - smooth01((t - (BURIED_EDGE_T - 0.03)) / 0.03);
  else if (t > 1 - BURIED_EDGE_T) d = smooth01((t - (1 - BURIED_EDGE_T)) / 0.03);
  if (r > BURIED_R) d = Math.max(d, smooth01((r - (BURIED_R - 0.5)) / 0.5));
  return Math.min(Math.max(d, 0), 1);
}

/* Solid-trace sampling with burial: runs split where depth crosses 0.5 so
 * surface renders solid and buried renders dashed + dimmed. Also returns
 * the full draped path for the flow overlay. */
function sampleTrace(points, step = 0.18) {
  const runs = []; // solid runs split by burial: {pts:[x,y,z…], buried}
  const flow = [];
  const total = pipeLen(points);
  let dist = 0;
  let cur = null;
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1];
    const [x1, z1] = points[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      const x = x0 + (x1 - x0) * f;
      const z = z0 + (z1 - z0) * f;
      const t = total === 0 ? 0 : (dist + len * f) / total;
      const depth = buryDepth(t, Math.hypot(x, z));
      // Buried runs drape onto the terrain surface (x-ray plan view) instead
      // of sinking under the opaque body where they would vanish entirely.
      const surfY = field(x, z) * VEX + 0.03;
      const y = DOT_Y * (1 - depth) + surfY * depth;
      flow.push(x, y + 0.02, z); // flow rides just above the pipe wall
      const buried = depth > 0.5;
      if (!cur || cur.buried !== buried) {
        cur = { pts: [], buried };
        runs.push(cur);
      }
      cur.pts.push(x, y, z);
    }
    dist += len;
  }
  return { runs, flow };
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
  const flowMats = []; // animated oil-flow overlays (dashOffset drift in tick)
  const chevrons = []; // dive markers riding the arc (flow dashes carry direction)
  const diveGeo = new THREE.OctahedronGeometry(0.11);
  const DIVE_COL = 0x7fa3b8; // cool steel: marks where a run dives underground
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

  /* --- pipelines: dotted Points traces + flow overlay + fault beads + proxies --- */
  for (const pipe of layout.pipelines) {
    const item = healthById.get(pipe.assetId);
    const health = item?.health ?? 'nominal';
    const trace = sampleTrace(pipe.points);
    // Solid pipe walls: surface runs solid, buried runs dashed + dimmed.
    for (const run of trace.runs) {
      if (run.pts.length < 6) continue;
      const wallGeo = new LineGeometry();
      wallGeo.setPositions(run.pts);
      const wallMat = new LineMaterial({
        color: colorFor(health),
        linewidth: 2,
        dashed: run.buried,
        dashSize: 0.4,
        gapSize: 0.3,
        transparent: true,
        opacity: (health === 'nominal' ? 0.5 : 1) * (run.buried ? 0.55 : 1),
        depthWrite: false,
      });
      wallMat.resolution.set(1280, 720);
      resMats.push(wallMat);
      const wall = new Line2(wallGeo, wallMat);
      wall.computeLineDistances();
      wall.frustumCulled = false;
      group.add(wall);
      track(pipe.assetId, wallMat, wallMat.opacity);
      dotTotal += run.pts.length / 3;
    }

    // Flow overlay: subtle dashed warm-yellow line drifting along the pipe
    // path (dashOffset animated in tick) suggesting real-time movement.
    const flowGeo = new LineGeometry();
    flowGeo.setPositions(trace.flow);
    const flowMat = new LineMaterial({
      color: FLOW_COLOR,
      linewidth: 2,
      dashed: true,
      dashSize: 0.6,
      gapSize: 0.45,
      dashOffset: 0,
      transparent: true,
      opacity: FLOW_OPACITY,
      depthWrite: false,
    });
    flowMat.resolution.set(1280, 720);
    resMats.push(flowMat);
    flowMats.push({ m: flowMat, assetId: pipe.assetId });
    const flowLine = new Line2(flowGeo, flowMat);
    flowLine.computeLineDistances();
    flowLine.frustumCulled = false;
    group.add(flowLine);

    // Dive markers: steel octahedrons at the two points where the run
    // leaves the surface — the explicit "pipeline goes underground HERE".
    for (const t0 of [BURIED_EDGE_T, 1 - BURIED_EDGE_T]) {
      const dp = polyPoint(pipe.points, t0);
      const dq = polyPoint(pipe.points, Math.min(t0 + 0.01, 1));
      const dm = new THREE.MeshBasicMaterial({
        color: DIVE_COL, transparent: true, opacity: 0.7, depthWrite: false,
      });
      const dive = new THREE.Mesh(diveGeo, dm);
      dive.position.set(dp.x, DOT_Y + 0.1, dp.z);
      dive.rotation.y = Math.atan2(dq.x - dp.x, dq.z - dp.z);
      dive.frustumCulled = false;
      group.add(dive);
      chevrons.push({ mesh: dive, points: pipe.points, t0, detailF: 1, assetId: pipe.assetId, dive: true });
    }

    // Fault beads: brighter spheres at fault chainage fractions.
    const beadGeo = new THREE.SphereGeometry(0.05, 12, 10);
    for (const fault of item?.faults ?? []) {
      const span = pipeLen(pipe.points); // per-pipe true length in km
      const ft = (fault.chainage ?? 0) / span;
      const bead = new THREE.Mesh(
        beadGeo,
        new THREE.MeshBasicMaterial({ color: colorFor(fault.severity === 'critical' ? 'critical' : health) }),
      );
      bead.position.copy(polyPoint(pipe.points, ft));
      const bd = buryDepth(ft, Math.hypot(bead.position.x, bead.position.z));
      bead.position.y = (DOT_Y + 0.04) * (1 - bd) + (field(bead.position.x, bead.position.z) * VEX + 0.07) * bd;
      bead.userData.assetId = pipe.assetId;
      group.add(bead);
      track(pipe.assetId, bead.material, 1);
      beadMats.push({ m: bead.material, assetId: pipe.assetId });
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
      // Hovered boxes/diamonds swell slightly so the click target is obvious.
      const hs = hovered === id && selected !== id ? 1.15 : 1;
      for (const n of entry.nodes) n.scale.setScalar(hs);
    }
    showRings(selected);
  };

  // Slow dash-offset drift on the flow overlays (direction follows the pipe
  // path from first to last point). Accepts absolute scene time.
  const tickFlow = (t = 0) => {
    for (const e of flowMats) e.m.dashOffset = -t * FLOW_SPEED;
    // Dive markers hold station on the arc (flow dashes carry direction).
    for (const c of chevrons) {
      const tt = c.dive ? c.t0 : (c.t0 + t * FLOW_SPEED * 0.06) % 1;
      const p = polyPoint(c.points, tt);
      const q = polyPoint(c.points, Math.min(tt + 0.01, 1));
      const d = buryDepth(tt, Math.hypot(p.x, p.z));
      const surfY = field(p.x, p.z) * VEX + 0.03;
      const y = (DOT_Y + 0.07) * (1 - d) + (surfY + 0.05) * d;
      c.mesh.position.set(p.x, y, p.z);
      if (!c.dive) c.mesh.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      const fade = 1 - d * 0.5;
      const dim = selected && selected !== c.assetId ? DIM_FACTOR : 1;
      const lvl = c.assetId === selected ? 1 : (c.detailF ?? 1);
      c.mesh.material.opacity = 0.6 * fade * lvl * dim;
    }
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
      if (typeof next === 'number') {
        tickFlow(next); // update(t) doubles as the flow clock
        return;
      }
      healthById.clear();
      for (const f of next ?? []) healthById.set(f.assetId, f);
      for (const [id, item] of healthById) applyHealth(id, item.health);
      applySelection();
    },
    tick(t = 0) {
      tickFlow(t);
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
          if (m.isPointsMaterial || m.isLineMaterial) m.opacity = base * f;
        }
      }
      for (const e of flowMats) e.m.opacity = FLOW_OPACITY * (e.assetId === selected ? 1 : f);
      for (const c of chevrons) c.detailF = f;
      for (const b of beadMats) b.m.opacity = (name === 'asset' && b.assetId !== selected) ? 0.2 : 1;
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
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) m.dispose?.();
      });
    },
  };
}
