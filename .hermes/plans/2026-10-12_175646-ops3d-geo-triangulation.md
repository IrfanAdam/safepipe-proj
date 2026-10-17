# Geo Triangulation — multi-source accuracy + completeness for the Sangachal twin

> Status: 🟡 ACTIVE — investigation + incremental integration, no rebuild.
> Site: **Sangachal Terminal, Azerbaijan — 40.201262N 49.481270E** (never transfer other-site constants).
> Binding spec: `docs/reference/sangachal-spec.md`. Active chassis plan: `.hermes/plans/2026-10-11_202541-ops3d-v3-realworld-iteration.md`.
> Rule: real data over invented geometry; approximations stamped approximated; missing data named with its official download page, never fabricated.

**Goal:** Raise the twin's geographic accuracy and feature completeness by triangulating overlapping open datasets against what's already installed.

**Architecture:** Three file-disjoint lanes (OSM vectors / elevation / source-recon) run in parallel; parent integrates, verifies (tests + 2x captures), commits path-limited with `[plan:2026-10-12_175646-ops3d-geo-triangulation.md#phase-01]`.

**Tech Stack:** Existing `scripts/data-pipe/` chain (overpass/clip/classify/validate/wire), Overpass API, AWS open-data DEMs, Three.js twin in `src/ring2/`.

---

## Current installed truth (do not re-fetch blindly)

- OSM vectors (ODbL, © OpenStreetMap contributors): 13 layers in `src/ring2/vectors.js:97-101` (roads/tracks/paths/coastline/terminal/arterials/streets/landuse/water/power/barriers/buildings/far_context); asset `public/data/sangachal-vectors.json` (883 el / 7911 vtx + 11 far-context feats). Known gap: M1 Baku-Quba motorway has no OSM geometry in bbox (flagged, nothing invented).
- Elevation: live Terrarium z12 via `src/ring2/field.js` (bicubic since `0f0de9d`); map side z15 (`src/ring2/sync.js:49`). Phase 01 compared Copernicus/OpenTopography/NASAED — Terrarium won on license + availability.
- Imagery: Esri satellite under twin canvas (attributed in HUD). No third-party pixels in-repo, ever.
- Environment: NO gdal/ogr2ogr, NO postgis/psql on this machine; java present.

## Lane A — OSM completeness (owns: `scripts/data-pipe/*`, `public/data/sangachal-vectors.json`, `src/ring2/vectors.js`, `tests/ring2-vectors*.test.js`) {#lane-a}
*Due: 2026-10-28*

- Re-query Overpass for the AOI: building count vs installed, water bodies (Caspian edge + inland), landuse classes, power/barrier deltas vs installed. Triangulate counts; list added/missing with way ids.
- Integrate deltas through the existing chain (overpass→clip→classify→validate→wire); buildings stay outlines this round (extrusion is a queued lever, not this lane).
- Verify: `node --test tests/ring2-vectors*.test.js` green; counts + ODbL attribution in `docs/source-manifest.json` (report text, parent edits manifest).

## Lane B — Elevation triangulation (owns: new `scripts/data-pipe/elev-*.mjs` + scratch only) {#lane-b}

- Fetch Copernicus GLO-30 tile(s) for the AOI from AWS open data (`s3://copernicus-dem-30m`, no auth) + SRTM 1-arcsec void-filled tile for the same bbox; compare vs live Terrarium field: relief ratio, RMSE at control points, shoreline (-24 m) agreement.
- Verdict rule: integrate (as validation note + manifest entry) only if a source beats Terrarium on measured agreement AND license allows; DEM swap needs parent approval — default is report, not swap.
- Respect access: Copernicus Dataspace OAuth endpoints and USGS EarthExplorer (login-walled) are investigate-only; use no-credential mirrors (AWS) for bytes. Name exact missing files + official download pages for anything gated.

## Lane C — Source recon: Cesium / OSM2World / GDAL / PostGIS (read-only + scratch probes, no repo writes) {#lane-c}

- Cesium ion / OSM Buildings / World Terrain: token-free verdict only (ion needs an account token; streaming-only terms — no vendoring). Report what would unlock with a token vs without.
- OSM2World (java present, fully open source): effort verdict — trial on a small Sangachal OSM extract to scratch if cheap (CLI/glTF out, scratch only); report whether its output could validate our procedural masses. No committed models without license review.
- GDAL/PROJ/PostGIS: not installed, no server — verdict: infeasible locally; standing substitute is `validate.mjs` cross-checks + node geo tests. Document the call (installing PostGIS for this AOI is disproportionate; revisit if pipeline outgrows file-based validation).

## License table (brief every report)

| Source | License | In-repo consequence |
|---|---|---|
| OSM/Overpass | ODbL-1.0 | Attribute © OpenStreetMap contributors (manifest + HUD); share-alike on derived vector DB |
| Copernicus DEM (AWS) | Free/open (Copernicus terms) | Cite + date; derived comparison stats are ours |
| SRTM (USGS, via AWS) | Public domain | Cite source |
| Esri imagery | Esri terms, ToS-bound endpoints | Read/stream only, never bulk-download or commit |
| Cesium ion assets | Account + streaming terms | No token → investigate only |
| OSM2World code/output | Open source (check per-asset) | Trial to scratch; review before committing anything |

## REF GATE

- Tests: full `node --test tests/` 0-fail; `npm run build` green before any commit.
- Captures: 2x TOP/ISO/NEAR vs T3 baseline — stable or improved, zero page errors.
- Honesty: every new number cites its source; every gap names its download page; tiers stamped.
