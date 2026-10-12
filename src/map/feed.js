// src/map/feed.js — Phase 03 Task 17 fixture feed (stub; real feed wiring out of scope).
// Facility sectors around the Sangachal pin (40.201262N 49.481270E).
// Offsets in metres: +x east, -z north. H3 index derived live via latLngToCell.
// Health ranks: ok < warn < crit. Worst-health per sector drives ring arcs.
export const SITE = Object.freeze({ lat: 40.201262, lon: 49.48127 });
export const H3_RES = 8;

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((SITE.lat * Math.PI) / 180);

export function offsetToGeo(dx, dz) {
  return {
    lat: SITE.lat - dz / M_PER_DEG_LAT,
    lon: SITE.lon + dx / M_PER_DEG_LON,
  };
}

function S(id, name, dx, dz, assets) {
  const g = offsetToGeo(dx, dz);
  return { id, name, dx, dz, lat: g.lat, lon: g.lon, assets };
}

// Fixture: worst-health varies per sector so the probe can force + read it.
export const SECTORS = [
  S('tank-farm', 'Tank farm', -1800, -600, [
    { id: 'tk-101', health: 'ok' },
    { id: 'tk-102', health: 'ok' },
    { id: 'tk-103', health: 'warn' },
  ]),
  S('processing', 'Processing', 400, -200, [
    { id: 'pr-201', health: 'ok' },
    { id: 'pr-202', health: 'crit' },
  ]),
  S('pumphouse', 'Pumphouse', 1900, 500, [
    { id: 'pu-301', health: 'ok' },
    { id: 'pu-302', health: 'ok' },
  ]),
  S('loading', 'Marine loading', 2600, 1900, [
    { id: 'ml-401', health: 'warn' },
    { id: 'ml-402', health: 'warn' },
  ]),
  S('flare', 'Flare area', -900, 1500, [{ id: 'fl-501', health: 'ok' }]),
  S('gate', 'Gate + utilities', -300, 2300, [
    { id: 'gu-601', health: 'ok' },
    { id: 'gu-602', health: 'ok' },
    { id: 'gu-603', health: 'ok' },
  ]),
];

export const HEALTH_RANK = Object.freeze({ ok: 0, warn: 1, crit: 2 });
export const HEALTH_COLORS = Object.freeze({
  ok: [62, 180, 110, 255],
  warn: [232, 163, 61, 255],
  crit: [224, 82, 82, 255],
});

export function worstHealth(assets) {
  let w = 'ok';
  for (const a of assets) {
    if ((HEALTH_RANK[a.health] ?? 0) > (HEALTH_RANK[w] ?? 0)) w = a.health;
  }
  return w;
}

/** Apply ?force=<sectorId>:<health> override (probe path). Returns a deep copy. */
export function sectorsWithOverride(search = '') {
  const q = new URLSearchParams(search.replace(/^[?]/, ''));
  const force = q.get('force');
  const list = SECTORS.map((s) => ({ ...s, assets: s.assets.map((a) => ({ ...a })) }));
  if (!force) return list;
  const [sid, h] = force.split(':');
  const sec = list.find((s) => s.id === sid);
  if (sec && HEALTH_RANK[h] !== undefined) {
    sec.assets = sec.assets.map((a) => ({ ...a, health: 'ok' }));
    sec.assets.push({ id: 'probe-forced', health: h });
  }
  return list;
}
