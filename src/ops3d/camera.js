/* Safepipe Ops 3D — src/ops3d/camera.js · orbit rig + presets + fly-to.
 * createRig(canvas) → {camera, setPreset, flyTo, update}
 * Presets (yaw°/pitch°/dist): sector 4/25/16 · plan 4/82/40 · wide 4/36/42.
 * flyTo eases 600ms; update(dt, t) steps the tween + damping.
 * Keys 1/2/3 are owned by twin.js — this module only exposes setPreset.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FOV = 40;
const DIST_MIN = 4;
const DIST_MAX = 140;
const MAX_POLAR = (80 * Math.PI) / 180;
const FLY_MS = 600;

const PRESETS = {
  sector: { yaw: 4, pitch: 25, dist: 16 },
  plan: { yaw: 4, pitch: 82, dist: 40 },
  wide: { yaw: 4, pitch: 36, dist: 42 },
};

const _v = () => new THREE.Vector3();

function presetPos({ yaw, pitch, dist }, target) {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return new THREE.Vector3(
    target.x + dist * Math.cos(p) * Math.sin(y),
    target.y + dist * Math.sin(p),
    target.z + dist * Math.cos(p) * Math.cos(y),
  );
}

const easeInOutCubic = (k) =>
  k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;

export function createRig(canvas, opts = {}) {
  if (!canvas) throw new Error('createRig: canvas required');
  const target0 = opts.target ?? _v();
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
  camera.position.copy(presetPos(PRESETS.sector, target0));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = MAX_POLAR;
  controls.minDistance = DIST_MIN;
  controls.maxDistance = DIST_MAX;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.update();

  // Active fly-to tween, stepped by update(). Null when idle.
  let tween = null;

  function flyTo(pos, tgt = null, durMs = FLY_MS) {
    const toPos = pos.isVector3 ? pos.clone() : _v().set(...pos);
    const toTg = tgt
      ? tgt.isVector3
        ? tgt.clone()
        : _v().set(...tgt)
      : controls.target.clone();
    if (reduced || durMs <= 0) {
      camera.position.copy(toPos);
      controls.target.copy(toTg);
      tween = null;
      controls.update();
      return;
    }
    tween = {
      t0: performance.now(),
      dur: durMs,
      fromPos: camera.position.clone(),
      toPos,
      fromTg: controls.target.clone(),
      toTg,
    };
  }

  function setPreset(name) {
    const p = PRESETS[name];
    if (!p) throw new Error(`setPreset: unknown preset "${name}"`);
    // Keep the current orbit target so drill-down focus survives 1/2/3.
    flyTo(presetPos(p, controls.target), controls.target.clone(), FLY_MS);
  }

  function update() {
    // Keep aspect glued to the canvas; twin.js owns renderer sizing.
    const w = canvas.clientWidth || 2;
    const h = canvas.clientHeight || 2;
    const aspect = w / h;
    if (Math.abs(camera.aspect - aspect) > 1e-4) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    if (tween) {
      const k = Math.min((performance.now() - tween.t0) / tween.dur, 1);
      const e = easeInOutCubic(k);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      controls.target.lerpVectors(tween.fromTg, tween.toTg, e);
      if (k >= 1) tween = null;
    }
    controls.update();
  }

  return { camera, setPreset, flyTo, update, getTarget: () => controls.target.clone() };
}

export const presets = Object.keys(PRESETS);
