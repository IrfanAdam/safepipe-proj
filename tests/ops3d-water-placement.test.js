import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  field, riverX, drainPathFromGrid,
  surveyChannelFromGrid, detectLakeBasins, waterPlacementFromGrid,
} from '../src/ops3d/terrain.js';

/* Ops 3D DEM→water derivation (real-site twin).
 * Water placement must be MEASURED from the sampled altitude grid — river
 * channel + lake positions/levels — never hand-tuned constants. Synthetic
 * placement (analytic corridor + fixed playa) survives only as the
 * procedural/unavailable fallback.
 */

const SIZE = 44;
const chanXat = (chan, n, step, z) => {
  const gz = Math.min(n, Math.max(0, (z + SIZE / 2) / step));
  const j0 = Math.min(n - 1, Math.floor(gz)), f = gz - j0;
  return chan[j0] * (1 - f) + chan[j0 + 1] * f;
};
const sampleField = (n) => {
  const step = SIZE / n;
  const H = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) H[j * (n + 1) + i] = field(-SIZE / 2 + i * step, -SIZE / 2 + j * step);
  }
  return { H, step };
};
/* Custom grid: diagonal valley along xV(z) + one closed basin + ripple. */
const synthGrid = (n, xV, basin) => {
  const step = SIZE / n;
  const H = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -SIZE / 2 + i * step, z = -SIZE / 2 + j * step;
      let h = -0.06 * Math.exp(-(((x - xV(z)) / 1.5) ** 2)); // ~60 m valley
      if (basin) {
        const dx = x - basin.x, dz = z - basin.z;
        h += -basin.d * Math.exp(-(dx * dx + dz * dz) / (basin.r * basin.r));
      }
      h += 0.001 * Math.sin(x * 1.3 + 0.5) * Math.sin(z * 1.1 - 0.7); // 1 m ripple
      H[j * (n + 1) + i] = h;
    }
  }
  return { H, step };
};

describe('ops3d DEM→water — surveyed channel needs no analytic axis', () => {
  it('tracks the procedural valley without teleporting (hill-in-channel reach aside)', () => {
    // The recipe parks hill H1 inside the valley around z≈+10, so the true
    // floor wanders there; the survey must still never jump across the
    // window. Precision is asserted on the clean grid below.
    const n = 44, { H, step } = sampleField(44);
    const chan = surveyChannelFromGrid(H, n, step);
    let maxJump = 0;
    for (let j = 1; j <= n; j++) maxJump = Math.max(maxJump, Math.abs(chan[j] - chan[j - 1]));
    assert.ok(maxJump < 2.6, `no teleport, max row jump ${maxJump.toFixed(2)} km`);
    const devs = [];
    for (let z = -15; z <= 15; z += 0.5) devs.push(Math.abs(chanXat(chan, n, step, z) - riverX(z)));
    devs.sort((a, b) => a - b);
    assert.ok(devs[Math.floor(devs.length / 2)] < 0.8, `median tracks axis`);
    assert.ok(devs[devs.length - 1] < 4, `worst stays in the valley reach`);
  });

  it('finds an off-analytic valley the fixed corridor cannot reach', () => {
    // Real Athabasca runs x≈+3…+12 diagonally; prove the survey follows the
    // GRID: valley along x=-10+0.35z sits far outside corridor [2,18].
    const n = 88, xV = (z) => -10 + 0.35 * z;
    const { H, step } = synthGrid(n, xV, null);
    const chan = surveyChannelFromGrid(H, n, step);
    for (let z = -15; z <= 15; z += 2.5) {
      assert.ok(Math.abs(chanXat(chan, n, step, z) - xV(z)) < 0.6,
        `z=${z}: surveyed ${chanXat(chan, n, step, z).toFixed(2)} vs true ${xV(z).toFixed(2)}`);
    }
    const old = drainPathFromGrid(H, n, step);
    let oldOff = 0;
    for (let z = -15; z <= 15; z += 5) oldOff = Math.max(oldOff, Math.abs(chanXat(old, n, step, z) - xV(z)));
    assert.ok(oldOff > 3, `corridor survey must miss it (off by ${oldOff.toFixed(1)} km) — why the full-window survey exists`);
  });
});

describe('ops3d DEM→water — measured lake basins', () => {
  it('measures two basins on a flat grid: positions, depths, radii, levels', () => {
    // Flat plane (no tilt) + valley far east + two Gaussian bowls + 1 m ripple.
    const n = 88, step = SIZE / n;
    const H = new Float32Array((n + 1) * (n + 1));
    const bowls = [
      { x: -9, z: 6, r: 1.3, d: 0.014 },
      { x: 5, z: -8, r: 0.8, d: 0.008 },
    ];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -SIZE / 2 + i * step, z = -SIZE / 2 + j * step;
        let h = -0.06 * Math.exp(-(((x - 18) / 1.5) ** 2));
        for (const b of bowls) h += -b.d * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r));
        h += 0.001 * Math.sin(x * 1.3 + 0.5) * Math.sin(z * 1.1 - 0.7);
        H[j * (n + 1) + i] = h;
      }
    }
    const chan = surveyChannelFromGrid(H, n, step);
    const lakes = detectLakeBasins(H, n, step, SIZE, { channel: chan });
    assert.equal(lakes.length, 2);
    const [a, b] = lakes; // deepest-first: A then B
    assert.ok(Math.hypot(a.x + 9, a.z - 6) < 0.7, `basin A at (-9,6), got (${a.x.toFixed(2)},${a.z.toFixed(2)})`);
    assert.ok(Math.abs(a.depthKm - 0.014) < 0.014 * 0.35, `A depth ~14 m, got ${(a.depthKm * 1000).toFixed(1)} m`);
    assert.ok(a.radiusKm > 0.5 && a.radiusKm < 2.0, `A radius ~1.3 km, got ${a.radiusKm.toFixed(2)} km`);
    assert.ok(Math.abs(a.levelKm + 0.0105) < 0.002, `A level ≈ floor+25%, got ${(a.levelKm * 1000).toFixed(2)} m`);
    assert.ok(Math.hypot(b.x - 5, b.z + 8) < 0.7, `basin B at (5,-8), got (${b.x.toFixed(2)},${b.z.toFixed(2)})`);
    assert.ok(Math.abs(b.depthKm - 0.008) < 0.008 * 0.4, `B depth ~8 m, got ${(b.depthKm * 1000).toFixed(1)} m`);
    assert.ok(b.radiusKm > 0.3 && b.radiusKm < 0.8, `B radius ~0.5 km (quarter-depth), got ${b.radiusKm.toFixed(2)} km`);
    assert.ok(Math.abs(b.levelKm + 0.006) < 0.002, `B level ≈ floor+25%, got ${(b.levelKm * 1000).toFixed(2)} m`);
  });

  it('rejects a bending canyon with no lakes (breadth + compactness vetoes)', () => {
    // 40 m deep, 0.65 km wide winding trough on a flat plane — the synthetic
    // dry-draw signature. Unmasked on purpose: the vetoes must kill it.
    const n = 88, step = SIZE / n;
    const H = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -SIZE / 2 + i * step, z = -SIZE / 2 + j * step;
        const dLine = (x - 2 * Math.sin(z * 0.5)) / 0.65;
        H[j * (n + 1) + i] = -0.04 * Math.exp(-dLine * dLine)
          + 0.001 * Math.sin(x * 1.3 + 0.5) * Math.sin(z * 1.1 - 0.7);
      }
    }
    assert.deepEqual(detectLakeBasins(H, n, step, SIZE, { channel: null }), []);
  });

  it('finds a custom basin where the grid puts it — not the constants', () => {
    const n = 88, xV = () => 2; // valley far from the basin
    const { H, step } = synthGrid(n, xV, { x: 14, z: -12, r: 1.0, d: 0.012 });
    const chan = surveyChannelFromGrid(H, n, step);
    const lakes = detectLakeBasins(H, n, step, SIZE, { channel: chan });
    assert.equal(lakes.length, 1);
    const [b] = lakes;
    assert.ok(Math.hypot(b.x - 14, b.z + 12) < 0.8, `basin at (14,-12), got (${b.x.toFixed(2)},${b.z.toFixed(2)})`);
    assert.ok(Math.hypot(b.x + 9, b.z - 6) > 5, 'not the synthetic playa constants');
    assert.ok(Math.abs(b.levelKm + 0.009) < 0.002, `level ≈ floor+25% depth, got ${(b.levelKm * 1000).toFixed(2)} m`);
    assert.ok(b.radiusKm > 0.4 && b.radiusKm < 1.6, `radius ~1 km, got ${b.radiusKm.toFixed(2)} km`);
  });

  it('ignores deep pools ON the channel (river water, not lakes)', () => {
    const n = 44, step = SIZE / n;
    const H = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = -SIZE / 2 + i * step;
        H[j * (n + 1) + i] = -0.0005 * x - 0.05 * Math.exp(-(((x - 5) / 1.0) ** 2));
      }
    }
    const chan = new Float32Array(n + 1).fill(5);
    assert.deepEqual(detectLakeBasins(H, n, step, SIZE, { channel: chan }), []);
  });

  it('flat grid yields no water (no phantom lakes)', () => {
    const n = 44, step = SIZE / n;
    assert.deepEqual(detectLakeBasins(new Float32Array((n + 1) * (n + 1)), n, step), []);
  });
});

describe('ops3d DEM→water — placement seam + fallback', () => {
  it('dem source: surveyed channel + measured basins, zero constants', () => {
    const n = 88, xV = (z) => 6 + 0.2 * z;
    const { H, step } = synthGrid(n, xV, { x: 14, z: -12, r: 1.0, d: 0.012 });
    const p = waterPlacementFromGrid(H, n, step, SIZE, 'dem');
    for (let z = -12; z <= 12; z += 4) {
      assert.ok(Math.abs(chanXat(p.channel, n, step, z) - xV(z)) < 0.6, `z=${z} on the grid valley`);
    }
    assert.equal(p.lakes.length, 1);
    assert.equal(p.lakes[0].organic, false);
    assert.ok(Math.hypot(p.lakes[0].x - 14, p.lakes[0].z + 12) < 0.8, 'basin from the grid');
    assert.ok(Number.isFinite(p.lakes[0].level), 'level measured, not null');
  });

  it('procedural source: analytic corridor + synthetic playa (fallback intact)', () => {
    const n = 44, { H, step } = sampleField(n);
    const p = waterPlacementFromGrid(H, n, step, SIZE, 'procedural');
    assert.equal(p.lakes.length, 1);
    assert.equal(p.lakes[0].organic, true);
    assert.equal(p.lakes[0].level, null);
    const ref = drainPathFromGrid(H, n, step);
    assert.deepEqual([...p.channel], [...ref]);
  });

  it('unknown source falls back to synthetic (never half-derived)', () => {
    const n = 44, { H, step } = sampleField(n);
    const p = waterPlacementFromGrid(H, n, step, SIZE, 'bogus');
    assert.equal(p.lakes.length, 1);
    assert.equal(p.lakes[0].organic, true);
  });
});
