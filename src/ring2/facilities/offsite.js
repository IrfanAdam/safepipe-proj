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

/* M2 corridor: Baku–Alat motorway ribbon east of site, N–S cue strip. */
export const M2 = Object.freeze({
  x: 6200,
  zFrom: -8000,
  zTo: 8000,
  width: 34, // carriageway + verge cue
  segs: 8,
  tier: TIER.APPROXIMATED,
});
export const m2LengthM = () => M2.zTo - M2.zFrom;

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
  const segLen = (M2.zTo - M2.zFrom) / M2.segs;
  for (let i = 0; i < M2.segs; i++) {
    const s = tag(new THREE.Mesh(new THREE.PlaneGeometry(M2.width, segLen), roadMat()), M2.tier, 'm2-ribbon');
    s.rotation.x = -Math.PI / 2;
    s.position.set(M2.x, 0.25, M2.zFrom + i * segLen + segLen / 2);
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
