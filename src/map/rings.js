// src/map/rings.js — Phase 03 Task 17 ring geometry (pure, node-checkable).
// Circular hotspot rings: health-divided arcs sized by H3 hex area.
// Each sector -> annulus wedges, one wedge per asset, colored by health.
// Pin fallback: sector centers + worst-health color (used when deck.gl
// can't render or ?pins=1).
import { cellArea, latLngToCell } from 'h3-js';
import { HEALTH_COLORS, H3_RES, worstHealth } from './feed.js';

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
