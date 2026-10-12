// src/ring2/facilities/racks.js — T0 pipe-rack builder (S4).
// Portal-frame corridors: repeated 2-column + beam frames carrying 3–6
// parallel pipes + cable tray. 8 in / 8 out lines run site-scale [board:F2].
// Frames are InstancedMesh (hundreds of repeats); pipes individual.
// All geometry approximated (PIP practice heights); corridors approximated.
// Every mesh gets userData.tier. Base y=0; parent wires siting/grounding.
// [board:S4]
import * as THREE from 'three';
import { RACK, TIER, rackPipeDiaM } from './dims.js';

const frameMat = new THREE.MeshStandardMaterial({ color: 0x7d8a84, roughness: 0.8, metalness: 0.3 }); // gray-green steel [board:S4]
const rackPipeMat = new THREE.MeshStandardMaterial({ color: 0xa8adb1, roughness: 0.5, metalness: 0.5 }); // aluminum-gray pipes [board:S4]
const footingMat = new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.95 }); // concrete [board:S4]

const tag = (mesh, kind) => { mesh.userData.tier = TIER.APPROXIMATED; mesh.userData.kind = kind; return mesh; };

/** Straight rack corridor from `from` to `to` (world-metre {x,z}). */
export function makeRackCorridor(from, to, { frameSpacing = RACK.frameSpacing, beamH = RACK.beamH, beamW = RACK.beamW, pipeCount = RACK.pipeCount } = {}) {
  const g = new THREE.Group();
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz); // +z-forward frame
  const n = Math.max(2, Math.round(len / frameSpacing) + 1);
  const dummy = new THREE.Object3D();
  dummy.rotation.y = yaw;

  // Per-part InstancedMesh: 2 columns + 2 footings + beam + tray per frame.
  const parts = [
    { geo: new THREE.BoxGeometry(RACK.colW, beamH, RACK.colW), mat: frameMat, kind: 'rack-column', offs: [[-beamW / 2, beamH / 2], [beamW / 2, beamH / 2]] },
    { geo: new THREE.BoxGeometry(1.4, 0.8, 1.4), mat: footingMat, kind: 'rack-footing', offs: [[-beamW / 2, 0.4], [beamW / 2, 0.4]] },
    { geo: new THREE.BoxGeometry(beamW, 0.5, 0.4), mat: frameMat, kind: 'rack-beam', offs: [[0, beamH]] },
    { geo: new THREE.BoxGeometry(beamW * 0.5, 0.15, 0.8), mat: footingMat, kind: 'rack-tray', offs: [[0, beamH + 0.45]] },
  ];
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  for (const p of parts) {
    const total = n * p.offs.length;
    const inst = new THREE.InstancedMesh(p.geo, p.mat, total);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const px = from.x + dx * t, pz = from.z + dz * t;
      for (const [ox, oy] of p.offs) {
        dummy.position.set(px + ox * cos, oy, pz - ox * sin);
        dummy.updateMatrix();
        inst.setMatrixAt(k++, dummy.matrix);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    g.add(tag(inst, p.kind));
  }
  // Pipes ride the corridor at beam level, 2 tiers [board:S4 flare header top]
  const pipeDia = rackPipeDiaM();
  const pipeGeo = new THREE.CylinderGeometry(pipeDia / 2, pipeDia / 2, len, 10);
  const perTier = Math.ceil(pipeCount / 2);
  const holder = new THREE.Group();
  holder.position.set((from.x + to.x) / 2, 0, (from.z + to.z) / 2);
  holder.rotation.y = yaw;
  for (let p = 0; p < pipeCount; p++) {
    const pipe = tag(new THREE.Mesh(pipeGeo, rackPipeMat), 'rack-pipe');
    const tierRow = Math.floor(p / perTier);
    const lane = p % perTier;
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set((lane - (perTier - 1) / 2) * (pipeDia + 0.5), beamH + 0.6 + tierRow * (pipeDia + 0.6), 0);
    holder.add(pipe);
  }
  g.add(holder);
  return g;
}

/** T0 racks: all corridors in RACK.mains. */
export function buildRacks() {
  const g = new THREE.Group();
  g.name = 'T0-racks';
  for (const m of RACK.mains) g.add(makeRackCorridor(m.from, m.to));
  return g;
}
