// scripts/data-pipe/classify.mjs — unified Overpass sweep -> the 12 boot layers.
//
// Tag rules reverse-engineered from the Phase-01 per-layer caches
// (/tmp/phase01-*.json: roads=highway motorway..service, tracks=highway=track,
// paths=footway|path|steps, coastline=natural=coastline, terminal=landuse=
// industrial incl. barrier=fence subsets). Ways only, like process-osm.mjs;
// relations/nodes are counted as skipped, never silently dropped.
//
// The original 5 layers (roads/tracks/paths/coastline/terminal) keep their
// exact rules — their clipped output is byte-pinned by tests. The 7 context
// layers (arterials/streets/landuse/water/power/barriers/buildings) are
// ADDITIVE views over the same ways: a way may join several layers (e.g. a
// primary road is both roads + arterials; a terminal fence is both terminal
// + barriers; an industrial poly is both terminal + landuse). Because of
// this overlap, input ways are NOT partitioned 1:1 across layers —
// validate.mjs accounts unique assigned ways (see buildAsset meta.accounting).

export const LAYER_ORDER = Object.freeze([
  'roads', 'tracks', 'paths', 'coastline', 'terminal',
  'arterials', 'streets', 'landuse', 'water', 'power', 'barriers', 'buildings',
]);

// Byte-pinned legacy buckets (do not reorder or widen — tests pin output).
const ROADS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'service',
]);
const PATHS = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway']);

// Context views (additive; members usually shared with a legacy bucket).
const ARTERIALS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
]);
const STREETS = new Set(['residential', 'living_street', 'footway', 'steps', 'path']);
const LANDUSE = new Set([
  'industrial', 'residential', 'grass', 'quarry', 'military', 'construction', 'greenfield',
]);
const WATERWAY = new Set(['stream', 'river', 'canal', 'drain']);
const POWER = new Set(['plant', 'substation', 'line']);

/**
 * Returns { layers: {12 arrays}, filtered: [{id, reason}],
 *   skippedNonWay: n, skippedWays: n, outOfScope: {tag: n} }.
 * Legacy 5 buckets behave exactly as before; context layers overlap them.
 */
export function classify(elements) {
  const layers = {
    roads: [], tracks: [], paths: [], coastline: [], terminal: [],
    arterials: [], streets: [], landuse: [], water: [], power: [], barriers: [], buildings: [],
  };
  const filtered = [];
  const outOfScope = {};
  let skippedNonWay = 0;
  let skippedWays = 0; // way-typed but geometry-less (vs nodes/relations)
  for (const el of elements ?? []) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) {
      skippedNonWay += 1;
      if (el?.type === 'way') skippedWays += 1;
      continue;
    }
    const t = el.tags ?? {};
    const hw = t.highway;
    // ---- legacy buckets (order + rules frozen) ----
    if (t.natural === 'coastline') { layers.coastline.push(el); }
    else if (t.landuse === 'industrial') { layers.terminal.push(el); }
    else if (hw === 'track') { layers.tracks.push(el); }
    else if (hw && PATHS.has(hw)) { layers.paths.push(el); }
    else if (hw && ROADS.has(hw)) { layers.roads.push(el); }
    else if (hw === 'living_street') {
      // Board gap #5: 373 likely mis-tagged town streets — filtered from the
      // legacy road buckets in Task 11, but installed in streets below.
      filtered.push({ id: el.id, reason: 'highway=living_street excluded per board gap #5' });
    } else {
      const key = hw ? `highway=${hw}` : Object.keys(t).slice(0, 3).join(',') || 'untagged';
      outOfScope[key] = (outOfScope[key] ?? 0) + 1;
    }
    // ---- additive context views (may share members with legacy) ----
    if (hw && ARTERIALS.has(hw)) layers.arterials.push(el);
    if (hw && STREETS.has(hw)) layers.streets.push(el);
    if (t.landuse && LANDUSE.has(t.landuse)) layers.landuse.push(el);
    if (t.waterway && WATERWAY.has(t.waterway)) layers.water.push(el);
    if (t.power && POWER.has(t.power)) layers.power.push(el);
    if (t.barrier === 'fence') layers.barriers.push(el);
    if (t.building !== undefined) layers.buildings.push(el);
  }
  return { layers, filtered, skippedNonWay, skippedWays, outOfScope };
}
