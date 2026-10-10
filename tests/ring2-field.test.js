// tests/ring2-field.test.js — Phase 1, Tasks 2+3 gate.
//
// Ground truth: Open-Meteo elevation 5x5 grid over the 20 km window,
// fetched 2026-10-10, pinned here as constants. Rows north->south
// (lat 40.291194 .. 40.11133), cols west->east (lon 49.363524 .. 49.599016).
//
// Gates:
//   A (always, offline-safe): procedural fallback relief/std >= 60% of real
//     + regression bands; PNG decoder unit test; tile geometry; bus idle.
//   B (live, needs network): cold-swap idle->coarse->live with timestamps,
//     isLive() true, sampleH changes measurably pre/post swap, live relief
//     within 50-150% of truth relief (flat/near-zero = FAIL, not pass).
//   C (offline proof): forced failure -> labelled procedural, no throw,
//     isLive() false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { SANGACHAL, geoToWorld } from '../src/ring2/site.js';
import {
  TERRARIUM_TEMPLATE,
  TILE_Z,
  MAX_TILES,
  TILE_CONCURRENCY,
  terrariumToElevation,
  decodeTerrariumPng,
  latLonToTile,
  tileToGeoBounds,
  tilesForExtent,
  getStatus,
  onStatus,
  isLive,
  ensureField,
  resetField,
  tileCount,
  proceduralH,
  sampleH,
  sampleSource,
  liveRelief,
} from '../src/ring2/field.js';

// ---------------- pinned Open-Meteo ground truth (metres) ----------------
const TRUTH_LATS = [40.291194, 40.246228, 40.201262, 40.156296, 40.11133];
const TRUTH_LONS = [49.363524, 49.422397, 49.48127, 49.540143, 49.599016];
const TRUTH = [
  [123, 112, 45, 7, 69],
  [86, 44, 268, 23, -20],
  [82, 13, -11, -28, -28],
  [211, 23, -28, -28, -28],
  [65, -4, -28, -28, -28],
];
const truthFlat = TRUTH.flat();
const truthMean = truthFlat.reduce((a, b) => a + b, 0) / truthFlat.length;
const truthRelief = Math.max(...truthFlat) - Math.min(...truthFlat);
const truthStd = Math.sqrt(
  truthFlat.reduce((a, b) => a + (b - truthMean) ** 2, 0) / truthFlat.length,
);

const stats = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, std, relief: Math.max(...xs) - Math.min(...xs) };
};

// World coords of the 25 truth posts.
const posts = [];
for (let r = 0; r < 5; r++)
  for (let c = 0; c < 5; c++)
    posts.push({ ...geoToWorld(TRUTH_LATS[r], TRUTH_LONS[c]), truth: TRUTH[r][c] });

// ============================ A — offline-safe ============================

test('A1: Terrarium encoding math', () => {
  assert.equal(terrariumToElevation(128, 0, 0), 0);
  assert.equal(terrariumToElevation(0, 0, 0), -32768);
  assert.ok(Math.abs(terrariumToElevation(128, 100, 128) - 100.5) < 1e-9);
});

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); // decoder ignores CRC; keep parser simple
  return Buffer.concat([len, td, data, crc]);
}

test('A2: PNG decoder recovers known elevations', async () => {
  // 2x1 RGB image, filter-0 rows: elevations 0 m and 100.5 m.
  const raw = Buffer.from([
    0x00, 128, 0, 0, 128, 100, 128,
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const { size, data } = await decodeTerrariumPng(new Uint8Array(png));
  assert.equal(size, 2);
  assert.equal(data[0], 0);
  assert.ok(Math.abs(data[1] - 100.5) < 1e-6);
});

test('A3: tile geometry — center tile contains site, budget respected', () => {
  assert.equal(TILE_Z, 12);
  assert.equal(MAX_TILES, 16);
  assert.equal(TILE_CONCURRENCY, 6);
  const t = latLonToTile(SANGACHAL.lat, SANGACHAL.lon, TILE_Z);
  const b = tileToGeoBounds(t.x, t.y, TILE_Z);
  assert.ok(b.south <= SANGACHAL.lat && SANGACHAL.lat <= b.north);
  assert.ok(b.west <= SANGACHAL.lon && SANGACHAL.lon <= b.east);
  const list = tilesForExtent(SANGACHAL.lat, SANGACHAL.lon, 20, TILE_Z, MAX_TILES);
  assert.ok(list.length > 0 && list.length <= MAX_TILES);
  assert.deepEqual({ x: list[0].x, y: list[0].y }, { x: t.x, y: t.y }); // center-out
  console.log(`  coarse window: ${list.length} tiles (cap ${MAX_TILES})`);
});

test('A4: status bus starts idle, isLive() false', () => {
  const s = getStatus();
  assert.equal(s.stage, 'idle');
  assert.equal(s.source, 'none');
  assert.equal(isLive(), false);
  assert.ok(Array.isArray(s.transitions) && s.transitions.length >= 1);
});

test('A5: procedural fallback relief/std >= 60% of real + regression bands', () => {
  const hs = posts.map((p) => proceduralH(p.x, p.z));
  assert.ok(hs.every(Number.isFinite), 'all procedural samples finite');
  const st = stats(hs);
  const reliefRatio = st.relief / truthRelief;
  const stdRatio = st.std / truthStd;
  console.log(
    `  truth relief=${truthRelief}m std=${truthStd.toFixed(1)}m mean=${truthMean.toFixed(1)}m | ` +
      `procedural relief=${st.relief.toFixed(1)}m std=${st.std.toFixed(1)}m mean=${st.mean.toFixed(1)}m | ` +
      `ratios relief=${reliefRatio.toFixed(2)} std=${stdRatio.toFixed(2)}`,
  );
  assert.ok(reliefRatio >= 0.6, `procedural relief ratio ${reliefRatio}`);
  assert.ok(stdRatio >= 0.6, `procedural std ratio ${stdRatio}`);
  // Regression bands: catch flat-field (v1 apron streaks) and explosions.
  assert.ok(Math.abs(st.mean - truthMean) <= 50, `mean drift ${st.mean}`);
  assert.ok(reliefRatio <= 1.6, `relief explosion ${reliefRatio}`);
  assert.ok(Math.min(...hs) >= -100 && Math.max(...hs) <= 800);
});

test('A6: sampleH pre-swap is finite procedural everywhere', () => {
  assert.equal(isLive(), false);
  for (const p of posts) {
    const h = sampleH(p.x, p.z);
    assert.ok(Number.isFinite(h), `non-finite at (${p.x},${p.z})`);
    assert.equal(sampleSource(p.x, p.z), 'procedural');
  }
});

// ================= B — live cold-swap (needs network) =================

test('B: cold-swap idle->coarse->live; sampleH changes; relief 50-150%', async () => {
  const seen = [];
  const unsub = onStatus((s) => seen.push({ stage: s.stage, at: s.updatedAt }));
  const t0 = Date.now();
  const pre = posts.map((p) => sampleH(p.x, p.z));
  let final;
  try {
    final = await ensureField({ template: TERRARIUM_TEMPLATE });
  } finally {
    unsub();
  }
  const status = getStatus();
  if (!isLive()) {
    console.log(
      `  ⚠ OFFLINE-SKIP: cold-swap ended at stage='${status.stage}' ` +
        `(no Terrarium reach). Live gates NOT proven — re-run with network.`,
    );
    assert.ok(['procedural', 'srtm'].includes(status.stage));
    return;
  }

  // (1) Transitions idle->coarse->live, timestamps increasing.
  const stages = status.transitions.map((t) => t.stage);
  console.log('  transitions: ' + status.transitions.map((t) => `${t.stage}@${t.at - t0}ms`).join(' -> '));
  assert.deepEqual(stages.slice(0, 3), ['idle', 'coarse', 'live']);
  for (let i = 1; i < status.transitions.length; i++) {
    assert.ok(status.transitions[i].at >= status.transitions[i - 1].at, 'timestamps monotonic');
  }
  console.log(`  tiles: ${status.tilesLoaded}/${status.tilesTotal} | coldSwapMs=${final.coldSwapMs}`);
  assert.ok(status.tilesLoaded > 0 && status.tilesLoaded <= MAX_TILES);
  assert.ok(final.coldSwapMs <= 60_000, `cold swap budget: ${final.coldSwapMs}ms`);

  // (3) isLive() LOUD.
  console.log(`  >>> isLive() = ${isLive()}  source = ${status.source} <<<`);

  // (1b) sampleH output changes measurably pre/post swap.
  const post = posts.map((p) => sampleH(p.x, p.z));
  const diffs = post.map((h, i) => Math.abs(h - pre[i]));
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const maxDiff = Math.max(...diffs);
  console.log(`  pre/post swap: meanAbsDiff=${meanDiff.toFixed(1)}m maxAbsDiff=${maxDiff.toFixed(1)}m`);
  assert.ok(meanDiff > 0.5, 'post-swap field must differ from procedural');
  assert.ok(maxDiff > 2, 'post-swap field must differ measurably somewhere');

  // (2) Relief sanity: live relief within 50-150% of truth; flat = FAIL.
  const lr = liveRelief(10000, 9);
  const ratio = lr.relief / truthRelief;
  console.log(
    `  live relief=${lr.relief.toFixed(1)}m (min ${lr.min.toFixed(1)}, max ${lr.max.toFixed(1)}) ` +
      `vs truth ${truthRelief}m → ratio ${ratio.toFixed(2)}`,
  );
  assert.ok(lr.relief > 5, `FLAT FIELD: live relief ${lr.relief}m — treat as FAILURE`);
  assert.ok(ratio >= 0.5 && ratio <= 1.5, `live relief ratio ${ratio} outside 50-150%`);

  // Per-post agreement with pinned truth (SRTM 30 m vs smoothed truth: generous).
  const errs = post.map((h, i) => Math.abs(h - posts[i].truth));
  const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
  console.log(`  vs pinned truth: rmse=${rmse.toFixed(1)}m maxAbs=${Math.max(...errs).toFixed(1)}m`);
  assert.ok(rmse < 60, `live RMSE ${rmse}m`);
  assert.ok(Math.max(...errs) < 150, 'live per-post band ±150 m');
});

// ===================== C — forced-offline fallback =====================

test('C: forced failure -> labelled procedural, no throw, isLive() false', async () => {
  resetField();
  assert.equal(getStatus().stage, 'idle');
  assert.equal(isLive(), false);
  const s = await ensureField({
    template: 'http://127.0.0.1:9/terrarium/{z}/{x}/{y}.png',
    allowSrtm: false,
    tileTimeoutMs: 3000,
  });
  console.log(`  forced-offline stage='${s.stage}' source='${s.source}' isLive()=${isLive()}`);
  assert.equal(s.stage, 'procedural');
  assert.equal(s.source, 'procedural');
  assert.equal(isLive(), false);
  assert.equal(tileCount(), 0);
  for (const p of posts) {
    assert.ok(Number.isFinite(sampleH(p.x, p.z)));
    assert.equal(sampleSource(p.x, p.z), 'procedural');
  }
  resetField(); // leave the module clean for later lanes
});
