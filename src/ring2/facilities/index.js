// src/ring2/facilities/index.js — T0 structures entry (Phase 02 T0, structures lane).
// buildT0() returns one THREE.Group: tanks + trains + racks in the board
// world frame (+x east, +z south of pin, metres, base y=0).
// Wiring into main.js/overlays/boot is the parent's job — no imports here
// reach outside facilities/ + site.js. [board:§T0/T1 cut list]
import * as THREE from 'three';
import { buildTanks } from './tanks.js';
import { buildTrains } from './trains.js';
import { buildRacks } from './racks.js';
import { buildHalls } from './halls.js';
import { buildFlare } from './flare.js';
import { buildAdmin } from './admin.js';
import { buildPerimeter } from './perimeter.js';
import { buildCoast } from './coast.js';
import { buildOffsite } from './offsite.js';
import { buildLandform } from './landform.js';
import { gateSatOnly } from './satgate.js';

export { buildTanks } from './tanks.js';
export { buildTrains } from './trains.js';
export { buildRacks } from './racks.js';
export { buildHalls } from './halls.js';
export { buildFlare } from './flare.js';
export { buildAdmin } from './admin.js';
export { buildPerimeter } from './perimeter.js';
export { buildCoast, SHORE, shoreXAt, shoreSlopeAt, coastSegFrame } from './coast.js';
export { buildOffsite, NAVAL, navalDistKm, QUARRIES, quarryDistKm, M2, m2LengthM } from './offsite.js';
export { buildLandform, HILL_N, HILL_SW, HILLOCK, hillockSpots } from './landform.js';
export * from './dims.js';
export { gateSatOnly, ungateSatOnly, applySatGate, resolveSatOnly, suspendSatGate, satGateCount } from './satgate.js';

/** Assemble the full T0 structures group. Parent owns siting/grounding. */
export function buildT0() {
  const g = new THREE.Group();
  g.name = 'T0-structures';
  g.userData.phase = 'T0';
  g.add(buildTanks());
  g.add(buildTrains());
  g.add(buildRacks());
  // Pure-satellite endpoint gate (mix 0 hides; 1..100 untouched). Materials,
  // dims, and tier stamps above are unchanged. [satgate.js]
  return gateSatOnly(g);
}

/** Assemble the additive T1 structures group (T0 untouched). Parent owns
 * siting/grounding and retires the schematic ADMIN/FLARE blocks. */
export function buildT1() {
  const g = new THREE.Group();
  g.name = 'T1-structures';
  g.userData.phase = 'T1';
  g.add(buildHalls());
  g.add(buildFlare());
  g.add(buildAdmin());
  g.add(buildPerimeter());
  // Pure-satellite endpoint gate (mix 0 hides; 1..100 untouched). [satgate.js]
  return gateSatOnly(g);
}

/** Assemble the additive backdrops group (T0/T1 untouched): shoreline
 * treatment + off-terminal structures + hillock furniture. Parent owns
 * siting/grounding; no main.js/overlays/boot edits here. */
export function buildBackdrops() {
  const g = new THREE.Group();
  g.name = 'BD-backdrops';
  g.userData.phase = 'BD';
  g.add(buildCoast());
  g.add(buildOffsite());
  g.add(buildLandform());
  // Pure-satellite endpoint gate (mix 0 hides; 1..100 untouched). [satgate.js]
  return gateSatOnly(g);
}
