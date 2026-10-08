import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLevels } from '../src/ops3d/levels.js';
import { autoFstop } from '../src/ops3d/post.js';
import { fovForFocal, lensCocPx } from '../src/ops3d/camera.js';

const layout = {
  pipelines: [{ assetId: 'PIPE-02', points: [[0, 0], [10, 0]] }],
  facilities: [{ assetId: 'FAC-01', position: [5, 5] }],
  sensors: [{ assetId: 'SEN-01', position: [2, 2] }],
};

const mockRig = () => {
  const flights = [];
  return {
    flights,
    flyTo(pos, tgt, dur) {
      flights.push({ pos: [...pos], tgt: [...tgt], dur });
    },
  };
};
const last = (rig) => rig.flights[rig.flights.length - 1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('levels framing', () => {
  it('focusAsset aims at the asset ground point', () => {
    const rig = mockRig();
    const lv = createLevels(rig, layout, {});
    lv.focusAsset('FAC-01');
    const f = last(rig);
    assert.ok(Math.hypot(f.tgt[0] - 5, f.tgt[2] - 5) < 1e-6, `target on asset, got ${f.tgt}`);
    assert.ok(Math.abs(dist(f.pos, f.tgt) - 0.9) < 1e-6, `facility close-up dist, got ${dist(f.pos, f.tgt)}`);
  });

  it('flown orbit target is the asset point itself (exact frame centre)', () => {
    const rig = mockRig();
    const lv = createLevels(rig, layout, {});
    lv.focusAsset('PIPE-02');
    const f = last(rig);
    // Midpoint of the 10-unit line; camera looks straight at it → NDC 0,0.
    assert.ok(Math.hypot(f.tgt[0] - 5, f.tgt[2] - 0) < 1e-6, `target IS the asset point, got ${f.tgt}`);
    // Camera sits on the preset ray through the target (no lateral offset).
    const dx = f.pos[0] - f.tgt[0];
    const dz = f.pos[2] - f.tgt[2];
    const yaw = Math.atan2(dx, dz) * 180 / Math.PI;
    assert.ok(Math.abs(yaw - 4) < 0.5, `camera on the 4° yaw ray, got ${yaw.toFixed(2)}°`);
  });

  it('network level keeps the selected asset in frame (not origin)', () => {
    const rig = mockRig();
    const lv = createLevels(rig, layout, {});
    lv.focusAsset('FAC-01');
    lv.setLevel('network');
    const f = last(rig);
    assert.ok(Math.hypot(f.tgt[0] - 5, f.tgt[2] - 5) < 1e-6, `TOP stays on asset, got ${f.tgt}`);
    const d = dist(f.pos, f.tgt);
    assert.ok(d < 20, `TOP just high enough to see a facility, got dist ${d.toFixed(2)}`);
  });

  it('network level with no selection still frames the origin', () => {
    const rig = mockRig();
    const lv = createLevels(rig, layout, {});
    lv.setLevel('network');
    const f = last(rig);
    assert.deepEqual([f.tgt[0], f.tgt[2]], [0, 0]);
    assert.ok(Math.abs(dist(f.pos, f.tgt) - 62) < 1e-6);
  });

  it('asset level with no selection dollies in place (never jumps to a fallback model)', () => {
    const rig = mockRig();
    const lv = createLevels(rig, layout, {});
    lv.setLevel('asset');
    const f = last(rig);
    assert.deepEqual([f.tgt[0], f.tgt[2]], [0, 0]);
    assert.ok(Math.abs(dist(f.pos, f.tgt) - 3.0) < 1e-6);
  });

  it('TOP distance fits the asset kind (line needs height, box does not)', () => {
    const rig = mockRig();
    const lv = createLevels(rig, layout, {});
    lv.focusAsset('PIPE-02');
    lv.setLevel('network');
    const pipeDist = dist(last(rig).pos, last(rig).tgt);
    lv.focusAsset('FAC-01');
    lv.setLevel('network');
    const facDist = dist(last(rig).pos, last(rig).tgt);
    assert.ok(pipeDist > facDist * 2, `pipe TOP ${pipeDist.toFixed(1)} vs facility TOP ${facDist.toFixed(1)}`);
  });
});

describe('lens', () => {
  it('auto aperture is deep up top, fast glass drilled in', () => {
    assert.equal(autoFstop('network'), 6.5);
    assert.equal(autoFstop('segment'), 2.2);
    assert.equal(autoFstop('asset'), 1.4);
  });

  it('focal length maps to real FOV (24mm-high frame)', () => {
    assert.ok(Math.abs(fovForFocal(50) - 27) < 0.5, `50mm ≈ 27°, got ${fovForFocal(50)}`);
    assert.ok(Math.abs(fovForFocal(32) - 41.1) < 0.5, `32mm ≈ 41°, got ${fovForFocal(32)}`);
    assert.ok(fovForFocal(18) > fovForFocal(120), 'wide < tele');
  });

  it('CoC is zero on the focus plane and grows off-plane', () => {
    const on = lensCocPx(32, 1.8, 2.2, 2.2, 1800, 41);
    assert.equal(on, 0);
    // Honest optics: 32mm @ ƒ/1.8 focused at 2.2m melts the near foreground…
    const front = lensCocPx(32, 1.8, 2.2, 0.5, 1800, 41);
    assert.ok(front > 1, `foreground melts at ƒ/1.8, got ${front}`);
    // …and long fast glass melts the background (hyperfocal does the rest).
    const behind = lensCocPx(120, 1.4, 2.2, 10, 1800, fovForFocal(120));
    assert.ok(behind > 1, `120mm @ ƒ/1.4 melts background, got ${behind}`);
  });

  it('CoC shrinks stopping down and grows with longer glass', () => {
    const wide = lensCocPx(32, 1.8, 2.2, 10, 1800, 41);
    const stopped = lensCocPx(32, 8, 2.2, 10, 1800, 41);
    assert.ok(stopped < wide / 3, `ƒ/8 ≈ 4.4× calmer than ƒ/1.8 (${stopped} vs ${wide})`);
    const tele = lensCocPx(85, 1.8, 2.2, 10, 1800, fovForFocal(85));
    assert.ok(tele > wide, `85mm melts harder than 32mm (${tele} vs ${wide})`);
  });

  it('CoC guards junk inputs', () => {
    assert.equal(lensCocPx(32, 0, 2.2, 10, 1800, 41), 0);
    assert.equal(lensCocPx(32, 1.8, -1, 10, 1800, 41), 0);
    assert.equal(lensCocPx(32, 1.8, 2.2, 0, 1800, 41), 0);
  });
});
