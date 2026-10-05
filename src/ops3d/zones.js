/* Safepipe Ops 3D — src/ops3d/zones.js · sensitive-area ground decals.
 * HCA = dashed-outline rectangle + diagonal hatch; environmentally-sensitive
 * = dashed-outline circle + hatch disc. Deliberately NO glow color: all decal
 * materials are dim bone/gray below the bloom threshold, so at a glance glow
 * always means health and outline always means sensitivity.
 * Contract: buildZones(scene, feed) → {update}.
 */

import * as THREE from 'three';

// Lane math mirrors health-feed.js: lane i zBase = -5 + ((i+0.5)*10)/6.
// PIPE-02 (hca) sits near z≈-0.83; PIPE-05 (environmental) near z≈+2.5.
const HCA_RECT = { x: 0.8, z: -0.9, w: 4.4, d: 2.8 };
const ENV_CIRCLE = { x: -2.4, z: 2.6, r: 1.5 };
const OUTLINE_COLOR = 0x9a9384; // dim bone — stays under bloom threshold
const DECAL_Y = 0.02;

function hatchTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(190,181,164,0.85)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(-16, 16);
  g.lineTo(16, -16);
  g.moveTo(0, 64);
  g.lineTo(64, 0);
  g.moveTo(48, 80);
  g.lineTo(80, 48);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function dashedLoop(points) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(
    geo,
    new THREE.LineDashedMaterial({
      color: OUTLINE_COLOR,
      dashSize: 0.25,
      gapSize: 0.15,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  line.computeLineDistances();
  return line;
}

export function buildZones(scene, feed) {
  const group = new THREE.Group();
  group.name = 'ops-zones';
  group.position.y = DECAL_Y;
  scene.add(group);

  const hatch = hatchTexture();

  /* --- HCA rectangle --- */
  const hca = new THREE.Group();
  hca.name = 'hca';
  const { x: hx, z: hz, w: hw, d: hd } = HCA_RECT;
  const corners = [
    new THREE.Vector3(hx - hw / 2, 0, hz - hd / 2),
    new THREE.Vector3(hx + hw / 2, 0, hz - hd / 2),
    new THREE.Vector3(hx + hw / 2, 0, hz + hd / 2),
    new THREE.Vector3(hx - hw / 2, 0, hz + hd / 2),
  ];
  hca.add(dashedLoop(corners));
  const hcaHatchTex = hatch.clone();
  hcaHatchTex.needsUpdate = true;
  hcaHatchTex.repeat.set(5, 3);
  const hcaHatch = new THREE.Mesh(
    new THREE.PlaneGeometry(hw, hd),
    new THREE.MeshBasicMaterial({
      map: hcaHatchTex,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  hcaHatch.rotation.x = -Math.PI / 2;
  hcaHatch.position.set(hx, -0.005, hz);
  hca.add(hcaHatch);
  group.add(hca);

  /* --- environmental circle --- */
  const env = new THREE.Group();
  env.name = 'environmental';
  const { x: ex, z: ez, r: er } = ENV_CIRCLE;
  const circlePts = new THREE.EllipseCurve(0, 0, er, er).getPoints(72).map(
    (p) => new THREE.Vector3(ex + p.x, 0, ez + p.y),
  );
  env.add(dashedLoop(circlePts));
  const envHatchTex = hatch.clone();
  envHatchTex.needsUpdate = true;
  envHatchTex.repeat.set(3, 3);
  const envHatch = new THREE.Mesh(
    new THREE.CircleGeometry(er, 48),
    new THREE.MeshBasicMaterial({
      map: envHatchTex,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  envHatch.rotation.x = -Math.PI / 2;
  envHatch.position.set(ex, -0.005, ez);
  env.add(envHatch);
  group.add(env);

  function update(next) {
    const list = next ?? [];
    hca.visible = list.some((f) => f.sensitivity === 'hca');
    env.visible = list.some((f) => f.sensitivity === 'environmental');
  }
  update(feed);

  return { update };
}
