// src/map/rings.js — Phase 03 Task 17 ring geometry (pure, node-checkable).
// Circular hotspot rings: health-divided arcs sized by H3 hex area.
// Each sector -> annulus wedges, one wedge per asset, colored by health.
// Pin fallback: sector centers + worst-health color (used when deck.gl
// can't render or ?pins=1).
import { cellArea, latLngToCell } from 'h3-js';
import { HEALTH_COLORS, H3_RES, SITE, worstHealth, siteRollup } from './feed.js';

export const RING_SCALE = 1.15; // ring outer radius vs hex circumradius
export const RING_INNER_FRac = 0.62;

/** Hex area (m^2) -> outer ring radius (m). */
export function ringRadiusM(h3Index) {
  const areaM2 = cellArea(h3Index, 'm2');
  const hexR = Math.sqrt((2 * areaM2) / (3 * Math.sqrt(3))); // flat-top circumradius
  return hexR * RING_SCALE;
}

/** Sector -> arc slices (one per asset, equal angles, asset order). */
export function arcsForSector(sector) {
  const n = sector.assets.length || 1;
  return sector.assets.map((a, i) => ({
    asset: a.id,
    health: a.health,
    color: HEALTH_COLORS[a.health] ?? HEALTH_COLORS.ok,
    startDeg: (i / n) * 360,
    endDeg: ((i + 1) / n) * 360,
  }));
}

const D2R = Math.PI / 180;
const M_LAT = 111320;
function mLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** Annulus wedge polygon (lngLat ring) around center. */
export function wedgePolygon(lat, lon, rOuterM, rInnerM, a0Deg, a1Deg, steps = 24) {
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0Deg + ((a1Deg - a0Deg) * i) / steps) * D2R) - Math.PI / 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    outer.push([lon + (dx * rOuterM) / mLon(lat), lat + (dz * rOuterM) / M_LAT]);
    inner.push([lon + (dx * rInnerM) / mLon(lat), lat + (dz * rInnerM) / M_LAT]);
  }
  inner.reverse();
  return [...outer, ...inner, outer[0].slice()];
}

/** Sectors -> deck.gl PolygonLayer data: one wedge feature per asset. */
export function buildRingFeatures(sectors) {
  const feats = [];
  for (const s of sectors) {
    const h3 = latLngToCell(s.lat, s.lon, H3_RES);
    const rO = ringRadiusM(h3);
    const rI = rO * RING_INNER_FRac;
    for (const arc of arcsForSector(s)) {
      feats.push({
        sector: s.id,
        asset: arc.asset,
        health: arc.health,
        color: arc.color,
        h3,
        polygon: wedgePolygon(s.lat, s.lon, rO, rI, arc.startDeg, arc.endDeg),
      });
    }
  }
  return feats;
}

/** GATE 3 single monitoring blip (pure, node-checkable): one datum pinned to
 * SITE (Sangachal), colored by the site worst-health rollup. The deck halo
 * (quiet, low-alpha) + core radii ship here so the blip reads as monitoring
 * — a small dot with a pulse ring — never a pin blob. Click -> twin target
 * is the rolled-up worst sector (twinlink.js wiring untouched). */
export const BLIP_CORE_R_PX = 6;
export const BLIP_HALO_R_PX = 22;
export const BLIP_HALO_ALPHA = 70;

/** Health color with a quiet halo alpha (deck ScatterplotLayer fill). */
export function haloColor(color, alpha = BLIP_HALO_ALPHA) {
  return [color[0], color[1], color[2], alpha];
}

/** Sectors -> the single SITE blip datum. */
export function buildSiteBlip(sectors) {
  const { siteWorst, siteSector } = siteRollup(sectors);
  const color = HEALTH_COLORS[siteWorst] ?? HEALTH_COLORS.ok;
  return {
    sector: siteSector,
    name: 'SANGACHAL',
    position: [SITE.lon, SITE.lat],
    h3: latLngToCell(SITE.lat, SITE.lon, H3_RES),
    worst: siteWorst,
    color,
    halo: haloColor(color),
    coreR: BLIP_CORE_R_PX,
    haloR: BLIP_HALO_R_PX,
  };
}

/** Pin fallback data: one pin per sector, colored by worst-health. */
export function buildPinData(sectors) {
  return sectors.map((s) => {
    const h3 = latLngToCell(s.lat, s.lon, H3_RES);
    const w = worstHealth(s.assets);
    return {
      sector: s.id,
      name: s.name,
      position: [s.lon, s.lat],
      h3,
      worst: w,
      color: HEALTH_COLORS[w],
    };
  });
}
