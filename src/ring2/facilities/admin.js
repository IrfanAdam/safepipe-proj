// src/ring2/facilities/admin.js — T1 admin/camp massing (T3, indicative).
// Permanent layout unknown: generic admin block + prefab camp rows,
// all stamped approximated (indicative). Replaces the schematic ADMIN
// block (parent retires schematic; no overlay edits here).
// Base y=0; parent wires siting/grounding. [board:§Gaps-3, §T1 candidates]
import * as THREE from 'three';
import { ADMIN_BLOCK, CAMP, campUnitCount, TIER } from './dims.js';

const blockMat = () => new THREE.MeshStandardMaterial({ color: 0xcfc9bb, roughness: 0.85 }); // pale admin block [indicative]
const bandMat = () => new THREE.MeshStandardMaterial({ color: 0x46525e, roughness: 0.6 }); // glazing band [indicative]
const campMat = () => new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: 0.9 }); // prefab cabins [indicative]
const canopyMat = () => new THREE.MeshStandardMaterial({ color: 0x7d8a84, roughness: 0.8 }); // canopy [indicative]

const tag = (mesh, kind) => { mesh.userData.tier = TIER.APPROXIMATED; mesh.userData.kind = kind; mesh.userData.indicative = true; return mesh; };

/** Two-storey admin block + glazing band + entrance canopy. */
export function makeAdminBlock() {
  const g = new THREE.Group();
  const block = tag(new THREE.Mesh(new THREE.BoxGeometry(ADMIN_BLOCK.w, ADMIN_BLOCK.h, ADMIN_BLOCK.d), blockMat()), 'admin-block');
  block.position.y = ADMIN_BLOCK.h / 2;
  g.add(block);
  const band = tag(new THREE.Mesh(new THREE.BoxGeometry(ADMIN_BLOCK.w * 0.96, 2.2, ADMIN_BLOCK.d + 0.3), bandMat()), 'admin-glazing');
  band.position.y = ADMIN_BLOCK.h * 0.68;
  g.add(band);
  const canopy = tag(new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 8), canopyMat()), 'admin-canopy');
  canopy.position.set(0, 4.5, ADMIN_BLOCK.d / 2 + 4);
  g.add(canopy);
  return g;
}

/** One prefab camp cabin. */
export function makeCampUnit() {
  const g = new THREE.Group();
  const unit = tag(new THREE.Mesh(new THREE.BoxGeometry(CAMP.unitW, CAMP.unitH, CAMP.unitD), campMat()), 'camp-unit');
  unit.position.y = CAMP.unitH / 2 + 0.4;
  g.add(unit);
  const skirt = tag(new THREE.Mesh(new THREE.BoxGeometry(CAMP.unitW, 0.4, CAMP.unitD), canopyMat()), 'camp-skirt');
  skirt.position.y = 0.2;
  g.add(skirt);
  return g;
}

/** T1 admin: block at the old schematic seat + camp rows on the east row. */
export function buildAdmin() {
  const g = new THREE.Group();
  g.name = 'T1-admin';
  const block = makeAdminBlock();
  block.position.set(ADMIN_BLOCK.anchor.x, 0, ADMIN_BLOCK.anchor.z);
  g.add(block);
  for (let r = 0; r < CAMP.rows; r++) {
    for (let i = 0; i < CAMP.perRow; i++) {
      const u = makeCampUnit();
      u.position.set(
        CAMP.anchor.x + i * CAMP.spacingX,
        0,
        CAMP.anchor.z + r * (CAMP.unitD + CAMP.spacingZ),
      );
      g.add(u);
    }
  }
  g.userData.unitCount = campUnitCount();
  return g;
}
