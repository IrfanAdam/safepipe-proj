/* Safepipe Ops 3D — src/ops3d/mapbox-base.js · Mapbox satellite base + crossfade.
 *
 * Owns a Mapbox GL JS Standard-Satellite map (3D terrain, hillshade, dusk-ish
 * light) in a div mounted BEHIND the three.js canvas, centred on the site
 * (57.03N 111.68W). The twin stays the interaction owner: every frame the
 * Mapbox center/bearing/pitch/zoom follows the twin orbit rig (one way,
 * twin → map), so the crossfade feels seamless instead of sliding.
 *
 * Token policy: ?mapboxToken=… in the URL or localStorage ONLY — never
 * committed, never logged, never rendered into the DOM. With no token the
 * module mounts a styled cinematic fallback div (dusk gradient + site tag)
 * and the twin runs custom-only, pixel-identical to today: zero breakage,
 * zero console errors on every path (all Mapbox failures are swallowed).
 *
 * Crossfade: setMix(m) drives BOTH the canvas element opacity (works through
 * the opaque post chain, which composites vec4(col,1)) AND scene.js
 * setBaseMix(m) (clearAlpha + null-able background, so ?post=0 direct
 * renders stay correct too). Default m = 1 = today's opaque look.
 * No twin.js / hud.js / post.js edits needed: the single SAT/TWIN control
 * (slider + toggle + auto-fade, diagonal-cut bar, z-index under the HUD
 * popovers) is injected here, and the DEM-swap remount is covered because
 * scene.js setBaseMix fans out to every live scene while syncFromTwin()
 * re-pins the fresh canvas layer each tick.
 *
 * Pure, unit-tested helpers: clampMix, resolveToken, twinViewToMapbox.
 */
import { setBaseMix as sceneSetBaseMix } from './scene.js';

export const SITE = { lat: 57.03, lon: -111.68 };
export const LS_TOKEN_KEY = 'ops3d.mapboxToken';
export const LS_MIX_KEY = 'ops3d.satMix';
const MAPBOX_JS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.js';
const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.css';
const STANDARD_SATELLITE = 'mapbox://styles/mapbox/standard-satellite';

// Clamp a base-mix value to [0, 1]; non-finite input means "today's opaque".
export function clampMix(m) {
  const v = Number(m);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

// Token resolution order: ?mapboxToken= (persisted to localStorage) then
// localStorage. Returns the token string or null. Never throws.
export function resolveToken({ search = '', storage = null } = {}) {
  try {
    const q = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
    const fromQuery = (q.get('mapboxToken') || '').trim();
    if (fromQuery) {
      try {
        storage?.setItem?.(LS_TOKEN_KEY, fromQuery);
      } catch {
        /* persistence is best-effort */
      }
      return fromQuery;
    }
  } catch {
    /* malformed query — fall through to storage */
  }
  try {
    const s = (storage?.getItem?.(LS_TOKEN_KEY) || '').trim();
    if (s) return s;
  } catch {
    /* storage unavailable (private mode) — custom-only */
  }
  return null;
}

// Twin orbit → Mapbox view. Pure: camPos/target are {x,y,z}-like, world km.
// Bearing follows the orbit azimuth, pitch mirrors the camera elevation
// (top-down twin = top-down map), zoom tracks orbit distance. Approximate
// on purpose — the crossfade reads as one locked view, not a survey overlay.
export function twinViewToMapbox(camPos, target) {
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

function loadMapboxGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (loadMapboxGL._p) return loadMapboxGL._p;
  loadMapboxGL._p = new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v || null);
      }
    };
    const timer = setTimeout(() => finish(null), 12000);
    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPBOX_CSS_URL;
      document.head.appendChild(link);
      const s = document.createElement('script');
      s.src = MAPBOX_JS_URL;
      s.async = true;
      s.onload = () => {
        clearTimeout(timer);
        finish(window.mapboxgl || null);
      };
      s.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      document.head.appendChild(s);
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
  return loadMapboxGL._p;
}

// Dusk-mood the satellite: dim cool light preset, 3D terrain + hillshade so
// relief reads under the dark cinematic twin. Everything best-effort.
function moodMap(map) {
  try {
    map.setConfig?.('basemap', 'lightPreset', 'dusk');
  } catch {
    /* older style schema — ignore */
  }
  try {
    if (!map.getSource?.('mapbox-dem')) {
      map.addSource?.('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    try {
      map.setTerrain?.({ source: 'mapbox-dem', exaggeration: 1.2 });
    } catch {
      /* terrain unsupported — hillshade still helps */
    }
    if (!map.getLayer?.('sat-hillshade')) {
      map.addLayer?.({
        id: 'sat-hillshade',
        type: 'hillshade',
        source: 'mapbox-dem',
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': '#0b0c12',
          'hillshade-highlight-color': '#5a6a86',
        },
      });
    }
  } catch {
    /* satellite alone is still a fine base */
  }
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* initMapboxBase(container, {getTwin, search, storage}) →
 *   {setMix, fadeTo, syncFromTwin, available, dispose}
 * container is the twin mount element (#ops3d-dev). Never throws: any
 * failure degrades to the styled fallback with the twin untouched. */
export function initMapboxBase(container, opts = {}) {
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

  const token = resolveToken({ search, storage });
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

  let map = null;
  let mapReady = false;
  if (!token) {
    const tag = mk('div', 'sat-base__tag', 'SATELLITE OFFLINE · CUSTOM TWIN');
    tag.setAttribute('data-testid', 'sat-base-tag');
    base.appendChild(tag);
  } else {
    loadMapboxGL().then((gl) => {
      if (!gl || !base.isConnected) return;
      try {
        gl.accessToken = token;
        map = new gl.Map({
          container: base,
          style: STANDARD_SATELLITE,
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
        map.on?.('error', () => {
          /* stay silent: fallback gradient shows through map gaps */
        });
      } catch {
        map = null;
      }
    });
  }

  const canvasOf = () => {
    try {
      return container.querySelector('canvas');
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
    const v = twinViewToMapbox(cam.position, tgt);
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
      return !!token;
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
