// src/ring2/facilities/trains.js — T0 processing-train builders (S3).
// 6 oil + 2 gas module rows: capsule vessels + columns + skids.
// All geometry approximated from EBRD zone pattern; no surveyed fix.
// Every mesh gets userData.tier. Base y=0; parent wires siting/grounding.
// [board:F6, S3]
import * as THREE from 'three';
import { OIL_TRAIN, GAS_TRAIN, TIER } from './dims.js';

const vesselMat = () => new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.6, metalness: 0.35 }); // light gray vessels [board:S3]
const saddleMat = () => new THREE.MeshStandardMaterial({ color: 0x6b7075, roughness: 0.85 }); // darker saddles [board:S3]
const skidMat = () => new THREE.MeshStandardMaterial({ color: 0xb8a77e, roughness: 0.8 }); // sand/beige cladding cue [board:S3]
const pipeMat = () => new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.55, metalness: 0.45 }); // aluminum-gray piping [board:S3]

const tag = (mesh, kind) => { mesh.userData.tier = TIER.APPROXIMATED; mesh.userData.kind = kind; return mesh; };

/** One train module: horizontal capsule on saddles + vertical column + pump skid + interconnect pipe. */
export function makeTrainModule({ vesselDia, vesselLen, columnDia, columnH, skidW, skidD, skidH }) {
  const g = new THREE.Group();
  const capLen = Math.max(1, vesselLen - vesselDia);
  const vessel = tag(new THREE.Mesh(new THREE.CapsuleGeometry(vesselDia / 2, capLen, 6, 16), vesselMat()), 'train-vessel');
  vessel.rotation.z = Math.PI / 2;
  vessel.position.y = vesselDia / 2 + 1.2;
  g.add(vessel);
  const saddleGeo = new THREE.BoxGeometry(1.2, 1.2, vesselDia * 1.2);
  for (const sx of [-capLen / 4, capLen / 4]) {
    const s = tag(new THREE.Mesh(saddleGeo, saddleMat()), 'train-saddle');
    s.position.set(sx, 0.6, 0);
    g.add(s);
  }
  const colX = vesselLen / 2 + columnDia;
  const col = tag(new THREE.Mesh(new THREE.CylinderGeometry(columnDia / 2, columnDia / 2, columnH, 20), vesselMat()), 'train-column');
  col.position.set(colX, columnH / 2, 0);
  g.add(col);
  const skid = tag(new THREE.Mesh(new THREE.BoxGeometry(skidW, skidH, skidD), skidMat()), 'train-skid');
  skid.position.set(0, skidH / 2, vesselDia + skidD / 2 + 2);
  g.add(skid);
  const pipe = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, vesselLen + columnDia, 10), pipeMat()), 'train-pipe');
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(columnDia / 2, vesselDia + 2.2, 0);
  g.add(pipe);
  return g;
}

/** Parallel row of `spec.count` modules spaced `spec.rowSpacing` along +x. */
export function makeTrainRow(spec) {
  const g = new THREE.Group();
  for (let i = 0; i < spec.count; i++) {
    const m = makeTrainModule(spec);
    m.position.set(i * spec.rowSpacing, 0, 0);
    g.add(m);
  }
  return g;
}

/** T0 trains: 6 oil + 2 gas rows at approximated anchors. */
export function buildTrains() {
  const g = new THREE.Group();
  g.name = 'T0-trains';
  const oil = makeTrainRow(OIL_TRAIN);
  oil.position.set(OIL_TRAIN.anchor.x, 0, OIL_TRAIN.anchor.z);
  g.add(oil);
  const gas = makeTrainRow(GAS_TRAIN);
  gas.position.set(GAS_TRAIN.anchor.x, 0, GAS_TRAIN.anchor.z);
  g.add(gas);
  return g;
}
