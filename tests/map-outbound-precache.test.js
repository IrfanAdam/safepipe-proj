// tests/map-outbound-precache.test.js — the reverse leg's tile warm and the
// enclosure zoom seal. The dive ladder warms the site 3x3 on the climb; this
// pins the opposite direction (viewport patch one level BELOW the camera,
// sat + vector, low priority) and the rule that once the mask has converged
// the map is a still plate: only the plane (S) scales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/map/main.js'), 'utf8');
const slice = (start, end) => {
  const a = SRC.indexOf(start);
  const b = SRC.indexOf(end, a + 1);
  assert.ok(a !== -1 && b > a, `source block ${start} → ${end} exists`);
  return SRC.slice(a, b);
};

test('outbound warm derives the viewport patch, not the site 3x3', () => {
  const fn = slice('function viewportTileOffsets(', 'function prefetchSatTiles(');
  assert.ok(fn.includes('Math.ceil(w / (2 * tilePx)) + 1'), 'radius comes from the live width');
  assert.ok(fn.includes('Math.ceil(h / (2 * tilePx)) + 1'), 'radius comes from the live height');
  assert.ok(fn.includes('Math.hypot(dx / rx, dy / ry)'), 'centre-out ellipse ordering');
  assert.ok(fn.includes('return out.map'), 'returns plain [dx, dy] offsets');
  const sat = slice('function prefetchSatTiles(', 'function warmSatLadder(');
  assert.ok(sat.includes('opts.viewport'), 'the sat warm accepts the viewport mode');
  assert.ok(sat.includes('viewportTileOffsets(opts.wPx, opts.hPx)'), 'the viewport offsets are consumed');
  assert.ok(sat.includes("opts.lowPriority ? 'low' : (hot ? 'high' : 'low')"), 'outbound warms never contend the live frame');
});

test('a zoom-out crossing warms the level BELOW the camera (sat + vector)', () => {
  const fn = slice('function warmOutboundLevel(', '/** Track journey velocity');
  assert.ok(fn.includes('const target = level - 1;'), 'the next lower level is the target');
  assert.ok(fn.includes('viewport: true'), 'the whole widening viewport is warmed');
  assert.ok(fn.includes('lowPriority: true'), 'speculative in both lanes');
  assert.ok(fn.includes('satOpacityForZoom(target) > 0.02'), 'satellite warms stop where the satellite is faded out');
  assert.ok(fn.includes('const vectorVisible = target < Z_FADE1'), 'vector warms only where the basemap is visible');
  assert.ok(fn.includes('level: target'), 'vector warm uses the TARGET level, not the live one');
  const dir = slice('function noteZoomDirection(', '/** Track journey velocity');
  assert.ok(dir.includes('zz < prev - 1e-4'), 'direction is read from the camera, not the wheel sign');
  assert.ok(dir.includes("warmOutboundLevel(zz, 'outbound')"), 'outbound movement arms the warm');
  const step = slice('function onNativeZoomStep(', 'const opacity = setSatScrubbed');
  assert.ok(step.includes('noteZoomDirection(z)'), 'every native zoom step feeds the direction detector');
});

test('outbound retention is bounded and per-source', () => {
  assert.ok(SRC.includes('maxTileCacheSize: 384'), 'a bounded hard cache ceiling');
  assert.ok(SRC.includes('maxTileCacheZoomLevels: 8'), 'deeper level retention for the reverse leg');
});

test('the enclosure seals BOTH zoom bounds at the converged gate', () => {
  const lock = slice('function lockStagedZoomAtGate(', 'function releaseStagedZoomLock(');
  assert.ok(lock.includes('z >= Z_HANDOFF - 0.02'), 'only at the handoff pose');
  assert.ok(lock.includes('setMaxZoom(Z_HANDOFF)') && lock.includes('setMinZoom(Z_HANDOFF)'), 'both directions pin to the gate');
  const release = slice('function releaseStagedZoomLock(', 'function restoreMaxZoom(');
  assert.ok(release.includes('setMinZoom(MAP_FLOOR)'), 'the floor is restored first');
  assert.ok(release.includes('setMaxZoom(Z_MAX)'), 'the ceiling is restored after');
  const restore = slice('function restoreMaxZoom(', 'function freezeStagedFrame(');
  assert.ok(restore.includes('stagedZoomLocked ? Z_HANDOFF : Z_MAX'), 'a stall release cannot unseal the upper bound');
  const step = slice('function onNativeZoomStep(', 'const opacity = setSatScrubbed');
  assert.ok(step.includes('lockStagedZoomAtGate()'), 'the per-step driver seals on arrival');
  assert.ok(SRC.includes('try { releaseStagedZoomLock(); } catch'), 'exit/close paths release');
  const staged = slice('function exitStaged(', 'function resetStagedOwnership(');
  assert.ok(staged.includes('releaseStagedZoomLock()'), 'the reverse exit releases the seal');
});
