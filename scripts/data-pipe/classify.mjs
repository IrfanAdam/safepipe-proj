// scripts/data-pipe/classify.mjs — unified Overpass sweep -> the 5 boot layers.
//
// Tag rules reverse-engineered from the Phase-01 per-layer caches
// (/tmp/phase01-*.json: roads=highway motorway..service, tracks=highway=track,
// paths=footway|path|steps, coastline=natural=coastline, terminal=landuse=
// industrial incl. barrier=fence subsets). Ways only, like process-osm.mjs;
// relations/nodes are counted as skipped, never silently dropped.

export const LAYER_ORDER = Object.freeze(['roads', 'tracks', 'paths', 'coastline', 'terminal']);

const ROADS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'service',
]);
const PATHS = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway']);

/**
 * Returns { layers: {roads:[],tracks:[],paths:[],coastline:[],terminal:[]},
 *   filtered: [{id, reason}], skippedNonWay: n, outOfScope: {tag: n} }.
 * Every input way lands in exactly one bucket — the counts always sum back
 * to the input total (asserted by validate.mjs).
 */
export function classify(elements) {
  const layers = { roads: [], tracks: [], paths: [], coastline: [], terminal: [] };
  const filtered = [];
  const outOfScope = {};
  let skippedNonWay = 0;
  for (const el of elements ?? []) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) {
      skippedNonWay += 1;
      continue;
    }
    const t = el.tags ?? {};
    const hw = t.highway;
    if (t.natural === 'coastline') { layers.coastline.push(el); continue; }
    if (t.landuse === 'industrial') { layers.terminal.push(el); continue; }
    if (hw === 'track') { layers.tracks.push(el); continue; }
    if (hw && PATHS.has(hw)) { layers.paths.push(el); continue; }
    if (hw && ROADS.has(hw)) { layers.roads.push(el); continue; }
    if (hw === 'living_street') {
      // Board gap #5: 373 likely mis-tagged town streets — filtered in Task 11.
      filtered.push({ id: el.id, reason: 'highway=living_street excluded per board gap #5' });
      continue;
    }
    const key = hw ? `highway=${hw}` : Object.keys(t).slice(0, 3).join(',') || 'untagged';
    outOfScope[key] = (outOfScope[key] ?? 0) + 1;
  }
  return { layers, filtered, skippedNonWay, outOfScope };
}
