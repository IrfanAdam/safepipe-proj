/* Safepipe Ops 3D — src/ops3d/labels.js · floating in-scene asset labels.
 * One canvas-sprite per asset (assetId + health word), a small glowing ring
 * sprite on the ground, and a thin vertical leader line joining them.
 * Plus a small destination pill per pipeline at its rim exit point naming
 * where the line heads (always visible at network/segment levels).
 * Contract: buildLabels(scene, {layout, healthById}) →
 *   {group, update(t), setSelection(id), setDetail(name), dispose}.
 * healthById is a Map (assetId → feed item or health string); arrays accepted.
 */

import * as THREE from 'three';

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

const healthOf = (v) => (typeof v === 'string' ? v : v?.health ?? 'nominal');
const colorOf = (h) => INK[h] ?? INK.nominal;

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
    opacity: 0.92, depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.9, 0.9 * (96 / 384), 1);
  sp.userData.baseW = 0.9;
  sp.userData.aspect = 96 / 384;
  drawLabel(cv, tex, assetId, health);
  return sp;
}

function drawLabel(cv, tex, assetId, health) {
  const ctx = cv.getContext('2d');
  const col = colorOf(health);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(8,12,14,0.72)';
  ctx.beginPath();
  ctx.roundRect(2, 8, cv.width - 4, cv.height - 16, 14);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(36, cv.height / 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8d5cc';
  ctx.font = '600 34px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${assetId} · ${health.toUpperCase()}`, 62, cv.height / 2 + 1);
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
    opacity: 0.9, depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
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
  ctx.fillStyle = 'rgba(8,12,14,0.66)';
  ctx.beginPath();
  ctx.roundRect(2, 12, cv.width - 4, cv.height - 24, 16);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
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
  ctx.fillStyle = '#f2efe8';
  ctx.fillText(text, x + r * 2 + gap, cv.height / 2 + 1);
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
  let hidden = false;
  const items = []; // {id, sprite, ring, ringMat, line, lineMat, cv, tex, baseY, phase} (+ dest pills: {dest, pipe, text}, ring/line null)

  function anchorOf(kind, a) {
    if (kind === 'pipe') return midPoint(a.points);
    return a.position;
  }

  function addLabel(id, x, z, y = LABEL_H) {
    const health = healthOf(byId.get(id));
    const col = new THREE.Color(colorOf(health));
    const sprite = makeTextSprite(id, health);
    sprite.position.set(x, y, z);
    group.add(sprite);
    const ringMat = new THREE.SpriteMaterial({
      map: getRingTexture(), color: col, sizeAttenuation: true,
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Sprite(ringMat);
    ring.scale.set(0.28, 0.28, 1);
    ring.position.set(x, RING_Y, z);
    group.add(ring);
    const lg = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(x, RING_Y, z), new THREE.Vector3(x, y - 0.12, z)]);
    const lineMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45 });
    group.add(new THREE.Line(lg, lineMat));
    items.push({
      id, sprite, ring, ringMat, lineMat, lineGeo: lg,
      cv: sprite.material.map.image, tex: sprite.material.map,
      baseY: y, phase: Math.random() * Math.PI * 2,
    });
  }

  for (const p of L.pipelines ?? []) {
    const [x, z] = anchorOf('pipe', p);
    addLabel(p.assetId, x, z);
    // Edge destination tag at the rim exit point (no ring/leader — pill only).
    if (DEST[p.assetId]) {
      const [ex, ez] = exitPoint(p.points);
      const health = healthOf(byId.get(p.assetId));
      const sprite = makeDestSprite(DEST[p.assetId], health);
      sprite.position.set(ex, LABEL_H * 0.85, ez);
      group.add(sprite);
      items.push({
        id: `${p.assetId}:dest`, dest: true, pipe: p.assetId, text: DEST[p.assetId],
        sprite, ring: null, ringMat: null, line: null, lineMat: null, lineGeo: null,
        cv: sprite.material.map.image, tex: sprite.material.map,
        baseY: LABEL_H * 0.85, phase: Math.random() * Math.PI * 2,
      });
    }
  }
  for (const f of L.facilities ?? []) addLabel(f.assetId, f.position[0], f.position[1]);
  for (const s of L.sensors ?? []) addLabel(s.assetId, s.position[0], s.position[1], 0.8);

  function repaint(id, health) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const col = new THREE.Color(colorOf(health));
    drawLabel(it.cv, it.tex, id, health);
    it.ringMat.color.copy(col);
    it.lineMat.color.copy(col);
  }

  return {
    group,
    /* update(t, next?) — animate; optionally refresh colors when feed passed. */
    update(t = 0, next) {
      if (next) {
        byId = toMap(next);
        for (const it of items) {
          if (it.dest) drawDest(it.cv, it.tex, it.text, healthOf(byId.get(it.pipe)));
          else repaint(it.id, healthOf(byId.get(it.id)));
        }
      }
      for (const it of items) {
        const sel = it.id === selected;
        if (it.ring) {
          const pulse = 1 + 0.18 * Math.sin(t * 2.4 + it.phase);
          it.ring.scale.set(0.28 * pulse * (sel ? 1.5 : 1), 0.28 * pulse * (sel ? 1.5 : 1), 1);
          it.ringMat.opacity = (sel ? 1 : 0.8) * (0.75 + 0.25 * Math.sin(t * 2.4 + it.phase));
        }
        it.sprite.position.y = it.baseY + 0.05 * Math.sin(t * 1.2 + it.phase);
        it.sprite.material.opacity = hidden ? 0 : sel ? 1 : it.dest ? 0.9 : 0.92;
      }
    },
    setSelection(id) {
      selected = id ?? null;
      for (const it of items) {
        const sel = it.id === selected;
        const w = it.sprite.userData.baseW * (it.k ?? 3.2) * (sel ? 1.3 : 1);
        it.sprite.scale.set(w, w * it.sprite.userData.aspect, 1);
      }
    },
    /* Side panel owns NEAR at 'asset' level — hide in-scene labels there. */
    setDetail(name) {
      hidden = name === 'asset';
      group.visible = !hidden;
      // Level-sized sprites: TOP reads from 68 km out, so labels grow 3×
      // up there; ISO 1.5×; NEAR hides (side panel owns the asset).
      const k = name === 'segment' ? 1.35 : 3.2;
      for (const it of items) {
        it.k = k;
        // TOP declutter: only attention + selection carry labels up there —
        // 14 pills at 3× would be a wall of noise. Destination tags bypass
        // the filter so the rim always reads at network/segment levels.
        const hot = healthOf(byId.get(it.dest ? it.pipe : it.id)) !== 'nominal';
        const show = it.dest ? true : name === 'network' ? (hot || it.id === selected) : true;
        it.sprite.visible = show;
        if (it.ring) it.ring.visible = show;
        if (it.line) it.line.visible = show;
        it.sprite.scale.set(it.sprite.userData.baseW * k, it.sprite.userData.baseW * k * it.sprite.userData.aspect, 1);
      }
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
