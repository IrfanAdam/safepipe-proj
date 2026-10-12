// src/ring2/facilities/flare.js — T1 flare builder (S6).
// Single 107 m SD2 HP/LP stack (derived) + KO drum within 100 m +
// safety-clearance ring cue. Replaces the schematic FLARE block
// (parent retires schematic; no overlay edits here).
// Base y=0; parent wires siting/grounding. [board:F5, F6, §Reconciled T2]
import * as THREE from 'three';
import { FLARE, TIER } from './dims.js';

const stackMat = () => new THREE.MeshStandardMaterial({ color: 0x8f959a, roughness: 0.6, metalness: 0.4 }); // galvanized steel [board:S6]
const tipMat = () => new THREE.MeshStandardMaterial({ color: 0x3c4043, roughness: 0.7, metalness: 0.3 }); // burner tip [board:S6]
const drumMat = () => new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.6, metalness: 0.35 }); // KO drum [board:S6]
const clearMat = () => new THREE.MeshBasicMaterial({ color: 0xc7a23a, transparent: true, opacity: 0.28, side: THREE.DoubleSide }); // sterile-ring cue [approx]

const tag = (mesh, tier, kind) => { mesh.userData.tier = tier; mesh.userData.kind = kind; return mesh; };

/** Tapered flare stack + burner tip. Height derived 107 m [board:F5]. */
export function makeFlareStack() {
  const g = new THREE.Group();
  const stack = tag(new THREE.Mesh(new THREE.CylinderGeometry(FLARE.tipDia / 2, FLARE.baseDia / 2, FLARE.stackH, 16), stackMat()), FLARE.tierHeight, 'flare-stack');
  stack.position.y = FLARE.stackH / 2;
  g.add(stack);
  const tip = tag(new THREE.Mesh(new THREE.CylinderGeometry(FLARE.tipDia / 2 + 0.4, FLARE.tipDia / 2 + 0.4, 3, 12), tipMat()), FLARE.tierRest, 'flare-tip');
  tip.position.y = FLARE.stackH + 1;
  g.add(tip);
  const base = tag(new THREE.Mesh(new THREE.CylinderGeometry(FLARE.baseDia / 2 + 1.5, FLARE.baseDia / 2 + 2, 3, 16), stackMat()), FLARE.tierRest, 'flare-base');
  base.position.y = 1.5;
  g.add(base);
  return g;
}

/** Horizontal KO drum on saddles, sited koDist from the stack (≤100 m). */
export function makeKODrum() {
  const g = new THREE.Group();
  const capLen = Math.max(1, FLARE.koLen - FLARE.koDia);
  const drum = tag(new THREE.Mesh(new THREE.CapsuleGeometry(FLARE.koDia / 2, capLen, 6, 14), drumMat()), FLARE.tierRest, 'flare-ko');
  drum.rotation.z = Math.PI / 2;
  drum.position.y = FLARE.koDia / 2 + 1;
  g.add(drum);
  const saddleGeo = new THREE.BoxGeometry(1, 1, FLARE.koDia * 1.2);
  for (const sx of [-capLen / 4, capLen / 4]) {
    const s = tag(new THREE.Mesh(saddleGeo, tipMat()), FLARE.tierRest, 'flare-ko-saddle');
    s.position.set(sx, 0.5, 0);
    g.add(s);
  }
  return g;
}

/** T1 flare: stack + KO drum + sterile-clearance ring at the T1 anchor. */
export function buildFlare() {
  const g = new THREE.Group();
  g.name = 'T1-flare';
  const stack = makeFlareStack();
  stack.position.set(FLARE.anchor.x, 0, FLARE.anchor.z);
  stack.userData.tierPlacement = FLARE.tierPlacement;
  g.add(stack);
  const ko = makeKODrum();
  ko.position.set(FLARE.anchor.x + FLARE.koDist, 0, FLARE.anchor.z);
  ko.userData.tierPlacement = FLARE.tierPlacement;
  g.add(ko);
  const ring = tag(new THREE.Mesh(new THREE.RingGeometry(FLARE.clearanceR - 2, FLARE.clearanceR, 96), clearMat()), TIER.APPROXIMATED, 'flare-clearance');
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(FLARE.anchor.x, 0.15, FLARE.anchor.z);
  ring.userData.tierPlacement = FLARE.tierPlacement;
  g.add(ring);
  return g;
}
