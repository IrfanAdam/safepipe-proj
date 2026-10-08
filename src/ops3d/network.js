/* Safepipe Ops 3D — src/ops3d/network.js · solid-wall network layer.
 * Pipelines render as continuous Line2 walls (buried stretches dashed +
 * dimmed), colored by feed health: faint bone nominal, amber #ff8c39 watch,
 * red #e31919 critical at 1.5× dot size. Fault chainages get brighter beads;
 * the selected asset's faults get a ground ring. Facilities are wireframe
 * boxes at line junctions, colored by own health; sensors are small diamonds.
 * Soft comet pulses ride each pipe path (tick/update(t) advances sprite
 * phase along the arc) — cyan, never amber, so flow direction can't read
 * as a watch state. Each pulse fades in/out over its life (tapered alpha
 * head-to-tail), never a hard-tipped dash. Outer runs (first/last 15% of arc
 * length, or radius > 12 km) render buried: sunk, dimmed ~40%, dash-grouped.
 * Picking raycasts invisible fat-tube/box proxies (never the dots).
 * Contract: buildNetwork(scene, feed) →
 *   {update, tick, setSelection, setHover, pick, setSize, setDetail, dispose, stats}.
 */

import * as THREE from 'three';
import { getLayout } from './health-feed.js';
import { field, VEX } from './terrain.js'; // drape buried runs onto the surface; VEX single-sourced
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
export const BASE_DOT_SIZE = 0.05;
export const CRITICAL_GAIN = 1.5; // critical renders at 1.5× dot size
const DIM_FACTOR = 0.3;
const FLOW_COLOR = 0x35c5d8; // cool cyan oil-flow pulses — never amber (watch #ff8c39)
const PULSE_OPACITY = 0.6; // pulse peak alpha (envelope tapers it to 0 at both ends)
const PULSE_SPEED = 1.6; // pulse travel along the pipe path (world units/s)
const PULSES_PER_PIPE = 3; // evenly phased pulses per pipe — direction reads, density stays calm
const BURIED_EDGE_T = 0.15; // outer 15% of each run dives underground
const BURIED_R = 12; // any stretch past r=12 km is buried too

function smooth01(x) {
  x = Math.min(Math.max(x, 0), 1);
  return x * x * (3 - 2 * x);
}

/* Soft radial dot shared by all flow pulses: hot core falling smoothly to
 * transparent — the pulse sprite itself has no edge, so flow can never
 * show a hard tip. Procedural DataTexture (no document/canvas) so the
 * network layer stays importable in Node tests. */
let pulseTex = null;
function getPulseTexture() {
  if (pulseTex) return pulseTex;
  const s = 64;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
      const r = Math.hypot(dx, dy) * 2; // 0 center → ~1 at edge
      const a = Math.pow(Math.max(0, 1 - r), 2); // smooth falloff, exactly 0 at the rim
      const i = (y * s + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  pulseTex = new THREE.DataTexture(data, s, s);
  pulseTex.colorSpace = THREE.SRGBColorSpace;
  pulseTex.needsUpdate = true;
  return pulseTex;
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
      // Drape: every run hugs the terrain surface (x-ray plan view) instead
      // of floating at flat datum where hills would swallow it. Surface runs
      // ride just above the skin; buried dives keep their smooth ramp under.
      const surfY = field(x, z) * VEX + 0.03;
      const skinY = Math.max(DOT_Y, surfY);
      const y = skinY * (1 - depth) + surfY * depth;
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
  const pulses = []; // soft comet flow pulses (sprite phase advanced in tick)
  const chevrons = []; // dive markers riding the arc (pulses carry direction)
  const diveGeo = new THREE.OctahedronGeometry(0.11);
  const DIVE_COL = 0x7fa3b8; // cool steel: marks where a run dives underground
  const resMats = []; // resolution-dependent fat-line materials (see setSize)
  const raycaster = new THREE.Raycaster();
  let dotTotal = 0;
  let beadTotal = 0;
  let selected = null;
  let hovered = null;
  let detailF = 1; // view-driven dot scale (TOP 1 → NEAR 0.35)
  let levelName = 'network'; // progressive-disclosure level (owns TOP nominal ghosting)
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
        linewidth: health === 'nominal' ? 2 : 3, // alarm pipes carry visual weight at TOP
        dashed: run.buried,
        dashSize: 0.4,
        gapSize: 0.3,
        transparent: true,
        opacity: (health === 'nominal' ? 0.34 : 1) * (run.buried ? 0.55 : 1),
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

    /* Soft comet flow: radial-gradient sprites ride the draped pipe path.
     * No dashes anywhere in the flow layer — each pulse's alpha tapers to 0
     * at both ends of its life (fade in over the first ~18%, out over the
     * last ~45%), so there are never hard tips. Additive blending keeps the
     * cyan whisper-thin over bright contours at TOP. */
    const flowPts = trace.flow;
    const flowCum = [0];
    for (let i = 3; i < flowPts.length; i += 3) {
      flowCum.push(flowCum[flowCum.length - 1] + Math.hypot(
        flowPts[i] - flowPts[i - 3], flowPts[i + 1] - flowPts[i - 2], flowPts[i + 2] - flowPts[i - 1]));
    }
    const flowLen = flowCum[flowCum.length - 1] || 1;
    const flowAt = (t, out) => {
      const d = ((t % 1) + 1) % 1 * flowLen;
      let lo = 0, hi = flowCum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (flowCum[mid] < d) lo = mid + 1; else hi = mid;
      }
      const i1 = Math.max(1, lo), i0 = i1 - 1;
      const seg = flowCum[i1] - flowCum[i0] || 1;
      const f = Math.min(Math.max((d - flowCum[i0]) / seg, 0), 1);
      out.set(
        flowPts[i0 * 3] + (flowPts[i1 * 3] - flowPts[i0 * 3]) * f,
        flowPts[i0 * 3 + 1] + (flowPts[i1 * 3 + 1] - flowPts[i0 * 3 + 1]) * f + 0.03,
        flowPts[i0 * 3 + 2] + (flowPts[i1 * 3 + 2] - flowPts[i0 * 3 + 2]) * f);
      return out;
    };
    const entry = { assetId: pipe.assetId, sprites: [], cum: flowCum, len: flowLen, at: flowAt, tmp: new THREE.Vector3(), lvl: 1, boost: 1 };
    for (let k = 0; k < PULSES_PER_PIPE; k++) {
      const mat = new THREE.SpriteMaterial({
        map: getPulseTexture(),
        color: FLOW_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.setScalar(0.55);
      sp.frustumCulled = false;
      group.add(sp);
      entry.sprites.push({ sp, mat, off: k / PULSES_PER_PIPE });
    }
    pulses.push(entry);

    // Dive markers: steel octahedrons at the two points where the run
    // leaves the surface — the explicit "pipeline goes underground HERE".
    for (const t0 of [BURIED_EDGE_T, 1 - BURIED_EDGE_T]) {
      const dp = polyPoint(pipe.points, t0);
      const dq = polyPoint(pipe.points, Math.min(t0 + 0.01, 1));
      const dm = new THREE.MeshBasicMaterial({
        color: DIVE_COL, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const dive = new THREE.Mesh(diveGeo, dm);
      dive.position.set(dp.x, Math.max(DOT_Y + 0.1, field(dp.x, dp.z) * VEX + 0.1), dp.z);
      dive.scale.setScalar(0.8);
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
      const bSurf = field(bead.position.x, bead.position.z) * VEX + 0.07;
      bead.position.y = Math.max(DOT_Y + 0.04, bSurf) * (1 - bd) + bSurf * bd;
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

  /* --- facilities: invisible pick boxes only. The visible facility boxes
   * live in structures.js (single box layer) — drawing wire boxes here too
   * rendered every facility twice. Proxies sit on the terrain surface. --- */
  for (const fac of layout.facilities) {
    const [w, h, d] = fac.size;
    const [fx, fz] = fac.position;
    const gy = field(fx, fz) * VEX;
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.5, h + 0.5, d + 0.5),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.set(fx, gy + h / 2 + 0.02, fz);
    proxy.userData.assetId = fac.assetId;
    proxy.userData.kind = 'facility';
    group.add(proxy);
    proxies.push(proxy);
  }

  /* --- sensors: small diamonds + invisible pick spheres --- */
  const diamondGeo = new THREE.OctahedronGeometry(0.07); // restrained: blips whisper
  for (const sen of layout.sensors) {
    const health = healthById.get(sen.assetId)?.health ?? 'nominal';
    const mesh = new THREE.Mesh(
      diamondGeo,
      new THREE.MeshBasicMaterial({ color: colorFor(health) }),
    );
    mesh.position.set(sen.position[0], field(sen.position[0], sen.position[1]) * VEX + 0.16, sen.position[1]);
    mesh.userData.assetId = sen.assetId;
    group.add(mesh);
    track(sen.assetId, mesh.material, health === 'nominal' ? 0.55 : 0.9);
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
      // Progressive disclosure: level dimming lives HERE (not in setDetail)
      // because this runs last and would otherwise wipe it. At TOP nominal
      // assets recede so faults/alarms lead; drilled-in levels even out.
      const h = healthById.get(id)?.health;
      const lvl = levelName === 'network' && h === 'nominal' ? 0.55 : 1;
      const f = (levelName === 'asset' ? 0.12 : levelName === 'segment' ? 0.6 : 1) * lvl;
      for (const { m, base } of entry.mats) {
        if (m.isPointsMaterial || m.isLineMaterial) m.opacity = (dimmed ? base * DIM_FACTOR : base) * f;
        else m.opacity = dimmed ? base * DIM_FACTOR : base * lvl;
      }
      // Hovered boxes/diamonds swell slightly so the click target is obvious.
      const hs = hovered === id && selected !== id ? 1.15 : 1;
      for (const n of entry.nodes) n.scale.setScalar(hs);
    }
    // NEAR fault-bead whisper lives here (not setDetail) so hover/selection
    // passes can't wipe it: at NEAR the kit owns the fault.
    if (levelName === 'asset') {
      for (const b of beadMats) {
        if (b.assetId !== selected) b.m.opacity = 0.2;
      }
    }
    showRings(selected);
  };

  // Comet pulses ride the arc: phase advances with scene time, alpha
  // follows a fade-in/out envelope (tapered head-to-tail, zero at both
  // ends) so pulses breathe in and out with no hard tips. Accepts
  // absolute scene time.
  const tickFlow = (t = 0) => {
    for (const e of pulses) {
      const dim = selected && selected !== e.assetId ? DIM_FACTOR : 1;
      const lvl = e.assetId === selected ? 1 : e.lvl ?? 1;
      for (const s of e.sprites) {
        const phase = ((t * PULSE_SPEED) / e.len + s.off) % 1;
        const env = smooth01(phase / 0.18) * (1 - smooth01((phase - 0.55) / 0.45));
        e.at(phase, e.tmp);
        s.sp.position.copy(e.tmp);
        s.mat.opacity = PULSE_OPACITY * env * lvl * dim * e.boost;
      }
    }
    // Dive markers hold station on the arc (pulses carry direction).
    for (const c of chevrons) {
      const tt = c.dive ? c.t0 : (c.t0 + t * PULSE_SPEED * 0.02) % 1;
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
    // Flow legibility: pulses grow + brighten at TOP (the earlier TOP failure
    // was CONTRAST — thin cyan washing out over blown contour blobs), shrink
    // to a whisper drilled-in. No dashes anywhere in the flow layer.
    setDetail(name) {
      levelName = name;
      detailF = name === 'asset' ? 0.25 : name === 'segment' ? 0.7 : 1;
      for (const e of pulses) {
        e.lvl = e.assetId === selected ? 1 : name === 'asset' ? 0.12 : name === 'segment' ? 0.6 : 1;
        e.boost = name === 'network' ? 1.5 : 1; // TOP legibility peak ≈0.9, still under alarm bloom
        const s = (name === 'network' ? 1.8 : name === 'segment' ? 0.7 : 0.45);
        for (const p of e.sprites) p.sp.scale.setScalar(0.55 * s);
      }
      for (const c of chevrons) c.detailF = name === 'asset' ? 0.12 : name === 'segment' ? 0.6 : 1;
      applySelection(); // owns ALL byId opacity (level + selection + NEAR beads)
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
