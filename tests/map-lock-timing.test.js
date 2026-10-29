// tests/map-lock-timing.test.js — lane lock-timing: center-anchored zoom
// starts exactly at mask arm, never cursor-pans after. The enclosing mask
// (vignette) writes on near && shared blend > 0; every zoom write path must
// consult that same arm — never the older 6.5 lock arm, never the cursor
// once the mask is up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Z_CENTER,
  Z_LOCK_ARM,
  centerBlendForZoom,
  lockAroundPoint,
} from '../src/map/scrolltrigger.js';

const srcOf = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('mask arm is the shared blend gate: 0 at/below Z_CENTER, open above', () => {
  assert.equal(centerBlendForZoom(Z_CENTER), 0, 'at the center checkpoint the blend is exactly closed');
  assert.equal(centerBlendForZoom(Z_CENTER - 0.5), 0, 'below the checkpoint the mask is down');
  assert.ok(centerBlendForZoom(Z_CENTER + 0.01) > 0, 'the first tick past arms the mask');
  assert.ok(Z_LOCK_ARM < Z_CENTER, 'the retired lock arm sat below the mask arm (early centering)');
});

test('phantom anchor math is unchanged (beyond-spot in, canvas-center out)', () => {
  assert.deepEqual(lockAroundPoint(700, 400, 640, 400, true), { x: 754, y: 400 }, 'zoom-in anchors past the spot');
  assert.deepEqual(lockAroundPoint(700, 400, 640, 400, false), { x: 640, y: 400 }, 'zoom-out anchors at canvas center');
  assert.equal(lockAroundPoint(NaN, 0, 0, 0, true), null, 'non-finite parks');
});

test('driver: every zoom write path gates on the mask arm, never the lock', () => {
  const main = srcOf('../src/map/main.js');
  assert.ok(main.includes('function maskArmed()'), 'the single mask-arm gate exists');
  assert.ok(
    main.includes('if (twinOpen || !mapRef) return false;'),
    'the gate bails under an open twin or before load',
  );
  assert.ok(
    main.includes('centerBlendForZoom(z) <= 0) return false;'),
    'the gate keys off the shared blend (mask arm), not a zoom literal',
  );
  assert.ok(!main.includes('function lockEngaged'), 'the old on-screen lock is gone — no second gate');
  assert.ok(!main.includes('Z_LOCK_ARM'), 'the old arm literal is unimported');
  assert.ok(!main.includes('lockState'), 'no lockState ctx survives on either flip install');
  assert.ok(main.includes('ctx.maskArmed && ctx.maskArmed()'), 'the wheel flip clones a phantom anchor only while armed');
  assert.ok(main.includes('window.__mapProbe.maskArmed'), 'the arm publishes on the probe');
  assert.ok(
    main.includes('else if (holdCenter) opts.center = holdCenter;'),
    'takeover zoom-out under the mask holds the live center instead of the cursor',
  );
  assert.ok(
    main.includes('const maskNow = centerBlendForZoom(z) > 0 && !!(prox && prox.armed);'),
    'the takeover consults the same armed gate as the vignette',
  );
});
