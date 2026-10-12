// src/ring2/facilities/coast.js — Caspian shoreline treatment (Phase 02 Task 12, backdrops lane).
// Waterline band + Sangachal bay curve inside the 10 km ring. Cues ONLY:
// the render datum (-24 m key, overlays.js) and the audited -24 crossing
// (x≈+3276 on the site parallel, ring2-fallback-shore test) own the true
// shoreline; these are flat bands the parent grounds onto the live DEM.
// Bay shape honors the OSM wiggle at pin lat (49.523285 / 49.526771 /
// 49.526791 → x≈3570/3869/3871). Base y=0; parent wires siting/grounding.
// [board:§Gaps-6; F1 OSM sweep]
import * as THREE from 'three';
import { TIER } from './dims.js';

const tag = (mesh, tier, kind) => { mesh.userData.tier = tier; mesh.userData.kind = kind; return mesh; };

/* Shore curve: baseX ≈ audited -24 crossing (+3276); bay bump peaks at the
 * pin parallel (+550 → 3850 ≈ OSM far hit 3871, within 1%). Shape cue. */
export const SHORE = Object.freeze({
  baseX: 3300,
  bayAmp: 550,
  bayZ: 0,
  baySigma: 2600,
  zFrom: -3000, // in-ring coast span (vectors asset z -3007..9782)
  zTo: 9700,
  waterReach: 500, // water band extends this far east of the waterline
  waterOverlap: 10, // west overlap so no gap against the sand band
  sandW: 80, // wet-sand band reaches this far west of the waterline
  segs: 14,
  tierShape: TIER.APPROXIMATED,
  tierDatum: TIER.DERIVED, // waterline y pins the audited -24 m datum
});

/** Waterline world-x at world-z (Sangachal bay curve, metres). */
export const shoreXAt = (z) =>
  SHORE.baseX + SHORE.bayAmp * Math.exp(-(((z - SHORE.bayZ) ** 2) / (2 * SHORE.baySigma ** 2)));

/** Analytic bay slope dx/dz at z (for segment yaw). */
export const shoreSlopeAt = (z) =>
  (-(z - SHORE.bayZ) / SHORE.baySigma ** 2) * (shoreXAt(z) - SHORE.baseX);

/** Frame for shoreline segment i: band centres + yaw. Pure math. */
export function coastSegFrame(i) {
  const segLen = (SHORE.zTo - SHORE.zFrom) / SHORE.segs;
  const z0 = SHORE.zFrom + i * segLen;
  const zmid = z0 + segLen / 2;
  const x = shoreXAt(zmid);
  return {
    zmid,
    segLen,
    waterX: x + SHORE.waterReach / 2 - SHORE.waterOverlap / 2,
    waterW: SHORE.waterReach,
    sandX: x - SHORE.sandW / 2,
    sandW: SHORE.sandW,
    rotY: Math.atan(shoreSlopeAt(zmid)),
  };
}

const waterMat = () => new THREE.MeshBasicMaterial({ color: 0x3f6474, transparent: true, opacity: 0.55, side: THREE.DoubleSide }); // Caspian haze cue [approx]
const sandMat = () => new THREE.MeshBasicMaterial({ color: 0xa89e86, transparent: true, opacity: 0.8, side: THREE.DoubleSide }); // wet-sand cue [approx]

/** Shoreline treatment: per-segment water + sand bands along the bay curve. */
export function buildCoast() {
  const g = new THREE.Group();
  g.name = 'BD-coast';
  g.userData.tierPlacement = SHORE.tierShape;
  for (let i = 0; i < SHORE.segs; i++) {
    const f = coastSegFrame(i);
    const seg = new THREE.Group();
    const water = tag(new THREE.Mesh(new THREE.PlaneGeometry(f.waterW, f.segLen), waterMat()), SHORE.tierDatum, 'shore-water');
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = f.rotY;
    water.position.set(f.waterX, 0.2, f.zmid);
    seg.add(water);
    const sand = tag(new THREE.Mesh(new THREE.PlaneGeometry(f.sandW, f.segLen), sandMat()), SHORE.tierShape, 'shore-sand');
    sand.rotation.x = -Math.PI / 2;
    sand.rotation.z = f.rotY;
    sand.position.set(f.sandX, 0.3, f.zmid);
    seg.add(sand);
    g.add(seg);
  }
  return g;
}
