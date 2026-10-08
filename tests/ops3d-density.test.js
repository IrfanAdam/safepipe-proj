import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quadrantOf, AUDIT_ROLES, roleOf, localToLonLat, lonLatToLocal, geoQuadrant } from '../src/ops3d/density.js';
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

  it('local↔geo round-trips to <1 m (Phase 2 Overpass contract)', () => {
    for (const [x, z] of [[0, 0], [-15, 12], [14, -12], [12.263, 6.764], [-8.7, -9.1]]) {
      const [lon, lat] = localToLonLat(x, z);
      const [rx, rz] = lonLatToLocal(lon, lat);
      assert.ok(Math.hypot(rx - x, rz - z) < 0.001, `round-trip ${x},${z}`);
      assert.equal(geoQuadrant(lon, lat), quadrantOf(x, z), `quadrant agreement ${x},${z}`);
    }
  });

  it('every layout asset geo-locates inside the site window', () => {
    const L = getLayout();
    for (const f of [...L.facilities, ...L.sensors]) {
      const [lon, lat] = localToLonLat(f.position[0], f.position[1]);
      assert.ok(Math.abs(lat - 57.03) < 0.25 && Math.abs(lon + 111.68) < 0.45, `${f.assetId} in window`);
    }
  });
});
