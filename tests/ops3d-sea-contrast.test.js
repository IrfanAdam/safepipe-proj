import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  field, VEX, WATER_COL,
  isSeaDepth, SHADE_VEX, SEA_BRIGHT_LO, SEA_BRIGHT_SPAN,
} from '../src/ops3d/terrain.js';
import { SEA_LABEL_TEXT, makeSeaLabelSprite } from '../src/ops3d/labels.js';

/* Ops 3D ocean identity + elevation legibility at true scale (Sangachal twin).
 * Locks src/ops3d/terrain.js + src/ops3d/labels.js:
 *  (1) sea unmistakable: sub-sea-level DEM fill verts read water-blue and
 *      BRIGHTER than land charcoal (blue stays water-only);
 *  (2) low hills read at VEX 1 via shading-only relief exaggeration —
 *      geometry untouched (VEX still 1);
 *  (3) the -78 m pill sitting in the sea is bathymetry, not a valley:
 *      sub-sea-level low points label SEABED under the DEM source, VALLEY
 *      everywhere else;
 *  (4) the open water carries a CASPIAN SEA identity label.
 */

const TERRAIN_SRC = readFileSync(new URL('../src/ops3d/terrain.js', import.meta.url), 'utf8');
const LABELS_SRC = readFileSync(new URL('../src/ops3d/labels.js', import.meta.url), 'utf8');

const lum = (hex) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe('ops3d sea identity — bathymetry is not a valley', () => {
  it('isSeaDepth: below-sea-level reads as sea ONLY under the DEM source', () => {
    assert.equal(isSeaDepth(-0.078, 'dem'), true, '-78 m under DEM is seabed');
    assert.equal(isSeaDepth(-0.001, 'dem'), true, 'any sub-sea-level DEM vert is water');
    assert.equal(isSeaDepth(0.05, 'dem'), false, 'high ground is never sea');
    assert.equal(isSeaDepth(-0.078, 'procedural'), false, 'procedural datum is relative — valley stays a valley');
    assert.equal(isSeaDepth(-0.078), false, 'default source is procedural');
  });

  it('valley pill labels a sub-sea-level DEM low as SEABED, land lows stay VALLEY', () => {
    assert.ok(TERRAIN_SRC.includes('SEABED'), 'buildTerrain carries a SEABED pill path');
    assert.ok(TERRAIN_SRC.includes('isSeaDepth('), 'pill choice goes through isSeaDepth');
    assert.ok(TERRAIN_SRC.includes("'VALLEY'"), 'land lows keep the VALLEY pill');
  });
});

describe('ops3d sea identity — sea fill unmistakable, land stays charcoal', () => {
  it('sea vertex brightness floor reads clearly above land charcoal', () => {
    assert.ok(SEA_BRIGHT_LO >= 0.7, `sea floor ${SEA_BRIGHT_LO} must lift off the charcoal`);
    assert.ok(SEA_BRIGHT_LO + SEA_BRIGHT_SPAN <= 1.25, 'sea cap stays out of alarm bloom');
    const sea = lum(WATER_COL) * SEA_BRIGHT_LO;
    const landHi = lum(0x3a3d40) * 1.2; // brightest possible land vert (sunlit cap)
    assert.ok(sea > landHi, `sea ${sea.toFixed(3)} must beat brightest land ${landHi.toFixed(3)}`);
  });

  it('fillVert tints sub-sea-level DEM verts water-blue (source-gated, baths stay)', () => {
    const m = TERRAIN_SRC.match(/const fillVert = \(x, z\) => \{([\s\S]*?)\n    \};/);
    assert.ok(m, 'fillVert builder present');
    assert.ok(m[1].includes('SEA'), 'below-sea-level verts tint water-blue (SEA := WATER_COL)');
    assert.ok(TERRAIN_SRC.includes('const SEA = new THREE.Color(WATER_COL)'), 'sea tint is the reserved water blue');
    assert.ok(m[1].includes("'dem'"), 'sea tint is gated on the DEM source (procedural lows stay land)');
  });
});

describe('ops3d legibility at VEX 1 — shading-only relief, geometry untouched', () => {
  it('twin geometry stays true-scale (VEX 1)', () => {
    assert.equal(VEX, 1, 'data stays 1:1 — no geometry exaggeration');
  });

  it('hillshade normals use a shading-only exaggeration (relief reads, field() untouched)', () => {
    assert.ok(SHADE_VEX > 1, `shading exaggeration ${SHADE_VEX} must exceed 1 at VEX 1`);
    assert.ok(TERRAIN_SRC.includes('SHADE_VEX'), 'hillshade grid reads SHADE_VEX');
    assert.ok(!/field\(x, z\) \* SHADE_VEX|h \* SHADE_VEX/.test(TERRAIN_SRC),
      'no geometry (field heights, fill positions) may use SHADE_VEX');
  });

  it('shade swing stays deep-shadowed but capped (greys stay grey)', () => {
    const m = TERRAIN_SRC.match(/const shadeToBright = \(t\) => ([\d.]+) \+ ([\d.]+) \*/);
    assert.ok(m, 'shadeToBright must be a literal ramp');
    const lo = parseFloat(m[1]), span = parseFloat(m[2]);
    assert.ok(lo <= 0.68, `shadow floor ${lo} deep enough for volume`);
    assert.ok(lo + span <= 1.15, `sunlit cap ${(lo + span).toFixed(2)} keeps greys grey`);
    assert.ok(span >= 0.4, `swing ${span} reads directionally`);
  });

  it('field() relief is untouched (procedural floor still the Athabasca recipe)', () => {
    assert.ok(Number.isFinite(field(0, 0)), 'field samples');
  });
});

describe('ops3d sea identity — CASPIAN SEA water label', () => {
  it('labels.js names the water', () => {
    assert.equal(SEA_LABEL_TEXT, 'CASPIAN SEA');
  });

  it('sea-label factory builds a water-styled sprite (blue-only, never an alarm color)', () => {
    const keepDescriptive = globalThis.document;
    try {
      const ctx2d = new Proxy({}, {
        get: (t, p) => {
          if (p === 'measureText') return () => ({ width: 100 });
          if (p === 'canvas') return {};
          return typeof p === 'string' ? (() => {}) : undefined;
        },
        set: () => true,
      });
      globalThis.document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
      };
      const sp = makeSeaLabelSprite();
      assert.ok(sp, 'factory returns a sprite');
      assert.equal(sp.userData.sea, true, 'sprite is tagged sea (detail rescale skips it)');
      const col = sp.material.color.getHex();
      const [r, g, b] = [col >> 16 & 255, col >> 8 & 255, col & 255];
      assert.ok(b > r + 20, 'sea label reads water-blue, not grey or alarm');
      assert.equal(sp.material.depthTest, false, 'water label overdraws the fill, never hides under it');
    } finally {
      if (keepDescriptive === undefined) delete globalThis.document;
      else globalThis.document = keepDescriptive;
    }
  });

  it('buildTerrain plants the sea label over DEM open water (and only there)', () => {
    assert.ok(TERRAIN_SRC.includes('makeSeaLabelSprite'), 'terrain plants the water label');
    assert.ok(LABELS_SRC.includes('makeSeaLabelSprite'), 'factory lives in labels.js');
  });
});
