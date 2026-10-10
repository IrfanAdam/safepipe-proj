/* Safepipe Ops 3D — src/ops3d/sat-base.js · open-source satellite base + crossfade.
 *
 * Owns a MapLibre GL JS satellite map (Esri World Imagery true-color +
 * Esri reference places/roads overlay + AWS Terrarium hillshade) in a div
 * mounted BEHIND the three.js canvas centred on the site (57.03N 111.68W).
 * MapLibre ALSO owns the ground in 3D: real Terrarium DEM terrain at the
 * twin VEX (TERRAIN_EXAGGERATION), so relief, valleys, and water sit where
 * the real world puts them — the twin's synthetic terrain mesh yields via
 * the ground-ownership seam (twin.setTerrainMode, driven by the crossfade
 * mix + SCOPE disc) and the twin renders overlays only (pipes, structures,
 * beacons, labels) on SAT. Every
 * frame the map center/bearing/pitch/zoom follows the twin orbit rig (one
 * way, twin → map), so the crossfade feels seamless instead of sliding.
 * First visit (no stored/?sat= choice) glides to SAT on map load so the
 * real terrain is the opening frame; any explicit choice retires that.
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
import { resolveSite } from './dem.js';

export const SITE = { lat: 57.03, lon: -111.68 };
export const LS_MIX_KEY = 'ops3d.satMix';

// MapLibre GL JS (open-source, BSD-3-Clause) via CDN. No npm dep, no key.
const MAPLIBRE_JS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const MAPLIBRE_CSS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';

// Free, keyless tile sources. Esri tile order is {z}/{y}/{x}.
const ESRI_WORLD_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Keyless Esri reference overlay (boundaries + places + roads) — what makes
// satellite read as Google-like instead of a bare photo. Same host as the
// imagery, attribution below.
const ESRI_REFERENCE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const TERRARIUM_TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const TILE_ATTRIBUTION = {
  imagery: 'Imagery © Esri, Maxar, Earthstar Geographics',
  reference: 'Reference © Esri, HERE, Garmin, OpenStreetMap contributors',
  terrain: 'Terrain © AWS Terrain Tiles (Terrarium; SRTM/ETOPO/GMTED sources)',
};

// MapLibre 3D terrain exaggeration. Matches the twin VEX (terrain.js) so
// draped overlays (pipes sample field() at VEX heights) sit ON the real
// terrain instead of floating above / sinking below it. Single source here;
// the test suite asserts numeric equality with terrain.js VEX.
export const TERRAIN_EXAGGERATION = 1;

// First-visit showcase: when the map loads and the user never chose a mix
// (no ?sat=/?mix=, nothing persisted), glide to SAT so the first thing
// seen is real 3D terrain + satellite. Pure + unit-tested.
export function shouldAutoShowcase({ hasParam = false, hasStored = false, level = 'network' } = {}) {
  return !hasParam && !hasStored && level === 'network';
}

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
  // Mirrored bearing: twin +x runs opposite the map's east at the same
  // yaw, so the map must turn with atan2(-dx, dz) — plain atan2(dx, dz)
  // spins the imagery opposite the orbit drag (invisible only at yaw
  // 0/180 where dx ≈ 0). Measured: mirrored bearing wins at every yaw.
  const bearing = ((Math.atan2(-dx, dz) * 180) / Math.PI + 360) % 360;
  const elev = (Math.asin(Math.min(1, Math.max(-1, dy / dist))) * 180) / Math.PI;
  const pitch = Math.min(70, Math.max(0, 90 - elev));
  const heightPx = Number(view.heightPx) > 0 ? Number(view.heightPx) : 900;
  const fovDeg = Number(view.fovDeg) > 0 ? Number(view.fovDeg) : 40;
  const spanKm = 2 * dist * Math.tan(((fovDeg * Math.PI) / 180) / 2);
  // No slant factor: zoom is dist/fov-driven only (slant is handled by
  // pitch). The zoom constant is the 512-px-tile convention
  // (78271.51696 = 156543.03392/2): feeding MapLibre the 256-px value
  // rendered imagery at 2× magnification vs the twin.
  const mpp = (spanKm * 1000) / heightPx; // twin metres per pixel
  // Site follows the twin: view.site (or the default pin) so a
  // ?site=<lat>,<lon> twin pans the map around the same ground.
  const center = twinTargetToLatLon(target, view.site ?? SITE);
  // Floor 8.5 (not 10): the corrected plan zoom at H=800 is ~9.5 — a
  // min-10 clamp would re-break the scope on typical windows.
  const zoom = Math.min(
    16,
    Math.max(8.5, Math.log2((78271.51696 * Math.cos((center.lat * Math.PI) / 180)) / Math.max(mpp, 1e-6))),
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

// TOP scope disc radius: the FULL mapped circle (r = SCOPE_R_KM, matches
// terrain.js / gridfloor.js) at every site. An earlier revision scaled the
// disc by the site DEM window (Sangachal extentKm 20 → ~9.09 km), which cut
// the satellite lens to ~45% of the ring diameter and stranded pipes on
// black outside the disc — the DEM window bounds surveyed relief, not the
// global Esri imagery under the lens. North-up fix: sea-east registration
// needs the whole ring, so the lens is the ring, period.
// [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-1]
export function scopeRadiusForSite(_site = {}) {
  return SCOPE_R_KM;
}

// World-space lens clip (user call — no ring, just clipping): a single
// opaque fill band (map-bg color) covering everything outside the mapped
// circle R. It lives INSIDE the map style, so the lens rides the map render
// at every pitch with zero JS per tick — real-time follow that cannot
// flicker, and a single hard world-circular edge that cannot band. Same
// pattern as Ring-2.
export const LENS_MASK_COL = '#0b0c0c'; // container bg: clipped ground reads as vignette
export const LENS_BAND_LAYER_IDS = ['lens-band'];
export const LENS_BAND_OPACITY = [1];
export function lensCirclePts(site = SITE, rKm = SCOPE_R_KM, seg = 72) {
  const pts = [];
  const count = Math.max(8, Math.min(256, Math.floor(Number(seg) || 72)));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const g = twinTargetToLatLon({ x: Math.cos(a) * rKm, y: 0, z: Math.sin(a) * rKm }, site);
    pts.push([g.lon, g.lat]);
  }
  pts.push(pts[0].slice());
  return pts;
}
export function lensMaskGeoJSON(site = SITE, radiusKm = SCOPE_R_KM) {
  const R = Number(radiusKm) > 0 ? Number(radiusKm) : SCOPE_R_KM;
  // Outer shell = the whole world (mercator limits): zoomed-out oblique
  // views otherwise show photo past a fixed-degree box. The lens hole is
  // the only imagery window at any zoom or pitch.
  const world = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const band = (outer, hole, id, op) => ({
    type: 'Feature',
    properties: { band: id, 'fill-opacity': op },
    geometry: { type: 'Polygon', coordinates: hole ? [outer, hole] : [outer] },
  });
  return {
    type: 'FeatureCollection',
    features: [band(world, lensCirclePts(site, R), 1, 1)],
  };
}

export function isNetworkLevel(level) {
  return level === 'network';
}

export function shouldShowScope({ scopeOn, level, mix = 0 } = {}) {
  if (!scopeOn || !isNetworkLevel(level ?? 'network')) return false;
  // Full-TWIN retires the lens: the slider promises the pure custom twin,
  // and a satellite punch on top of it reads as photo bleed / a rim
  // mismatch. Drag back toward SAT and the lens returns.
  if (Number(mix) >= 0.999) return false;
  return true;
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

// Screen ellipse of the mapped circle derived from the MAP's own rendered
// pose (not the twin camera): ring points go twin-km → lon/lat →
// map.project() → screen px. The clip is painted onto the map element, so
// deriving it from the map frame keeps lens and photo on the same cadence —
// seamless real-time follow with no rim shimmer mid-orbit. Pure (project is
// injected, so unit tests use a fake).
export function ringEllipseFromProject(project, site = SITE, radiusKm = SCOPE_R_KM, n = 48) {
  if (typeof project !== 'function') return null;
  if (!(radiusKm > 0)) return null;
  const count = Math.max(8, Math.min(128, Math.floor(Number(n) || 48)));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let valid = 0;
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    let s = null;
    try {
      const ll = twinTargetToLatLon(
        { x: radiusKm * Math.cos(a), y: 0, z: radiusKm * Math.sin(a) },
        site,
      );
      s = project([ll.lon, ll.lat]);
    } catch {
      s = null;
    }
    const x = Number(s?.x);
    const y = Number(s?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    valid++;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (valid < 8) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  if (!(rx >= 2) || !(ry >= 2) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const q = (v) => Math.round(v * 10) / 10;
  return { cx: q(cx), cy: q(cy), rx: q(rx), ry: q(ry) };
}
// Twin-camera variant (fallback when the map pose is unreadable).
export function rimEllipsePx(camPos, target, fovDeg, w, h, radiusKm = SCOPE_R_KM, n = 48) {
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
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  if (!(rx >= 2) || !(ry >= 2) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const q = (v) => Math.round(v * 10) / 10;
  return { cx: q(cx), cy: q(cy), rx: q(rx), ry: q(ry) };
}
// Bounding-box circle variant (kept for API compat + centered fallback).
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

// CSS that confines the satellite layer to the lens (applied to .sat-base).
// Ellipse form conforms to the foreshortened disc at oblique tilt; when
// ry is omitted it equals rx (circle, top-down look).
export function scopeClipCss(cx, cy, rx, ry = null) {
  const yy = ry === null || ry === undefined ? rx : ry;
  if (yy === rx) return `circle(${rx}px at ${cx}px ${cy}px)`;
  return `ellipse(${rx}px ${yy}px at ${cx}px ${cy}px)`;
}

// Lens-limb feather (px) by camera elevation: crisp hairline up top where
// the lens reads as a survey instrument, melting at oblique tilt where a
// hard circular limb + bezel ring would read as a planet sphere. Pure.
export function scopeFeatherPx(elevDeg) {
  const e = Number(elevDeg);
  if (!Number.isFinite(e)) return 1.5;
  if (e >= 70) return 1.5;
  if (e <= 20) return 28;
  return 1.5 + ((70 - e) / 50) * (28 - 1.5);
}

// Satellite stays visible at EVERY tilt (user call — TOP-only retired):
// MapLibre 3D terrain superimposes under the twin at all angles, so the
// base layer never hides. Unknown camera fails visible (legacy). Pure.
export const SAT_TOP_MIN_ELEV = 70; // retired gate boundary (kept for API compat)
export function satVisibleAtTilt(elevDeg) {
  const e = Number(elevDeg);
  if (!Number.isFinite(e)) return true;
  return true;
}
// CSS mask that punches the same disc out of the twin canvas: satellite
// shows through inside, custom twin stays opaque outside. `inside` is the
// twin's alpha inside the disc — the crossfade mix, so mid-blend ghosts the
// twin (contours/pipes) over the satellite instead of snapping SAT-only.
// `featherPx` softens the limb (see scopeFeatherPx). Transparent
// inside → black outside with a feathered rim. Pure.
export function scopeMaskCss(cx, cy, rx, inside = 0, featherPx = 1.5, ry = null) {
  const a = Number(inside);
  const inner = `rgba(0,0,0,${Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 0})`;
  const f = Number(featherPx);
  const feather = Number.isFinite(f) ? Math.min(64, Math.max(0.5, f)) : 1.5;
  const yy = ry === null || ry === undefined ? rx : ry;
  if (yy === rx) {
    return (
      `radial-gradient(circle ${rx}px at ${cx}px ${cy}px, ` +
      `${inner} 0, ${inner} ${rx}px, #000 calc(${rx}px + ${feather}px))`
    );
  }
  return (
    `radial-gradient(ellipse ${rx}px ${yy}px at ${cx}px ${cy}px, ` +
    `${inner} 0, ${inner} 100%, #000 calc(100% + ${feather}px))`
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
function satStyle(site = SITE) {
  return {
    version: 8,
    center: [site.lon, site.lat],
    zoom: 11,
    sources: {
      'esri-sat': {
        type: 'raster',
        tiles: [ESRI_WORLD_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: TILE_ATTRIBUTION.imagery,
      },
      'esri-ref': {
        type: 'raster',
        tiles: [ESRI_REFERENCE],
        tileSize: 256,
        maxzoom: 19,
        attribution: TILE_ATTRIBUTION.reference,
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
      'lens-mask-src': {
        type: 'geojson',
        data: lensMaskGeoJSON(site, scopeRadiusForSite(site)),
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
      {
        id: 'sat-ref',
        type: 'raster',
        source: 'esri-ref',
        paint: {
          // Reference labels over the photo, kept quiet so imagery leads.
          'raster-opacity': 0.85,
        },
      },
      // World-space lens clip, topmost: stepped world-circular fade (see
      // lensMaskGeoJSON). Labels clip to the lens too.
      ...LENS_BAND_LAYER_IDS.map((id, i) => ({
        id,
        type: 'fill',
        source: 'lens-mask-src',
        filter: ['==', ['get', 'band'], i + 1],
        paint: { 'fill-color': LENS_MASK_COL, 'fill-opacity': LENS_BAND_OPACITY[i] ?? 1 },
      })),
    ],
  };
}

// MapLibre OWNS the ground: real Terrarium DEM 3D terrain at the twin VEX
// (overlays drape at VEX heights, so exaggeration must match or pipes
// float/sink) + atmosphere sky at oblique angles. Best-effort, swallowed.
function moodMap(map) {
  try {
    map.setTerrain?.({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION });
  } catch {
    /* satellite + hillshade alone is still a fine base */
  }
  try {
    map.setSky?.({
      'sky-color': '#0e141b',
      'horizon-color': 'rgba(146, 160, 175, 0.35)',
      'fog-color': '#0e141b',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.5,
      'sky-horizon-blend': 0.5,
    });
  } catch {
    /* sky is cosmetic (older CDN) */
  }
  try {
    if (typeof map.setMaxPitch === 'function') map.setMaxPitch(70);
  } catch {
    /* pitch cap is cosmetic */
  }
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* initSatBase(container, {getTwin, search, storage, site}) →
 *   {setMix, fadeTo, syncFromTwin, available, mix, dispose}
 * container is the twin mount element (#ops3d-dev). Never throws: any
 * failure degrades to the styled fallback with the twin untouched.
 * site ({lat,lon} or "lat,lon") centers the map; defaults to ?site=, then
 * the Fort McMurray pin. */
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
  // Working site: explicit opts.site wins, then ?site=, then the default
  // pin — the map style center + every twin→map follow use this one site.
  const site = resolveSite(opts.site, (() => {
    try { return new URLSearchParams(search || '').get('site'); } catch { return null; }
  })());
  const storage = opts.storage ?? (() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  })();

  let startMix = 1;
  let hasParam = false;
  let hasStored = false;
  try {
    const q = new URLSearchParams(search || '');
    if (q.get('sat') != null) { startMix = clampMix(Number(q.get('sat'))); hasParam = true; }
    else if (q.get('mix') != null) { startMix = clampMix(Number(q.get('mix'))); hasParam = true; }
    else {
      const saved = storage?.getItem?.(LS_MIX_KEY);
      if (saved != null && saved !== '') { startMix = clampMix(Number(saved)); hasStored = true; }
    }
  } catch {
    startMix = 1;
  }
  // Any explicit mix choice (UI or API) retires the first-visit showcase.
  let userChoseMix = hasParam || hasStored;

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
  let tileOks = 0;
  let terrainBad = false;
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
    // opts.map injects a ready map (unit tests): same wiring, no CDN.
    if (opts.map) {
      map = opts.map;
    } else {
      if (!ml || !base.isConnected) {
        // In jsdom/fake-DOM unit tests base.isConnected is undefined — only
        // tag when we are sure there is no live document to mount into.
        if (!ml) showOfflineTag();
        return;
      }
      try {
        map = new ml.Map({
        container: base,
        style: satStyle(site),
        center: [site.lon, site.lat],
        // Extent-scaled initial zoom: a 20 km window opens ~1.14 closer than
        // the 44 km Fort McMurray default (13 + log2(44/extent)); default
        // extent keeps exactly 13.
        // [plan:2026-10-10_150100-ops3d-sangachal-twin.md#phase-1]
        zoom: 13 + Math.log2(44 / (Number(site?.extentKm) > 0 ? Number(site.extentKm) : 44)),
        attributionControl: { compact: true },
        interactive: false,
        fadeDuration: 0,
      });
      map.on?.('load', () => {
        // Shed map wins over late load: error-tiles count as complete, so a
        // dead-layer map still fires load — it must not strip the offline
        // tag, re-apply terrain churn, or showcase-fade over a layerless map.
        if (degraded) {
          try {
            hideLoadingTag();
          } catch {
            /* tag is cosmetic */
          }
          return;
        }
        mapReady = true;
        hideLoadingTag();
        // Late load after the watchdog fired: drop the stale offline tag so
        // the DOM never claims OFFLINE under a live map.
        try {
          base.querySelector?.('[data-testid="sat-base-tag"]')?.remove();
        } catch {
          /* tag is cosmetic */
        }
        moodMap(map);
        syncFromTwin(true);
        // First-visit showcase: no explicit choice + TOP/network → glide to
        // the real 3D terrain + satellite (cinematic 1000 ms). A failed map
        // never moves the twin; a stored/?sat= choice always wins.
        try {
          if (!userChoseMix && shouldAutoShowcase({ hasParam, hasStored, level: resolveLevel() })) {
            fadeTo(0);
          }
        } catch {
          /* showcase is cosmetic */
        }
      });
      map.on?.('error', (e) => {
        /* stay silent: fallback gradient shows through map gaps. When tiles
         * keep failing (blocked network), shed the 3D terrain + reclaim the
         * twin so the tab is twin-over-gradient + offline tag — NEVER a
         * black hole. Sat layers are KEPT (not removed) so tile retries
         * continue and the recovery listener below can un-shed. An explicit
         * user SAT choice is still reversed: an unfulfillable choice must
         * not strand the viewport on a layerless map. */
        if (degraded) return;
        if (!e || (!e.tile && e.sourceId !== 'esri-sat' && e.sourceId !== 'terrain')) return;
        tileOks = 0;
        if (e.sourceId === 'terrain') terrainBad = true;
        if (++tileErrs < 8) return;
        degraded = true;
        try {
          map.setTerrain?.(null);
        } catch {
          /* ignore */
        }
        showOfflineTag();
        // Shed may land while the twin sits transparent (user slid to SAT):
        // bring it back — twin-over-gradient + tag beats black every time.
        try {
          fadeTo(1);
        } catch {
          /* twin stays as-is */
        }
      });
      // Self-heal: tile retries continue after a shed (layers kept). Six
      // consecutive successful sat/reference tile loads mean the network
      // breathes again → un-shed, re-apply terrain unless terrain itself
      // was the culprit, drop the offline tag.
      map.on?.('sourcedata', (e) => {
        try {
          if (!e || e.sourceDataType !== 'content') return;
          if (!e.tile || e.tile.state !== 'loaded') return;
          const id = e.sourceId || e.source?.id;
          if (id !== 'esri-sat' && id !== 'esri-ref') return;
          if (!degraded) {
            tileErrs = 0;
            return;
          }
          if (++tileOks < 6) return;
          degraded = false;
          tileErrs = 0;
          tileOks = 0;
          try {
            if (!terrainBad) map.setTerrain?.({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION });
          } catch {
            /* satellite alone is still a fine base */
          }
          try {
            base.querySelector?.('[data-testid="sat-base-tag"]')?.remove();
          } catch {
            /* tag is cosmetic */
          }
        } catch {
          /* recovery is best-effort */
        }
      });
    } catch {
      map = null;
      showOfflineTag();
    }
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
  let scopeMiss = 0; // consecutive gated ticks before the lens actually hides
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

  // Reconcile the scope overlay with toggle + level (throttled; force on
  // toggle/resize). Shown only at TOP/network — drill-ins auto-hide and
  // the user's crossfade mix is restored untouched.
  // Lens visibility drives the WORLD-SPACE bands (lens-band-1..3, topmost
  // in the style): show = clipped satellite lens, hide = full-bleed map.
  // Static layers ride the map render — no per-tick paint, no flicker.
  // Guarded: pre-mount (or a map without the bands) keeps today's look.
  const setLensVisible = (on) => {
    try {
      if (!map) return false;
      for (const id of LENS_BAND_LAYER_IDS) {
        try {
          if (typeof map.getLayer === 'function' && !map.getLayer(id)) continue;
          map.setLayoutProperty?.(id, 'visibility', on ? 'visible' : 'none');
        } catch {
          /* one band never breaks the lens */
        }
      }
      return !!on;
    } catch {
      return false;
    }
  };

  const refreshScope = (force = false) => {
    // Base stays visible at every tilt (TOP-only retired — user call):
    // MapLibre 3D terrain superimposes under the twin at all angles. The
    // crossfade mix alone drives twin opacity now.
    try {
      if (base && base.style) base.style.display = '';
      const c = canvasOf();
      if (c && c.style) c.style.opacity = mix >= 0.999 ? '' : String(mix);
    } catch {
      /* base stays as-is */
    }
    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (!force && now - lastScope < 50) return scopeShown;
    lastScope = now;
    // No sized container (gallery hidden-mount): cannot show, never throws.
    try {
      if (!(container.clientWidth > 0) || !(container.clientHeight > 0)) {
        scopeShown = false;
        return false;
      }
    } catch {
      scopeShown = false;
      return false;
    }
    const level = resolveLevel();
    const show = shouldShowScope({ scopeOn, level, mix });
    try {
      btnScope?.setAttribute?.('data-gated', scopeOn && !show ? 'true' : 'false');
    } catch {
      /* ignore */
    }
    if (!show) {
      // Debounced hide (anti-flicker): a single gated tick — level-distance
      // heuristic mid push-in — must not snap the lens off and on. Five
      // consecutive misses before clearing.
      scopeMiss = (scopeMiss || 0) + 1;
      // A forced sync is deliberate (drill-in, toggle) — hide now. Only
      // unforced throttle ticks debounce, where a miss is likely transient.
      if (scopeMiss < 5 && !force) return scopeShown;
      scopeMiss = 0;
      if (scopeShown) {
        setLensVisible(false);
        scopeShown = false;
        applyMix(mix, { auto: true });
      }
      return false;
    }
    scopeMiss = 0;
    setLensVisible(true);
    scopeShown = true;
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
    // No camera yank on enable: the world-space lens is valid at every
    // pitch, so SCOPE keeps the current orbit (it used to drop to TOP for
    // the screen-space disc). The network level gate still applies.
    refreshScope(true);
    return scopeOn;
  };
  // Ground ownership follows the MIX only — never the scope lens. The lens
  // punches satellite through inside the disc while the twin stays opaque
  // outside it, so the mesh must stay up whenever the twin side shows
  // (mix >= 0.5); yielding it on scope alone blacked out the twin ground
  // outside the disc and read as photo bleed + a rim mismatch. Guarded:
  // a twin without the seam (or none yet) keeps today's look. Never throws.
  const driveGroundMode = () => {
    try {
      const twin = getTwin?.();
      const fn = twin?.setTerrainMode;
      if (typeof fn !== 'function') return;
      fn.call(twin, mix < 0.5 ? 'maplibre' : 'twin');
    } catch {
      /* ground mode is cosmetic */
    }
  };
  const applyMix = (v, opts = {}) => {
    mix = clampMix(v);
    // Internal re-applies (seed, remount heal, fade steps) are not choices;
    // only the slider / SAT-TWIN buttons / external setMix retire the
    // first-visit showcase.
    if (!opts.auto) userChoseMix = true;
    driveGroundMode();
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
    // World-space lens needs no re-force: static bands ride the map render,
    // so a mid-scope slider drag can't smear anything. Mix alone drives
    // the twin canvas (reconciled at the top of refreshScope).
    return mix;
  };

  // Auto-fade animator: SAT/TWIN jumps glide ~1000 ms (cinematic ease) when
  // AUTO is on — the crossfade reads as one camera move, not a layer swap.
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
      const k = Math.min((now - t0) / 1000, 1);
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
  // DEM-swap remounts replace the twin canvas (fresh element, no opacity,
  // no scope mask, synthetic mesh back to visible): re-apply the full mix
  // the moment the element changes so the crossfade survives the swap.
  let lastCanvas = null;
  const syncFromTwin = (force = false) => {
    pinCanvas();
    try {
      const cur = canvasOf();
      if (cur && cur !== lastCanvas) {
        lastCanvas = cur;
        applyMix(mix, { auto: true });
      }
    } catch {
      /* re-apply is best-effort */
    }
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
    const v = twinViewToMap(cam.position, tgt, { heightPx: h, fovDeg: cam.fov, site });
    try {
      map.jumpTo?.({ center: [v.center.lon, v.center.lat], bearing: v.bearing, pitch: v.pitch, zoom: v.zoom });
    } catch {
      /* a torn-down map never breaks the twin loop */
    }
  };

  applyMix(startMix, { auto: true });
  // The seed call above is not a user choice (auto), and the live canvas is
  // baselined here so only a genuine DEM-remount element swap re-applies.
  userChoseMix = hasParam || hasStored;
  try {
    lastCanvas = canvasOf();
  } catch {
    /* healed on the first sync tick */
  }
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
  // Reseat-on-release: the motion-hold freezes the lens mid-drag, so a
  // release would visibly lag one throttle tick behind. Repaint the lens
  // from the settled camera the moment the pointer lifts (forced sync
  // bypasses the hold; the repaint-skip keeps it cheap when parked).
  const onPointerUp = () => {
    try {
      refreshScope(true);
    } catch {
      /* lens never breaks input */
    }
  };
  try {
    container.addEventListener?.('pointerup', onPointerUp);
    container.addEventListener?.('pointercancel', onPointerUp);
  } catch {
    /* container is a fake in tests */
  }

  return {
    setMix: applyMix,
    fadeTo,
    syncFromTwin,
    // Resize recovery: the gallery mounts v1 while its panel is hidden
    // (0×0); the twin self-heals via RO on unhide but the map needs an
    // explicit resize when its tab is shown. Called from gallery.html.
    resize: () => {
      try {
        map?.resize();
      } catch {
        /* pre-mount: nothing to resize yet */
      }
    },
    setScope,
    get available() {
      return !!map;
    },
    get degraded() {
      return degraded;
    },
    get mapReady() {
      return mapReady;
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
        container.removeEventListener?.('pointerup', onPointerUp);
        container.removeEventListener?.('pointercancel', onPointerUp);
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
