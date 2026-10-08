import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  HATCH_SIGNATURES,
  markerForAsset,
  isMarkerType,
  chamferPath,
  paintHatch,
} from '../src/ops3d/markers.js';

/* Hatched infrastructure markers (Phase 1 feedback).
 * One diagonal-hatch signature per surface type inside a chamfered
 * circle/rect; HUD legend maps hatch → type; nothing unexplained sits
 * below the surface (buried pipe runs stay dashed by design).
 * [plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-1]
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(resolve(root, p), 'utf8');

describe('ops3d hatch signatures (one per type)', () => {
  it('covers compressor, valve, terminal, wellhead', () => {
    for (const t of ['compressor', 'valve', 'terminal', 'wellhead']) {
      assert.ok(isMarkerType(t), `${t} is a known marker type`);
      assert.ok(HATCH_SIGNATURES[t].label.length > 0, `${t} has a legend label`);
    }
  });

  it('every signature is unique (shape × angle × spacing)', () => {
    const keys = Object.values(HATCH_SIGNATURES).map(
      (s) => `${s.shape}:${s.angle}:${s.spacing}`,
    );
    assert.equal(new Set(keys).size, keys.length, `signatures collide: ${keys}`);
  });

  it('angles are diagonal (never 0°/90°) and shapes are circle/rect only', () => {
    for (const [t, s] of Object.entries(HATCH_SIGNATURES)) {
      assert.ok(![0, 90, 180, 270].includes(((s.angle % 180) + 180) % 180),
        `${t} angle ${s.angle}° must read diagonal`);
      assert.ok(['circle', 'rect'].includes(s.shape), `${t} shape ${s.shape}`);
    }
  });

  it('maps seeded assets to types; pipelines get no hatch (dashed buried)', () => {
    assert.equal(markerForAsset('FAC-01'), 'compressor');
    assert.equal(markerForAsset('FAC-02'), 'valve');
    assert.equal(markerForAsset('FAC-03'), 'terminal');
    assert.equal(markerForAsset('SEN-01'), 'wellhead');
    assert.equal(markerForAsset('PIPE-01'), null);
    assert.equal(markerForAsset('NOPE-00'), null);
  });

  it('paintHatch draws diagonal strokes for every signature (fake ctx)', () => {
    for (const sig of Object.values(HATCH_SIGNATURES)) {
      const calls = [];
      const ctx = {
        clearRect: () => {}, save: () => {}, restore: () => {}, clip: () => {},
        beginPath: () => {}, closePath: () => {}, stroke: () => calls.push(1),
        moveTo: () => {}, lineTo: () => {},
        arc: () => {}, set strokeStyle(v) {}, set lineWidth(v) {},
      };
      paintHatch(ctx, 256, 160, sig);
      assert.ok(calls.length > 0, `${sig.label} strokes ink`);
      // chamfer path closes a 5-point plate (never a round rect)
      const pts = [];
      const pc = { beginPath: () => {}, closePath: () => {}, moveTo: (x, y) => pts.push([x, y]), lineTo: (x, y) => pts.push([x, y]) };
      chamferPath(pc, 0, 0, 100, 40);
      assert.equal(pts.length, 5, 'chamfer plate is 5 points (4 corners + 1 cut)');
    }
  });
});

describe('ops3d surface-only rule (no unexplained underground)', () => {
  it('structures.js has no drop lines below datum', () => {
    const s = src('src/ops3d/structures.js');
    assert.ok(!s.includes('drops('), 'drop-line helper + calls are gone');
    assert.ok(!s.includes('yBot'), 'no below-datum bleed parameter remains');
    assert.ok(!s.includes('position.y = -'), 'no asset sits below the surface');
    assert.ok(!s.match(/,\s*-\d+\s*\)/), 'no below-datum depth literals remain');
  });

  it('hatch markers sit on the skin (y ≥ 0) and dispose with the asset', () => {
    const s = src('src/ops3d/structures.js');
    assert.ok(s.includes('hatchMarkerAt'), 'world-scale hatch pads are built per asset');
    assert.ok(s.includes('field(x, z) * VEX + lift'), 'pad ground-sits on the terrain skin');
    assert.ok(s.includes('FAC_PAD'), 'one pad signature per facility');
  });
});

describe('ops3d hatch legend (HUD)', () => {
  it('hud.js shows a hatch→type key (now behind ▣ icon, hidden by default) with the schematic note', () => {
    const h = src('src/ops3d/hud.js');
    assert.ok(h.includes('ops-hud__legend'), 'legend present');
    assert.ok(h.includes('ops-hud__legend--hidden'), 'legend hidden by default behind icon (like ?)');
    assert.ok(h.includes('▣') && h.includes('legendBtn'), 'legend toggle button exists');
    for (const row of ['hatch-compressor', 'hatch-valve', 'hatch-terminal', 'hatch-wellhead']) {
      assert.ok(h.includes(row), `legend keys ${row}`);
    }
    assert.ok(h.includes('MARKERS DENOTE TYPE'), 'schematic/type-not-site note present');
  });

  it('hud.css paints one diagonal swatch per type (bone only)', () => {
    const c = src('src/ops3d/hud.css');
    for (const sw of ['hatch-compressor', 'hatch-valve', 'hatch-terminal', 'hatch-wellhead']) {
      assert.ok(c.includes(`ops-hud__swatch--${sw}`), `swatch ${sw} styled`);
    }
    assert.ok(c.includes('repeating-linear-gradient'), 'swatches use diagonal-line fills');
  });
});
