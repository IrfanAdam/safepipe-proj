// src/ring2/facilities/perimeter.js — T1 dyke ring + drainage cue.
// Site bund perimeter back-computed from the 688 ha F2 footprint
// (r ≈ 1480 m; ring area matches bp within 1%) + a darker ditch ring
// just outside as the drainage cue. All approximated.
// Base y=0; parent wires siting/grounding. [board:F2, F6]
import * as THREE from 'three';
import { PERIMETER, TIER, dykeAreaHa } from './dims.js';

const bermMat = () => new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95, side: THREE.DoubleSide }); // earth bund [approx]
const ditchMat = () => new THREE.MeshBasicMaterial({ color: 0x3e4a4e, transparent: true, opacity: 0.5, side: THREE.DoubleSide }); // water/ditch cue [approx]

const tag = (mesh, kind) => { mesh.userData.tier = TIER.APPROXIMATED; mesh.userData.kind = kind; return mesh; };

/** T1 perimeter: low earth-berm band + flat drainage-ditch ring. */
export function buildPerimeter() {
  const g = new THREE.Group();
  g.name = 'T1-perimeter';
  const berm = tag(new THREE.Mesh(new THREE.CylinderGeometry(PERIMETER.dykeR, PERIMETER.dykeR, PERIMETER.dykeH, 128, 1, true), bermMat()), 'dyke-berm');
  berm.position.y = PERIMETER.dykeH / 2;
  g.add(berm);
  const crest = tag(new THREE.Mesh(new THREE.RingGeometry(PERIMETER.dykeR - PERIMETER.dykeW / 2, PERIMETER.dykeR + PERIMETER.dykeW / 2, 128), bermMat()), 'dyke-crest');
  crest.rotation.x = -Math.PI / 2;
  crest.position.y = PERIMETER.dykeH + 0.05;
  g.add(crest);
  const ditch = tag(new THREE.Mesh(new THREE.RingGeometry(PERIMETER.ditchR - 3, PERIMETER.ditchR + 3, 128), ditchMat()), 'drainage-ditch');
  ditch.rotation.x = -Math.PI / 2;
  ditch.position.y = 0.12;
  g.add(ditch);
  g.userData.areaHa = dykeAreaHa();
  return g;
}
