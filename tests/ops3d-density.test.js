import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quadrantOf, AUDIT_ROLES, roleOf } from '../src/ops3d/density.js';
import { getLayout } from '../src/ops3d/health-feed.js';

describe('ops3d density grammar (phase 1, audit spot map)', () => {
  it('quadrants resolve on known coords', () => {
    assert.equal(quadrantOf(-15, 12), 'NW');
    assert.equal(quadrantOf(0, 0), 'CENTER');
    assert.equal(quadrantOf(14, -12), 'SE');
    assert.equal(quadrantOf(15, 12), 'NE');
    assert.equal(quadrantOf(-14, -12), 'SW');
  });

  it('audit roles cover mines NW, tailings center, pads SE', () => {
    assert.match(AUDIT_ROLES.NW, /mine/i);
    assert.match(AUDIT_ROLES.CENTER, /tailing/i);
    assert.match(AUDIT_ROLES.SE, /pad|SAGD/i);
  });

  it('every layout asset resolves a role (no unlabeled asset)', () => {
    const L = getLayout();
    const assets = [
      ...L.pipelines.map((p) => ({ id: p.assetId, at: p.points[Math.floor(p.points.length / 2)] })),
      ...L.facilities.map((f) => ({ id: f.assetId, at: f.position })),
      ...L.sensors.map((s) => ({ id: s.assetId, at: s.position })),
    ];
    assert.ok(assets.length >= 10, `layout has ${assets.length} assets`);
    for (const a of assets) {
      const r = roleOf(a.id, a.at);
      assert.ok(r && r.quadrant && r.role, `${a.id} has quadrant+role`);
    }
  });
});
