// scripts/data-pipe/overpass.mjs — Overpass fetch for the Sangachal dataset pipe.
//
// superset fetch; classification/filtering lives in classify.mjs (auditable
// counts, never silent drops). Query bbox = the AOI rect shared with
// scripts/process-osm.mjs (AOI) and docs/source-manifest.json (query_bbox).

export const AOI_BBOX = Object.freeze({
  S: 40.111431, N: 40.291093, W: 49.363656, E: 49.598884,
});

export const DOWNLOAD_PAGE = 'https://overpass-turbo.eu/';

// Union of every selector the boot vector layers need, plus living_street
// (fetched so classify.mjs can filter it with a logged reason — board gap #5,
// "373 highway=living_street likely mis-tagged town streets — filter in
// Task 11" — instead of pretending the fetch never saw it).
export function buildQuery(b = AOI_BBOX) {
  const bb = `${b.S},${b.W},${b.N},${b.E}`;
  return `[out:json][timeout:120];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track|footway|path|steps|pedestrian|cycleway|bridleway)$"](${bb});
  way["natural"="coastline"](${bb});
  way["landuse"="industrial"](${bb});
);
out geom;`;
}

export const ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET the query from the first healthy endpoint. Throws LoudFetchError. */
export async function fetchOverpass(query, { timeoutMs = 120000 } = {}) {
  const errors = [];
  for (const base of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeoutMs);
        // GET with data= : the main instance answers POST with 406.
        const res = await fetch(`${base}?data=${encodeURIComponent(query)}`, {
          signal: ctl.signal,
          headers: { 'User-Agent': 'safepipe-data-pipe/1.0 (ODbL research use)' },
        }).finally(() => clearTimeout(t));
        if (res.status === 429 || res.status === 504) {
          errors.push(`${base} HTTP ${res.status}`);
          await sleep(30000);
          continue;
        }
        if (!res.ok) {
          errors.push(`${base} HTTP ${res.status}`);
          break; // try next mirror, not a retry of the same refusal
        }
        const json = await res.json();
        if (!Array.isArray(json?.elements)) throw new Error('bad payload: no elements[]');
        return { json, endpoint: base };
      } catch (e) {
        errors.push(`${base} attempt ${attempt + 1}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
        await sleep(5000 * (attempt + 1));
      }
    }
  }
  throw new LoudFetchError(errors);
}

export class LoudFetchError extends Error {
  constructor(errors) {
    super(
      [
        'OVERPASS UNREACHABLE — no data fetched, nothing written, nothing invented.',
        ...errors.map((e) => `  - ${e}`),
        'Recover by hand (official download page, no key needed):',
        `  1. Open ${DOWNLOAD_PAGE}`,
        '  2. Paste the query printed below (bbox S40.111431 N40.291093 W49.363656 E49.598884), Run, Export → JSON.',
        '  3. Re-run this pipe with: node scripts/data-pipe/run.mjs --input <downloaded>.json',
      ].join('\n'),
    );
    this.name = 'LoudFetchError';
    this.query = buildQuery();
  }
}
