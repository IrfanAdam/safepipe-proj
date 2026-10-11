// tests/ring2-ctxmon.test.js — Phase 4, Safari context-loss telemetry.
// Pins the six status-bar tokens + the context registry so one real-Safari
// screenshot discriminates every defect-hunt hypothesis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCtxMon,
  ctxLive,
  ctxLost,
  ctxRestored,
  mapLostPending,
  noteMapAdopted,
  hostSuffix,
  noteTileErr,
  noteTileOk,
  killGL,
  pxToken,
  ctxToken,
  cxlToken,
  tileToken,
  ldTerrToken,
  effToken,
  CTX_DECODE,
} from '../src/ring2/ctxmon.js';

test('registry: fresh counters are zeroed', () => {
  const m = createCtxMon(() => 1000);
  assert.equal(m.live, 0);
  assert.equal(m.lost, 0);
  assert.equal(m.restored, 0);
  assert.equal(m.tileErr, 0);
  assert.equal(m.tileOk, 0);
  assert.equal(m.lastHost, '-');
});

test('ctxLive: adjusts but never below zero', () => {
  const m = createCtxMon();
  assert.equal(ctxLive(m, +1), 1);
  assert.equal(ctxLive(m, +1), 2);
  assert.equal(ctxLive(m, -1), 1);
  assert.equal(ctxLive(m, -5), 0);
});

test('lost/restored: stamps per canvas, pending until restore', () => {
  let now = 1000;
  const m = createCtxMon(() => now);
  assert.equal(mapLostPending(m), false);
  ctxLost(m, 'map');
  assert.equal(m.mapLostAt, 1000);
  assert.equal(m.lost, 1);
  assert.equal(mapLostPending(m), true);
  now = 2000;
  ctxLost(m, 'twin');
  assert.equal(m.twinLostAt, 2000);
  assert.equal(mapLostPending(m), true); // twin restore must not clear map pending
  now = 3000;
  ctxRestored(m, 'twin');
  assert.equal(mapLostPending(m), true);
  now = 4000;
  ctxRestored(m, 'map');
  assert.equal(mapLostPending(m), false);
});

test('generation: remount adopts clear an older instance pending loss', () => {
  let now = 1000;
  const m = createCtxMon(() => now);
  noteMapAdopted(m); // gen 1: first mount
  ctxLost(m, 'map');
  assert.equal(mapLostPending(m), true);
  // Dead canvas never fires restore; the replacement adopts (gen 2) —
  // pending clears even though mapRestoredAt < mapLostAt.
  noteMapAdopted(m);
  assert.equal(mapLostPending(m), false);
  // A loss on the NEW instance pends again (stamped at the new gen).
  now = 2000;
  ctxLost(m, 'map');
  assert.equal(mapLostPending(m), true);
  // A stale restore from the dead canvas also clears (restoredAt passes).
  now = 3000;
  ctxRestored(m, 'map');
  assert.equal(mapLostPending(m), false);
});

test('hostSuffix: bare hostname out of URLs and messages', () => {
  assert.equal(
    hostSuffix('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/1/2'),
    'server.arcgisonline.com',
  );
  assert.equal(hostSuffix('Load failed: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/2/3.png 404'), 's3.amazonaws.com');
  assert.equal(hostSuffix('map WebGL context LOST (GPU)'), '-');
  assert.equal(hostSuffix(''), '-');
  assert.equal(hostSuffix(null), '-');
});

test('tile counters: err keeps host, ok counts', () => {
  const m = createCtxMon();
  noteTileErr(m, 'boom https://server.arcgisonline.com/x 500');
  noteTileErr(m, 'no url here');
  noteTileOk(m);
  noteTileOk(m);
  noteTileOk(m);
  assert.equal(m.tileErr, 2);
  assert.equal(m.tileOk, 3);
  assert.equal(m.lastHost, 'server.arcgisonline.com');
  assert.equal(tileToken(m), 'tile:2/3:server.arcgisonline.com');
});

test('killGL: single loseContext, skipped when already lost', () => {
  let calls = 0;
  const gl = { getExtension: () => ({ loseContext: () => { calls++; } }) };
  killGL({ getContext: () => gl }, false);
  assert.equal(calls, 1);
  killGL({ getContext: () => { throw new Error('must not touch GL when lost'); } }, true);
  assert.equal(calls, 1);
  killGL(null, false); // never throws
  killGL({ getContext: () => null }, false);
});

test('pxToken: canvas vs container vs dpr vs ratio', () => {
  assert.equal(pxToken({ cw: 1280, ch: 800, ew: 1280, eh: 800, dpr: 2, pr: 2 }), 'px:1280x800/c:1280x800/dpr:2/pr:2');
  assert.equal(pxToken({ cw: 0, ch: 0, ew: 1280, eh: 800, dpr: 2, pr: 0 }), 'px:0x0/c:1280x800/dpr:2/pr:0');
  assert.ok(pxToken({ cw: 0, ch: 0 }).includes('pr:-'));
});

test('ctxToken + cxlToken: census and last event', () => {
  let now = 5000;
  const m = createCtxMon(() => now);
  m.live = 2;
  assert.equal(ctxToken(m), 'ctx:2L:0/R:0');
  assert.equal(cxlToken(m), 'cxl:-');
  ctxLost(m, 'map');
  assert.equal(cxlToken(m), 'cxl:map:lost@5000');
  assert.equal(ctxToken(m), 'ctx:2L:1/R:0');
  now = 6000;
  ctxRestored(m, 'map');
  assert.equal(cxlToken(m), 'cxl:map:restored@6000');
  now = 7000;
  ctxLost(m, 'twin');
  assert.equal(cxlToken(m), 'cxl:twin:lost@7000');
});

test('ldTerrToken + effToken: loaded/terrain and effective mix', () => {
  assert.equal(ldTerrToken({ loaded: true, terrain: 'vex' }), 'ld:1/terr:vex');
  assert.equal(ldTerrToken({ loaded: false, terrain: 'off' }), 'ld:0/terr:off');
  assert.equal(ldTerrToken({ loaded: true, terrain: 'mis' }), 'ld:1/terr:mis');
  assert.equal(ldTerrToken({ loaded: true, terrain: 'bogus' }), 'ld:1/terr:off');
  assert.equal(effToken(50), 'eff:50');
  assert.equal(effToken(100), 'eff:100');
});

test('CTX_DECODE: legend names every token', () => {
  for (const tok of ['pr:0', 'ctx', 'cxl', 'tile', 'ld', 'terr', 'eff']) {
    assert.ok(CTX_DECODE.includes(tok), `decode missing ${tok}`);
  }
});
