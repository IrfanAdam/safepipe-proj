/* Safepipe Ops 3D — src/ops3d/health-feed.js · unified asset-health feed.
 * Feed item shape (energy-generic, O&G now):
 *   {assetId, kind:'pipeline'|'facility'|'sensor', health:'nominal'|'watch'|'critical',
 *    faults:[{type, chainage, severity}], sensitivity:'normal'|'hca'|'environmental',
 *    compliance:[{flag:'inspection-overdue'|'moc-open'|'permit-due', ref}]}
 * Compliance refs are real work-order ids from src/logic/fixtures.json (WO-001..WO-008).
 * Layout is deterministic (mulberry32, fixed SEED): 6 pipeline polylines over a
 * 10×10 area, 3 facilities at line junctions, 5 sensors bound to parent lines.
 * Guarantees: ≥1 critical corrosion fault, ≥1 watch fault, ≥1 hca asset.
 * Contracts: loadFeed() → feed[], healthRollup(feed) → {nominal,watch,critical}.
 * getLayout() exposes the seeded geometry so network.js renders the same lines.
 */

const SEED = 20261006;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Point along a polyline at fraction t (0..1), for facility/sensor placement. */
function pointAt(points, t) {
  let total = 0;
  const lens = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dz);
    lens.push(len);
    total += len;
  }
  let target = clamp(t, 0, 1) * total;
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

function buildLayout() {
  const rnd = mulberry32(SEED);
  const pipelines = [];
  const LANES = 6;
  for (let i = 0; i < 6; i++) {
    const pts = [];
    const zBase = -5 + ((i + 0.5) * 10) / LANES;
    const n = 5;
    for (let k = 0; k < n; k++) {
      const x = -5 + (k * 10) / (n - 1) + (k === 0 || k === n - 1 ? 0 : (rnd() - 0.5) * 1.6);
      const z = clamp(zBase + (rnd() - 0.5) * 2.2, -5, 5);
      pts.push([+x.toFixed(3), +z.toFixed(3)]);
    }
    pipelines.push({ assetId: `PIPE-0${i + 1}`, points: pts });
  }
  const byPipe = (id) => pipelines.find((p) => p.assetId === id).points;
  const facilities = [
    { assetId: 'FAC-01', name: 'Compressor station', position: pointAt(byPipe('PIPE-01'), 0.5), size: [1.1, 0.55, 0.85] },
    { assetId: 'FAC-02', name: 'Valve yard', position: pointAt(byPipe('PIPE-03'), 0.62), size: [0.8, 0.4, 0.65] },
    { assetId: 'FAC-03', name: 'Metering station', position: pointAt(byPipe('PIPE-05'), 0.35), size: [0.9, 0.45, 0.7] },
  ];
  const sensorSpec = [
    ['SEN-01', 'PIPE-01', 0.3],
    ['SEN-02', 'PIPE-02', 0.55],
    ['SEN-03', 'PIPE-03', 0.7],
    ['SEN-04', 'PIPE-05', 0.4],
    ['SEN-05', 'PIPE-06', 0.6],
  ];
  const sensors = sensorSpec.map(([assetId, parentId, t]) => ({
    assetId,
    parentId,
    chainage: +((t * 8.4).toFixed(1)),
    position: pointAt(byPipe(parentId), t).map((v) => +v.toFixed(3)),
  }));
  return { pipelines, facilities, sensors };
}

const LAYOUT = buildLayout();

function buildFeed() {
  return [
    { assetId: 'PIPE-01', kind: 'pipeline', health: 'nominal', faults: [],
      sensitivity: 'normal', compliance: [] },
    { assetId: 'PIPE-02', kind: 'pipeline', health: 'critical',
      faults: [{ type: 'corrosion', chainage: 4.2, severity: 'critical' }],
      sensitivity: 'hca',
      compliance: [
        { flag: 'inspection-overdue', ref: 'WO-002' },
        { flag: 'moc-open', ref: 'WO-004' },
      ] },
    { assetId: 'PIPE-03', kind: 'pipeline', health: 'nominal', faults: [],
      sensitivity: 'normal',
      compliance: [{ flag: 'permit-due', ref: 'WO-006' }] },
    { assetId: 'PIPE-04', kind: 'pipeline', health: 'watch',
      faults: [{ type: 'coating', chainage: 1.8, severity: 'watch' }],
      sensitivity: 'normal',
      compliance: [{ flag: 'inspection-overdue', ref: 'WO-007' }] },
    { assetId: 'PIPE-05', kind: 'pipeline', health: 'nominal', faults: [],
      sensitivity: 'environmental',
      compliance: [{ flag: 'permit-due', ref: 'WO-003' }] },
    { assetId: 'PIPE-06', kind: 'pipeline', health: 'nominal', faults: [],
      sensitivity: 'normal', compliance: [] },
    { assetId: 'FAC-01', kind: 'facility', name: 'Compressor station', health: 'nominal',
      faults: [], sensitivity: 'normal',
      compliance: [{ flag: 'moc-open', ref: 'WO-001' }] },
    { assetId: 'FAC-02', kind: 'facility', name: 'Valve yard', health: 'watch',
      faults: [{ type: 'valve', chainage: 0, severity: 'watch' }],
      sensitivity: 'normal',
      compliance: [{ flag: 'inspection-overdue', ref: 'WO-008' }] },
    { assetId: 'FAC-03', kind: 'facility', name: 'Metering station', health: 'nominal',
      faults: [], sensitivity: 'environmental', compliance: [] },
    { assetId: 'SEN-01', kind: 'sensor', parentId: 'PIPE-01', health: 'nominal',
      faults: [], sensitivity: 'normal', compliance: [] },
    { assetId: 'SEN-02', kind: 'sensor', parentId: 'PIPE-02', health: 'nominal',
      faults: [], sensitivity: 'hca', compliance: [] },
    { assetId: 'SEN-03', kind: 'sensor', parentId: 'PIPE-03', health: 'nominal',
      faults: [], sensitivity: 'normal', compliance: [] },
    { assetId: 'SEN-04', kind: 'sensor', parentId: 'PIPE-05', health: 'nominal',
      faults: [], sensitivity: 'environmental', compliance: [] },
    { assetId: 'SEN-05', kind: 'sensor', parentId: 'PIPE-06', health: 'nominal',
      faults: [], sensitivity: 'normal', compliance: [] },
  ];
}

const FEED_TEMPLATE = buildFeed();
const deepCopy = (v) => JSON.parse(JSON.stringify(v));

/* Fresh copy each call so consumers can mutate freely. */
export function loadFeed() {
  return deepCopy(FEED_TEMPLATE);
}

export function healthRollup(feed) {
  const out = { nominal: 0, watch: 0, critical: 0 };
  for (const item of feed) {
    if (out[item.health] === undefined) out[item.health] = 0;
    out[item.health] += 1;
  }
  return out;
}

/* Seeded geometry matching the feed assetIds (fresh copy each call). */
export function getLayout() {
  return deepCopy(LAYOUT);
}
