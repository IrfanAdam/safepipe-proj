# Data pipeline — Sangachal OSM vectors (Phase 02, Tasks 9/11)

One rerunnable chain: **fetch (Overpass) → clip (10 km disc) → validate →
wire (boot)**. Reproduce it from this file alone.

## Reproduce

```sh
# Live (default): fetches Overpass, builds, validates, dry-run wire diff
node scripts/data-pipe/run.mjs

# Offline: reuse a cached sweep (no network), same clip+validate+wire
node scripts/data-pipe/run.mjs --input public/data/osm-sangachal.json

# Install the fresh asset to the boot path (default is dry-run diff only)
node scripts/data-pipe/run.mjs --apply
```

Flags: `--input FILE` (skip fetch), `--out DIR` (default
`scripts/data-pipe/out/`), `--fetch-only`, `--apply`.

## Stages

| Step | Script | In → out |
|---|---|---|
| fetch | `scripts/data-pipe/overpass.mjs` | Overpass QL (bbox `S40.111431 N40.291093 W49.363656 E49.598884`) → raw sweep JSON |
| classify | `scripts/data-pipe/classify.mjs` | raw ways → 5 boot layers + filtered + out-of-scope counts |
| clip | `scripts/data-pipe/clip.mjs` | AOI clamp → `geoToWorld` → disc split → 0.1 m → boot-schema JSON |
| validate | `scripts/data-pipe/validate.mjs` | schema + counts + bounds gates (exit 1 on error, 0 with warnings) |
| wire | `scripts/data-pipe/wire.mjs` | dry-run diff vs `public/data/sangachal-vectors.json`; `--apply` installs |

Boot reads `VECTORS_URL = '/data/sangachal-vectors.json'`
(`src/ring2/vectors.js`) served from `public/data/sangachal-vectors.json` —
the wire step checks this URL and diffs the files, never rewires code.

## Classification (tag rules)

Derived from the Phase-01 per-layer caches (`/tmp/phase01-*.json`); the live
fetch reproduces them almost exactly (tracks 61/61, paths 113/113, coastline
1/1, terminal 91/91 on 2026-10-12):

- **roads** — `highway` in motorway(+_link), trunk(+_link), primary(+_link),
  secondary(+_link), tertiary(+_link), unclassified, residential, service
- **tracks** — `highway=track`
- **paths** — footway, path, steps, pedestrian, cycleway, bridleway
- **coastline** — `natural=coastline`
- **terminal** — `landuse=industrial` (incl. `barrier=fence` subsets)
- **filtered (logged, with reason)** — `highway=living_street` (board gap #5:
  likely mis-tagged town streets, filtered in Task 11)
- **out-of-scope (kept in raw, not boot vectors)** — buildings, pipelines,
  storage tanks, waterways, non-industrial landuse: modeling inputs for later
  tasks, counts reported per run, never silently dropped

Every input element lands in exactly one bucket; validate asserts the
accounting sums back to the input total.

## Clip math

Same semantics as `scripts/process-osm.mjs` (cited, not imported — that
module rebuilds `public/data` + the manifest as an import side effect, and
the manifest is single-writer owned outside this lane): clamp each vertex to
the AOI rect (flag `c:1`), project with `geoToWorld` (`src/ring2/site.js`,
single source of truth), split polylines at the twin-disc crossings
(`DISC_R = RING_RADIUS_M − 150 = 9850 m`, `DISC_TOL = 0.11 m`), drop
fully-outside runs, round to 0.1 m. If the process-osm clip ever changes,
port it to `clip.mjs` and note it here.

## Validation gates

Errors (exit 1): layer keys ≠ the 5 boot layers, malformed features,
non-finite vertices, any vertex past `DISC_R + 0.11`, meta/count mismatch,
accounting gap. Warnings (exit 0): empty layer with a named cause — e.g.
`coastline` is empty for the 2026-10-12 board sweep, whose query omitted
`natural=coastline`; the pipe's own query includes it, so a live fetch clears
the warning.

## Failure contract

Unreachable source → exit 2, nothing written, nothing invented: the error
names the official download page (https://overpass-turbo.eu/), the exact
query bbox, and the `--input` recovery command. The full QL is printed for
paste-into-Turbo recovery.

## Provenance

This pipe never writes `docs/source-manifest.json` (single-writer: parent
lane). It prints a `PROVENANCE` block per run for the parent to file. Latest:

- source: Overpass API (https://overpass-turbo.eu/, api overpass-api.de)
- query_bbox: S40.111431 N40.291093 W49.363656 E49.598884
- 2026-10-12 live: osm_base `2026-10-12T10:48:02Z`, classified
  roads 692 / tracks 61 / paths 113 / coastline 1 / terminal 91,
  asset 883 elements / 7911 vertices, max_rr 9850 m
- license: ODbL-1.0, attribution © OpenStreetMap contributors

## Last verified

2026-10-12: offline chain (`--input public/data/osm-sangachal.json`) and
live chain both VALID; `node --test tests/` green; `npm run build` green.
Wire left as dry-run: fresh asset differs from the live boot file only in
roads (649 vs 638 — new OSM ways since the Phase-01 cache); wiring is a
parent decision with pinned-test + manifest updates.
