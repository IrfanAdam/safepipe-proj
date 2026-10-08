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
import { buildLabels } from './labels.js';
import { buildGridFloor } from './gridfloor.js';
import { buildChecker } from './checker.js';
import { buildOverlays } from './overlays.js';
import { ensureAudio, audioLive, play, setMuted, isMuted } from './sound.js';
import { field, VEX } from './terrain.js';
import { buildHud } from './hud.js';
import { createPost, autoFstop } from './post.js';

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
  const gridfloor = buildGridFloor(scene);
  const checker = buildChecker(scene);
  const labels = buildLabels(scene, { layout, healthById: byId() });
  const overlays = buildOverlays(scene, { layout });
  // Twin-data overlays: O cycles OFF → WEATHER → TECTONIC → FORECAST.
  let overlayMode = null;
  const OVERLAY_ORDER = [null, 'weather', 'tectonic', 'forecast'];
  function cycleOverlay() {
    overlayMode = OVERLAY_ORDER[(OVERLAY_ORDER.indexOf(overlayMode) + 1) % OVERLAY_ORDER.length];
    overlays.setMode(overlayMode);
    ensureAudio();
    play('toggle');
    pushHud();
  }
  const levels = createLevels(rig, layout, {
    onChange: () => pushHud(),
  });
  // Camera focus: autofocus tracks whatever is under the cursor, falling
  // back to the click point / selection, then the orbit target. Aperture
  // (f-stop) and focal length (mm, real zoom) are always live; the camera
  // panel (one ⌖ icon, sliders hidden inside) holds them plus manual focus
  // distance + the DoF switch. dof:null = auto = on at every level.
  const focusCtl = { af: true, fstop: 5.6, focalMm: 32, focusDist: 10, dof: null, panel: false };
  let fstopTouched = false;
  let hoveredId = null;
  let clickAnchor = null;
  // Ground anchor for an asset: fault chainage on pipes (what select() aims
  // at), stored position for facilities/sensors, orbit target as fallback.
  const anchorFor = (id) => {
    const item = byId().get(id);
    if (item?.kind === 'pipeline') {
      const pipe = layout.pipelines.find((p) => p.assetId === id);
      const ch = item?.faults?.[0]?.chainage;
      if (pipe && ch != null) {
        const [px, pz] = arcPoint(pipe.points, ch);
        return new THREE.Vector3(px, field(px, pz) * VEX + 0.05, pz);
      }
      if (pipe) {
        const m = pipe.points[Math.floor(pipe.points.length / 2)];
        return new THREE.Vector3(m[0], field(m[0], m[1]) * VEX + 0.05, m[1]);
      }
    } else {
      const all = [...(layout.facilities ?? []), ...(layout.sensors ?? [])];
      const found = all.find((a) => a.assetId === id);
      if (found?.position) {
        const [px, pz] = found.position;
        return new THREE.Vector3(px, field(px, pz) * VEX + 0.05, pz);
      }
    }
    return rig.getTarget();
  };
  const focusAnchor = () => {
    if (focusCtl.af && hoveredId && byId().has(hoveredId)) return anchorFor(hoveredId);
    if (clickAnchor) return clickAnchor;
    if (selected && byId().has(selected)) return anchorFor(selected);
    return rig.getTarget();
  };
  // Per-frame lens sync: AF measures camera→anchor distance; aperture follows
  // the view until the user grabs the slider; focal always drives real FOV.
  const syncLens = () => {
    rig.setFocal(focusCtl.focalMm);
    post.fx.focalMm = focusCtl.focalMm;
    if (!fstopTouched) focusCtl.fstop = autoFstop(levels.name);
    post.fx.fstop = focusCtl.fstop;
    if (focusCtl.af) {
      focusCtl.focusDist = Math.max(0.05, rig.camera.position.distanceTo(focusAnchor()));
    }
    post.fx.focusDist = focusCtl.focusDist;
    post.fx.dof = focusCtl.dof ?? 1;
  };
  const hud = buildHud(container, {
    onSearch: (id) => select(id, { fly: true }),
    onCreateWO,
    onMute: () => {
      setMuted(!isMuted());
      pushHud();
    },
    onCamToggle: () => {
      focusCtl.panel = !focusCtl.panel;
      ensureAudio();
      play('toggle');
      pushHud();
    },
    onCamParam: (p = {}) => {
      if (typeof p.fstop === 'number') {
        focusCtl.fstop = Math.min(16, Math.max(1.4, p.fstop));
        fstopTouched = true;
      }
      if (typeof p.focalMm === 'number') {
        focusCtl.focalMm = Math.min(120, Math.max(18, p.focalMm));
      }
      if (typeof p.focusDist === 'number') {
        focusCtl.focusDist = Math.min(120, Math.max(0.2, p.focusDist));
        focusCtl.af = false;
      }
      if (typeof p.af === 'boolean') focusCtl.af = p.af;
      if (typeof p.dof === 'boolean') focusCtl.dof = p.dof ? 1 : 0;
      if (p.dofAuto) focusCtl.dof = null;
      syncLens();
      pushHud();
    },
    onLevel: (name) => {
      try {
        levels.setLevel(name);
      } catch {
        /* unknown level — ignore */
      }
      pushHud();
    },
    onOverlay: () => cycleOverlay(),
  });
  const post = createPost(renderer, scene, rig.camera);
  if (!postEnabled) post.fx.enabled = false;

  let selected = null;

  function pushHud() {
    syncLens();
    // Detail follows the view too: ghost TOP dots + hide flow beads at NEAR.
    network.setDetail?.(levels.name);
    beacons.setDetail?.(levels.name);
    structures.setDetail?.(levels.name);
    labels.setDetail?.(levels.name);
    terrain.setDetail?.(levels.name); // index-ring elevation numbers on drill-in
    checker.setDetail?.(levels.name);
    const map = byId();
    const sel = selected ? map.get(selected) ?? null : null;
    const crit = sel?.health === 'critical' ? sel : current.find((a) => a.health === 'critical');
    hud.update({
      rollup: healthRollup(current),
      selection: sel,
      level: levels.name,
      overlay: overlayMode,
      muted: isMuted(),
      cam: { ...focusCtl, effectiveDof: post.fx.dof },
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
  function select(id, { fly = true } = {}) {
    if (!id || !byId().has(id)) return false;
    selected = id;
    // One anchor for every path: the asset anchor (fault chainage, else
    // midpoint / position) — the same point the 1/2/3 buttons aim at, and
    // where the beacon + halo + labels live. Aiming the raw click point
    // instead centred bare dirt with the markers off in a corner.
    const anchor = anchorFor(id);
    const aim = [anchor.x, anchor.y, anchor.z];
    // AF follows the same aim the camera flies to.
    clickAnchor = anchor.clone();
    network.setSelection(id);
    structures.setSelection(id);
    beacons.setSelection(id);
    labels.setSelection(id);
    ensureAudio();
    play(byId().get(id)?.health === 'critical' ? 'alert' : 'select');
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
    return [hitPoint.x, field(hitPoint.x, hitPoint.z) * VEX + 0.05, hitPoint.z];
  };

  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const downPos = [0, 0];
  // AudioContext is gesture-locked: create it on the first real pointer press,
  // never on mousemove (pre-gesture) or at boot.
  container.addEventListener('pointerdown', () => ensureAudio(), { once: true });
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
  let lastHoverSnd = null;
  canvas.addEventListener('mousemove', (e) => {
    setNdc(e);
    const id = network.pick(ndc, rig.camera);
    hoveredId = id ?? null;
    if (network.setHover(id)) canvas.style.cursor = id ? 'pointer' : '';
    beacons.setHover?.(id);
    if (id !== lastHoverSnd) {
      lastHoverSnd = id;
      // Hover is not a user gesture: only play when the context already runs
      // (creating one here logs a pre-gesture warning and stays suspended).
      if (id && audioLive()) play('hover');
    }
  });
  canvas.addEventListener('mouseleave', () => {
    hoveredId = null;
    network.setHover(null);
    beacons.setHover?.(null);
    lastHoverSnd = null;
    canvas.style.cursor = '';
  });
  canvas.addEventListener('click', (e) => {
    // Orbit/pan drags end in a click — ignore presses that traveled so only
    // deliberate taps drill down (otherwise every pan flies the camera).
    if (Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 6) return;
    const at = clickPoint(e);
    // AF still focuses the tapped dirt on a miss — but selection always
    // flies to the asset anchor (see select), never the raw click point.
    clickAnchor = at ? new THREE.Vector3(at[0], at[1], at[2]) : null;
    setNdc(e);
    const id = network.pick(ndc, rig.camera);
    if (id) select(id, { fly: true });
  });
  const onKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'm' || e.key === 'M') {
      setMuted(!isMuted());
      pushHud();
      return;
    }
    if (e.key === '1') {
      levels.setLevel('network');
      pushHud();
    } else if (e.key === '2') {
      levels.setLevel('segment');
      pushHud();
    } else if (e.key === '3') {
      levels.setLevel('asset');
      pushHud();
    } else if (e.key === 'o' || e.key === 'O') {
      cycleOverlay();
    } else if (e.key === 'f' || e.key === 'F') {
      focusCtl.panel = !focusCtl.panel;
      pushHud();
    } else if (e.key === 'Escape') {
      const atTop = levels.name === 'network';
      levels.cycle(-1);
      if (atTop && selected) {
        selected = null;
        clickAnchor = null;
        network.setSelection(null);
        structures.setSelection(null);
        beacons.setSelection(null);
        labels.setSelection(null);
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
  // Context-loss armor: when the browser kills the GL context (Safari does
  // this once its GPU process runs dry — e.g. IOSurface exhaustion after a
  // long dev session), rendering into it silently no-ops forever: the canvas
  // sits black while the DOM HUD keeps working ("only overlay text"). Pause
  // the loop, badge the container so the state is visible instead of
  // mysterious, and resume on restore — three re-uploads on next render.
  let glLost = false;
  let lossNote = null;
  const onGlLost = (e) => {
    e.preventDefault();
    if (glLost) return;
    glLost = true;
    cancelAnimationFrame(raf);
    lossNote = document.createElement('div');
    lossNote.textContent = '3D PAUSED · GPU CONTEXT LOST — RESTORING · RELOAD IF STUCK';
    lossNote.style.cssText =
      'position:absolute;top:10px;left:50%;transform:translateX(-50%);' +
      'font:10px/1.6 ui-monospace,monospace;letter-spacing:0.12em;color:#ff8c39;' +
      'background:rgba(10,14,18,0.92);border:1px solid rgba(255,140,57,0.4);' +
      'border-radius:4px;padding:4px 10px;pointer-events:none;z-index:5;';
    container.appendChild(lossNote);
  };
  const onGlRestored = () => {
    if (!glLost) return;
    glLost = false;
    lossNote?.remove();
    lossNote = null;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  canvas.addEventListener('webglcontextlost', onGlLost);
  canvas.addEventListener('webglcontextrestored', onGlRestored);
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    rig.update(dt, now / 1000);
    table.update?.(now / 1000);
    terrain.update?.(now / 1000);
    checker.update?.(now / 1000);
    beacons.tick(now / 1000);
    network.tick?.(now / 1000);
    overlays.update?.(now / 1000);
    labels.update?.(now / 1000);
    syncLens();
    if (post.fx.enabled) post.render(now / 1000);
    else renderer.render(scene, rig.camera);
  };
  raf = requestAnimationFrame(tick);

  pushHud();
  // Opening frame: fly out to the full mapped circle (rig boots at the
  // close sector preset; HUD already reads TOP so the camera must match).
  // View param: ?view=ISO|NEAR opens drilled in (default TOP fly-out).
  const startView = (params.get('view') || '').toLowerCase();
  if (startView === 'iso' || startView === 'segment') levels.setLevel('segment');
  else if (startView === 'near' || startView === 'asset') levels.setLevel('asset');
  else levels.setLevel('network');
  // Deep link: ?asset=PIPE-07 drills straight to the asset.
  const deep = params.get('asset');
  if (deep) select(deep, { fly: true });
  // Overlay link: ?overlay=weather|tectonic|forecast opens with it on.
  const startOverlay = (params.get('overlay') || '').toLowerCase();
  if (OVERLAY_ORDER.includes(startOverlay) && startOverlay) {
    overlayMode = startOverlay;
    overlays.setMode(overlayMode);
    pushHud();
  }
  // ?asset=X&view=ISO lands on the segment view of that asset's ground.
  if (deep && (startView === 'iso' || startView === 'segment')) levels.setLevel('segment');

  return {
    rollup: () => healthRollup(current),
    debug: { camera: rig.camera, target: () => rig.getTarget() },
    setSelection(id) {
      if (id == null) {
        selected = null;
        clickAnchor = null;
        network.setSelection(null);
        structures.setSelection(null);
        beacons.setSelection(null);
        labels.setSelection(null);
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
      labels.update?.(performance.now() / 1000, feed);
      if (selected && !byId().has(selected)) {
        selected = null;
        network.setSelection(null);
        structures.setSelection(null);
        beacons.setSelection(null);
        labels.setSelection(null);
      }
      pushHud();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onGlLost);
      canvas.removeEventListener('webglcontextrestored', onGlRestored);
      lossNote?.remove();
      hud.dispose();
      post.dispose();
      beacons.dispose();
      structures.dispose();
      labels.dispose?.();
      gridfloor.dispose?.();
      checker.dispose?.();
      overlays.dispose?.();
      terrain.dispose?.();
      renderer.dispose();
      canvas.remove();
    },
  };
}
