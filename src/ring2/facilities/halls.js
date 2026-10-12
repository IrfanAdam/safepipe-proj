// src/ring2/facilities/halls.js — T1 hall builders (S5).
// Pump/compressor hall boxes on F1 candidate seeds + 7 turbine exhaust
// stacks. Footprints derived (measured); FUNCTIONS approximated until
// confirmed — every mesh carries tier + tierFunction stamps.
// Base y=0; parent wires siting/grounding. [board:§T1 candidates, S5]
import * as THREE from 'three';
import { geoToWorld } from '../site.js';
import { HALLS, TURBINE_STACK, turbineStacksPerHall, TIER } from './dims.js';

const wallMat = () => new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.85, metalness: 0.15 }); // sand cladding cue [board:S5]
const roofMat = () => new THREE.MeshStandardMaterial({ color: 0x7e8891, roughness: 0.7, metalness: 0.3 }); // gray roof [board:S5]
const stackMat = () => new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.55, metalness: 0.45 }); // exhaust steel [board:S5]
const doorMat = () => new THREE.MeshStandardMaterial({ color: 0x4c565e, roughness: 0.8 }); // door/louver band [board:S5]

const tag = (mesh, tier, kind, tierFunction) => {
  mesh.userData.tier = tier;
  mesh.userData.kind = kind;
  if (tierFunction) mesh.userData.tierFunction = tierFunction;
  return mesh;
};

/** Hall box: walls + shallow gable roof slab + door band. Footprint derived, function approx. */
export function makeHallBox(w, d, { wallH = HALLS.wallH, rise = HALLS.roofRise } = {}) {
  const g = new THREE.Group();
  const walls = tag(new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat()), HALLS.tierFootprint, 'hall-walls', HALLS.tierFunction);
  walls.position.y = wallH / 2;
  g.add(walls);
  const roof = tag(new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.6, d + 2), roofMat()), TIER.RECONSTRUCTED, 'hall-roof', HALLS.tierFunction);
  roof.position.y = wallH + rise / 2;
  g.add(roof);
  const ridge = tag(new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, rise, 2.5), roofMat()), TIER.RECONSTRUCTED, 'hall-ridge', HALLS.tierFunction);
  ridge.position.y = wallH + rise;
  g.add(ridge);
  const doors = tag(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 3, 0.4), doorMat()), TIER.APPROXIMATED, 'hall-doors', HALLS.tierFunction);
  doors.position.set(0, 1.5, d / 2 + 0.1);
  g.add(doors);
  return g;
}

/** Turbine exhaust stack: plain steel flue, sits on hall roof. */
export function makeExhaustStack() {
  const g = new THREE.Group();
  const flue = tag(new THREE.Mesh(new THREE.CylinderGeometry(TURBINE_STACK.dia / 2, TURBINE_STACK.dia / 2, TURBINE_STACK.h, 12), stackMat()), TURBINE_STACK.tier, 'turbine-stack', TURBINE_STACK.tier);
  flue.position.y = TURBINE_STACK.h / 2;
  g.add(flue);
  const cap = tag(new THREE.Mesh(new THREE.CylinderGeometry(TURBINE_STACK.dia / 2 + 0.3, TURBINE_STACK.dia / 2 + 0.3, 0.8, 12), stackMat()), TURBINE_STACK.tier, 'turbine-cap', TURBINE_STACK.tier);
  cap.position.y = TURBINE_STACK.h;
  g.add(cap);
  return g;
}

/** T1 halls: 5 seed-sited boxes, 7 stacks spread [2,2,1,1,1] along roof ridges. */
export function buildHalls() {
  const g = new THREE.Group();
  g.name = 'T1-halls';
  const per = turbineStacksPerHall();
  HALLS.items.forEach((s, i) => {
    const w = geoToWorld(s.lat, s.lon);
    const hall = makeHallBox(s.w, s.d);
    hall.position.set(w.x, 0, w.z);
    hall.userData.role = s.role; // provisional function [approx]
    hall.userData.name = s.name;
    const n = per[i] ?? 0;
    for (let k = 0; k < n; k++) {
      const st = makeExhaustStack();
      const fx = n === 1 ? 0 : ((k / (n - 1)) - 0.5) * s.w * 0.6;
      st.position.set(fx, HALLS.wallH + HALLS.roofRise, 0);
      hall.add(st);
    }
    g.add(hall);
  });
  return g;
}
