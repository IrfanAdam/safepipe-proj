/* Safepipe Ops 3D — src/ops3d/levels.js · semantic zoom network → segment → asset.
 * createLevels(rig, layout, {onChange}) → {name, setLevel, focusAsset, cycle}
 * L0 network: plan preset (dist 55) over origin, all visible.
 * L1 segment: sector preset (dist 9) around last target, neighbours dim (twin-owned).
 * L2 asset: close-up (dist 0.55) on asset position, target y ~0.05.
 * Reduced-motion is honoured inside rig.flyTo — no handling needed here.
 */

import { field, VEX } from './terrain.js';

const ORDER = ['network', 'segment', 'asset'];

// Mirror of camera.js preset angles (yaw°/pitch°/dist).
const VIEWS = {
  network: { yaw: 4, pitch: 78, dist: 62 },
  segment: { yaw: 4, pitch: 25, dist: 9 },
  asset: { yaw: 4, pitch: 25, dist: 2.2 },
};

const TARGET_Y = 0.05;
const FOCUS_MS = 1400; // TOP→NEAR drill-down: slow enough to track, fast enough to feel instant
const FALLBACK_ASSET = 'PIPE-02';

function viewPos({ yaw, pitch, dist }, target) {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [
    target[0] + dist * Math.cos(p) * Math.sin(y),
    target[1] + dist * Math.sin(p),
    target[2] + dist * Math.cos(p) * Math.cos(y),
  ];
}

/* Arc-length midpoint of a pipeline polyline ([[x,z]..] → [x,z]). */
function polylineMidpoint(points) {
  if (!points?.length) return null;
  if (points.length === 1) return points[0].slice();
  let total = 0;
  const lens = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(len);
    total += len;
  }
  let target = total / 2;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : target / lens[i];
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * f,
        points[i][1] + (points[i + 1][1] - points[i][1]) * f,
      ];
    }
    target -= lens[i];
  }
  return points[points.length - 1].slice();
}

export function createLevels(rig, layout, opts = {}) {
  if (!rig?.flyTo) throw new Error('createLevels: rig with flyTo required');
  const onChange = opts.onChange ?? (() => {});

  // assetId → [x, z] ground position.
  const index = new Map();
  // assetId → kind for per-kind close-up distance (a 180 m pad needs a
  // closer camera than a 37 km line or the hero fills 2% of frame).
  const kinds = new Map();
  const KIND_DIST = { pipeline: 2.2, facility: 0.45, sensor: 0.35 };
  for (const p of layout?.pipelines ?? []) {
    const mid = polylineMidpoint(p.points);
    if (mid) index.set(p.assetId, mid);
    kinds.set(p.assetId, 'pipeline');
  }
  for (const f of layout?.facilities ?? []) {
    if (f.position) index.set(f.assetId, [f.position[0], f.position[1]]);
    kinds.set(f.assetId, 'facility');
  }
  for (const s of layout?.sensors ?? []) {
    if (s.position) index.set(s.assetId, [s.position[0], s.position[1]]);
    kinds.set(s.assetId, 'sensor');
  }

  let current = 'network';
  let lastTarget = [0, 0, 0];
  let lastAssetId = null;

  // Ground height at the asset so the target sits on the terrain surface,
  // never at datum (on a 70 m hill a y=0 aim buries the focus point).
  const resolveTarget = (assetId) => {
    const pos = index.get(assetId);
    if (!pos) throw new Error(`levels: unknown asset "${assetId}"`);
    return [pos[0], field(pos[0], pos[1]) * VEX + TARGET_Y, pos[1]];
  };

  const go = (name, target) => {
    const view = VIEWS[name];
    if (!view) throw new Error(`setLevel: unknown level "${name}"`);
    current = name;
    lastTarget = target;
    rig.flyTo(viewPos(view, target), target);
    onChange(name);
  };

  return {
    get name() {
      return current;
    },

    setLevel(name) {
      if (!VIEWS[name]) throw new Error(`setLevel: unknown level "${name}"`);
      if (name === 'network') go('network', [0, 0, 0]);
      else if (name === 'segment') go('segment', lastTarget);
      // Asset needs a concrete anchor: last focused asset, else PIPE-02.
      else this.focusAsset(lastAssetId ?? FALLBACK_ASSET);
    },

    focusAsset(assetId, at = null) {
      const target = at ?? resolveTarget(assetId);
      lastAssetId = assetId;
      // Close-up distance follows the asset's real size.
      const view = { ...VIEWS.asset, dist: KIND_DIST[kinds.get(assetId)] ?? VIEWS.asset.dist };
      current = 'asset';
      lastTarget = target;
      rig.flyTo(viewPos(view, target), target, FOCUS_MS);
      onChange('asset');
    },

    // dir > 0 descends toward asset, dir < 0 ascends toward network (ESC).
    cycle(dir) {
      const idx = ORDER.indexOf(current);
      const next = Math.min(ORDER.length - 1, Math.max(0, idx + Math.sign(dir || 0)));
      if (ORDER[next] !== current) this.setLevel(ORDER[next]);
      return ORDER[next];
    },
  };
}
