import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildNetwork, flowEnvelope } from '../src/ops3d/network.js';
import { loadFeed, getLayout } from '../src/ops3d/health-feed.js';

const src = () => readFileSync(new URL('../src/ops3d/network.js', import.meta.url), 'utf8');

/* Cylindrical tube walls: TubeGeometry (radialSegments 8) is the primary
 * pipe read — it must shade cylindrical at ISO drill-in. */
describe('ops3d tube walls (cylindrical, neutral)', () => {
  it('every pipeline gets TubeGeometry walls with low radial segments', () => {
    const scene = new THREE.Scene();
    const net = buildNetwork(scene, loadFeed());
    const tubes = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'TubeGeometry' && o.material?.visible !== false)
        tubes.push(o);
    });
    assert.ok(tubes.length >= getLayout().pipelines.length,
      `expected ≥${getLayout().pipelines.length} visible tubes, found ${tubes.length}`);
    for (const t of tubes)
      assert.equal(t.geometry.parameters.radialSegments, 8, 'tubes use 8 radial segs');
    assert.ok(net.stats.tubes >= getLayout().pipelines.length, 'stats.tubes tracks walls');
  });

  it('nominal tubes are neutral bone-grey whispers (fault tints only on state)', () => {
    const s = src();
    assert.ok(s.includes('0x8a857a'), 'nominal bone-grey present');
    const scene = new THREE.Scene();
    buildNetwork(scene, loadFeed());
    const bones = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'TubeGeometry' && o.material?.visible !== false)
        bones.push(o.material.color.getHex());
    });
    assert.ok(bones.length > 0);
    for (const h of bones)
      assert.ok(h === 0x8a857a || h === 0xff8c39 || h === 0xe31919,
        `tube color 0x${h.toString(16)} must be bone/amber/red only`);
  });

  it('watch/critical flips tint tube walls amber/red', () => {
    const scene = new THREE.Scene();
    const feed = loadFeed();
    const net = buildNetwork(scene, feed);
    net.update(feed.map((f) => ({ ...f, health: 'critical' })));
    const reds = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'TubeGeometry' && o.material.color.getHex() === 0xe31919)
        reds.push(o);
    });
    assert.ok(reds.length > 0, 'critical flip must tint tubes red');
  });
});

/* Flow layer: warm-white only. BLUE IS RESERVED FOR WATER — no blue/cyan in
 * network.js source or in any live flow material. */
describe('ops3d flow has no blue/cyan', () => {
  it('source palette is bone/amber/red/white/bone-dive only', () => {
    const s = src();
    const hexes = [...s.matchAll(/0x([0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
    const allowed = new Set(['8a857a', 'ff8c39', 'e31919', 'f5f2ea', 'cfc9bc']);
    for (const h of hexes)
      assert.ok(allowed.has(h), `hex 0x${h} is not in the allowed neutral palette`);
  });

  it('live flow materials (trace + chevrons) are warm white, never blue-led', () => {
    const scene = new THREE.Scene();
    const net = buildNetwork(scene, loadFeed());
    net.tick(3.7); // mid-envelope: flow opacities > 0
    const flows = [];
    scene.traverse((o) => {
      const isFlow = (o.isLine2) ||
        (o.isMesh && o.geometry?.type === 'ConeGeometry') ||
        (o.isMesh && o.geometry?.type === 'OctahedronGeometry');
      if (isFlow && o.material?.color && o.material.opacity > 0.01) flows.push(o.material);
    });
    assert.ok(flows.length > 0, 'expected visible flow materials mid-envelope');
    for (const m of flows) {
      const { r, g, b } = m.color;
      assert.ok(!(b > r && b > g), `flow color #${m.color.getHexString()} must never be blue-led`);
    }
  });
});

/* Flow envelope math: emerge/fade with zero at both ends, crest mid-travel. */
describe('ops3d flowEnvelope math', () => {
  it('0 at cycle ends, crest mid-travel, gradual ramps', () => {
    assert.equal(flowEnvelope(0), 0, 'born invisible');
    assert.equal(flowEnvelope(1), 0, 'dies invisible');
    assert.ok(flowEnvelope(0.3) > 0.9, `crests mid-travel (${flowEnvelope(0.3).toFixed(2)})`);
    assert.ok(flowEnvelope(0.125) > 0 && flowEnvelope(0.125) < 0.6, 'fade-in is gradual');
  });
});

/* Chevrons: cones riding the centerline upstream→downstream, noses on the
 * tangent, opacity under the envelope. */
describe('ops3d flow chevrons (direction read)', () => {
  const cones = (scene) => {
    const out = [];
    scene.traverse((o) => { if (o.isMesh && o.geometry?.type === 'ConeGeometry') out.push(o); });
    return out;
  };

  it('each pipe carries chevron cones', () => {
    const scene = new THREE.Scene();
    buildNetwork(scene, loadFeed());
    const n = getLayout().pipelines.length;
    assert.ok(cones(scene).length >= n, 'every pipe gets direction chevrons');
  });

  it('chevrons travel along the path and fade under the envelope', () => {
    const scene = new THREE.Scene();
    const net = buildNetwork(scene, loadFeed());
    net.tick(0);
    const p0 = cones(scene).map((c) => c.position.clone());
    const o0 = cones(scene).map((c) => c.material.opacity);
    net.tick(4);
    const p1 = cones(scene).map((c) => c.position.clone());
    const o1 = cones(scene).map((c) => c.material.opacity);
    const moved = p1.filter((p, i) => p.distanceTo(p0[i]) > 1e-6).length;
    assert.ok(moved > p1.length / 2, `chevrons must travel (${moved}/${p1.length} moved)`);
    assert.ok(o0.some((o) => o > 0) || o1.some((o) => o > 0), 'envelope must crest somewhere');
    assert.ok([...o0, ...o1].every((o) => o >= 0 && o <= 0.91), 'opacity stays in envelope bounds');
  });
});

/* Buried rule: dashed + dimmed by design, and ONLY there. */
describe('ops3d buried runs stay dashed + dimmed', () => {
  it('dashes exist only on buried-wall overlays', () => {
    const s = src();
    assert.ok(!/dashed:\s*true/.test(s), 'no literal dashed:true may remain anywhere');
    assert.ok(/dashed:\s*run\.buried/.test(s), 'buried pipe walls keep their structural dashes');
    assert.ok(s.includes('dashOffset') === false, 'no dashOffset animation may remain');
  });

  it('buried materials render dimmer than surface materials', () => {
    const s = src();
    assert.ok(s.includes('run.buried ? 0.50 : 1'), 'buried runs dim to 50% by design');
    const scene = new THREE.Scene();
    buildNetwork(scene, loadFeed());
    let dashed = 0, solid = 0;
    scene.traverse((o) => {
      if (o.isLine2 && o.material.opacity > 0) {
        if (o.material.dashed) dashed += 1; else solid += 1;
      }
    });
    assert.ok(dashed > 0, 'buried dashed overlays must exist in-scene');
    assert.ok(solid > 0, 'surface solid overlays must exist in-scene');
  });
});
