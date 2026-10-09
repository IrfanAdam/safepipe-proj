/* Safepipe Ops 3D — src/ops3d/sat-base.js · open-source satellite base + crossfade.
 *
 * Owns a MapLibre GL JS satellite map (Esri World Imagery XYZ true-color +
 * AWS Terrarium terrain + neutral hillshade) in a div mounted BEHIND the
 * three.js canvas centred on the site (57.03N 111.68W). Every
 * frame the map center/bearing/pitch/zoom follows the twin orbit rig (one
 * way, twin → map), so the crossfade feels seamless instead of sliding.
 *
 * Tokenless by design: every tile source is keyless (no tokens, no keys,
 * no accounts anywhere — see TILE_ATTRIBUTION below). When the MapLibre
 * CDN or the tile endpoints are unreachable (offline / blocked tiles) the
 * module degrades to a styled cinematic fallback div (dusk gradient + site
 * tag) and the twin runs custom-only, pixel-identical to the opaque look:
 * zero breakage, zero console errors on every path (all map failures are
 * swallowed via the 'error' handler + guarded loader).
 *
 * Crossfade: setMix(m) drives BOTH the canvas element opacity (works through
 * the opaque post chain, which composites vec4(col,1)) AND scene.js
 * setBaseMix(m) (clearAlpha + null-able background, so ?post=0 direct
 * renders stay correct too). Default m = 1 = the opaque look.
 * No twin.js / hud.js / post.js edits needed: the single SAT/TWIN control
 * (slider + toggle + auto-fade, diagonal-cut bar, z-index under the HUD
 * popovers) is injected here, and the DEM-swap remount is covered because
 * scene.js setBaseMix fans out to every live scene while syncFromTwin()
 * re-pins the fresh canvas layer each tick.
 *
 * Pure, unit-tested helpers: clampMix, twinViewToMap, plus the scope
 * overlay math (isNetworkLevel, shouldShowScope, projectPinhole,
 * rimCirclePx, scopeClipCss, scopeMaskCss).
 */

import { setBaseMix as sceneSetBaseMix } from './scene.js';

export const SITE = { lat: 57.03, lon: -111.68 };
export const LS_MIX_KEY = 'ops3d.satMix';

// MapLibre GL JS (open-source, BSD-3-Clause) via CDN. No npm dep, no key.
const MAPLIBRE_JS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const MAPLIBRE_CSS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';

// Free, keyless tile sources. Esri tile order is {z}/{y}/{x}.
const ESRI_WORLD_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TERRARIUM_TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const TILE_ATTRIBUTION = {
  imagery: 'Imagery © Esri, Maxar, Earthstar Geographics',
  terrain: 'Terrain © AWS Terrain Tiles (Terrarium; SRTM/ETOPO/GMTED sources)',
};

// Clamp a base-mix value to [0, 1]; non-finite input means "today's opaque".
export function clampMix(m) {
  const v = Number(m);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

// Twin world (km, +x east, +z south) → lat/lon, equirectangular at the
// site latitude (good to <1% over the 44 km window — same projection as
// dem.js geoWindowForSite). Pure + unit-tested. The orbit target rides the
// ground plane, so the map center tracks twin pans 1:1.
export function twinTargetToLatLon(target, site = SITE) {
  const x = Number(target?.x) || 0;
  const z = Number(target?.z) || 0;
  const lat = site.lat - z / 111.32;
  const lon = site.lon + x / (111.32 * Math.cos((site.lat * Math.PI) / 180));
  return { lat, lon };
};

// Twin orbit → map view. Pure: camPos/target are {x,y,z}-like, world km
// (+x east, +z south, 1 unit = 1 km — matches the camera presets: the TOP
// camera sits at +z looking north, screen-up is −z).
// Bearing follows the orbit azimuth, pitch mirrors the camera elevation
// (top-down twin = top-down map). Zoom matches ground resolution: the
// twin's visible span (2·dist·tan(fov/2)) over the viewport height gives
// metres-per-pixel, converted to a WebMercator zoom at the site latitude —
// so the crossfade holds scale instead of jumping ~4× (the old
// 15.5 − log2(dist/9) sat two zoom levels too tight everywhere). `view`
// is an optional {heightPx, fovDeg}; defaults (900 px, 40°) keep the
// two-arg call shape working. Center follows the orbit target through
// twinTargetToLatLon so panning the twin pans the map — previously the
// center stayed pinned on SITE and every pan slid the layers apart.
// Approximate on purpose — the crossfade reads as one locked view, not a
// survey overlay (oblique footprints stretch beyond the top-down span).
export function twinViewToMap(camPos, target, view = {}) {
  const dx = camPos.x - target.x;
  const dy = camPos.y - target.y;
  const dz = camPos.z - target.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const bearing = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
  const elev = (Math.asin(Math.min(1, Math.max(-1, dy / dist))) * 180) / Math.PI;
  const pitch = Math.min(70, Math.max(0, 90 - elev));
  const heightPx = Number(view.heightPx) > 0 ? Number(view.heightPx) : 900;
  const fovDeg = Number(view.fovDeg) > 0 ? Number(view.fovDeg) : 40;
  const spanKm = 2 * dist * Math.tan(((fovDeg * Math.PI) / 180) / 2);
  // Oblique stretch: the centre-pixel ray meets the ground at a slant, so
  // ground-per-pixel grows by 1/sin(elevation). Without this the map sits
  // ~2-3× too tight at ISO and the crossfade double-visions mid-fade.
  // Top-down is unaffected (sin 90° = 1). Factor clamped to 3 (twin camera
  // floor is 16° elevation) so grazing views never over-zoom out.
  const slant = Math.min(3, 1 / Math.max(Math.sin((Math.max(elev, 5) * Math.PI) / 180), 1 / 3));
  const mpp = ((spanKm * 1000) / heightPx) * slant; // twin metres per pixel
  const center = twinTargetToLatLon(target);
  const zoom = Math.min(
    16,
    Math.max(10, Math.log2((156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.max(mpp, 1e-6))),
  );
  return { bearing, pitch, zoom, center };
}
// Historic name (pre open-source swap): identical math, kept so any
// existing HUD/sync import keeps working with zero edits.
export const twinViewToMapbox = twinViewToMap;

// — Circular satellite monitor (TOP scope overlay). —
// Clips the satellite layer to the mapped-circle disc (r = 20 km, matches
// terrain.js / gridfloor.js) as projected through the live twin camera, so
// the imagery registers 1:1 with the custom render at TOP/network level.
// Pure, unit-tested helpers: isNetworkLevel, shouldShowScope,
// projectPinhole, rimCirclePx, scopeClipCss, scopeMaskCss.
export const SCOPE_R_KM = 20;
export const LS_SCOPE_KEY = 'ops3d.satScope';

export function isNetworkLevel(level) {
  return level === 'network';
}

export function shouldShowScope({ scopeOn, level } = {}) {
  return !!scopeOn && isNetworkLevel(level ?? 'network');
}

// Pinhole projection of a world point through the twin orbit camera.
// camPos/target are {x,y,z}-like (world km), fovDeg the vertical FOV,
// w/h the container px. Returns {x, y} px (origin top-left) or null when
// behind the camera. Plain math (OrbitControls looks down −Z, +Y up) so
// sat-base stays three-free.
export function projectPinhole(camPos, target, fovDeg, w, h, p) {
  const fx = target.x - camPos.x;
  const fy = target.y - camPos.y;
  const fz = target.z - camPos.z;
  const fl = Math.hypot(fx, fy, fz);
  if (!(fl > 1e-9)) return null;
  const ux = fx / fl;
  const uy = fy / fl;
  const uz = fz / fl;
  let upx = 0;
  let upy = 1;
  let upz = 0;
  if (Math.abs(uy) > 0.999) {
    upx = 0;
    upy = 0;
    upz = -1;
  }
  // right = normalize(cross(f, up)), upv = cross(right, f).
  let rx = uy * upz - uz * upy;
  let ry = uz * upx - ux * upz;
  let rz = ux * upy - uy * upx;
  const rl = Math.hypot(rx, ry, rz);
  if (!(rl > 1e-9)) return null;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const vx = ry * uz - rz * uy;
  const vy = rz * ux - rx * uz;
  const vz = rx * uy - ry * ux;
  const dx = p.x - camPos.x;
  const dy = p.y - camPos.y;
  const dz = p.z - camPos.z;
  const zc = dx * ux + dy * uy + dz * uz;
  if (!(zc > 1e-6)) return null;
  const xc = dx * rx + dy * ry + dz * rz;
  const yc = dx * vx + dy * vy + dz * vz;
  const fov = ((Number(fovDeg) > 0 ? Number(fovDeg) : 40) * Math.PI) / 180;
  const tanH = Math.tan(fov / 2);
  if (!(tanH > 0)) return null;
  const aspect = w / Math.max(1, h);
  const xNdc = xc / (zc * tanH * aspect);
  const yNdc = yc / (zc * tanH);
  return { x: (xNdc * 0.5 + 0.5) * w, y: (1 - (yNdc * 0.5 + 0.5)) * h };
}

// Screen disc of the mapped circle (rim at the target ground plane) as
// seen by the twin camera. Returns {cx, cy, r} px or null when the rim is
// unusable (behind camera / degenerate). Bounding-box circle: exact for
// the near-top-down TOP view, conservative otherwise.
export function rimCirclePx(camPos, target, fovDeg, w, h, radiusKm = SCOPE_R_KM, n = 48) {
  if (!(w > 0) || !(h > 0) || !(radiusKm > 0)) return null;
  const count = Math.max(8, Math.min(128, Math.floor(Number(n) || 48)));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let valid = 0;
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    const s = projectPinhole(camPos, target, fovDeg, w, h, {
      x: target.x + radiusKm * Math.cos(a),
      y: target.y,
      z: target.z + radiusKm * Math.sin(a),
    });
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
    valid++;
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  if (valid < 8) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const r = Math.max(maxX - minX, maxY - minY) / 2;
  if (!(r >= 2) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const q = (v) => Math.round(v * 10) / 10;
  return { cx: q(cx), cy: q(cy), r: q(r) };
}

// CSS that confines the satellite layer to the disc (applied to .sat-base).
export function scopeClipCss(cx, cy, r) {
  return `circle(${r}px at ${cx}px ${cy}px)`;
}

// CSS mask that punches the same disc out of the twin canvas: satellite
// shows through inside, custom twin stays opaque outside. Transparent
// inside → black outside with a 1.5px feathered rim.
export function scopeMaskCss(cx, cy, r) {
  return (
    `radial-gradient(circle ${r}px at ${cx}px ${cy}px, ` +
    `rgba(0,0,0,0) 0, rgba(0,0,0,0) ${r}px, #000 calc(${r}px + 1.5px))`
  );
}

function loadMaplibre() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loadMaplibre._p) return loadMaplibre._p;
  // fetch()-based loading (not <script>/<link> tags): a blocked CDN then
  // rejects silently into the fallback instead of logging resource errors,
  // keeping the offline path at zero console errors.
  loadMaplibre._p = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const [css, js] = await Promise.all([
        fetch(MAPLIBRE_CSS_URL, { signal: ctrl.signal }).then((r) => (r.ok ? r.text() : '')),
        fetch(MAPLIBRE_JS_URL, { signal: ctrl.signal }).then((r) => (r.ok ? r.text() : '')),
      ]);
      clearTimeout(timer);
      if (!js) return null;
      if (css) {
        try {
          const style = document.createElement('style');
          style.textContent = css;
          document.head.appendChild(style);
        } catch {
          /* map works unstyled — ignore */
        }
      }
      try {
        // UMD bundle: evaluates to window.maplibregl, returns nothing.
        new Function(js)();
      } catch {
        return null;
      }
      return window.maplibregl || null;
    } catch {
      return null;
    }
  })();
  return loadMaplibre._p;
}

// Inline keyless style: Esri true-color satellite raster (natural,
// Google-like — no tinting; an earlier dusk-dim + blue hillshade made it
// read as thermal imagery) + Terrarium hillshade for relief in the
// crossfade, + 3D terrain via moodMap().
function satStyle() {
  return {
    version: 8,
    center: [SITE.lon, SITE.lat],
    zoom: 11,
    sources: {
      'esri-sat': {
        type: 'raster',
        tiles: [ESRI_WORLD_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: TILE_ATTRIBUTION.imagery,
      },
      terrain: {
        type: 'raster-dem',
        tiles: [TERRARIUM_TERRAIN],
        encoding: 'terrarium',
        tileSize: 256,
        // Cap at 13 (overzoomed above): high-zoom Terrarium coverage is
        // spotty in the boreal zone and 404 tiles flash gaps + console noise.
        maxzoom: 13,
        attribution: TILE_ATTRIBUTION.terrain,
      },
    },
    layers: [
      // Opaque floor: the canvas is never transparent, so a slow or
      // failed tile load reads as dark base — never a black hole. Covered
      // by imagery wherever tiles resolve.
      { id: 'void', type: 'background', paint: { 'background-color': '#0e141b' } },
      {
        id: 'sat',
        type: 'raster',
        source: 'esri-sat',
      },
      {
        id: 'sat-hillshade',
        type: 'hillshade',
        source: 'terrain',
        paint: {
          // Gentle neutral relief only — default black/white shading keeps
          // the imagery true-color; tinted shadows/highlights here once
          // pushed the whole base into a thermal look.
          'hillshade-exaggeration': 0.25,
        },
      },
    ],
  };
}

// Dusk-mood the satellite: 3D terrain + hillshade already in the style;
// terrain exaggeration is best-effort. Everything swallowed.
function moodMap(map) {
  try {
    map.setTerrain?.({ source: 'terrain', exaggeration: 1.2 });
  } catch {
    /* satellite + hillshade alone is still a fine base */
  }
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* initSatBase(container, {getTwin, search, storage}) →
 *   {setMix, fadeTo, syncFromTwin, available, mix, dispose}
 * container is the twin mount element (#ops3d-dev). Never throws: any
 * failure degrades to the styled fallback with the twin untouched. */
export function initSatBase(container, opts = {}) {
  const noop = {
    setMix: (m) => clampMix(m),
    fadeTo: (m) => clampMix(m),
    syncFromTwin: () => {},
    setScope: () => false,
    scope: false,
    scopeShown: false,
    available: false,
    dispose: () => {},
  };
  if (!container || typeof document === 'undefined') return noop;
  const getTwin = opts.getTwin ?? (() => (typeof window !== 'undefined' ? window.__twin : null));
  const search = opts.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const storage = opts.storage ?? (() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  })();

  let startMix = 1;
  try {
    const q = new URLSearchParams(search || '');
    if (q.get('sat') != null) startMix = clampMix(Number(q.get('sat')));
    else if (q.get('mix') != null) startMix = clampMix(Number(q.get('mix')));
    else {
      const saved = storage?.getItem?.(LS_MIX_KEY);
      if (saved != null && saved !== '') startMix = clampMix(Number(saved));
    }
  } catch {
    startMix = 1;
  }

  // Circular monitor toggle: default OFF. ?scope=1 seeds ON (screenshot /
  // deep-link path), else the persisted choice.
  let startScope = false;
  try {
    const q = new URLSearchParams(search || '');
    const raw = q.get('scope');
    if (raw != null) {
      const s = String(raw).toLowerCase();
      startScope = s === '1' || s === 'true' || s === 'on' || s === 'yes';
    } else {
      startScope = storage?.getItem?.(LS_SCOPE_KEY) === '1';
    }
  } catch {
    startScope = false;
  }

  // — Behind layer (z-index 0; canvas is pinned to 1 every sync tick). —
  const base = mk('div', 'sat-base');
  base.setAttribute('data-testid', 'sat-base');
  try {
    container.insertBefore(base, container.firstChild);
  } catch {
    return noop;
  }

  // Tokenless: always attempt the map. Offline/CDN failure → styled
  // fallback tag, twin untouched, zero console noise.
  let map = null;
  let mapReady = false;
  let degraded = false;
  let tileErrs = 0;
  const showOfflineTag = () => {
    try {
      hideLoadingTag();
      if (base.querySelector?.('[data-testid="sat-base-tag"]')) return;
      const tag = mk('div', 'sat-base__tag', 'SATELLITE OFFLINE · CUSTOM TWIN');
      tag.setAttribute('data-testid', 'sat-base-tag');
      base.appendChild(tag);
    } catch {
      /* tag is cosmetic */
    }
  };
  // Loading state: honest "LOADING" text until the map fires load (or fails
  // into the offline tag). Silence used to read as a black hole.
  const showLoadingTag = () => {
    try {
      if (base.querySelector?.('[data-testid="sat-base-loading"]')) return;
      const tag = mk('div', 'sat-base__tag', 'SATELLITE LOADING…');
      tag.setAttribute('data-testid', 'sat-base-loading');
      base.appendChild(tag);
    } catch {
      /* tag is cosmetic */
    }
  };
  const hideLoadingTag = () => {
    try {
      base.querySelector?.('[data-testid="sat-base-loading"]')?.remove();
    } catch {
      /* already gone */
    }
  };
  showLoadingTag();
  // Watchdog: CDN/tiles slower than 20 s still resolve into honesty —
  // loading text leaves, offline tag explains, twin untouched.
  try {
    setTimeout(() => {
      if (!mapReady) showOfflineTag();
    }, 20000);
  } catch {
    /* timer is cosmetic */
  }
  loadMaplibre().then((ml) => {
    if (!ml || !base.isConnected) {
      // In jsdom/fake-DOM unit tests base.isConnected is undefined — only
      // tag when we are sure there is no live document to mount into.
      if (!ml) showOfflineTag();
      return;
    }
    try {
      map = new ml.Map({
        container: base,
        style: satStyle(),
        center: [SITE.lon, SITE.lat],
        zoom: 13,
        attributionControl: { compact: true },
        interactive: false,
        fadeDuration: 0,
      });
      map.on?.('load', () => {
        mapReady = true;
        hideLoadingTag();
        moodMap(map);
        syncFromTwin(true);
      });
      map.on?.('error', (e) => {
        /* stay silent: fallback gradient shows through map gaps. When tiles
         * keep failing (blocked network), shed the sat layers after a small
         * error budget so the map stops requesting and the twin runs
         * custom-only over the gradient + offline tag. */
        if (degraded) return;
        if (!e || (!e.tile && e.sourceId !== 'esri-sat' && e.sourceId !== 'terrain')) return;
        if (++tileErrs < 8) return;
        degraded = true;
        try {
          map.setTerrain?.(null);
        } catch {
          /* ignore */
        }
        for (const id of ['sat-hillshade', 'sat']) {
          try {
            if (map.getLayer?.(id)) map.removeLayer(id);
          } catch {
            /* ignore */
          }
        }
        showOfflineTag();
      });
    } catch {
      map = null;
      showOfflineTag();
    }
  });

  const canvasOf = () => {
    try {
      // The twin canvas specifically: the MapLibre canvas lives inside the
      // base layer (first in DOM order), so a bare 'canvas' selector would
      // fade the satellite instead of the twin.
      return (
        container.querySelector('canvas:not(.maplibregl-canvas)') ||
        container.querySelector('canvas')
      );
    } catch {
      return null;
    }
  };
  // Pin the (possibly remounted) canvas above the base layer. Idempotent.
  const pinCanvas = () => {
    const c = canvasOf();
    if (!c || !c.style) return;
    if (c.style.position !== 'relative') c.style.position = 'relative';
    if (c.style.zIndex !== '1') c.style.zIndex = '1';
  };

  let mix = startMix;

  // — Circular satellite monitor (TOP scope overlay) state. —
  let scopeOn = startScope;
  let scopeShown = false;
  let scopeDisc = null;
  let lastScope = 0;
  let btnScope = null; // assigned when the crossfade bar is built below

  // Current twin level without touching twin.js: explicit override first,
  // then the HUD's active level button, then a camera-distance heuristic
  // (network TOP sits far at dist ≥ 15; segment/asset drill-ins sit close).
  const resolveLevel = () => {
    try {
      const v = opts.getLevel?.();
      if (typeof v === 'string' && v) return v;
    } catch {
      /* fall through */
    }
    try {
      const active = container.querySelector?.('.ops-hud__level-btn--active');
      const lv = active?.dataset?.level ?? active?.getAttribute?.('data-level');
      if (typeof lv === 'string' && lv) return lv;
    } catch {
      /* fall through */
    }
    try {
      const twin = getTwin();
      const cam = twin?.debug?.camera;
      let tgt = null;
      try {
        tgt = twin?.debug?.target?.();
      } catch {
        tgt = null;
      }
      if (cam?.position && tgt) {
        const dx = cam.position.x - tgt.x;
        const dy = cam.position.y - tgt.y;
        const dz = cam.position.z - tgt.z;
        return Math.hypot(dx, dy, dz) >= 15 ? 'network' : 'segment';
      }
    } catch {
      /* fall through */
    }
    return 'network';
  };

  // Screen disc of the TOP scope ring through the live twin camera; falls
  // back to a centered disc when the camera is unreadable (never throws).
  const scopeDiscFromTwin = () => {
    let w = 0;
    let h = 0;
    try {
      w = container.clientWidth || 0;
      h = container.clientHeight || 0;
    } catch {
      w = 0;
      h = 0;
    }
    if (!(w > 0) || !(h > 0)) return null;
    try {
      const twin = getTwin();
      const cam = twin?.debug?.camera;
      let tgt = null;
      try {
        tgt = twin?.debug?.target?.();
      } catch {
        tgt = null;
      }
      if (cam?.position && tgt) {
        const disc = rimCirclePx(cam.position, tgt, cam.fov ?? 40, w, h);
        if (disc) return disc;
      }
    } catch {
      /* fallback below */
    }
    const q = (v) => Math.round(v * 10) / 10;
    return { cx: q(w / 2), cy: q(h / 2), r: q(Math.min(w, h) * 0.42) };
  };

  // Paint the shown-scope look: sat layer clipped to the disc, twin canvas
  // punched open inside it (satellite through) and forced opaque outside
  // (custom twin). Never throws.
  const paintScope = (disc) => {
    try {
      base.style.clipPath = scopeClipCss(disc.cx, disc.cy, disc.r);
    } catch {
      /* ignore */
    }
    const c = canvasOf();
    if (c && c.style) {
      try {
        const mask = scopeMaskCss(disc.cx, disc.cy, disc.r);
        c.style.maskImage = mask;
        c.style.webkitMaskImage = mask;
        c.style.opacity = '';
      } catch {
        /* ignore */
      }
    }
    try {
      sceneSetBaseMix(1);
    } catch {
      /* ignore */
    }
  };

  // Reconcile the scope overlay with toggle + level (throttled; force on
  // toggle/resize). Shown only at TOP/network — drill-ins auto-hide and
  // the user's crossfade mix is restored untouched.
  const refreshScope = (force = false) => {
    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (!force && now - lastScope < 150) return scopeShown;
    lastScope = now;
    const level = resolveLevel();
    const show = shouldShowScope({ scopeOn, level });
    try {
      btnScope?.setAttribute?.('data-gated', scopeOn && !show ? 'true' : 'false');
    } catch {
      /* ignore */
    }
    if (!show) {
      if (scopeShown) {
        try {
          base.style.clipPath = '';
        } catch {
          /* ignore */
        }
        const c = canvasOf();
        try {
          if (c && c.style) {
            c.style.maskImage = '';
            c.style.webkitMaskImage = '';
          }
        } catch {
          /* ignore */
        }
        scopeShown = false;
        scopeDisc = null;
        applyMix(mix);
      }
      return false;
    }
    const disc = scopeDiscFromTwin();
    if (!disc) {
      scopeShown = false;
      scopeDisc = null;
      return false;
    }
    scopeDisc = disc;
    scopeShown = true;
    paintScope(disc);
    return true;
  };

  const setScope = (on) => {
    scopeOn = !!on;
    try {
      storage?.setItem?.(LS_SCOPE_KEY, scopeOn ? '1' : '0');
    } catch {
      /* ignore */
    }
    try {
      btnScope?.setAttribute?.('aria-pressed', scopeOn ? 'true' : 'false');
    } catch {
      /* ignore */
    }
    if (scopeOn) {
      // Toggling SCOPE on always drops the camera to TOP/network first, so
      // the disc overlay has a level to show in — same path as the HUD `1`
      // key / network button, no twin.js contract change.
      try {
        document
          .querySelector('.ops-hud__level-btn[data-level="network"]')
          ?.click();
      } catch {
        /* HUD not mounted yet — overlay appears when network is active */
      }
    }
    refreshScope(true);
    return scopeOn;
  };
  const applyMix = (v) => {
    mix = clampMix(v);
    pinCanvas();
    const c = canvasOf();
    // Canvas-element fade carries the post chain (opaque composite) while
    // scene clearAlpha + null background keep ?post=0 direct renders true.
    if (c && c.style) c.style.opacity = mix >= 0.999 ? '' : String(mix);
    try {
      sceneSetBaseMix(mix);
    } catch {
      /* scene not ready — canvas opacity alone still fades */
    }
    try {
      storage?.setItem?.(LS_MIX_KEY, String(mix));
    } catch {
      /* persistence best-effort */
    }
    if (slider && document.activeElement !== slider) {
      try {
        slider.value = String(Math.round(mix * 100));
      } catch {
        /* ignore */
      }
    }
    if (btnSat && btnTwin) {
      try {
        btnSat.setAttribute('aria-pressed', mix < 0.5 ? 'true' : 'false');
        btnTwin.setAttribute('aria-pressed', mix >= 0.5 ? 'true' : 'false');
      } catch {
        /* ignore */
      }
    }
    // Scope overlay owns the canvas look while shown (sat inside the disc,
    // twin outside): re-force it so a mid-scope slider drag can't smear it.
    if (scopeShown && scopeDisc) {
      try {
        paintScope(scopeDisc);
      } catch {
        /* ignore */
      }
    }
    return mix;
  };

  // Auto-fade animator: SAT/TWIN jumps glide ~600 ms when AUTO is on.
  let anim = 0;
  const fadeTo = (target) => {
    const v = clampMix(target);
    try {
      cancelAnimationFrame(anim);
    } catch {
      /* ignore */
    }
    if (!autoBox || !autoBox.checked) return applyMix(v);
    const from = mix;
    if (Math.abs(v - from) < 1e-3) return applyMix(v);
    const t0 =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const step = (now) => {
      const k = Math.min((now - t0) / 600, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      applyMix(from + (v - from) * e);
      if (k < 1) {
        try {
          anim = requestAnimationFrame(step);
        } catch {
          applyMix(v);
        }
      }
    };
    try {
      anim = requestAnimationFrame(step);
    } catch {
      return applyMix(v);
    }
    return v;
  };

  // — Single crossfade control: flat bar, no popover, under HUD (z 2). —
  const bar = mk('div', 'sat-xfade');
  bar.setAttribute('data-testid', 'sat-xfade');
  const btnSat = mk('button', 'sat-xfade__btn', 'SAT');
  btnSat.type = 'button';
  btnSat.setAttribute('aria-label', 'Show satellite base');
  const btnTwin = mk('button', 'sat-xfade__btn', 'TWIN');
  btnTwin.type = 'button';
  btnTwin.setAttribute('aria-label', 'Show custom twin');
  const slider = mk('input', 'sat-xfade__slider');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(mix * 100));
  slider.setAttribute('aria-label', 'Satellite to twin crossfade');
  const autoWrap = mk('label', 'sat-xfade__auto');
  const autoBox = mk('input', '');
  autoBox.type = 'checkbox';
  autoBox.checked = true;
  autoWrap.appendChild(autoBox);
  autoWrap.appendChild(document.createTextNode('AUTO'));
  btnSat.addEventListener('click', () => fadeTo(0));
  btnTwin.addEventListener('click', () => fadeTo(1));
  slider.addEventListener('input', () => {
    try {
      cancelAnimationFrame(anim);
    } catch {
      /* ignore */
    }
    applyMix(Number(slider.value) / 100);
  });
  // Circular monitor chip: same diagonal-cut bar language, default OFF.
  btnScope = mk('button', 'sat-xfade__btn sat-xfade__scope', 'SCOPE');
  btnScope.type = 'button';
  btnScope.setAttribute('aria-label', 'Clip satellite to the TOP scope disc');
  btnScope.setAttribute('aria-pressed', scopeOn ? 'true' : 'false');
  btnScope.setAttribute('data-testid', 'sat-scope');
  btnScope.setAttribute('data-gated', 'false');
  try {
    btnScope.title = 'Satellite monitor: imagery inside the TOP disc, twin outside';
  } catch {
    /* title is cosmetic */
  }
  btnScope.addEventListener('click', () => setScope(!scopeOn));
  // SCOPE leads (left end): the bottom-right HUD system cluster
  // (···/FULLSCREEN) overlaps the bar's right end, so the chip stays
  // clickable at the far left, clear of every HUD hit-box.
  bar.appendChild(btnScope);
  bar.appendChild(btnSat);
  bar.appendChild(slider);
  bar.appendChild(btnTwin);
  bar.appendChild(autoWrap);
  container.appendChild(bar);

  // — Twin → map follow (one way, minimal). Center tracks the orbit target
  // (twin pans pan the map 1:1); bearing/pitch/zoom track the orbit rig so
  // the fade never slides. —
  let lastSync = 0;
  let lastCamKey = null;
  const syncFromTwin = (force = false) => {
    pinCanvas();
    // Scope overlay reconciles every tick (throttled inside): the disc
    // follows orbit/pan/zoom and auto-hides on drill-in.
    try {
      refreshScope(force);
    } catch {
      /* scope never breaks the twin loop */
    }
    // Re-assert the mix on every tick: a DEM-swap remount builds a fresh
    // scene at mix 1, and the global fan-out pulls it back for free.
    // Skipped while the scope overlay owns the look (painted opaque).
    if (!scopeShown && (force || mix < 0.999)) {
      try {
        sceneSetBaseMix(mix);
      } catch {
        /* ignore */
      }
    }
    if (!map || !mapReady) return;
    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    // Motion-adaptive throttle: a fixed 150 ms timer makes the map drag
    // visibly behind the camera mid-orbit (crossfade out of sync). When the
    // rig moved since the last sync, follow it immediately; at rest, rest.
    let moved = true;
    try {
      const q = (v) => Math.round(Number(v) * 1e3) / 1e3;
      const key = [q(cam.position.x), q(cam.position.y), q(cam.position.z), q(tgt.x), q(tgt.y), q(tgt.z)].join(',');
      moved = key !== lastCamKey;
      lastCamKey = key;
    } catch {
      moved = true;
    }
    if (!force && !moved && now - lastSync < 150) return;
    lastSync = now;
    let twin = null;
    try {
      twin = getTwin();
    } catch {
      twin = null;
    }
    const cam = twin?.debug?.camera;
    const tgt = (() => {
      try {
        return twin?.debug?.target?.();
      } catch {
        return null;
      }
    })();
    if (!cam?.position || !tgt) return;
    let h = 0;
    try {
      h = container.clientHeight || 0;
    } catch {
      h = 0;
    }
    const v = twinViewToMap(cam.position, tgt, { heightPx: h, fovDeg: cam.fov });
    try {
      map.jumpTo?.({ center: [v.center.lon, v.center.lat], bearing: v.bearing, pitch: v.pitch, zoom: v.zoom });
    } catch {
      /* a torn-down map never breaks the twin loop */
    }
  };

  applyMix(startMix);
  refreshScope(true);

  // Keep the disc glued to the scope ring across window resizes.
  const onResize = () => {
    try {
      refreshScope(true);
    } catch {
      /* ignore */
    }
  };
  try {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', onResize);
    }
  } catch {
    /* ignore */
  }

  return {
    setMix: applyMix,
    fadeTo,
    syncFromTwin,
    setScope,
    get available() {
      return !!map;
    },
    get degraded() {
      return degraded;
    },
    get mix() {
      return mix;
    },
    get scope() {
      return scopeOn;
    },
    get scopeShown() {
      return scopeShown;
    },
    dispose() {
      try {
        cancelAnimationFrame(anim);
      } catch {
        /* ignore */
      }
      try {
        if (typeof window !== 'undefined' && window.removeEventListener) {
          window.removeEventListener('resize', onResize);
        }
      } catch {
        /* ignore */
      }
      try {
        // A twin-owned canvas outlives us: unpunch the scope disc first.
        const c = canvasOf();
        if (c && c.style) {
          c.style.maskImage = '';
          c.style.webkitMaskImage = '';
        }
      } catch {
        /* ignore */
      }
      try {
        map?.remove?.();
      } catch {
        /* ignore */
      }
      map = null;
      try {
        bar.remove();
      } catch {
        /* ignore */
      }
      try {
        base.remove();
      } catch {
        /* ignore */
      }
    },
  };
}
// Historic name (pre open-source swap): kept so existing imports work.
export const initMapboxBase = initSatBase;
