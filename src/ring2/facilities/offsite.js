// src/ring2/facilities/offsite.js — off-terminal structures (Phase 02 Task 12, backdrops lane).
// Naval terminal massing S + quarry pits + M2 corridor ribbon. All LOW
// detail by design — distant context, never focus-pullers (no tall stacks,
// no emissive, muted haze palette). Base y=0; parent wires siting/grounding.
// Positions from the F1 OSM sweep (military ×3, quarry ×2, M2 ref ways);
// exact offsite fixes unverified, so every stamp is approximated.
// [board:§Gaps-6 (naval terminal ~10.4 km S, quarries 9–12 km, M2 east)]
import * as THREE from 'three';
import { TIER } from './dims.js';

const tag = (mesh, tier, kind) => { mesh.userData.tier = tier; mesh.userData.kind = kind; return mesh; };

/* Naval sea terminal: true bearing ~10.4 km S of pin (hypot(1500,10300)
 * ≈ 10.41 km), at the ring edge. Three sheds + one pier finger. */
export const NAVAL = Object.freeze({
  x: 1500,
  z: 10300,
  sheds: 3,
  shedW: 60,
  shedD: 20,
  shedH: 8,
  shedGap: 90,
  pierL: 220, // finger east toward the water
  pierW: 14,
  tier: TIER.APPROXIMATED,
});
export const navalDistKm = () => Math.hypot(NAVAL.x, NAVAL.z) / 1000;

/* Quarry pits: two OSM landuse=quarry ways, approximated at 9–12 km. */
export const QUARRIES = Object.freeze({
  tier: TIER.APPROXIMATED,
  items: Object.freeze([
    { x: -7500, z: -6500, r: 180, depth: 25 }, // ≈9.9 km NW
    { x: 9000, z: 6500, r: 140, depth: 20 }, // ≈11.1 km E
  ]),
});
export const quarryDistKm = (q) => Math.hypot(q.x, q.z) / 1000;

/* M2 corridor: Baku–Alat motorway on its REAL OSM trace (was a straight
 * N–S strip at x=6200 that crossed the sea — wrong side, wrong shape).
 * 25 thinned waypoints, SW→NE, derived from F1 motorway/ref=M2 ways,
 * clipped to the 10 km ring. Ribbon follows the polyline; each leg is
 * separately DEM-grounded by the parent. Tier: derived (route). */
export const M2 = Object.freeze({
  trace: Object.freeze([
    [-3647, 8633], [-2862, 6989], [-2408, 6105], [-1996, 5236], [-1717, 4849],
    [-1551, 4614], [-1583, 4312], [-1141, 3724], [-741, 2988], [-438, 2487],
    [-261, 2295], [259, 2011], [773, 1717], [1432, 1294], [2654, 465],
    [3331, 10], [3855, -287], [4173, -485], [5438, -1189], [5951, -1524],
    [6673, -1954], [7011, -2258], [7439, -2688], [7716, -2941], [8708, -3584],
  ]), // [x, z] SW→NE, thinned F1 M2 ways, in-ring
  width: 24, // carriageway cue
  tier: TIER.DERIVED,
});
export const m2LengthM = () => {
  let L = 0;
  for (let i = 1; i < M2.trace.length; i++) {
    L += Math.hypot(M2.trace[i][0] - M2.trace[i - 1][0], M2.trace[i][1] - M2.trace[i - 1][1]);
  }
  return L;
};

const hazeMat = () => new THREE.MeshBasicMaterial({ color: 0x8a939a, side: THREE.DoubleSide }); // distant massing haze [approx]
const pitMat = () => new THREE.MeshBasicMaterial({ color: 0x6f6a5e, side: THREE.DoubleSide }); // quarry wall cue [approx]
const pitFloorMat = () => new THREE.MeshBasicMaterial({ color: 0x5c584c, side: THREE.DoubleSide }); // pit floor cue [approx]
const roadMat = () => new THREE.MeshBasicMaterial({ color: 0x6e6e6e, side: THREE.DoubleSide }); // motorway ribbon cue [approx]

function buildNaval() {
  const g = new THREE.Group();
  g.name = 'BD-naval';
  g.userData.tierPlacement = NAVAL.tier;
  for (let i = 0; i < NAVAL.sheds; i++) {
    const s = tag(new THREE.Mesh(new THREE.BoxGeometry(NAVAL.shedW, NAVAL.shedH, NAVAL.shedD), hazeMat()), NAVAL.tier, 'naval-shed');
    s.position.set(NAVAL.x + (i - (NAVAL.sheds - 1) / 2) * NAVAL.shedGap, NAVAL.shedH / 2, NAVAL.z);
    g.add(s);
  }
  const pier = tag(new THREE.Mesh(new THREE.BoxGeometry(NAVAL.pierL, 2, NAVAL.pierW), hazeMat()), NAVAL.tier, 'naval-pier');
  pier.position.set(NAVAL.x + NAVAL.pierL / 2, 1, NAVAL.z + 80);
  g.add(pier);
  return g;
}

function buildQuarries() {
  const g = new THREE.Group();
  g.name = 'BD-quarries';
  g.userData.tierPlacement = QUARRIES.tier;
  for (const q of QUARRIES.items) {
    const pit = new THREE.Group();
    const wall = tag(
      new THREE.Mesh(new THREE.CylinderGeometry(q.r, q.r * 0.35, q.depth, 24, 1, true), pitMat()),
      QUARRIES.tier,
      'quarry-pit',
    );
    wall.position.set(q.x, 0, q.z);
    pit.add(wall);
    const floor = tag(new THREE.Mesh(new THREE.CircleGeometry(q.r * 0.35, 24), pitFloorMat()), QUARRIES.tier, 'quarry-floor');
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(q.x, -q.depth / 2 + 1, q.z);
    pit.add(floor);
    pit.userData.tierPlacement = QUARRIES.tier;
    g.add(pit);
  }
  return g;
}

function buildM2() {
  const g = new THREE.Group();
  g.name = 'BD-m2';
  g.userData.tierPlacement = M2.tier;
  for (let i = 1; i < M2.trace.length; i++) {
    const [x0, z0] = M2.trace[i - 1];
    const [x1, z1] = M2.trace[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const s = tag(new THREE.Mesh(new THREE.PlaneGeometry(M2.width, len), roadMat()), M2.tier, 'm2-ribbon');
    s.rotation.x = -Math.PI / 2;
    s.rotation.z = Math.atan2(x1 - x0, z1 - z0);
    s.position.set((x0 + x1) / 2, 0.25, (z0 + z1) / 2);
    g.add(s);
  }
  return g;
}

/** Offsite backdrops: naval massing + quarry pits + M2 ribbon. */
export function buildOffsite() {
  const g = new THREE.Group();
  g.name = 'BD-offsite';
  g.add(buildNaval());
  g.add(buildQuarries());
  g.add(buildM2());
  return g;
}
