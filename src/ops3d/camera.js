/* Safepipe Ops 3D — src/ops3d/camera.js · orbit rig + presets + fly-to + lens.
 * createRig(canvas) → {camera, setPreset, flyTo, update, getTarget, setFocal}
 * Presets (yaw°/pitch°/dist): sector 4/25/9 · plan 4/78/62 · wide 4/36/60.
 * flyTo eases 600ms; update(dt, t) steps the tween + damping + camera cage
 * (target clamped to r22 / y 0..8, camera radius clamped to 70).
 * Lens: setFocal(mm) drives real zoom (24mm-high frame → fov); lensCocPx is
 * the thin-lens circle-of-confusion in pixels (1 world unit = 1 m) that
 * post.js uses for depth-driven DoF — aperture + focal + focus distance are
 * real inputs, not a screen-space blur band.
 * Keys 1/2/3 are owned by twin.js — this module only exposes setPreset.
 * Cinematic push-in: a slow dolly toward the orbit target on load and after
 * every TOP-enter flight (interruptible on first user input, off under
 * prefers-reduced-motion). Pure helpers pushInTarget/isTopView are unit-tested.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FOV = 40;
const DIST_MIN = 0.5; // near cage: zooming onto the skin rasterizes every blip — hold off
const DIST_MAX = 40; // user call: no deep zoom-out — the 20 km lens fills the frame at 40, past it is only fade + void
const MAX_POLAR = (80 * Math.PI) / 180;
const FLY_MS = 600;

const PRESETS = {
  sector: { yaw: 4, pitch: 25, dist: 9 },
  plan: { yaw: 4, pitch: 78, dist: 40 },
  wide: { yaw: 4, pitch: 36, dist: 40 },
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

// Cinematic push-in tuning: 6% closer over 5 s — felt, never nauseating.
export const PUSH_IN_FACTOR = 0.94;
export const PUSH_IN_MS = 5000;
// TOP-enter detection: a flight ending high (≥60° elevation) and far (≥20)
// reads as the TOP map view (network preset is 78°/62, 78°/30, 78°/6…).
export const TOP_PITCH_DEG = 60;
export const TOP_DIST = 20;

const _toV3 = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));

// Pure: where a slow dolly from pos toward tgt ends (target fixed, frame
// tightens by 1 − factor). Unit-tested.
export function pushInTarget(pos, tgt, factor = PUSH_IN_FACTOR) {
  const p = _toV3(pos);
  const t = _toV3(tgt);
  return p.lerp(t, 1 - factor);
}

// Pure: does a flyTo destination read as a TOP view? Unit-tested.
export function isTopView(pos, tgt, pitchDeg = TOP_PITCH_DEG, minDist = TOP_DIST) {
  const p = _toV3(pos);
  const t = _toV3(tgt);
  const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist >= minDist)) return false;
  const pitch = (Math.asin(Math.min(1, Math.max(-1, dy / (dist || 1)))) * 180) / Math.PI;
  return pitch >= pitchDeg;
}

// Full-frame stills convention: 24mm-high frame, fov = 2·atan(12/f).
// Pure + unit-tested; 32mm ≈ 41°, 50mm ≈ 27°.
export function fovForFocal(focalMm) {
  const f = Math.max(8, Math.min(200, focalMm));
  return (2 * Math.atan(12 / f) * 180) / Math.PI;
}

// Thin-lens circle of confusion, in pixels. f = focal length, N = f-stop,
// S = focus distance, D = subject depth (all metres; 1 world unit = 1 m).
// coc = f²/(N·(S−f)) · |1 − S/D|, projected via screen height + fov.
// Zero when the subject sits exactly on the focus plane. Pure + unit-tested.
export function lensCocPx(focalMm, fstop, focusDist, subjectDist, screenHPx, fovDeg) {
  if (!(fstop > 0) || !(focusDist > 0) || !(subjectDist > 0) || !(screenHPx > 0)) return 0;
  const f = Math.max(8, Math.min(200, focalMm)) / 1000;
  const cocM = ((f * f) / (fstop * Math.max(focusDist - f, 1e-6))) * Math.abs(1 - focusDist / subjectDist);
  const pxPerM = screenHPx / (2 * Math.tan(((fovDeg * Math.PI) / 180) / 2) * subjectDist);
  return cocM * pxPerM;
}

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
  // Cinematic push-in state: slow dolly toward the orbit target after load /
  // TOP-enter. Damping stays ON during a push (no fight: no input deltas),
  // and ANY user grab cancels it outright (see 'start' below).
  let push = null;
  // Trailing push chained after a TOP-enter flight lands.
  let pendingPush = false;
  // Load intro: fires once the opening flight (if any) settles.
  let introPending = !reduced;

  const pushEase = (k) => 1 - (1 - k) * (1 - k); // easeOutQuad: glides in, settles

  function startPush(durMs = PUSH_IN_MS, factor = PUSH_IN_FACTOR) {
    if (reduced || !(durMs > 0)) return;
    push = {
      t0: performance.now(),
      dur: durMs,
      fromPos: camera.position.clone(),
      toPos: pushInTarget(camera.position, controls.target, factor),
    };
  }

  // Damping fights the tween: controls.update() applies leftover orbit
  // deltas on top of the lerped position, so the camera drifts on arrival.
  // While a fly is active damping stays off (deltas zero out, update only
  // re-aims); it is restored when the fly ends or the user grabs control.
  const setDamping = (on) => {
    controls.enableDamping = on;
  };

  function flyTo(pos, tgt = null, durMs = FLY_MS) {
    const toPos = pos.isVector3 ? pos.clone() : _v().set(...pos);
    const toTg = tgt
      ? tgt.isVector3
        ? tgt.clone()
        : _v().set(...tgt)
      : controls.target.clone();
    // A new flight always wins: any running/trailing push is superseded.
    push = null;
    pendingPush = false;
    if (reduced || durMs <= 0) {
      camera.position.copy(toPos);
      controls.target.copy(toTg);
      tween = null;
      setDamping(true);
      controls.update();
      return;
    }
    setDamping(false);
    tween = {
      t0: performance.now(),
      dur: durMs,
      fromPos: camera.position.clone(),
      toPos,
      fromTg: controls.target.clone(),
      toTg,
    };
    // TOP-enter chains a trailing slow push once this flight lands — the map
    // breathes instead of freezing. Drilled-in flights land still.
    if (!reduced && isTopView(toPos, toTg)) pendingPush = true;
  }
  // Grabbing the camera mid-fly cancels the fly — otherwise the tween keeps
  // fighting the user's drag. The same grab kills any cinematic push-in, the
  // trailing TOP push, and the load intro: user input always wins.
  controls.addEventListener('start', () => {
    tween = null;
    push = null;
    pendingPush = false;
    introPending = false;
    setDamping(true);
  });

  function setPreset(name) {
    const p = PRESETS[name];
    if (!p) throw new Error(`setPreset: unknown preset "${name}"`);
    // Keep the current orbit target so drill-down focus survives 1/2/3.
    flyTo(presetPos(p, controls.target), controls.target.clone(), FLY_MS);
  }

  // Real zoom: focal length in mm on a 24mm-high frame (50mm ≈ 27° fov).
  // Orbit distances are untouched — only the projection changes.
  function setFocal(focalMm) {
    const fov = fovForFocal(focalMm);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    return camera.fov;
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
      if (k >= 1) {
        tween = null;
        setDamping(true);
        // Flight landed: run the chained TOP push, else the load intro.
        if (pendingPush) {
          pendingPush = false;
          introPending = false;
          startPush();
        } else if (introPending) {
          introPending = false;
          startPush();
        }
      }
    } else if (introPending && !push) {
      // No opening flight (already home): intro starts on first update.
      introPending = false;
      startPush();
    }
    if (push) {
      const k = Math.min((performance.now() - push.t0) / push.dur, 1);
      camera.position.lerpVectors(push.fromPos, push.toPos, pushEase(k));
      if (k >= 1) push = null;
    }
    // Camera cage: never leave the mapped circle (r20) + margin.
    const tr = Math.hypot(controls.target.x, controls.target.z);
    if (tr > 22) {
      const s = 22 / tr;
      controls.target.x *= s;
      controls.target.z *= s;
    }
    controls.target.y = Math.min(8, Math.max(0, controls.target.y));
    const cr = Math.hypot(camera.position.x, camera.position.z);
    if (cr > 70) {
      const s = 70 / cr;
      camera.position.x *= s;
      camera.position.z *= s;
    }
    controls.update();
  }

  return { camera, setPreset, setFocal, flyTo, update, getTarget: () => controls.target.clone(), pushIn: startPush, pushActive: () => !!push };
}

export const presets = Object.keys(PRESETS);
