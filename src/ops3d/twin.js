/* Safepipe Ops 3D — src/ops3d/twin.js · container-agnostic digital-twin mount.
 * createTwin(container, {feed, onSelect, onCreateWO}) → {setSelection, setFeed, dispose}
 * Owns canvas, ResizeObserver sizing, RAF loop, click-select + keys.
 * Scene/rig/table/network/zones/levels/hud/post are child-owned modules (frozen contracts):
 *   scene.js:        createScene(canvas) → {renderer, scene}
 *   camera.js:       createRig(canvas) → {camera, setPreset, flyTo, update, getTarget}
 *   table.js:        addTable(scene) → {update?}
 *   health-feed.js:  loadFeed() → feed[], healthRollup(feed) → {nominal,watch,critical},
 *                    getLayout() → {pipelines, facilities, sensors}
 *   network.js:      buildNetwork(scene, feed) → {update, setSelection, setHover, pick, setSize, stats}
 *   zones.js:        buildZones(scene, feed) → {update}
 *   levels.js:       createLevels(rig, layout, {onChange}) → {name, setLevel, focusAsset(id, at?), cycle}
 *   terrain.js:      buildTerrain(scene) → {mesh, setSize, update, dispose}
 *   structures.js:   buildStructures(scene, feed, layout) → {group, update, setSelection, dispose}
 *   beacons.js:      buildBeacons(scene, feed, layout) → {update, setSelection, tick, dispose}
 *   hud.js:          buildHud(container, {onSearch, onCreateWO, onLevel}) → {update, dispose}
 *   post.js:         createPost(renderer, scene, camera) → {render, setSize, dispose, fx}
 */
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createRig } from './camera.js';
import { addTable } from './table.js';
import { loadFeed, healthRollup, getLayout } from './health-feed.js';
import { buildNetwork } from './network.js';
import { buildZones } from './zones.js';
import { createLevels } from './levels.js';
import { buildTerrain } from './terrain.js';
import { buildStructures } from './structures.js';
import { buildBeacons } from './beacons.js';
import { buildHud } from './hud.js';
import { createPost } from './post.js';

export function createTwin(container, opts = {}) {
  if (!container) throw new Error('createTwin: container requires a DOM element');
  if (!container.style.position) container.style.position = 'relative';
  let current = opts.feed ?? loadFeed();
  const onSelect = opts.onSelect ?? (() => {});
  const onCreateWO =
    opts.onCreateWO ??
    // eslint-disable-next-line no-console
    ((id) => console.log('[ops3d] create WO for', id));

  const params = new URLSearchParams(window.location.search);
  const postEnabled = params.get('post') !== '0';

  const canvas = document.createElement('canvas');
  canvas.className = 'ops-twin';
  // Container-agnostic sizing: without this the canvas stays at the 300×150
  // default box while the renderer buffer + raycast rect use container size
  // (squished image, wrong pick rays). Inline so owners need no stylesheet.
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  const { renderer, scene } = createScene(canvas);
  const rig = createRig(canvas);
  scene.add(rig.camera);
  const table = addTable(scene);
  const network = buildNetwork(scene, current);
  const zones = buildZones(scene, current);
  const layout = getLayout();
  const terrain = buildTerrain(scene);
  const structures = buildStructures(scene, current, layout);
  const beacons = buildBeacons(scene, current, layout);
  // eslint-disable-next-line no-console
  console.log('[ops3d]', network.stats);

  const byId = () => new Map(current.map((a) => [a.assetId, a]));
  const levels = createLevels(rig, layout, {
    onChange: () => pushHud(),
  });
  const hud = buildHud(container, {
    onSearch: (id) => select(id, { fly: true }),
    onCreateWO,
    onLevel: (name) => {
      try {
        levels.setLevel(name);
      } catch {
        /* unknown level — ignore */
      }
      pushHud();
    },
  });
  const post = createPost(renderer, scene, rig.camera);
  if (!postEnabled) post.fx.enabled = false;

  let selected = null;

  function pushHud() {
    // Tilt-shift DoF follows the view: sharp map up top, cinematic focus
    // band once drilled into ISO/NEAR (target always lands frame-centre).
    post.fx.dof = levels.name === 'asset' ? 0.8 : levels.name === 'segment' ? 0.45 : 0;
    // Detail follows the view too: ghost TOP dots + hide flow beads at NEAR.
    network.setDetail?.(levels.name);
    beacons.setDetail?.(levels.name);
    const map = byId();
    const sel = selected ? map.get(selected) ?? null : null;
    const crit = sel?.health === 'critical' ? sel : current.find((a) => a.health === 'critical');
    hud.update({
      rollup: healthRollup(current),
      selection: sel,
      level: levels.name,
      banner: crit ? { kind: crit.faults[0]?.type ?? 'CRITICAL', assetId: crit.assetId } : null,
    });
  }

  // Arc-length helpers: drill-down aims at the FAULT chainage, not the
  // asset midpoint (a fault at one end of a 37 km line must land in frame).
  const polyLen = (pts) => {
    let t = 0;
    for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return t || 1;
  };
  const arcPoint = (pts, dist) => {
    let t = Math.min(Math.max(dist, 0), polyLen(pts));
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (t <= l || i === pts.length - 1) {
        const f = l === 0 ? 0 : t / l;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      }
      t -= l;
    }
    return pts[pts.length - 1].slice();
  };
  function select(id, { fly = true, at = null } = {}) {
    if (!id || !byId().has(id)) return false;
    selected = id;
    let aim = at;
    if (!aim) {
      const item = byId().get(id);
      const ch = item?.faults?.[0]?.chainage;
      const pipe = item?.kind === 'pipeline' && layout.pipelines.find((p) => p.assetId === id);
      if (pipe && ch != null) {
        const [px, pz] = arcPoint(pipe.points, ch);
        aim = [px, 0.05, pz];
      }
    }
    network.setSelection(id);
    structures.setSelection(id);
    beacons.setSelection(id);
    if (fly) {
      try {
        levels.focusAsset(id, aim);
      } catch {
        /* layout miss — selection still applies */
      }
    }
    onSelect(id);
    pushHud();
    return true;
  }

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  // Ground point under the cursor: drill-down centers the CLICKED point, not
  // the asset midpoint (a fault at one end of a line would land off-frame).
  const clickPoint = (e) => {
    setNdc(e);
    raycaster.setFromCamera(ndc, rig.camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    return [hitPoint.x, 0.05, hitPoint.z];
  };

  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const downPos = [0, 0];
  canvas.addEventListener('pointerdown', (e) => {
    downPos[0] = e.clientX;
    downPos[1] = e.clientY;
  });
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
    // Orbit/pan drags end in a click — ignore presses that traveled so only
    // deliberate taps drill down (otherwise every pan flies the camera).
    if (Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 6) return;
    const at = clickPoint(e);
    setNdc(e);
    const id = network.pick(ndc, rig.camera);
    if (id) select(id, { fly: true, at });
  });
  const onKey = (e) => {
    if (e.key === '1') {
      levels.setLevel('network');
      pushHud();
    } else if (e.key === '2') {
      levels.setLevel('segment');
      pushHud();
    } else if (e.key === '3') {
      levels.setLevel('asset');
      pushHud();
    } else if (e.key === 'Escape') {
      const atTop = levels.name === 'network';
      levels.cycle(-1);
      if (atTop && selected) {
        selected = null;
        network.setSelection(null);
        structures.setSelection(null);
        beacons.setSelection(null);
      }
      pushHud();
    }
  };
  window.addEventListener('keydown', onKey);

  const size = () => {
    const w = container.clientWidth || 2;
    const h = container.clientHeight || 2;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    const bw = Math.floor(w * pr);
    const bh = Math.floor(h * pr);
    network.setSize?.(bw, bh);
    zones.setSize?.(bw, bh);
    terrain.setSize?.(bw, bh);
    post.setSize(bw, bh);
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
    terrain.update?.(now / 1000);
    beacons.tick(now / 1000);
    if (post.fx.enabled) post.render(now / 1000);
    else renderer.render(scene, rig.camera);
  };
  raf = requestAnimationFrame(tick);

  pushHud();
  // Opening frame: fly out to the full mapped circle (rig boots at the
  // close sector preset; HUD already reads TOP so the camera must match).
  levels.setLevel('network');
  // Deep link: ?asset=PIPE-07 drills straight to the asset.
  const deep = params.get('asset');
  if (deep) select(deep, { fly: true });

  return {
    rollup: () => healthRollup(current),
    debug: { camera: rig.camera, target: () => rig.getTarget() },
    setSelection(id) {
      if (id == null) {
        selected = null;
        network.setSelection(null);
        structures.setSelection(null);
        beacons.setSelection(null);
        pushHud();
        return true;
      }
      return select(id, { fly: true });
    },
    setFeed(feed) {
      current = feed;
      network.update(feed);
      zones.update(feed);
      structures.update(feed);
      beacons.update(feed);
      if (selected && !byId().has(selected)) {
        selected = null;
        network.setSelection(null);
        structures.setSelection(null);
        beacons.setSelection(null);
      }
      pushHud();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      hud.dispose();
      post.dispose();
      beacons.dispose();
      structures.dispose();
      terrain.dispose?.();
      renderer.dispose();
      canvas.remove();
    },
  };
}
