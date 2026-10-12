// src/ring2/facilities/landform.js — hillock furniture on DEM highs (Phase 02 Task 12, backdrops lane).
// Scattered lotte/hillock furniture on the procedural highs: the northern
// hill mass (peak 230 m at (0,-5000), field.js) and the SW ridge shoulder,
// pulled inside the ring. Furniture only — caps at 25 m tall so nothing
// competes with the 107 m flare. Deterministic seeded spots (no RNG drift
// between loads). Base y=0; parent wires siting/grounding. All approximated.
// [board:§Gaps-6; field.js proceduralH N-hill + SW ridge]
import * as THREE from 'three';
import { TIER } from './dims.js';

const tag = (mesh, tier, kind) => { mesh.userData.tier = tier; mesh.userData.kind = kind; return mesh; };

export const HILL_N = Object.freeze({ cx: 0, cz: -5000, rMin: 1200, rMax: 2600, count: 9 });
export const HILL_SW = Object.freeze({ cx: -6500, cz: 6000, rMin: 400, rMax: 1000, count: 5 });
export const HILLOCK = Object.freeze({
  rMin: 60,
  rMax: 150,
  hMin: 8, // furniture cap: never a focus-puller vs the 107 m flare
  hMax: 25,
  outcrops: 3,
  outcropR: 8,
  tier: TIER.APPROXIMATED,
});
export const RING_M = 10000;

/** Deterministic PRNG (mulberry32) — stable spots across loads. */
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hillock spots for both clusters. Pure math: [{x, z, r, h, cluster}]. */
export function hillockSpots() {
  const spots = [];
  const clusters = [
    { c: HILL_N, name: 'N', seed: 1212 },
    { c: HILL_SW, name: 'SW', seed: 3434 },
  ];
  for (const { c, name, seed } of clusters) {
    const rnd = rng32(seed);
    for (let i = 0; i < c.count; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = c.rMin + rnd() * (c.rMax - c.rMin);
      spots.push({
        x: c.cx + Math.cos(a) * rr,
        z: c.cz + Math.sin(a) * rr,
        r: HILLOCK.rMin + rnd() * (HILLOCK.rMax - HILLOCK.rMin),
        h: HILLOCK.hMin + rnd() * (HILLOCK.hMax - HILLOCK.hMin),
        cluster: name,
      });
    }
  }
  return spots;
}

const scrubMat = () => new THREE.MeshStandardMaterial({ color: 0x7e7a66, roughness: 1 }); // hill-tone drape (was olive, read as blobs vs imagery) [approx]
const rockMat = () => new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.95, flatShading: true }); // outcrop [approx]

/** Hillock furniture: flattened domes on the DEM highs + rock outcrops. */
export function buildLandform() {
  const g = new THREE.Group();
  g.name = 'BD-landform';
  g.userData.tierPlacement = HILLOCK.tier;
  for (const s of hillockSpots()) {
    const dome = tag(
      new THREE.Mesh(new THREE.SphereGeometry(s.r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), scrubMat()),
      HILLOCK.tier,
      'hillock',
    );
    dome.scale.y = s.h / s.r;
    dome.position.set(s.x, 0, s.z);
    dome.userData.cluster = s.cluster;
    g.add(dome);
  }
  const rnd = rng32(5656);
  const spots = hillockSpots();
  for (let i = 0; i < HILLOCK.outcrops; i++) {
    const s = spots[Math.floor(rnd() * spots.length)];
    const rock = tag(new THREE.Mesh(new THREE.DodecahedronGeometry(HILLOCK.outcropR, 0), rockMat()), HILLOCK.tier, 'outcrop');
    rock.position.set(s.x + s.r * 0.7, HILLOCK.outcropR * 0.4, s.z);
    g.add(rock);
  }
  return g;
}
