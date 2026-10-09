import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  field, riverX, riverTrough, RIVER_TROUGH_D, RIVER_TROUGH_W,
  LAKE_ISO_SCALES, LAKE_ISO_OPAC, WATER_COL, drainPathFromGrid,
} from '../src/ops3d/terrain.js';

/* Ops 3D water + terrain mood (pool/stream/charcoal rework).
 * Locks src/ops3d/terrain.js:
 *  (1) pool: 5–6 organic lake isobaths, blue only, outer strongest inward;
 *  (2) stream: shallow trough carved along riverX into field(), 2 wavy
 *      centerlines + ONE upstream→downstream chevron drift (soft envelope);
 *  (3) mood: matte-charcoal hillshade strengthened, contours neutral grey,
 *      blue reserved for water, elevation glow rubric capped (alarms lead).
 */

const rgb = (hex) => [((hex >> 16) & 255), ((hex >> 8) & 255), (hex & 255)];

describe('ops3d pool — densified organic lake isobaths', () => {
  it('isobath count is 5–6 rings', () => {
    assert.ok(LAKE_ISO_SCALES.length >= 5 && LAKE_ISO_SCALES.length <= 6,
      `expected 5–6 rings, got ${LAKE_ISO_SCALES.length}`);
    assert.equal(LAKE_ISO_OPAC.length, LAKE_ISO_SCALES.length, 'scales/opacities pair up');
  });

  it('rings nest inward, all inside the shoreline', () => {
    for (let k = 1; k < LAKE_ISO_SCALES.length; k++) {
      assert.ok(LAKE_ISO_SCALES[k] < LAKE_ISO_SCALES[k - 1], `ring ${k} nests inward`);
    }
    assert.ok(LAKE_ISO_SCALES[0] < 1 && LAKE_ISO_SCALES.at(-1) > 0, 'rings live inside water');
  });

  it('outer strongest, fading inward (no hard inner edge)', () => {
    for (let k = 1; k < LAKE_ISO_OPAC.length; k++) {
      assert.ok(LAKE_ISO_OPAC[k] < LAKE_ISO_OPAC[k - 1], `opacity fades at ring ${k}`);
    }
    assert.ok(LAKE_ISO_OPAC[0] <= 0.4, 'outer ring stays a whisper (fills lead)');
  });

  it('rings wiggle organically (per-ring wave, not scaled circles)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('Lake isobaths'), src.indexOf('const shorePos'));
    assert.ok(/Math\.sin\(3 \* a/.test(block), 'ring wiggle carries a 3-lobe wave');
    assert.ok(/Math\.sin\(5 \* a/.test(block), 'ring wiggle carries a 5-lobe wave');
    assert.ok(/k \* 1\.7|k \* 2\.3/.test(block), 'wiggle phase varies per ring (no perfect circles)');
  });
});

describe('ops3d stream — trough carve + directional flow', () => {
  it('trough profile: ~12 m deep on path, gone by ±2 km', () => {
    for (const z of [-10, -3, 4, 11]) {
      const c = riverTrough(riverX(z), z);
      assert.ok(Math.abs(c + RIVER_TROUGH_D) < 1e-9, `on-path depth at z=${z}`);
      assert.ok(Math.abs(riverTrough(riverX(z) + 2.5, z)) < 0.002, `decayed by +2.5 km at z=${z}`);
    }
    assert.ok(RIVER_TROUGH_D >= 0.008 && RIVER_TROUGH_D <= 0.016, 'shallow carve (8–16 m)');
    assert.ok(RIVER_TROUGH_W >= 0.6 && RIVER_TROUGH_W <= 1.1, 'ribbon (0.6) sits inside with banks');
  });

  it('field() carries the carve: river center is a local low across ±1 km', () => {
    for (const z of [-10, -5, 0, 5, 10]) {
      const cx = riverX(z);
      const c = field(cx, z);
      assert.ok(c < field(cx - 1, z) && c < field(cx + 1, z),
        `z=${z}: center ${(c * 1000).toFixed(1)} m must sit below both ±1 km banks`);
    }
  });

  it('threads + masks follow the DERIVED drainage line, not a fixed drawing', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
    assert.ok(src.includes('_riverXat = drainAt'), 'buildTerrain installs the grid-derived axis');
    assert.ok(src.includes('drainAt(z) + off'), 'wave threads ride the derived line');
    assert.ok(src.includes('(x - _riverXat(z))'), 'water mask follows the derived line');
  });

  it('derived fallback drainage matches the valley axis (threads sit in the carve)', () => {
    const n = 44, size = 44, step = size / n;
    const H = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) H[j * (n + 1) + i] = field(-size / 2 + i * step, -size / 2 + j * step);
    }
    const drain = drainPathFromGrid(H, n, step);
    for (let z = -15; z <= 15; z += 2.5) {
      const gz = Math.min(n, Math.max(0, (z + size / 2) / step));
      const j0 = Math.min(n - 1, Math.floor(gz)), f = gz - j0;
      const dx = drain[j0] * (1 - f) + drain[j0 + 1] * f;
      assert.ok(Math.abs(dx - riverX(z)) < 0.6,
        `z=${z}: derived ${dx.toFixed(2)} tracks valley axis ${riverX(z).toFixed(2)} (inside 0.85 trough)`);
    }
  });

  it('two wavy centerlines draped at the trough bottom — no slab, no chevrons', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
    assert.ok(src.includes('const offs = [-0.18, 0.18]'), 'exactly 2 offset wavy centerlines');
    assert.ok(src.includes('_heightAt(cx, z) * VEX'), 'threads sample the live grid per segment (draped, never floating)');
    for (const banned of ['ribGeo', 'const ribbon', 'ribbon.renderOrder', 'FLOW_N', 'flowChevs', 'stepFlow', 'flowTex', 'FLAT quad']) {
      assert.ok(!src.includes(banned), `kill-list: \`${banned}\` must be gone (no slab, no carets)`);
    }
    assert.ok(!/dashed:\s*true/.test(src), 'no dashed lines anywhere in terrain water');
  });
});

describe('ops3d mood — charcoal relief, blue-only water, capped glow', () => {
  const loadTerrainSrc = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
  };

  it('hillshade swing is strengthened (volume reads) but capped', async () => {
    const src = await loadTerrainSrc();
    const m = src.match(/const shadeToBright = \(t\) => ([\d.]+) \+ ([\d.]+) \*/);
    assert.ok(m, 'shadeToBright must be a literal ramp');
    const lo = parseFloat(m[1]), span = parseFloat(m[2]);
    assert.ok(lo <= 0.68, `shadow floor ${lo} deep enough for charcoal volume`);
    assert.ok(lo + span <= 1.15, `sunlit cap ${(lo + span).toFixed(2)} keeps greys grey`);
    assert.ok(span >= 0.4, `swing ${span} reads directionally (stronger than 0.31)`);
  });

  it('blue is water-only: every hex literal is grey, white, or WATER_COL', async () => {
    const src = await loadTerrainSrc();
    const lits = [...src.matchAll(/0x([0-9a-fA-F]{6})/g)].map((m) => parseInt(m[1], 16));
    assert.ok(lits.length > 0, 'literals to audit');
    for (const h of lits) {
      if (h === WATER_COL || h === 0xffffff) continue;
      const [r, g, b] = rgb(h);
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 26,
        `0x${h.toString(16)} must be neutral grey (land), not a second blue`);
    }
    const [wr, wg, wb] = rgb(WATER_COL);
    assert.ok(wb > wr + 20, 'WATER_COL reads ice-blue (blue-dominant)');
    const uses = (src.match(/WATER_COL/g) || []).length;
    assert.ok(uses >= 5, `WATER_COL feeds lake fill + 6 isobaths + 2 wave threads (found ${uses})`);
  });

  it('hierarchy reads alarms > water > land (no contour bloom, TOP review)', () => {
    const lum = (hex) => {
      const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    const THRESHOLD = 0.44; // post.js bloom threshold — contours must stay under it
    const brightestLand = lum(0x9fabb3) * 0.95 * 1.11 * 0.32; // INDEX × summit glow × sunlit shade × opacity
    const waterThread = lum(WATER_COL) * 0.45; // river threads: legible, still under bloom
    const waterFill = lum(WATER_COL) * 0.48; // lake surface over near-black ground
    assert.ok(brightestLand < THRESHOLD, `brightest contour ${brightestLand.toFixed(3)} stays below bloom ${THRESHOLD}`);
    assert.ok(waterThread < THRESHOLD, `river thread ${waterThread.toFixed(3)} stays below bloom ${THRESHOLD}`);
    assert.ok(brightestLand < waterThread, `land ${brightestLand.toFixed(3)} sits below river water ${waterThread.toFixed(3)}`);
    assert.ok(waterThread <= waterFill, `threads ${waterThread.toFixed(3)} sit under the lake fill ${waterFill.toFixed(3)}`);
    assert.ok(waterFill < lum(0xff4545), `water ${waterFill.toFixed(3)} stays below lamp-red flow/alarm`);
  });

  it('hillshade rig is declared exactly once (no dupes, no missing SUN)', async () => {
    const src = await loadTerrainSrc();
    for (const decl of ['const SUN =', 'const _sn =', 'let _shadeAt =', 'const shadeToBright =']) {
      const n = src.split(decl).length - 1;
      assert.equal(n, 1, `\`${decl}\` must appear exactly once (found ${n})`);
    }
  });

  it('elevation glow rubric holds: 0.55→0.95 summit-brightest, width ≤2.0', async () => {
    const src = await loadTerrainSrc();
    const mn = src.match(/const ELEV_GLOW_MIN = ([\d.]+)/);
    const mx = src.match(/const ELEV_GLOW_MAX = ([\d.]+)/);
    const w = src.match(/const SUMMIT_WIDTH = ([\d.]+)/);
    assert.ok(mn && mx && w, 'glow rubric literals must exist');
    assert.equal(parseFloat(mn[1]), 0.55, 'lowland recedes deep at 0.55');
    assert.equal(parseFloat(mx[1]), 0.95, 'summit caps at 0.95 (below bloom, alarms lead)');
    assert.ok(parseFloat(w[1]) <= 2.0, `summit width ${w[1]} ≤ 2.0`);
    assert.ok(src.includes('rankGlow(k)'), 'rank-scaled brightness × width still drives tiers');
  });
});
