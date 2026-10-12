# OPS 3D V3 — REAL-WORLD SA… (Ring-2 chassis iteration)

> Status: 🟢 CANVAS LOCKED — base map + twin locked as the canvas (Phase 01 shipped, owner-verified). NEXT: twin-model build (Phase 02 facility reconstruction, scored by the parity rubric). Binding spec: `docs/reference/sangachal-spec.md` (owner's Sangachal outline, 277 lines, verbatim — vendored repo-relative 2026-10-12; was `/Users/irfan/.hermes/attachments/pasted_content_2026-10-11_15-02-15-677_1a4c96.txt`). Parity rubric: `docs/reference/sangachal-spec.md` (real→digital parity guide — the evaluation lens for every REF GATE below; the second snapshot was byte-identical to the first, so both point here).
> Continues method of: `2026-10-07_153000-ops3d-realworld-twin.md` (Phases 00–01 done — foundation + real-terrain workflow in `src/ops3d/`, carried over as method, not site).
> Replaces as active plan: `2026-10-10_191500-ops3d-ring2-seamless-redo.md` (COMPLETE — pushed `c36d8d1`). Ring-2 @ Sangachal stays live as the shipped reference build AND the v3 work site.
> Chassis: `src/ring2/` + `ops3d-ring2.html` (gate-mount, context-loss recovery + telemetry, takeover endpoints, same-frame zoom sync, tilt-aware rim fade).
> Site: **Sangachal Terminal, Azerbaijan — 40.201262N 49.481270E** (the Ring-2 ring center). 153000's Fort McMurray ground truth (Copernicus 25-pt grid) does NOT transfer — Sangachal ground truth is established by this plan's own source workflow below.

## TLDR

Build the geographically grounded twin of the REAL Sangachal Terminal on the shipped Ring-2 chassis: Phase 00 ports v1 control panels (parity first — markers wait for the models); Phase 01 researches/acquires/processes real Sangachal source data and builds real-DEM terrain with aligned imagery; Phase 02 builds the twin geometry in owner order (terrain detail → backdrops → pipelines → facilities) with evidence loops + honest 3-tier provenance, no new interactivity; Phases 03–06 carry the 153000 scope (launcher map → time+sim → ops → lock). Every phase ends at a **REF GATE**, every gate scored by the parity rubric.

**Non-negotiable (from spec):** real place from real data — never a generic facility. Implement end-to-end, don't stop at a research report. Never invent files, coverage, coordinates, or findings: if a dataset can't be obtained, name the exact missing file + its official download page, use the best alternative, and document the limitation.

---

## Phase 00 — Fix the foundation (chassis parity)
<!-- {#phase-00} -->
*Panels only — markers pin to facility geometry that doesn't exist yet, so they move to Phase 05 after the models land. Nothing else moves.*

| # | Task | Done when |
|---|---|---|
| 1 | Control panels port (v1 panel set → Ring-2 HUD, token-only `--ops-*`, no raw hex/px) | every v1 control present, same order |
| 2 | Parity sweep (chromium+webkit, mix 0/50/100, TOP/NEAR, zero pageerrors) | screenshots match v1 stop-for-stop |

- REF GATE 0: owner confirms panels feel like v1 on real Safari.

## Phase 01 — Real Sangachal terrain (source → DEM → imagery)
<!-- {#phase-01} -->
*Spec §§1–4, 7. Bootstrap: Ring-2's live Esri + Terrarium stays up until the real DEM + aligned imagery replace it — never a black/void regression.*

| # | Task | Done when |
|---|---|---|
| 3 | Source research — geography (BP Azerbaijan site; BP ACG ESIA PDF: topo maps, hills, coastline, coords/elevations/distances; treat facility layout as HISTORICAL, not current) | source manifest started; usable figures/coords extracted or gaps named |
| 4 | Source research — elevation (Copernicus Data Space vs OpenTopography vs NASA Earthdata over Sangachal; coverage + resolution + CRS + license compared) | best dataset chosen + documented; limitations written down |
| 5 | Source research — imagery/features (Google Earth, Copernicus, OSM, Overpass Turbo: footprint, hills, Caspian coastline, roads, tanks, buildings; check resolution + acquisition dates; acquisition per owner authorization — see Phase 02 reference strategy) | reference set pinned with dates/licenses; area of interest bounded (whole terminal + hills + coastline, no arbitrary mega-tile) |
| 6 | Source research — 3D models/tech docs (GLB/GLTF/OBJ/FBX/IFC/STEP hunt; verify downloadable + usable before depending on anything) | verdict per format; procedural fallback confirmed if empty |
| 7 | DEM → Three.js terrain mesh (real elevations; true horizontal proportions + units; missing-value handling; geo→local coords, never raw lat/lon as positions; Caspian water separated; coastline matches imagery; normals + materials; tiles/LOD for perf; TOO-COARSE acknowledged, never invented detail) | mesh from real band; water/coastline consistent; bounds+CRS recorded |
| 8 | Geographically aligned imagery drape (bounds+projection honored, no stretch-to-fit; else best-permitted reference + clearly-labeled alternative material; source/resolution/date/license documented) | photo and DEM agree at control points; manifest entry complete |
| 9 | Processing workflow + metadata (GDAL/Rasterio/GeoPandas/GeoJSON scripts; compact browser outputs; per-dataset: name, URL, date, resolution, CRS, units, license, steps, limitations — metadata never silently dropped) | rerunnable scripts; source manifest covers every external file |

- REF GATE 1: owner confirms the terrain reads as the real Sangachal coast (screenshot vs reference imagery).

## Phase 02 — Build the twin (ordered reconstruction, evidence loops)
<!-- {#phase-02} -->
*Spec §5. Geometry only — no new interactivity in this phase; click-selection + panel round-trip is deferred to Phase 05 (ops layer). Build order per owner: terrain detail → non-facility backdrops → pipelines → facilities. Reference strategy (owner authorization: scrape any publicly available data): automate acquisition from every open / API-permitted source — Copernicus Data Space, NASA Earthdata, OpenTopography, OSM / Overpass, Esri reference endpoints within their terms — plus Google views read interactively in-browser or via owner-supplied captures, satellite, open data, ground photos — to rebuild accurate models of the whole terminal within ring bounds. Standing boundary: Google tile endpoints are ToS-bound, so those are read, not bulk-downloaded; and no third-party imagery is committed to or redistributed from the repo — shipped models are procedural reconstructions informed by references, not imagery copies. Gaussian-splat / photogrammetry experiments wherever multi-view reference exists. Each category runs a self-improving loop: build → capture → diff vs board → refine or honestly tier. Procedural Three.js; reusable components (tank cylinder+roof, parametric buildings, road curves/extrusions, pipe-rack repeats, paved polys). Clean hierarchy: terrain / water / roads / buildings / industrial.*

| # | Task | Done when |
|---|---|---|
| 10 | Reference board (multi-source sweep: Google views, Sentinel-2/Copernicus, Esri reference, OSM/Overpass vectors, BP ESIA figures, ground photos; dates pinned; unobtainable views named with official download pages) | every later task cites board frames; board holds references + captures, never third-party pixels in-repo |
| 11 | Terrain detail + roads (micro-relief within DEM limits, OSM road corridors draped, paved polys; never invented detail) | roads sit on terrain with no float; too-coarse spots recorded approximated |
| 12 | Backdrop objects (non-facility physical inside ring bounds: off-terminal structures, coastal features, landform furniture) | backdrops read at ISO without pulling focus from the terminal |
| 13 | Pipelines + pipe racks (parametric runs, rack repeats; routes from visible evidence only, inferred runs tiered never claimed) | runs continuous at NEAR; no verified-claims on hidden routing |
| 14 | Facilities (tanks, processing blocks, buildings; reusable components; splat-assisted where licensable multi-view exists) | terminal recognisable vs board at TOP / ISO / NEAR |
| 15 | Category parity loops + tier labels (per category: capture → diff → refine; every object stamped **derived** / **reconstructed** / **approximated**; loop log kept) | all objects tiered; loop log attached to gate note |

- REF GATE 2: owner scores captures against the reference board via the parity rubric (toy / noisy / just right) + tier labels visible.

## Phase 03 — Hotspot launcher map
<!-- {#phase-03} -->
*The map is the launcher. (153000 Phase 3.)*

| # | Task | Done when |
|---|---|---|
| 16 | Map landing (MapLibre + deck.gl, Dark Matter vector; Esri satellite toggle) | loads keyless-ish; satellite toggle works |
| 17 | Circular hotspot rings (health-divided arcs, H3-hex sized) + pin fallback | ring matches feed worst-health per sector |
| 18 | Click → full-screen twin overlay (`?sector=<h3>`) | twin opens pre-selected on sector's worst asset |
| 19 | Close round-trip (X/Esc/back keeps hex + selection) | Esc mid-orbit returns to map, selection kept |

- REF GATE 3: owner picks map look + confirms ring reads right.

## Phase 04 — Time variance + sim
<!-- {#phase-04} -->
*(153000 Phase 4.)*

| # | Task | Done when |
|---|---|---|
| 20 | `feedAt(t)` + time slider (30 d history, live tick, +72 h sim) | scrub moves infra + weather + WOs + sim together |
| 21 | Open-Meteo weather overlays (rain tint, wind, temp shift) | cached fixtures offline; live fetch keyless |
| 22 | USGS seismic markers + risk-gated pulse | pulse fires only above threshold; markers match feed |
| 23 | Subsidence field (seeded now, labeled modeled) + sim presets + SIM watermark | same seed → same outcome; watermark whenever sim time active |

- REF GATE 4: owner approves slider feel + sim honesty.

## Phase 05 — Operations layer
<!-- {#phase-05} -->
*(153000 Phase 5.)*

| # | Task | Done when |
|---|---|---|
| 24 | Map markers port (v1 marker set → map + twin overlay, pinned to Phase 02 geometry) | positions match facility models; survive SAT↔TWIN slide |
| 25 | Panel↔marker wiring (select/hover/focus round-trip) | click marker → panel; panel action → focus lands <5px @ NEAR |
| 26 | Twin selection + panel round-trip (deferred from Phase 02: click facility object → panel; panel action → focus) | click object → panel; panel action → focus lands <5px @ NEAR |
| 27 | WO fixtures + spatial markers/trails (survive map↔twin trip) | markers match fixtures; list survives trip |
| 28 | Field crews + activity (live pos, heading, ping age) | crews move; stale pings visibly age |
| 29 | Approval-gated actions (request → approve → execute → audit) | unapproved action never executes; audit entry each |
| 30 | Sonic + tactile (confirms, chime, pulse; `M` mutes) | all sounds post-gesture; mute covers all |

- REF GATE 5: owner approves the gate flow.

## Phase 06 — Lock
<!-- {#phase-06} -->
*Ships clean, stays clean. (153000 Phase 6.) Spec §9 deliverables land here.*

| # | Task | Done when |
|---|---|---|
| 31 | Perf budgets (pixel cap, instance counts, `?post=0`, reduced-motion) | budgets logged at boot; Safari holds |
| 32 | Docs + captures (README: setup, processing, architecture, accuracy limits; source manifest with licensing; captures TOP/ISO/NEAR + map) | fresh reader reproduces data pipeline from docs alone |
| 33 | Track-close (phases marked ✓ + sha, 0 wip) | every phase closed with sha; final walkthrough signed |

- REF GATE 6 (final): full walkthrough sign-off. **Success = recognisably the real Sangachal landscape** (real-DEM terrain, plausible coastline, evidence-placed structures) — accuracy + coherence over decoration.

---

## Twin parity rubric (real → digital evaluation)

*The parity doc is the yardstick, not a second build spec. Every REF GATE is scored against it — a gate passes only when its parity checks hold. Evidence wins over looks: geographic accuracy + coherent reconstruction over decorative effects.*

| Gate | Parity check (rubric §§) | Pass bar |
|---|---|---|
| REF 1 — terrain canvas ✅ | §§2–4: real-DEM mesh, true proportions + units, water separated, coastline agrees with imagery at control points, imagery bounds + projection honored, too-coarse acknowledged never invented | owner confirms terrain reads as the real Sangachal coast (screenshot vs reference) |
| REF 2 — facility | §5: majors placed by geographic reference; every object tiered **derived** / **reconstructed** / **approximated**; no fabricated hidden detail, no verified-claims on inferred dims/routes; reusable components; hierarchy terrain / water / roads / buildings / industrial | owner approves honesty (toy / noisy / just right) + tier labels visible |
| REF 3–5 — launcher / time / ops | §6: interaction parity, selection round-trips to panel; sim state labeled modeled + SIM watermark; no invented live state | per-gate owner sign-off as tabled |
| REF 6 — lock (final) | §§7–10: pipeline reproducible from docs alone; manifest covers every external file with license; README states accuracy limits; scene recognisably the real terminal landscape | full walkthrough sign-off |

- Parity evidence per gate: captures TOP / ISO / NEAR at mix 0 / 50 / 100, set against the pinned reference set and attached to the gate note.
- Disputes resolve to the rubric, not to taste. A prettier gate that breaks a parity check fails the gate.

---

## Standing rules

- Ports: agents on `:5198`/`:5199` only — NEVER `:5173`/`:5175` (owner's). Reuse live `:5198`, never start/kill servers.
- Every fix via subagents; read-only audits write to `/tmp` only.
- Tests + `npm run build` green before every commit; commit carries `[plan:<this-file>#<phase>]`; no push without owner's `y`.
- Every phase ends at its REF GATE before the next starts. Phases never restart silently.
- Headless-WebKit green ≠ real-Safari proven: Safari proof is an owner-device screenshot with readable telemetry bar.
- The binding spec + parity rubric (attachment paths in the header) MUST be passed in-context to every Phase 01–02 task delegation, and each task's verify step checks its spec section (§§1–9) — the plan tables are the index, the attachments are the text. Phase 02+ gates are additionally scored by the parity rubric above.
