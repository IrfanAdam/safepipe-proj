/* Safepipe Ops 3D — src/ops3d/sat-base.js · open-source satellite base + crossfade.
 *
 * Owns a MapLibre GL JS satellite map (Esri World Imagery XYZ + AWS
 * Terrarium terrain + hillshade, dusk-dimmed raster to match the dark
 * cinematic twin) in a div mounted BEHIND the three.js canvas, centred on
 * the site (57.03N 111.68W). The twin stays the interaction owner: every
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
 * Pure, unit-tested helpers: clampMix, twinViewToMap.
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

// Twin orbit → map view. Pure: camPos/target are {x,y,z}-like, world km.
// Bearing follows the orbit azimuth, pitch mirrors the camera elevation
// (top-down twin = top-down map), zoom tracks orbit distance. Approximate
// on purpose — the crossfade reads as one locked view, not a survey overlay.
export function twinViewToMap(camPos, target) {
  const dx = camPos.x - target.x;
  const dy = camPos.y - target.y;
  const dz = camPos.z - target.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const bearing = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
  const elev = (Math.asin(Math.min(1, Math.max(-1, dy / dist))) * 180) / Math.PI;
  const pitch = Math.min(70, Math.max(0, 90 - elev));
  const zoom = Math.min(16, Math.max(10, 15.5 - Math.log2(dist / 9)));
  return { bearing, pitch, zoom };
}
// Historic name (pre open-source swap): identical math, kept so any
// existing HUD/sync import keeps working with zero edits.
export const twinViewToMapbox = twinViewToMap;

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

// Inline keyless style: Esri satellite raster (dusk-dimmed to sit under the
// dark twin) + Terrarium hillshade so relief reads in the crossfade.
function satStyle() {
  return {
    version: 8,
    center: [SITE.lon, SITE.lat],
    zoom: 13,
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
      {
        id: 'sat',
        type: 'raster',
        source: 'esri-sat',
        paint: {
          'raster-brightness-max': 0.92,
          'raster-saturation': 0.85,
          'raster-contrast': 0.05,
        },
      },
      {
        id: 'sat-hillshade',
        type: 'hillshade',
        source: 'terrain',
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': '#0b0c12',
          'hillshade-highlight-color': '#5a6a86',
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
      if (base.querySelector?.('[data-testid="sat-base-tag"]')) return;
      const tag = mk('div', 'sat-base__tag', 'SATELLITE OFFLINE · CUSTOM TWIN');
      tag.setAttribute('data-testid', 'sat-base-tag');
      base.appendChild(tag);
    } catch {
      /* tag is cosmetic */
    }
  };
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
  bar.appendChild(btnSat);
  bar.appendChild(slider);
  bar.appendChild(btnTwin);
  bar.appendChild(autoWrap);
  container.appendChild(bar);

  // — Twin → map follow (one way, minimal). Center stays pinned on site;
  // bearing/pitch/zoom track the orbit rig so the fade never slides. —
  let lastSync = 0;
  const syncFromTwin = (force = false) => {
    pinCanvas();
    // Re-assert the mix on every tick: a DEM-swap remount builds a fresh
    // scene at mix 1, and the global fan-out pulls it back for free.
    if (force || mix < 0.999) {
      try {
        sceneSetBaseMix(mix);
      } catch {
        /* ignore */
      }
    }
    if (!map || !mapReady) return;
    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (!force && now - lastSync < 150) return;
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
    const v = twinViewToMap(cam.position, tgt);
    try {
      map.jumpTo?.({ center: [SITE.lon, SITE.lat], bearing: v.bearing, pitch: v.pitch, zoom: v.zoom });
    } catch {
      /* a torn-down map never breaks the twin loop */
    }
  };

  applyMix(startMix);

  return {
    setMix: applyMix,
    fadeTo,
    syncFromTwin,
    get available() {
      return !!map;
    },
    get degraded() {
      return degraded;
    },
    get mix() {
      return mix;
    },
    dispose() {
      try {
        cancelAnimationFrame(anim);
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
