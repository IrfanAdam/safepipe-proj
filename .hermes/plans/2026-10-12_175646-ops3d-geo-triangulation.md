# Geo Triangulation — multi-source accuracy + completeness for the Sangachal twin

> Status: 🟡 ACTIVE — Phase 01 + 02 landed (Lanes A/B), Phase 03 recon open.
> Site: **Sangachal Terminal, Azerbaijan — 40.201262N 49.481270E** (never transfer other-site constants).
> Binding spec: `docs/reference/sangachal-spec.md`. Active chassis plan: `.hermes/plans/2026-10-11_202541-ops3d-v3-realworld-iteration.md`.
> Rule: real data over invented geometry; approximations stamped approximated; missing data named with its official download page, never fabricated.

**Goal:** Raise the twin's geographic accuracy and feature completeness by triangulating overlapping open datasets against what's already installed — executed as three phases of agent-delegable tasks, each closable on evidence.

**Architecture:** Three phases (vectors → elevation → source-recon). Each phase has: a one-line *what accuracy gains*, the task table, a `### Task N: plain name` note with **Objective** (what changes) + **Owns** (files the agent may write — nothing else) + **Steps** + **Verify** (the exact check that closes it), then a **REF GATE checklist**. Lane history: Phase 01 continues Lane A, Phase 02 continues Lane B, Phase 03 is Lane C — old `lane-x` commits stay attached via the tokens in each phase intro.

**Delegation rules (all phases):** one task = one agent session; the agent reports text only, the parent edits `docs/source-manifest.json` and the plan. Fresh data goes through the existing chain, never hand-edited into the asset. Scratch under the scratch dir only, pruned after. Counts, coordinates, and findings are measured, never invented. Commits are path-limited with `[plan:2026-10-12_175646-ops3d-geo-triangulation.md#phase-0N]`.

**Tech Stack:** Existing `scripts/data-pipe/` chain (overpass/clip/classify/validate/wire), Overpass API, AWS open-data DEMs, Three.js twin in `src/ring2/`.

---

## Current installed truth (do not re-fetch blindly)

- OSM vectors (ODbL, © OpenStreetMap contributors): 13 layers in `src/ring2/vectors.js:97-101` (roads/tracks/paths/coastline/terminal/arterials/streets/landuse/water/power/barriers/buildings/far_context); asset `public/data/sangachal-vectors.json` (2877 el / 27662 vtx + 10 far-context feats, OSM base 2026-10-12T12:50Z, rebuild `446350f`). Known gap: M1 Baku-Quba motorway has no OSM geometry in bbox (flagged, nothing invented).
- Elevation: live Terrarium z12 via `src/ring2/field.js` (bicubic since `0f0de9d`); map side z15 (`src/ring2/sync.js:49`). Phase 01 compared Copernicus/OpenTopography/NASAED — Terrarium won on license + availability.
- Imagery: Esri satellite under twin canvas (attributed in HUD). No third-party pixels in-repo, ever.
- Environment: NO gdal/ogr2ogr, NO postgis/psql on this machine; java present.

## Phase 01 — OSM vector completeness, close the loop
*Due: 2026-10-28*
<!-- {#phase-01} -->
*What accuracy gains: the installed vectors stop being questioned — suite fully green, M1 gap re-verified against fresh OSM, manifest counts match the asset. (Continues Lane A {#lane-a}.)*
*Fanout: Task 2 and Task 3 read the same asset — run Task 3 after Task 2 only if Task 2 integrates new geometry. Task 1 is file-disjoint, parallel-safe.*

| # | Task | Done when |
|---|---|---|
| 1 | Vectors suite to full green (kill the /tmp dependency) | `tests/ring2-vectors*.test.js` 24/24 with no reads outside the repo |
| 2 | M1 fresh verdict (re-query, integrate only if real) | manifest carries a dated M1 verdict; asset touched only via the chain |
| 3 | Counts + attribution audit | asset counts == manifest counts == mounted layers; ODbL attributed |

### Task 1: vectors suite to full green
**Objective:** One less red the whole plan inherits — the suite passes on any fresh checkout.
**Owns:** `tests/ring2-vectors*.test.js` (+ fixtures under `tests/` if needed).
**Steps:** Replace the `/tmp/phase01-roads.json` read (v3-era `fcbba51` scratch, absent on fresh machines) with a fixture committed under `tests/` or generated in-test from the repo asset. No production-file changes.
**Verify:** `node --test tests/ring2-vectors*.test.js` → 24 pass / 0 fail; full `node --test tests/` fail count drops by exactly one (767→768).
### Task 2: M1 fresh verdict
**Objective:** Settle whether the M1 Baku-Quba motorway has appeared in OSM since the 2026-10-12 base — motorway + route-relation search in bbox and 25 km far-context.
**Owns:** `scripts/data-pipe/*`, `public/data/sangachal-vectors.json`, `src/ring2/vectors.js` (chain outputs only).
**Steps:** Fresh Overpass query (motorway ways + `route=road` relations); triangulate vs installed. If M1 geometry exists: integrate through overpass→clip→classify→validate→wire. If still absent: confirm the standing gap, do not invent.
**Verify:** `node scripts/data-pipe/validate.mjs` clean + vectors tests green; report text states way ids found (or confirms absence) with query date — parent writes the dated manifest verdict.
**Depends:** none. Task 3 re-runs after this if geometry landed.
### Task 3: counts + attribution audit
**Objective:** The three numbers agree — asset meta, manifest, mounted layers — and ODbL attribution is present in manifest + HUD.
**Owns:** none (read-only; reports text, parent edits manifest).
**Steps:** Compare `public/data/sangachal-vectors.json` meta (elements/vertices/far_src) vs `docs/source-manifest.json` vs the 13 layers in `src/ring2/vectors.js:97-101`; confirm © OpenStreetMap contributors in manifest + HUD.
**Verify:** Report text lists the three counts side by side with match/mismatch per line; mismatches become follow-up tasks, not silent edits.

- REF GATE 1 (OPEN, by owner: vector-suite sign-off owed): `tests/ring2-vectors*.test.js` 24/24 with zero out-of-repo reads; full suite 768/768; manifest counts match the asset; M1 verdict dated 2026-10 or later. Evidence: test output + manifest diff. No screenshots — data-only phase.

## Phase 02 — Elevation verdict locked
*Due: 2026-11-17*
<!-- {#phase-02} -->
*What accuracy gains: the Terrarium-holds verdict is reproducible on demand and fully recorded — RMSE, relief, shoreline — with the GLO-30 gap named. (Continues Lane B {#lane-b}.)*
*Fanout: Task 4 then Task 5 — Task 5 reads the manifest Task 4 confirms.*

| # | Task | Done when |
|---|---|---|
| 4 | Re-run elev-compare, confirm verdict reproduces | compare output matches manifest RMSE/agreement within tolerance |
| 5 | Shoreline + relief agreement recorded | manifest carries shore-crossing and relief-ratio numbers with method |

### Task 4: re-run elev-compare, confirm verdict reproduces
**Objective:** The `9cca07e` verdict isn't a one-off — anyone can re-run it and get the same answer.
**Owns:** `scripts/data-pipe/elev-*.mjs` (fixes only; no threshold tuning to force a match).
**Steps:** `node --check` all three scripts; re-run `elev-fetch.mjs` (AWS mirrors, no auth) + `elev-compare.mjs`; compare srtm-terrarium RMSE / r, GLO-90-terrarium RMSE, relief ratios against the manifest entry.
**Verify:** `node --check scripts/data-pipe/elev-common.mjs scripts/data-pipe/elev-fetch.mjs scripts/data-pipe/elev-compare.mjs` clean; report text quotes reproduced vs recorded numbers side by side.
### Task 5: shoreline (−24 m) + relief agreement recorded
**Objective:** The two non-RMSE legs of the verdict exist as numbers in the manifest, not just in a pruned scratch report.
**Owns:** none (read-only; reports text, parent edits manifest).
**Steps:** Confirm manifest carries the shore-crossing comparison (Terrarium vs SRTM distance) and relief ratios with method (grid size, control points); if the scratch report has been pruned, re-derive from the scripts, never from memory.
**Verify:** Report text quotes the manifest lines (or their absence → parent adds them, then re-verify).

- REF GATE 2 (OPEN, by owner: elevation-comparison sign-off owed): compare reproduced within tolerance; manifest carries RMSE + relief + shore numbers with method; GLO-30 gap named with its download page; no DEM swap (swap needs parent approval). Evidence: compare output + manifest diff. No screenshots — data-only phase.

## Phase 03 — Source recon verdicts
<!-- {#phase-03} -->
*What accuracy gains: three build-vs-buy-vs-never verdicts on record — Cesium, OSM2World, GDAL/PostGIS — so nobody re-investigates them. (Lane C {#lane-c}, no commits yet.)*
*Fanout: Tasks 6–8 fully parallel — disjoint tools, scratch/prose only, zero repo writes outside manifest/plan.*

| # | Task | Done when |
|---|---|---|
| 6 | Cesium token-free verdict | manifest states what unlocks with vs without a token, with terms |
| 7 | OSM2World scratch-trial verdict | effort verdict + whether its output validates our procedural masses |
| 8 | GDAL/PostGIS call documented | infeasibility verdict with standing substitute + revisit condition |

### Task 6: Cesium token-free verdict
**Objective:** A written answer to "does Cesium unlock anything for Sangachal" — without an account, without vendoring.
**Owns:** none (investigate only; reports text, parent edits manifest).
**Steps:** Review Cesium ion / OSM Buildings / World Terrain access terms (streaming-only, no vendoring); state what a token would unlock vs what is visible without one.
**Verify:** Report text names the terms reviewed + the with/without-token capability split; license table gains the Cesium row if missing.
### Task 7: OSM2World scratch-trial verdict
**Objective:** Know what OSM2World costs us and whether its output could validate our procedural masses.
**Owns:** scratch only (small Sangachal OSM extract → CLI/glTF out, never committed).
**Steps:** If cheap, trial OSM2World on a small extract to scratch; report effort (setup minutes, output quality) + whether its massing output is a usable cross-check for the twin's procedural buildings. No committed models without license review.
**Verify:** Report text gives the effort verdict + the validation-usefulness call with the trial output path (scratch) or the reason the trial wasn't cheap enough to run.
### Task 8: GDAL/PostGIS call documented
**Objective:** The "why not PostGIS" answer, written once.
**Owns:** none (reports text, parent edits manifest).
**Steps:** Confirm gdal/ogr2ogr + postgis/psql still absent; document the call — installing PostGIS for this AOI is disproportionate; standing substitute is `validate.mjs` cross-checks + node geo tests; revisit if the pipeline outgrows file-based validation.
**Verify:** Report text states the checked versions/absence + substitute + revisit condition.

- REF GATE 3 (OPEN, by owner: recon-verdict sign-off owed): three verdicts in the manifest with license + access notes; zero repo writes outside manifest/plan (scratch pruned); license table covers every source touched. Evidence: manifest diff. No screenshots — recon phase.

## License table (brief every report)

| Source | License | In-repo consequence |
|---|---|---|
| OSM/Overpass | ODbL-1.0 | Attribute © OpenStreetMap contributors (manifest + HUD); share-alike on derived vector DB |
| Copernicus DEM (AWS) | Free/open (Copernicus terms) | Cite + date; derived comparison stats are ours |
| SRTM (USGS, via AWS) | Public domain | Cite source |
| Esri imagery | Esri terms, ToS-bound endpoints | Read/stream only, never bulk-download or commit |
| Cesium ion assets | Account + streaming terms | No token → investigate only |
| OSM2World code/output | Open source (check per-asset) | Trial to scratch; review before committing anything |
