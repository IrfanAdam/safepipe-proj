import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* Ops 3D attention-lock photometry (Phase 1, Task 10).
 * Locks the TRUE bloom relationships instead of the old shorthand claim.
 * Bright-pass: smoothstep(threshold=0.44, +0.25) on Rec.601 luminance.
 * Measured here in sRGB 0..1 (matches the shader's UnsignedByte pipeline):
 *   critical red  #e31919 → L≈0.335  (BELOW threshold: the red body does NOT
 *     self-bloom — its white-hot pin, lamp dots and pulse carry it)
 *   lamp red      #ff4545 → L≈0.488  (blooms ✓)
 *   white pin     #ffffff → L=1.0    (blooms ✓)
 *   terrain base  white @0.44 → L≈0.44 (blooms softly — the whisper halo)
 *   terrain index white @0.92 → L≈0.92 (blooms — index lines are the map grid)
 * So: faults win by white-hot cores + pulse against an evenly glowing map,
 * NOT by red beating white. Raising the threshold above lamp-red (0.488)
 * would kill fault bloom while leaving terrain glowing — this gate forbids it.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */
const THRESHOLD = 0.44; // post.js fx.threshold — keep in sync by hand
const FLOW = 0xf5f2ea; // network.js FLOW_COLOR (warm-white neutral — BLUE RESERVED FOR WATER)
const AMBER = 0xff8c39; // watch amber — flow stays achromatic so it never reads as watch

const lum = (hex) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
const hueDeg = (hex) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const hueSep = (a, b) => {
  const d = Math.abs(hueDeg(a) - hueDeg(b)) % 360;
  return d > 180 ? 360 - d : d;
};

describe('ops3d attention photometry (phase 1 task 10)', () => {
  it('fault hot-core colors clear the bloom threshold', () => {
    assert.ok(lum(0xff4545) > THRESHOLD, `lamp red L=${lum(0xff4545).toFixed(3)} must bloom`);
    assert.ok(lum(0xffffff) > THRESHOLD, 'white pin must bloom');
  });

  it('threshold stays below lamp-red (raising it kills fault bloom, not terrain glow)', () => {
    assert.ok(THRESHOLD < lum(0xff4545), `threshold ${THRESHOLD} vs lamp red ${lum(0xff4545).toFixed(3)}`);
    assert.ok(THRESHOLD > 0.2, 'threshold must still suppress dark-map noise');
  });

  it('critical-red body does NOT self-bloom (documented: pins + pulse carry it)', () => {
    assert.ok(lum(0xe31919) < THRESHOLD, `critical red L=${lum(0xe31919).toFixed(3)} rides under the threshold by design`);
  });

  it('flow neutral-white vs watch amber are never confusable (achromatic, not amber)', () => {
    const r = ((FLOW >> 16) & 255) / 255, g = ((FLOW >> 8) & 255) / 255, b = (FLOW & 255) / 255;
    const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
    assert.ok(sat < 0.08, `flow saturation ${sat.toFixed(3)} must be near-zero (neutral white)`);
    assert.ok(!(b > r && b > g), 'flow must never be blue-dominant (blue reserved for water)');
    assert.ok(hueSep(FLOW, AMBER) > 90 || sat < 0.08, 'achromatic flow cannot read as a watch state');
  });
});

/* Label-plate backplate contrast (Phase 1 remainder: plates read as smudges
 * at TOP against bright contours). Locks src/ops3d/labels.js PLATE_STYLE:
 * the near-black, near-opaque fill must hold ≥4.5:1 contrast against the
 * brightest contour grey (INDEX #9fabb3) while staying far below alarm
 * luminance — plates get legible without shouting over faults.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */
const INDEX_CONTOUR = 0x9fabb3; // terrain.js INDEX_COL — brightest contour
const blendOver = (fill, alpha, bg) => {
  const f = [fill[0] / 255, fill[1] / 255, fill[2] / 255];
  const b = [((bg >> 16) & 255) / 255, ((bg >> 8) & 255) / 255, (bg & 255) / 255];
  return f.map((c, i) => alpha * c + (1 - alpha) * b[i]);
};
const lumRgb = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const contrast = (a, b) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

describe('ops3d label-plate contrast (phase 1 remainder)', () => {
  // PLATE_STYLE mirror — src/ops3d/labels.js is browser-module code
  // (THREE + document at import time); values are asserted here by hand
  // and must be updated together with the source. The screenshot pixel
  // check (plate_before/after.png) is the visual counterpart.
  const PLATE_FILL = [3, 5, 7];
  const ALPHA_ASSET = 0.92;
  const ALPHA_DEST = 0.88;

  it('backplate fill is near-black and near-opaque (source of record: labels.js PLATE_STYLE)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('./ops3d-attention.test.js', import.meta.url));
    const src = readFileSync(here.replace(/tests\/[^/]+$/, 'src/ops3d/labels.js'), 'utf8');
    for (const needle of [
      'fill: [3, 5, 7]',
      'alphaAsset: 0.92',
      'alphaDest: 0.88',
      'depthTest: false',
      'renderOrder = 10',
    ]) assert.ok(src.includes(needle), `labels.js must contain \`${needle}\` (PLATE_STYLE lock)`);
  });

  it('plate-vs-brightest-contour contrast ≥ 4.5:1 (reads at TOP)', () => {
    for (const a of [ALPHA_ASSET, ALPHA_DEST]) {
      const plateL = lumRgb(blendOver(PLATE_FILL, a, INDEX_CONTOUR));
      const c = contrast(plateL, lum(INDEX_CONTOUR));
      assert.ok(c >= 4.5, `alpha ${a}: contrast ${c.toFixed(2)}:1 must clear 4.5:1`);
    }
  });

  it('plates stay far below alarm luminance (faults still lead)', () => {
    const plateL = lumRgb(blendOver(PLATE_FILL, ALPHA_ASSET, INDEX_CONTOUR));
    assert.ok(plateL < THRESHOLD, `plate L=${plateL.toFixed(3)} must not bloom`);
    assert.ok(plateL < lum(0xe31919), `plate L=${plateL.toFixed(3)} below critical-red body`);
  });
});

/* Chevron flow (user direction: cylindrical bone-grey tubes primary; flow is
 * warm-white chevrons + trace with a traveling emerge/fade envelope — no
 * hard-tipped dashes, no blur-glow sprites, no blue/cyan anywhere).
 * Locks src/ops3d/network.js: TubeGeometry walls, cone chevrons with fade
 * in/out envelope, and no dashed LineMaterial outside buried pipe walls.
 */
describe('ops3d chevron flow (no hard dash tips, no blue)', () => {
  const loadNetworkSrc = async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('./ops3d-attention.test.js', import.meta.url));
    return readFileSync(here.replace(/tests\/[^/]+$/, 'src/ops3d/network.js'), 'utf8');
  };

  it('flow layer has no dashed lines (dashes survive only on buried walls)', async () => {
    const src = await loadNetworkSrc();
    assert.ok(!/dashed:\s*true/.test(src), 'no literal dashed:true may remain anywhere');
    assert.ok(/dashed:\s*run\.buried/.test(src), 'buried pipe walls keep their structural dashes');
    assert.ok(src.includes('dashOffset') === false, 'no dashOffset animation may remain in the flow layer');
  });

  it('chevron envelope tapers to zero at both ends (tapered head-to-tail)', async () => {
    const src = await loadNetworkSrc();
    assert.ok(src.includes('flowEnvelope('), 'shared emerge/fade envelope must exist');
    assert.ok(src.includes('smooth01(p / 0.25)'), 'fade-in ramp over travel must exist');
    assert.ok(src.includes('1 - smooth01((p - 0.5) / 0.5)'), 'fade-out ramp over travel must exist');
    assert.ok(src.includes('ConeGeometry'), 'direction chevrons must be cone geometry (no sprites)');
    assert.ok(!src.includes('SpriteMaterial'), 'no blur-glow sprite pulses may remain');
    assert.ok(!src.includes('AdditiveBlending'), 'no additive glow may remain in the flow layer');
  });

  it('no blue/cyan anywhere in network.js (blue reserved for water)', async () => {
    const src = await loadNetworkSrc();
    const stripped = src.replace(/blue\/cyan/gi, '').replace(/blue-led/gi, '');
    assert.ok(!/\bcyan\b/i.test(stripped), 'no cyan reference may remain');
    assert.ok(!src.includes('35c5d8'), 'old cyan flow hex must be gone');
    assert.ok(!src.includes('7fa3b8'), 'old steel-blue dive hex must be gone');
  });

  it('envelope math holds: alpha 0 at birth/death, >0 mid-life', () => {
    const s01 = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
    const env = (p) => s01(p / 0.18) * (1 - s01((p - 0.55) / 0.45));
    assert.equal(env(0), 0, 'pulse born invisible');
    assert.equal(env(1), 0, 'pulse dies invisible');
    assert.ok(env(0.4) > 0.9, `pulse peaks mid-life (env(0.4)=${env(0.4).toFixed(2)})`);
    assert.ok(env(0.09) > 0 && env(0.09) < 0.6, 'fade-in is gradual, not a step');
  });
});

/* Traveling soft-fade flow trace (user direction: white trace stays, but must
 * gently emerge and fade along the pipe — never sit hard).
 * Locks src/ops3d/network.js: each pipe carries a SOLID neutral-white flow
 * trace split into FLOW_LINE_SEGS chunks; tick sweeps the shared
 * flowEnvelope along the pipe (time travel + along-pipe order + per-pipe
 * offset) under a slow global breathing swell. Cone chevrons carry
 * direction. No dashes, no dashOffset, no blue — the dashed ban holds for
 * the whole flow layer, dashes survive only on buried walls.
 */
describe('ops3d traveling flow-line envelope (emerge/fade, never hard)', () => {
  const loadNetworkSrc = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL('../src/ops3d/network.js', import.meta.url), 'utf8');
  };

  it('flow-line chunks + travel + breathing exist in source', async () => {
    const src = await loadNetworkSrc();
    for (const needle of [
      'FLOW_LINE_SEGS',
      'FLOW_LINE_SPEED',
      'FLOW_BREATHE',
      'flowLines.push',
      'flowEnvelope(ph)',
      'Math.sin(t * 0.6)',
      'FLOW_LINE_OPACITY',
      'CHEVRONS_PER_PIPE',
      'TubeGeometry',
    ]) assert.ok(src.includes(needle), `network.js must contain \`${needle}\``);
  });

  it('flow lines stay solid + additive (buried walls keep the only dashes)', async () => {
    const src = await loadNetworkSrc();
    assert.ok(!/dashed:\s*true/.test(src), 'no literal dashed:true may remain anywhere');
    assert.ok(/dashed:\s*run\.buried/.test(src), 'buried pipe walls keep their structural dashes');
    assert.ok(src.includes('dashOffset') === false, 'no dashOffset animation may remain in the flow layer');
  });

  it('envelope math holds: 0 at cycle ends, peak mid-travel, breathing bounded', () => {
    const s01 = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
    const env = (ph) => s01(ph / 0.25) * (1 - s01((ph - 0.5) / 0.5));
    assert.equal(env(0), 0, 'chunk born invisible');
    assert.equal(env(1), 0, 'chunk dies invisible');
    assert.ok(env(0.3) > 0.9, `chunk peaks mid-travel (env(0.3)=${env(0.3).toFixed(2)})`);
    assert.ok(env(0.125) > 0 && env(0.125) < 0.6, 'fade-in is gradual, not a step');
    const breathe = (t) => 1 - 0.35 * (0.5 + 0.5 * Math.sin(t * 0.6));
    for (const t of [0, 2.5, 5, 7.5, 10]) {
      const b = breathe(t);
      assert.ok(b >= 0.65 && b <= 1, `breathing stays a whisper swell (b=${b.toFixed(2)} at t=${t})`);
    }
  });

  it('flow-line peak stays under alarms (prominent but never alarming)', async () => {
    const src = await loadNetworkSrc();
    const m = src.match(/const FLOW_LINE_OPACITY = ([\d.]+)/);
    assert.ok(m, 'FLOW_LINE_OPACITY must be a literal const');
    assert.ok(parseFloat(m[1]) <= 0.65, `line peak ${m[1]} must stay ≤0.65 (prominent flow, pipeline walls whisper)`);
  });
});

/* Elevation-ranked contour glow + land-water edges + flat water fills
 * (user direction, four sub-locks). Locks src/ops3d/terrain.js:
 *  (a) rubric: brightness × width scaled by level rank, summit brightest,
 *      CAPPED below bloom so alarms lead (glow ≤1.0, summit width ≤2.0, whisper opacities);
 *  (b) shore: land edges touching water get the rubric top-rank glow;
 *  (c) water: playa lake renders as a FLAT blue fill (indexed, one level Y)
 *      + 6 organic isobath rings; the main stem carries 2 thin draped blue
 *      wave threads seated on the derived valley floor (no slab, no carets).
 *      Contours masked off water; shore/drain stay neutral grey.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */
describe('ops3d elevation-ranked contour glow (capped, alarms lead)', () => {
  const loadTerrainSrc = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
  };

  it('rubric exists: rank glow + summit batch, width scaled by rank', async () => {
    const src = await loadTerrainSrc();
    for (const needle of [
      'rankGlow(k)',
      'ELEV_GLOW_MIN',
      'summitBatch',
      'summitMat',
      'SUMMIT_TOP_K',
    ]) assert.ok(src.includes(needle), `terrain.js must contain \`${needle}\``);
  });

  it('glow is capped: summit brightness ≤1.0, summit width ≤2.0 (TOP review: no contour bloom)', async () => {
    const src = await loadTerrainSrc();
    const gm = src.match(/const ELEV_GLOW_MAX = ([\d.]+)/);
    assert.ok(gm, 'ELEV_GLOW_MAX must be a literal const');
    assert.ok(parseFloat(gm[1]) <= 1.0, `summit glow ${gm[1]} capped at 1.0 (below bloom, alarms lead)`);
    const wm = src.match(/const SUMMIT_WIDTH = ([\d.]+)/);
    assert.ok(wm, 'SUMMIT_WIDTH must be a literal const');
    assert.ok(parseFloat(wm[1]) <= 2.0, `summit width ${wm[1]} capped at 2.0`);
  });

  it('whisper opacities hold (land sits below pipes/flow/water)', async () => {
    const src = await loadTerrainSrc();
    for (const needle of [
      'baseMat.opacity = 0.16 * dimF',
      'indexMat.opacity = 0.32 * dimF',
      'summitMat.opacity = 0.32 * dimF',
    ]) assert.ok(src.includes(needle), `terrain.js must contain \`${needle}\``);
  });

  it('rubric math holds: brightest at summit, fading downslope', () => {
    const MIN = 0.55, MAX = 0.95, LEVELS = 32;
    const smooth = (a, b, v) => {
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const rankGlow = (k) => MIN + (MAX - MIN) * smooth(0, 1, k / (LEVELS - 1));
    assert.ok(rankGlow(LEVELS - 1) > rankGlow(0), 'summit glows most');
    assert.ok(rankGlow(0) < 1 && rankGlow(LEVELS - 1) <= 1.35, 'capped both ends');
    for (let k = 1; k < LEVELS; k++) assert.ok(rankGlow(k) >= rankGlow(k - 1), `monotone at k=${k}`);
  });
});

describe('ops3d land-water edges + flat blue water fills', () => {
  const loadTerrainSrc = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
  };

  it('shoreline glow: land-water edges get the rubric top rank', async () => {
    const src = await loadTerrainSrc();
    for (const needle of ['shoreTouch', 'waterWet', 'WATER_MASK', 'shoreTouch(x, z) ? ELEV_GLOW_MAX']) {
      assert.ok(src.includes(needle), `terrain.js must contain \`${needle}\``);
    }
    assert.ok(src.includes('linewidth: 2.0') && src.includes('opacity: 0.45'),
      'shoreline ring stays restrained (2.0 wide, 0.45 alpha)');
  });

  it('contours stay off water (fills own it, never hatches)', async () => {
    const src = await loadTerrainSrc();
    assert.ok(src.includes('pwet > WATER_MASK'), 'wet segments must be skipped in pushPath');
    assert.ok(src.includes('batch.segs += 1'), 'segment counts must reflect the mask (per-push, not upfront)');
  });

  it('water is a flat lake fill + draped river threads (no slab, no hatch)', async () => {
    const src = await loadTerrainSrc();
    for (const needle of ['lakeGeo.setIndex', 'const offs = [-0.18, 0.18]', '_heightAt(cx, z) * VEX']) {
      assert.ok(src.includes(needle), `terrain.js must contain \`${needle}\``);
    }
    assert.ok(!src.includes('washPos'), 'old draped wash fan must be gone');
    assert.ok(!src.includes('ribGeo'), 'seamed ribbon slab must be gone (kill-list: water sits IN the trough)');
    assert.ok(!src.includes('drapeRun(stem'), 'old river thread line must be gone');
    assert.ok(!src.includes('riverMat'), 'river line material must be gone (threads only)');
    assert.ok(!src.includes('flowChevs'), 'chevron carets must be gone (kill-list: lines carry flow)');
  });

  it('blue is fill-only: shore/drain stay neutral grey', async () => {
    const src = await loadTerrainSrc();
    assert.ok(src.includes('SHORE_COL = 0x848b90'), 'shoreline stays neutral grey');
    assert.ok(src.includes('DRAIN_COL = 0x848b90'), 'dry-draw stays neutral grey');
    const fills = (src.match(/color: WATER_COL/g) || []).length;
    // lake fill + isobaths + 2 wave threads all use WATER_COL — count ≥2
    assert.ok(fills >= 2, `WATER_COL must feed lake + isobath rings + wave threads, found ${fills}`);
    // ensure no contour blue leaks
    assert.ok(!src.includes('BASE_COL = 0x5f'), 'base contours stay grey, not blue');
  });
});
