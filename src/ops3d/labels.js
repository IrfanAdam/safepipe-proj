/* Safepipe Ops 3D — src/ops3d/labels.js · floating in-scene asset labels.
 * One canvas-sprite per asset (assetId + health word), a small glowing ring
 * sprite on the ground, and a thin vertical leader line joining them.
 * Plus a small destination pill per pipeline at its rim exit point naming
 * where the line heads (hot/selected/hovered only at network level — the
 * hot ones double as rim landmarks; full set in-field).
 * Contract: buildLabels(scene, {layout, healthById}) →
 *   {group, update(t), setSelection(id), setDetail(name), dispose}.
 * healthById is a Map (assetId → feed item or health string); arrays accepted.
 */

import * as THREE from 'three';
import { field, VEX } from './terrain.js';

const DEST = {
  'PIPE-01': 'MIDLAND REFINERY',
  'PIPE-02': 'ODESSA TERMINAL',
  'PIPE-03': 'CRANE STATION',
  'PIPE-04': 'WINK HUB',
  'PIPE-05': 'MIDLAND',
  'PIPE-06': 'ODESSA',
};

const INK = {
  nominal: '#e8e4da', // bone-white
  watch: '#ff8c39',
  critical: '#e31919',
};
const LABEL_H = 1.0;
const RING_Y = 0.05;

/* Occlusion probe (pure, unit-tested): is `anc` hidden from `cam` by relief?
 * Samples the sight line at two interior points; if the heightfield pokes
 * above the line (+margin), the anchor reads as buried/occluded from this
 * viewpoint and its plate should fade instead of drawing over the map. */
export function sightOccluded(cam, anc, heightAt, margin = 0.15) {
  if (!cam || !anc || typeof heightAt !== 'function') return false;
  for (const t of [0.35, 0.7]) {
    const px = anc.x + (cam.x - anc.x) * t;
    const pz = anc.z + (cam.z - anc.z) * t;
    const py = anc.y + (cam.y - anc.y) * t;
    let h = 0;
    try {
      h = heightAt(px, pz);
    } catch {
      return false;
    }
    if (typeof h === 'number' && Number.isFinite(h) && h > py + margin) return true;
  }
  return false;
}

const healthOf = (v) => (typeof v === 'string' ? v : v?.health ?? 'nominal');
const colorOf = (h) => INK[h] ?? INK.nominal;

/* Terrain height under a label anchor — guarded: layout points far outside
 * the mapped field return NaN in some sources, fall back to 0. */
function groundAt(x, z) {
  try {
    const h = field(x, z) * VEX;
    return Number.isFinite(h) ? h : 0;
  } catch {
    return 0;
  }
}

function toMap(src) {
  if (src instanceof Map) return src;
  const m = new Map();
  for (const f of src ?? []) m.set(f.assetId, f);
  return m;
}

/* Arc-length midpoint of an [x,z] polyline. */
function midPoint(points) {
  let total = 0;
  const lens = [];
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let target = total / 2;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : target / lens[i];
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * f,
        points[i][1] + (points[i + 1][1] - points[i][1]) * f];
    }
    target -= lens[i];
  }
  return points[points.length - 1].slice();
}

function makeTextSprite(assetId, health) {
  const cv = document.createElement('canvas');
  cv.width = 384;
  cv.height = 96;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, sizeAttenuation: true, transparent: true,
    opacity: 0.96, depthWrite: false,
    // Plates always overdraw the contour field: at TOP the bright index
    // lines used to poke straight through the semi-transparent backplate
    // and read as smudges. depthTest off + renderOrder puts the dark
    // plate over the lines (contours dim under labels by construction).
    depthTest: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 10;
  sp.scale.set(0.9, 0.9 * (96 / 384), 1);
  sp.userData.baseW = 0.9;
  sp.userData.aspect = 96 / 384;
  drawLabel(cv, tex, assetId, health);
  return sp;
}

/* Plate backplate style — locked by tests/ops3d-attention.test.js.
 * Near-black, near-opaque: the fill must hold ≥4.5:1 contrast against the
 * brightest contour grey (#9fabb3) so plates read at TOP, while staying far
 * below alarm luminance so faults still lead. */
export const PLATE_STYLE = {
  fill: [3, 5, 7],
  alphaAsset: 0.92,
  alphaDest: 0.88,
  haloAlpha: 0.9,
  depthTest: false,
};
const plateFill = (a) =>
  `rgba(${PLATE_STYLE.fill[0]},${PLATE_STYLE.fill[1]},${PLATE_STYLE.fill[2]},${a})`;

/* Dark halo separating the plate from bright contours: a wide near-black
 * stroke under the thin health-colored stroke, so the colored edge never
 * sits directly on a white line. */
function strokePlateEdge(ctx, col, alpha) {
  ctx.globalAlpha = PLATE_STYLE.haloAlpha;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
function chamferPlate(ctx, x, y, w, h) {
  /* Cyberpunk chamfer plate: sharp corners with the signature diagonal cut
   * top-right — never rounded. Cut is half the plate height so the diagonal
   * survives the ~3× TOP downsample as a multi-pixel face. */
  const cut = Math.round(Math.min(w, h) * 0.5);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function drawLabel(cv, tex, assetId, health) {
  const ctx = cv.getContext('2d');
  const col = colorOf(health);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = plateFill(PLATE_STYLE.alphaAsset);
  chamferPlate(ctx, 2, 8, cv.width - 4, cv.height - 16);
  ctx.fill();
  strokePlateEdge(ctx, col, 0.85);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(36, cv.height / 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f1e9';
  ctx.font = '600 28px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillText(`${assetId} · ${health.toUpperCase()}`, 62, cv.height / 2 + 1);
  ctx.shadowBlur = 0;
  tex.needsUpdate = true;
}

/* Pipeline exit: the endpoint farthest from origin (nearest the rim),
 * pushed slightly outward so the tag floats just past the line end. */
function exitPoint(points) {
  const a = points[0], b = points[points.length - 1];
  const end = Math.hypot(b[0], b[1]) >= Math.hypot(a[0], a[1]) ? b : a;
  const r = Math.hypot(end[0], end[1]) || 1;
  const push = 0.7;
  return [end[0] + (end[0] / r) * push, end[1] + (end[1] / r) * push];
}

/* Small destination pill in the makeTextSprite style (smaller canvas text,
 * narrower sprite) naming where a pipeline heads. */
function makeDestSprite(text, health) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, sizeAttenuation: true, transparent: true,
    opacity: 0.94, depthWrite: false,
    // Same contour overdraw as asset plates (see makeTextSprite).
    depthTest: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 10;
  sp.scale.set(0.62, 0.62 * (96 / 512), 1);
  sp.userData.baseW = 0.62;
  sp.userData.aspect = 96 / 512;
  drawDest(cv, tex, text, health);
  return sp;
}

function drawDest(cv, tex, text, health) {
  const ctx = cv.getContext('2d');
  const col = colorOf(health);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = plateFill(PLATE_STYLE.alphaDest);
  chamferPlate(ctx, 2, 12, cv.width - 4, cv.height - 24);
  ctx.fill();
  strokePlateEdge(ctx, col, 0.8);
  ctx.font = '600 30px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const gap = 14, r = 8;
  const totalW = r * 2 + gap + tw;
  const x = (cv.width - totalW) / 2;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x + r, cv.height / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f1e9';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, x + r * 2 + gap, cv.height / 2 + 1);
  ctx.shadowBlur = 0;
  tex.needsUpdate = true;
}

let ringTex = null;
function getRingTexture() {
  if (ringTex) return ringTex;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 12, 0, Math.PI * 2);
  ctx.stroke();
  ringTex = new THREE.CanvasTexture(cv);
  return ringTex;
}

export function buildLabels(scene, { layout, healthById } = {}) {
  const L = layout ?? { pipelines: [], facilities: [], sensors: [] };
  let byId = toMap(healthById);
  const group = new THREE.Group();
  group.name = 'ops-labels';
  scene.add(group);

  let selected = null;
  let hovered = null; // hover lights the label without selecting
  let hidden = false;
  let detailName = 'network';
  const items = []; // {id, sprite, ring, ringMat, line, lineMat, cv, tex, baseY, phase} (+ dest pills: {dest, pipe, text}, ring/line null)

  function anchorOf(kind, a) {
    if (kind === 'pipe') return midPoint(a.points);
    return a.position;
  }

  function addLabel(id, x, z, lift = LABEL_H) {
    const health = healthOf(byId.get(id));
    const col = new THREE.Color(colorOf(health));
    // Terrain-seated: ring and plate ride the relief (gy), never a fixed
    // datum — at grazing angles a fixed y reads as floating under the map.
    const gy = groundAt(x, z);
    const baseY = gy + lift;
    const sprite = makeTextSprite(id, health);
    sprite.position.set(x, baseY, z);
    group.add(sprite);
    const ringMat = new THREE.SpriteMaterial({
      map: getRingTexture(), color: col, sizeAttenuation: true,
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
      // Buried segments hide: the ring/leader depth-test against terrain so
      // relief between camera and anchor occludes them instead of drawing
      // through. (Plates keep depthTest:false by design — contours must
      // never poke through the backplate; occlusion fades them instead.)
      depthTest: true,
    });
    const ring = new THREE.Sprite(ringMat);
    ring.scale.set(0.28, 0.28, 1);
    ring.position.set(x, gy + RING_Y, z);
    group.add(ring);
    const lg = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(x, gy + RING_Y, z), new THREE.Vector3(x, baseY - 0.12, z)]);
    const lineMat = new THREE.LineBasicMaterial({
      color: col, transparent: true, opacity: 0.45, depthTest: true,
    });
    const line = new THREE.Line(lg, lineMat);
    group.add(line);
    items.push({
      id, sprite, ring, ringMat, line, lineMat, lineGeo: lg,
      cv: sprite.material.map.image, tex: sprite.material.map,
      baseY, groundY: gy, lift, phase: Math.random() * Math.PI * 2, x, z,
      occFade: 1,
    });
  }

  for (const p of L.pipelines ?? []) {
    const [x, z] = anchorOf('pipe', p);
    addLabel(p.assetId, x, z);
    // Edge destination tag at the rim exit point: pill + thin vertical leader
    // to the ground, like asset plates — no leader-less floaters (gap 6).
    if (DEST[p.assetId]) {
      const [ex, ez] = exitPoint(p.points);
      const health = healthOf(byId.get(p.assetId));
      const sprite = makeDestSprite(DEST[p.assetId], health);
      const egy = groundAt(ex, ez);
      const destY = egy + LABEL_H * 0.85;
      sprite.position.set(ex, egy + LABEL_H * 0.85, ez);
      group.add(sprite);
      const dlg = new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(ex, egy + RING_Y, ez), new THREE.Vector3(ex, destY - 0.1, ez)]);
      const dlm = new THREE.LineBasicMaterial({
        color: new THREE.Color(colorOf(health)), transparent: true, opacity: 0.4, depthTest: true,
      });
      const dline = new THREE.Line(dlg, dlm);
      group.add(dline);
      items.push({
        id: `${p.assetId}:dest`, dest: true, pipe: p.assetId, text: DEST[p.assetId],
        sprite, ring: null, ringMat: null, line: dline, lineMat: dlm, lineGeo: dlg,
        cv: sprite.material.map.image, tex: sprite.material.map,
        baseY: egy + LABEL_H * 0.85, groundY: egy, lift: LABEL_H * 0.85,
        phase: Math.random() * Math.PI * 2, x: ex, z: ez, occFade: 1,
      });
    }
  }
  for (const f of L.facilities ?? []) addLabel(f.assetId, f.position[0], f.position[1]);
  for (const s of L.sensors ?? []) addLabel(s.assetId, s.position[0], s.position[1], 0.8);

  /* Label restraint: at TOP (network) ONLY hot (faulted) + selected +
   * hovered labels read — asset plates and rim destination pills alike.
   * A hot pipe's dest pill doubles as its rim landmark, so nothing extra
   * stays on. TOP plates are small, dim, low over the ground (terrain-hug
   * tags, not billboards in your face) and collision-thinned so neighbours
   * never stack: greedy keep, 2.5 km apart, hottest first. In-field
   * (segment) every label reads full-size; asset level keeps the
   * selected/hovered label in-scene (side panel covers the rest). */
  const HOT_RANK = { critical: 0, watch: 1, nominal: 2 };
  const rankOf = (c) => {
    const h = healthOf(byId.get(c.it.dest ? c.it.pipe : c.it.id));
    return (c.sel ? -4 : 0) + (c.hov ? -2 : 0) - (HOT_RANK[h] ?? 2);
  };
  function refresh() {
    const inField = detailName !== 'network';
    const topThin = detailName === 'network' ? [] : null;
    for (const it of items) {
      const sel = it.id === selected || (it.dest && it.pipe === selected);
      const hov = it.id === hovered || (it.dest && it.pipe === hovered);
      const hot = healthOf(byId.get(it.dest ? it.pipe : it.id)) !== 'nominal';
      const show = detailName === 'asset' ? (sel || hov) : inField ? true : (hot || sel || hov);
      if (topThin && show) topThin.push({ it, sel, hov });
      else if (!topThin) applyShow(it, show);
    }
    if (topThin) {
      // Hottest first, selected/hovered pin to the front; keep a plate only
      // if no kept plate sits within COLLIDE km of it.
      const COLLIDE = 2.5;
      topThin.sort((a, b) => rankOf(a) - rankOf(b));
      const kept = [];
      for (const c of topThin) {
        const clear = kept.every(
          (k) => Math.hypot(c.it.x - k.x, c.it.z - k.z) > COLLIDE,
        );
        if (clear || c.sel || c.hov) {
          if (clear) kept.push(c.it);
          applyShow(c.it, true);
        } else applyShow(c.it, false);
      }
    }
  }

  function applyShow(it, show) {
      it.sprite.visible = show;
      if (it.ring) it.ring.visible = show;
      if (it.line) it.line.visible = show;
      const w = it.sprite.userData.baseW * (it.k ?? 1.4) * ((it.id === selected || (it.dest && it.pipe === selected)) ? 1.3 : 1);
      it.sprite.scale.set(w, w * it.sprite.userData.aspect, 1);
  }

  function repaint(id, health) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const col = new THREE.Color(colorOf(health));
    drawLabel(it.cv, it.tex, id, health);
    it.ringMat.color.copy(col);
    it.lineMat.color.copy(col);
  }

  /* Viewpoint for the occlusion fade (twin.js hands over its camera once).
   * Every OCC_EVERY seconds each visible plate probes its sight line: an
   * anchor buried behind relief from this viewpoint fades to OCC_FADE
   * instead of drawing over the map. Selected plates never fade — the
   * drill-in target must stay readable (X-ray dips the terrain instead). */
  let viewCam = null;
  let lastOcc = -1;
  const OCC_EVERY = 0.25;
  const OCC_FADE = 0.22;

  return {
    group,
    setView(cam) {
      viewCam = cam ?? null;
    },
    /* update(t, next?) — animate; optionally refresh colors when feed passed. */
    update(t = 0, next) {
      const top = detailName === 'network';
      if (next) {
        byId = toMap(next);
        for (const it of items) {
          if (it.dest) {
            drawDest(it.cv, it.tex, it.text, healthOf(byId.get(it.pipe)));
            it.lineMat?.color?.set?.(colorOf(healthOf(byId.get(it.pipe))));
          }
          else repaint(it.id, healthOf(byId.get(it.id)));
        }
      }
      const doOcc = viewCam && t - lastOcc > OCC_EVERY;
      if (doOcc) lastOcc = t;
      for (const it of items) {
        const sel = it.id === selected;
        if (it.ring) {
          const pulse = 1 + 0.12 * Math.sin(t * 2.4 + it.phase);
          it.ring.scale.set(0.28 * pulse * (sel ? 1.5 : 1), 0.28 * pulse * (sel ? 1.5 : 1), 1);
          it.ringMat.opacity = (sel ? 1 : 0.65) * (0.75 + 0.25 * Math.sin(t * 2.4 + it.phase)) * (top ? 0.6 : 1);
        }
        // TOP plates hug the relief (low, small, dim terrain tags) — height
        // is relative to the seated ground, not a fixed datum; drill-in
        // restores full-height readable plates. Sprites are inherently
        // camera-facing (true ground-parallel would need plane meshes), so
        // the TOP read comes from altitude + size + opacity, not rotation.
        it.sprite.position.y = top ? it.groundY + it.lift * 0.45 : it.baseY;
        if (doOcc && it.sprite.visible && !sel) {
          const occ = sightOccluded(
            viewCam.position,
            { x: it.x, y: it.baseY, z: it.z },
            (x, z) => groundAt(x, z),
          );
          it.occFade = occ ? OCC_FADE : 1;
        } else if (!viewCam || sel) {
          it.occFade = 1;
        }
        const base = hidden ? 0 : sel ? 1 : it.dest ? 0.94 : 0.96;
        // Fit-zoom legibility: TOP tags hold more body (0.72×) instead of
        // washing out — plates stay far below alarm luminance regardless.
        it.sprite.material.opacity = (top && !sel ? base * 0.72 : base) * it.occFade;
      }
    },
    setSelection(id) {
      selected = id ?? null;
      refresh();
    },
    setHover(id) {
      const next = id ?? null;
      if (next === hovered) return false;
      hovered = next;
      refresh();
      return true;
    },
    /* NEAR keeps the SELECTED label in-scene (side panel covers the rest) —
     * zooming in must never blank the thing you drilled into. NEAR sprites
     * shrink (0.55×): at 2 m standoff a TOP-sized billboard fills the frame. */
    setDetail(name) {
      detailName = name;
      group.visible = true;
      // Level-sized sprites: TOP tags stay small (1.4×) so they never
      // obstruct the terrain read; ISO 1.35×; NEAR shrinks to a small tag.
      const k = name === 'asset' ? 0.55 : name === 'segment' ? 1.35 : 1.4;
      for (const it of items) it.k = k;
      refresh();
    },
    dispose() {
      scene.remove(group);
      for (const it of items) {
        it.tex.dispose();
        it.sprite.material.dispose();
        it.ringMat?.dispose?.();
        it.lineMat?.dispose?.();
        it.lineGeo?.dispose?.();
      }
      items.length = 0;
    },
  };
}
