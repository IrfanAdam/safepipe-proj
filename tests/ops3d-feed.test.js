import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildNetwork, BASE_DOT_SIZE, CRITICAL_GAIN } from '../src/ops3d/network.js';
import { loadFeed } from '../src/ops3d/health-feed.js';

const CRITICAL_HEX = 0xe31919;

describe('ops3d feed sizing constants', () => {
  it('exports a positive base dot size and a critical gain above 1', () => {
    assert.equal(typeof BASE_DOT_SIZE, 'number');
    assert.ok(BASE_DOT_SIZE > 0);
    assert.equal(typeof CRITICAL_GAIN, 'number');
    assert.ok(CRITICAL_GAIN > 1);
  });
});

describe('network.update(feed)', () => {
  it('survives nominal→watch→critical flips without throwing', () => {
    const scene = new THREE.Scene();
    const feed = loadFeed();
    assert.ok(feed.length > 0);
    const net = buildNetwork(scene, feed);
    for (const health of ['nominal', 'watch', 'critical']) {
      net.update(feed.map((f) => ({ ...f, health })));
    }
    net.update(feed);
  });

  it('paints critical red onto tracked materials after a critical flip', () => {
    const scene = new THREE.Scene();
    const feed = loadFeed();
    const net = buildNetwork(scene, feed);
    net.update(feed.map((f) => ({ ...f, health: 'critical' })));
    const reds = [];
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m?.color && m.color.getHex() === CRITICAL_HEX) reds.push(o.type);
      }
    });
    assert.ok(reds.length > 0, 'expected critical-red materials after critical flip');
  });
});
