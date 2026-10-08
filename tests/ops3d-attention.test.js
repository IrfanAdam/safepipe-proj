import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* Ops 3D attention-lock photometry (Phase 1, Task 10).
 * Locks the TRUE bloom relationships instead of the old shorthand claim.
 * Bright-pass: smoothstep(threshold=0.36, +0.25) on Rec.601 luminance.
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
const THRESHOLD = 0.36; // post.js fx.threshold — keep in sync by hand
const FLOW = 0x35c5d8; // network.js FLOW_COLOR (cool cyan)
const AMBER = 0xff8c39; // watch amber — flow must never read as watch

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

  it('flow cyan vs watch amber are opposite hues (never confusable)', () => {
    assert.ok(hueSep(FLOW, AMBER) > 90, `hue separation ${hueSep(FLOW, AMBER).toFixed(0)}°`);
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

/* Soft-fade flow (user direction: no hard-tipped dashes in the flow layer).
 * Locks src/ops3d/network.js: flow rides comet sprites with a fade-in/out
 * envelope — zero alpha at both ends of each pulse life — and no dashed
 * LineMaterial remains outside buried pipe walls.
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */
describe('ops3d soft flow pulses (no hard dash tips)', () => {
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

  it('pulse envelope tapers to zero at both ends (tapered head-to-tail)', async () => {
    const src = await loadNetworkSrc();
    assert.ok(src.includes('smooth01(phase / 0.18)'), 'fade-in ramp over pulse life must exist');
    assert.ok(src.includes('1 - smooth01((phase - 0.55) / 0.45)'), 'fade-out ramp over pulse life must exist');
    assert.ok(src.includes('AdditiveBlending'), 'pulses must be additive (whisper over bright contours)');
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
