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
import { field, VEX } from './terrain.js'; // beads ride the terrain skin, never flat datum

const FLOW_COLOR = { nominal: 0x8f9797, watch: 0xff8c39, critical: 0xff2a2a };
const BEAD_SIZE = 0.05; // small + dim: furniture, never glow-compete with faults
const BEAD_Y = 0.09;
const skinY = (x, z, lift) => Math.max(lift, field(x, z) * VEX + lift);
const PILLAR_H = 0.3;

/* True polyline length in km — bead position = chainage / trueLength. */
function trueLen(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total || 1;
}

let glowTex = null;
function getGlowTexture() {
  if (glowTex) return glowTex;
  const s = 128; // 128px soft dot — 64px rasterized into squares on zoom-in
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
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
  let hovered = null; // hover-only status halo: green safe / red alert, subtle
  const HOVER_COL = { nominal: 0x36d65c, watch: 0xff8c39, critical: 0xff2a1a };
  let haloBase = 1; // per-asset halo scale (pipes 1, pads 0.5, sensors 0.35)
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
          const bx = x0 + (x1 - x0) * f, bz = z0 + (z1 - z0) * f;
          dense.push(new THREE.Vector3(bx, skinY(bx, bz, BEAD_Y), bz));
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
        map: getGlowTexture(), transparent: true, opacity: health === 'nominal' ? 0.22 : 0.4,
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
  const coreGeo = new THREE.SphereGeometry(0.025, 10, 8);
  const ringGeo = new THREE.RingGeometry(0.12, 0.18, 40);
  // Fault-site pipe kit (shared): holographic pipe segment that materializes
  // at each fault — wireframe wall + weld rings, red patch rings at center.
  const kitBodyGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 12, 6, true);
  const kitRingGeo = new THREE.TorusGeometry(0.06, 0.005, 6, 20);
  const kitBodyMat = new THREE.MeshBasicMaterial({ color: 0x9aa4a8, wireframe: true, transparent: true, opacity: 0.5 });
  const kitWeldMat = new THREE.MeshBasicMaterial({ color: 0xcfd6d8, wireframe: true, transparent: true, opacity: 0.7 });
  // Conforming wall-loss band: partial cylinder hugging the pipe surface.
  const kitBandGeo = new THREE.CylinderGeometry(0.063, 0.063, 0.24, 12, 1, true, 0, 2.2);
  // Fault zone fill: the ref reads DANGER as a glowing area, not a pin —
  // warm orange disc + rim at each fault, TOP/ISO only (a 1.2 km disc
  // would fill the NEAR frame). Cool terrain vs warm zone wins by hue.
  const zoneGeo = new THREE.CircleGeometry(0.6, 48);
  const zoneRimGeo = new THREE.RingGeometry(0.6, 0.64, 48);
  // Fault grounding shadow: dark ellipse under the kit so the spool reads
  // as mass on the skin, never floating in the red wash.
  const kitShadowGeo = new THREE.CircleGeometry(0.35, 24);
  // Static anchor ring (thin NEAR-only outline) + unit leader + white pin.
  const anchorGeo = new THREE.RingGeometry(0.09, 0.095, 40);
  const leaderGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const pinGeo = new THREE.SphereGeometry(0.012, 8, 6);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const UP_Y = new THREE.Vector3(0, 1, 0);
  function faultAnchor(assetId) {
    if (pipeById.has(assetId)) {
      const pts = pipeById.get(assetId).points;
      const item = healthById.get(assetId);
      const ch = item?.faults?.[0]?.chainage ?? trueLen(pts) / 2;
      return polyPoint(pts, ch / trueLen(pts));
    }
    if (facById.has(assetId)) { const [x, z] = facById.get(assetId).position; return new THREE.Vector3(x, 0.06, z); }
    if (senById.has(assetId)) { const [x, z] = senById.get(assetId).position; return new THREE.Vector3(x, 0.06, z); }
    return null;
  }
  function buildFaults() {
    for (const f of faults) {
      group.remove(f.pillar); if (f.core) group.remove(f.core);
      if (f.kit) group.remove(f.kit);
      if (f.anchor) group.remove(f.anchor);
      if (f.leader) group.remove(f.leader);
      if (f.pin) group.remove(f.pin);
      if (f.zone) { group.remove(f.zone); group.remove(f.zoneRim); }
      if (f.kitShadow) group.remove(f.kitShadow);
      group.remove(...f.rings.map((r) => r.mesh));
      f.mat.dispose(); f.coreMat?.dispose(); f.kitMats?.forEach((m) => m.dispose());
      for (const r of f.rings) { r.mesh.geometry.dispose(); r.mat.dispose(); }
    }
    faults = [];
    for (const [assetId, item] of healthById) {
      if (!item?.faults?.length) continue;
      for (const fault of item.faults) {
        let p = null;
        let tangent = null;
        if (pipeById.has(assetId)) {
          const pts = pipeById.get(assetId).points;
          const L = trueLen(pts);
          const ch = fault.chainage ?? 0;
          p = polyPoint(pts, ch / L);
          const pa = polyPoint(pts, Math.max(0, ch - 0.4) / L);
          const pb = polyPoint(pts, Math.min(L, ch + 0.4) / L);
          tangent = pb.clone().sub(pa).setY(0).normalize();
        } else p = faultAnchor(assetId);
        if (!p) continue;
        const col = sevColor(fault, item.health);
        const gy = field(p.x, p.z) * VEX; // fault kit ground-sits on the skin
        const mat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const pillar = new THREE.Mesh(pillarGeo, mat);
        pillar.position.set(p.x, gy + PILLAR_H / 2, p.z);
        group.add(pillar);
        // Holographic pipe segment at the fault: wireframe wall + 7 weld
        // rings, the middle 3 burning fault-red (corrosion patch).
        let kit = null;
        const kitMats = [];
        if (tangent && tangent.lengthSq() > 1e-8) {
          kit = new THREE.Group();
          const seg = new THREE.Group();
          seg.quaternion.setFromUnitVectors(UP_Y, tangent.normalize());
          seg.add(new THREE.Mesh(kitBodyGeo, kitBodyMat));
          const patchMat = new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.9 });
          kitMats.push(patchMat);
          for (let w = -3; w <= 3; w++) {
            const ring = new THREE.Mesh(kitRingGeo, (w >= -1 && w <= 1) ? patchMat : kitWeldMat);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = w * 0.1;
            seg.add(ring);
          }
          seg.add(new THREE.Mesh(kitBandGeo, patchMat));
          // Solid sleeve over the wireframe band: the damaged section reads
          // as mass, not mesh — opaque red against the white lattice.
          const sleeveMat = new THREE.MeshBasicMaterial({ color: col });
          kitMats.push(sleeveMat);
          seg.add(new THREE.Mesh(kitBandGeo, sleeveMat));
          kit.add(seg);
          kit.position.set(p.x, gy + 0.02, p.z);
          group.add(kit);
        }
        // Hot core floats above the fault on a leader line — holograms mark,
        // they don't bury. Tight anchor ring replaces the washers at NEAR.
        const coreMat = new THREE.MeshBasicMaterial({ color: col });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.set(p.x, gy + 0.22, p.z);
        group.add(core);
        const anchorMat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.25,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        kitMats.push(anchorMat);
        const anchor = new THREE.Mesh(anchorGeo, anchorMat);
        anchor.rotation.x = -Math.PI / 2;
        anchor.position.set(p.x, gy + 0.03, p.z);
        anchor.visible = false;
        group.add(anchor);
        const leader = new THREE.Line(leaderGeo, pinMat);
        leader.scale.y = 0.135;
        leader.position.set(p.x, gy + 0.085, p.z);
        group.add(leader);
        // White pin snaps the leader foot into the top of the sleeve.
        const pin = new THREE.Mesh(pinGeo, pinMat);
        pin.position.set(p.x, gy + 0.085, p.z);
        group.add(pin);
        // Zone fill: warm glowing disc + rim around the fault ground.
        // Rim-dominant: the boundary reads danger, the faint disc tints
        // without burying the facilities underneath.
        const zoneMat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.08,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        kitMats.push(zoneMat);
        const zone = new THREE.Mesh(zoneGeo, zoneMat);
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(p.x, gy + 0.015, p.z);
        group.add(zone);
        const zoneRimMat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.7,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        kitMats.push(zoneRimMat);
        const zoneRim = new THREE.Mesh(zoneRimGeo, zoneRimMat);
        zoneRim.rotation.x = -Math.PI / 2;
        zoneRim.position.set(p.x, gy + 0.015, p.z);
        group.add(zoneRim);
        const kitShadowMat = new THREE.MeshBasicMaterial({
          color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false,
        });
        kitMats.push(kitShadowMat);
        const kitShadow = new THREE.Mesh(kitShadowGeo, kitShadowMat);
        kitShadow.rotation.x = -Math.PI / 2;
        kitShadow.position.set(p.x, gy + 0.008, p.z);
        group.add(kitShadow);
        const rings = [0, 0.5].map((phase) => {
          const rm = new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(ringGeo, rm);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(p.x, gy + 0.03, p.z);
          group.add(mesh);
          return { mesh, mat: rm, phase };
        });
        faults.push({ assetId, pillar, mat, core, coreMat, kit, kitMats, anchor, leader, pin, zone, zoneRim, kitShadow, rings, baseOp: 0.45, crit: fault.severity === 'critical' });
      }
    }
  }

  /* --- (3) selection halo: single pulsing ring at the asset anchor --- */
  const haloGeo = new THREE.RingGeometry(0.22, 0.3, 48);
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
    // Halo scales to the asset: a 600 m disc drowns a 180 m pad.
    if (pipeById.has(selected)) { p = polyPoint(pipeById.get(selected).points, 0.5); haloBase = 1; }
    else { p = faultAnchor(selected); haloBase = facById.has(selected) ? 0.5 : 0.35; }
 halo.position.set(p.x, field(p.x, p.z) * VEX + 0.04, p.z);
    halo.material.color.set(0xbfefff);
    halo.visible = true;
  };
  /* Hover halo: status color only while the cursor rests on the entity —
   * green safe / red alert, never competing with the selection halo. */
  function anchorOf(id) {
    if (pipeById.has(id)) return { p: polyPoint(pipeById.get(id).points, 0.5), base: 1 };
    if (facById.has(id) || senById.has(id)) {
      return { p: faultAnchor(id), base: facById.has(id) ? 0.5 : 0.35 };
    }
    return null;
  }
  // Level-driven declutter: streaming beads are TOP context; at NEAR they
  // cluster into blobs around the camera — hide them, fault kit stays.
  function setDetail(name) {
    const show = name !== 'asset';
    for (const fl of flows) fl.beads.visible = show || fl.pipeId === selected;
    // Marker restraint per view: TOP gets the full stack; ISO keeps the
    // pillar + kit (rings would bloom into a blob at 9 km); NEAR swaps
    // cone + washers for the tight anchor ring.
    // The SELECTED fault keeps its full highlight at every level — drilling
    // in must never dim the thing you drilled into.
    const seg = name === 'segment';
    const near = name === 'asset';
    for (const f of faults) {
      const isSel = f.assetId === selected;
      f.pillar.visible = show || isSel;
      if (near) f.pillar.scale.setScalar(0.55); // NEAR: slim beacon, spool owns the frame
      else if (seg) f.pillar.scale.setScalar(0.7);
      else f.pillar.scale.setScalar(1);
      for (const r of f.rings) r.mesh.visible = (show && !seg) || isSel;
      if (f.anchor) f.anchor.visible = !show;
      // Zone fill owns TOP/ISO; at NEAR the disc would fill the frame and
      // swallow the spool — the kit + sleeve own the fault down there,
      // selected or not.
      if (f.zone) { f.zone.visible = !near && (show || isSel); f.zoneRim.visible = !near && (show || isSel); }
    }
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
        fl.mat.opacity = h === 'nominal' ? 0.22 : 0.4;
      }
      buildFaults();
      placeHalo();
    },
    setSelection(id) {
      selected = id ?? null;
      placeHalo();
    },
    setHover(id) {
      hovered = id ?? null;
      if (!halo) return;
      if (!hovered || hovered === selected) { placeHalo(); return; }
      const a = anchorOf(hovered);
      if (!a) { placeHalo(); return; }
      const h = healthById.get(hovered)?.health ?? 'nominal';
      haloBase = a.base;
      halo.position.set(a.p.x, field(a.p.x, a.p.z) * VEX + 0.04, a.p.z);
      halo.material.color.set(HOVER_COL[h] ?? HOVER_COL.nominal);
      halo.visible = true;
    },
    setDetail,
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
          fl.pos[b * 3 + 1] = a.y + (c.y - a.y) * f;
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
          const sc = 1 + s * 0.6;
          r.mesh.scale.setScalar(sc);
          r.mat.opacity = (1 - s) * (isSel ? 0.95 : 0.65);
        }
      }
      if (halo?.visible) {
        const s = haloBase * (1 + 0.12 * Math.sin(t * 3));
        halo.scale.setScalar(s);
        const hot = hovered && hovered !== selected;
        halo.material.opacity = hot ? 0.3 : 0.45 + 0.2 * Math.sin(t * 3);
      }
    },
    dispose() {
      scene.remove(group);
      for (const fl of flows) { fl.beads.geometry.dispose(); fl.mat.dispose(); }
      for (const f of faults) { f.mat.dispose(); for (const r of f.rings) r.mat.dispose(); }
      pillarGeo.dispose(); coreGeo.dispose(); ringGeo.dispose(); kitShadowGeo.dispose(); haloGeo.dispose(); halo?.material.dispose();
      flows.length = 0; faults = [];
    },
  };
}
