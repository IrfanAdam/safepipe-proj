// tests/map-lock-early.test.js — LOCK-EARLY: hotspot lock-in at the staged
// arm (not S-max recovery), zero center drift mid-hold, pan restored after
// unwind. Guards the owner verdict: (a) centering happened only via the
// near-fail re-park at S-max; (b) drag could pan mid-staged; (c) fork-guard
// resolves + Esc closes leaked the camera lock (pan never restored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('lock tick fires at the staged arm, onto the SITE anchor', () => {
  const main = srcOf('../src/map/main.js');
  const freeze = main.slice(main.indexOf('function freezeStagedFrame()'), main.indexOf('function reassertStagedAnchor('));
  assert.ok(freeze.length > 500, 'freezeStagedFrame body is intact');
  assert.ok(
    freeze.includes('mapRef.jumpTo({ center: SITE_LNGLAT })'),
    'arm recenters onto the SITE anchor as staged begins (not at S-max recovery)',
  );
  assert.ok(
    freeze.includes('LOCK-EARLY lock tick'),
    'the arm lock tick is marker-pinned',
  );
});

test('staged ticks hard-pin the center: no glide gate, no pan drift', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('mapRef.jumpTo({ center: [stagedAnchor.cx, stagedAnchor.cy] })'),
    'every staged tick re-seats the map on the anchor center',
  );
  assert.ok(
    !main.includes('stagedFreezeCenter.lng + (stagedAnchor.cx'),
    'the k-gated S-glide is gone: centering no longer waits on reveal progress',
  );
  assert.ok(
    main.includes('LOCK-EARLY hard center pin'),
    'the hard pin is marker-pinned',
  );
});

test('arm disables all panning; unwind restores it', () => {
  const main = srcOf('../src/map/main.js');
  const freeze = main.slice(main.indexOf('function freezeStagedFrame()'), main.indexOf('function reassertStagedAnchor('));
  for (const h of ['mapRef.dragPan', 'mapRef.touchZoomRotate', 'mapRef.keyboard']) {
    assert.ok(freeze.includes(`${h}.disable()`), `${h} disabled at arm`);
  }
  const unfreeze = main.slice(main.indexOf('function unfreezeStagedFrame()'), main.indexOf('function postTwinStagedS('));
  for (const h of ['mapRef.dragPan', 'mapRef.touchZoomRotate', 'mapRef.boxZoom', 'mapRef.keyboard']) {
    assert.ok(unfreeze.includes(`${h}`) && unfreeze.includes('.enable()'), `${h} re-enabled on unwind`);
  }
});

test('pan restores on every teardown: unwind, commit-forks, Esc close', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(
    main.includes('unfreezeStagedFrame(); // MAP FRAME FREEZE: unwind releases the camera lock'),
    'exitStaged releases the lock on reverse unwind',
  );
  assert.ok(
    main.includes('unfreezeStagedFrame(); // MAP FRAME FREEZE: commit releases the camera lock'),
    'finalizeStagedReveal releases the lock on commit',
  );
  const forkLocks = main.match(/unfreezeStagedFrame\(\); \/\/ LOCK-EARLY: a resolved hold must not keep the camera lock/g) || [];
  assert.equal(forkLocks.length, 2, `both fork-guard resolves release the lock (found ${forkLocks.length})`);
  const close = main.slice(main.indexOf('function doCloseTwin()'), main.indexOf('function flattenJourneyTiltToLaw('));
  assert.ok(close.includes('if (stagedActive && !stagedCommitted) exitStaged();'), 'Esc/close unwinds a live staged hold');
  assert.ok(close.includes('unfreezeStagedFrame();'), 'Esc/close releases the camera lock even for fork-resolved holds');
});

test('S-max near-fail recovery stays the invisible backstop', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('NEAR-FAIL RECOVERY'), 'the S-max re-park comment is intact');
  assert.ok(
    main.includes('window.__mapProbe.staged.recovering = recovered;'),
    'the recovery probe still reports',
  );
});
