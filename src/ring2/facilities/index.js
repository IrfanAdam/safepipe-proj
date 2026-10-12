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

export { buildTanks } from './tanks.js';
export { buildTrains } from './trains.js';
export { buildRacks } from './racks.js';
export { buildHalls } from './halls.js';
export { buildFlare } from './flare.js';
export { buildAdmin } from './admin.js';
export { buildPerimeter } from './perimeter.js';
export * from './dims.js';

/** Assemble the full T0 structures group. Parent owns siting/grounding. */
export function buildT0() {
  const g = new THREE.Group();
  g.name = 'T0-structures';
  g.userData.phase = 'T0';
  g.add(buildTanks());
  g.add(buildTrains());
  g.add(buildRacks());
  return g;
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
  return g;
}
