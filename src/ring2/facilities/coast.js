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

/* Real-coast sand drape: the analytic bay curve only matched near z≈0 —
 * everywhere else the straight N–S column ran inland/in-sea (the sea
 * band). Replaced with quads straddling the REAL OSM waterline (installed
 * coastline layer, smoothed window-3, ~18 km in-ring). Tier: derived. */
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

const sandMat = () => new THREE.MeshBasicMaterial({ color: 0xa89e86, transparent: true, opacity: 0.8, side: THREE.DoubleSide }); // wet-sand cue [approx]

export const REAL_COAST = Object.freeze({
  pts: Object.freeze([
    [869, 9418], [163, 8423], [-395, 6818], [-567, 5021], [-575, 3807],
    [-203, 2922], [532, 2208], [1181, 1893], [1842, 1451], [2610, 759],
    [3165, 301], [3411, 158], [3486, 146], [3501, 146], [3538, 61],
    [3716, -83], [3946, -165], [4043, -169], [4548, -321], [5766, -754],
    [6772, -1190], [7164, -1340], [7390, -1347], [7580, -1444], [7709, -1621],
    [7886, -1838], [8137, -2098], [8603, -2464], [9156, -2849],
  ]), // [x, z] S→N, smoothed installed waterline
  sandW: 80, // straddles the waterline — no land-side call needed
  tier: TIER.DERIVED,
});

/** Shoreline treatment: wet-sand quads straddling the real waterline. */
export function buildCoast() {
  const g = new THREE.Group();
  g.name = 'BD-coast';
  g.userData.tierPlacement = REAL_COAST.tier;
  for (let i = 1; i < REAL_COAST.pts.length; i++) {
    const [x0, z0] = REAL_COAST.pts[i - 1];
    const [x1, z1] = REAL_COAST.pts[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1) continue;
    const sand = tag(new THREE.Mesh(new THREE.PlaneGeometry(REAL_COAST.sandW, len), sandMat()), REAL_COAST.tier, 'shore-sand');
    sand.rotation.x = -Math.PI / 2;
    sand.rotation.z = Math.atan2(x1 - x0, z1 - z0);
    sand.position.set((x0 + x1) / 2, 0.3, (z0 + z1) / 2);
    g.add(sand);
  }
  return g;
}
