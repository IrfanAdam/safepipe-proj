// tests/map-boot-once.test.js — boot-once smart cache: one scroll zoom-in
// boots the twin shell exactly once per hotspot; takeover + arrival reuse
// the warm shell via retarget (no second navigation/reload); after first
// paint only tiles/details stream in (the twin re-pins its hold pose,
// never re-boots the shell). Own file — the stall-harden lane owns its.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TWIN_RETARGET_MSG,
  buildTwinRetargetMessage,
  isTwinRetargetMessage,
  parseTwinRetargetFrame,
} from '../src/map/twinlink.js';
import {
  TWIN_RETARGET_MSG as TWIN_RETARGET_MSG_TWIN,
  isTwinRetargetMessage as isTwinRetargetMessageTwin,
  parseTwinRetargetFrame as parseTwinRetargetFrameTwin,
} from '../src/ring2/sector.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

function fnSlice(main, name, endMarker) {
  const open = main.indexOf(`function ${name}(`);
  assert.ok(open !== -1, `${name} exists`);
  const close = main.indexOf(endMarker, open);
  assert.ok(close > open, `${name} closes before ${endMarker}`);
  return main.slice(open, close);
}

test('retarget wire agrees on both sides of the iframe boundary', () => {
  assert.equal(TWIN_RETARGET_MSG, 'safepipe-twin-retarget');
  assert.equal(TWIN_RETARGET_MSG_TWIN, TWIN_RETARGET_MSG, 'twin names the map channel');
  assert.equal(isTwinRetargetMessageTwin, isTwinRetargetMessage, 'twin reuses the twinlink predicate');
  assert.equal(parseTwinRetargetFrameTwin, parseTwinRetargetFrame, 'twin reuses the twinlink parser');
});

test('retarget builder sanitizes like the boot URL params', () => {
  const msg = buildTwinRetargetMessage({ cx: 49.5, cy: 40.3, z: 11.5, bearing: 0, pitch: 45 });
  assert.deepEqual(msg, {
    type: TWIN_RETARGET_MSG,
    frame: { cx: 49.5, cy: 40.3, z: 11.5, bearing: 0, pitch: 45 },
  });
  assert.ok(isTwinRetargetMessage(msg), 'the built payload passes the gate');
  assert.deepEqual(parseTwinRetargetFrame(msg), msg.frame, 'parse round-trips the frame');
  // Bearing/pitch are additive — absent when non-finite, like twinUrl.
  assert.deepEqual(
    buildTwinRetargetMessage({ cx: 49.5, cy: 40.3, z: 11.5 }),
    { type: TWIN_RETARGET_MSG, frame: { cx: 49.5, cy: 40.3, z: 11.5 } },
  );
  for (const bad of [null, undefined, {}, { cx: 49.5, cy: 40.3 }, { cx: 999, cy: 40.3, z: 11 },
    { cx: 49.5, cy: 40.3, z: -1 }, { cx: 'x', cy: 40.3, z: 11 }]) {
    assert.equal(buildTwinRetargetMessage(bad), null, `bad frame rejected (${JSON.stringify(bad)})`);
    assert.equal(parseTwinRetargetFrame({ type: TWIN_RETARGET_MSG, frame: bad }), null, 'bad frame never parses');
  }
  assert.equal(parseTwinRetargetFrame({ type: 'safepipe-twin-staged', s: 1 }), null, 'staged never parses as retarget');
  assert.equal(parseTwinRetargetFrame(null), null, 'null never parses');
});

test('early boot records the shell key; re-entry for the same hotspot is warm', () => {
  const main = srcOf('../src/map/main.js');
  const boot = fnSlice(main, 'earlyBootTwin', '/** Boot-once reuse');
  assert.ok(boot.includes('twinBootKey = h3'), 'the boot records the live shell key');
  assert.ok(
    boot.includes('twinBootKey === h3map[siteSector]') && boot.includes('return true'),
    'an armed re-entry for the same hotspot is warm — no second boot',
  );
  assert.equal(
    boot.match(/setFrameUrl\(/g)?.length ?? 0,
    1,
    'the boot site navigates exactly once',
  );
  assert.ok(main.includes('twinBootKey = null'), 'teardown clears the key');
});

test('arrival reuses the warm shell: one boot per zoom, no reload', () => {
  const main = srcOf('../src/map/main.js');
  const arrival = fnSlice(main, 'prewarmThenReveal', '/* Unstaged + staged fallback reveal');
  assert.ok(arrival.includes('reuseWarmTwin(h3, frame)'), 'arrival consults the warm shell first');
  assert.ok(
    arrival.includes('if (!warmReused) setFrameUrl(frameEl, url)'),
    'arrival navigates only when there is no warm shell to reuse',
  );
  assert.ok(
    arrival.includes('if (earlyTwinArmed && !warmReused)'),
    'the stale-close guard arms only on actual navigation (reuse has no unload echo)',
  );
  const open = fnSlice(main, 'openTwin', '/** Actual teardown');
  assert.ok(open.includes('reuseWarmTwin(h3, handoff)'), 'direct opens reuse the warm shell too');
  assert.ok(
    open.includes('if (!warmReused) setFrameUrl(frame, url)'),
    'direct opens navigate only when there is no warm shell',
  );
  assert.ok(
    main.includes('win.postMessage(msg'),
    'reuse hands the arrival frame to the live shell via postMessage (selective update)',
  );
  assert.ok(
    main.includes('buildTwinRetargetMessage(frame)'),
    'reuse posts the sanitized retarget payload',
  );
});

test('abort + close blank the shell key so the next dive boots fresh', () => {
  const main = srcOf('../src/map/main.js');
  const abort = fnSlice(main, 'abortEarlyBootTwin', '/** Handoff-4 Lane A seeded reveal');
  assert.ok(abort.includes('twinBootKey = null'), 'aborting the prewarm clears the key');
  const close = fnSlice(main, 'doCloseTwin', 'function mountChrome');
  assert.ok(close.includes('twinBootKey = null'), 'closing the twin clears the key');
});

test('twin re-pins the hold pose on retarget — tiles stream, shell never reboots', () => {
  const twin = srcOf('../src/ring2/main.js');
  const at = twin.indexOf('isTwinRetargetMessage(e?.data)');
  assert.ok(at !== -1, 'the twin listens for retarget');
  const listener = twin.slice(at, twin.indexOf('/* Capture-phase wheel', at));
  assert.ok(listener.includes("handoff.phase !== 'hold'"), 'retarget applies only pre-release (hold)');
  assert.ok(listener.includes('handoff.readyPosted'), 'a posted ready is never re-pinned');
  assert.ok(listener.includes('refitHandoffRange()'), 'the hold pose re-pins from the arrival frame');
  assert.ok(listener.includes('handoff.frame = f'), 'the arrival frame becomes the match frame');
  assert.ok(!listener.includes('location'), 'retarget never navigates — no shell reboot');
});
