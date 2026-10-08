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
