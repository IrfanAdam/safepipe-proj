/* Safepipe Ops 3D — src/ops3d/twin.js · container-agnostic digital-twin mount.
 * createTwin(container, {feed, onSelect}) → {setSelection, setFeed, dispose}
 * Owns canvas, ResizeObserver sizing, RAF loop, click-select + keys.
 * Scene/rig/table/network/zones are child-owned modules (frozen contracts):
 *   scene.js:        createScene(canvas) → {renderer, scene}
 *   camera.js:       createRig(canvas) → {camera, setPreset, flyTo, update}
 *   table.js:        addTable(scene) → {update?}
 *   health-feed.js:  loadFeed() → feed[], healthRollup(feed) → {nominal,watch,critical}
 *   network.js:      buildNetwork(scene, feed) → {update, setSelection, pick, stats}
 *   zones.js:        buildZones(scene, feed) → {update}
 */
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createRig } from './camera.js';
import { addTable } from './table.js';
import { loadFeed, healthRollup } from './health-feed.js';
import { buildNetwork } from './network.js';
import { buildZones } from './zones.js';

export function createTwin(container, opts = {}) {
  if (!container) throw new Error('createTwin: container requires a DOM element');
  let current = opts.feed ?? loadFeed();
  const onSelect = opts.onSelect ?? (() => {});

  const canvas = document.createElement('canvas');
  canvas.className = 'ops-twin';
  container.appendChild(canvas);

  const { renderer, scene } = createScene(canvas);
  const rig = createRig(canvas);
  scene.add(rig.camera);
  const table = addTable(scene);
  const network = buildNetwork(scene, current);
  const zones = buildZones(scene, current);
  // eslint-disable-next-line no-console
  console.log('[ops3d]', network.stats);

  let selected = null;
  const ndc = new THREE.Vector2();
  const setNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  };
  canvas.addEventListener('mousemove', (e) => {
    setNdc(e);
    const id = network.pick(ndc, rig.camera);
    if (network.setHover(id)) canvas.style.cursor = id ? 'pointer' : '';
  });
  canvas.addEventListener('mouseleave', () => {
    network.setHover(null);
    canvas.style.cursor = '';
  });
  canvas.addEventListener('click', (e) => {
    setNdc(e);
    const id = network.pick(ndc, rig.camera);
    if (id) {
      selected = id;
      network.setSelection(id);
      onSelect(id);
    }
  });
  const onKey = (e) => {
    if (e.key === '1') rig.setPreset('plan');
    else if (e.key === '2') rig.setPreset('sector');
    else if (e.key === '3') rig.setPreset('wide');
    else if (e.key === 'Escape' && selected) {
      selected = null;
      network.setSelection(null);
    }
  };
  window.addEventListener('keydown', onKey);

  const size = () => {
    const w = container.clientWidth || 2;
    const h = container.clientHeight || 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
  };
  const ro = new ResizeObserver(size);
  ro.observe(container);
  size();

  let raf = 0;
  let last = performance.now();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    rig.update(dt, now / 1000);
    table.update?.(now / 1000);
    renderer.render(scene, rig.camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    rollup: () => healthRollup(current),
    setSelection(id) {
      selected = id;
      network.setSelection(id);
    },
    setFeed(feed) {
      current = feed;
      network.update(feed);
      zones.update(feed);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      renderer.dispose();
      canvas.remove();
    },
  };
}
