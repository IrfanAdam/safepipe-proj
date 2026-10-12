# OPS 3D V3 — REAL-WORLD SA… (Ring-2 chassis iteration)

> Status: 🟢 CANVAS LOCKED — base map + twin locked as the canvas (Phase 01 shipped, owner-verified). NEXT: twin-model build (Phase 02 facility reconstruction, scored by the parity rubric). Binding spec: `/Users/irfan/.hermes/attachments/pasted_content_2026-10-11_15-02-15-677_1a4c96.txt` (owner's Sangachal outline, 277 lines, verbatim). Parity rubric: `/Users/irfan/.hermes/attachments/pasted_content_2026-10-12_08-22-14-560_f474d7.txt` (real→digital parity guide — the evaluation lens for every REF GATE below).
> Continues method of: `2026-10-07_153000-ops3d-realworld-twin.md` (Phases 00–01 done — foundation + real-terrain workflow in `src/ops3d/`, carried over as method, not site).
> Replaces as active plan: `2026-10-10_191500-ops3d-ring2-seamless-redo.md` (COMPLETE — pushed `c36d8d1`). Ring-2 @ Sangachal stays live as the shipped reference build AND the v3 work site.
> Chassis: `src/ring2/` + `ops3d-ring2.html` (gate-mount, context-loss recovery + telemetry, takeover endpoints, same-frame zoom sync, tilt-aware rim fade).
> Site: **Sangachal Terminal, Azerbaijan — 40.201262N 49.481270E** (the Ring-2 ring center). 153000's Fort McMurray ground truth (Copernicus 25-pt grid) does NOT transfer — Sangachal ground truth is established by this plan's own source workflow below.

## TLDR

Build the geographically grounded twin of the REAL Sangachal Terminal on the shipped Ring-2 chassis: Phase 00 ports v1 panels + markers (parity first); Phase 01 researches/acquires/processes real Sangachal source data and builds real-DEM terrain with aligned imagery; Phase 02 reconstructs the visible terminal (tanks, structures, pipe racks, roads) with honest 3-tier provenance; Phases 03–06 carry the 153000 scope (launcher map → time+sim → ops → lock). Every phase ends at a **REF GATE**.

**Non-negotiable (from spec):** real place from real data — never a generic facility. Implement end-to-end, don't stop at a research report. Never invent files, coverage, coordinates, or findings: if a dataset can't be obtained, name the exact missing file + its official download page, use the best alternative, and document the limitation.

---

## Phase 00 — Fix the foundation (chassis parity)
<!-- {#phase-00} -->
*v1 control panels + map markers on Ring-2. Nothing else moves.*

| # | Task | Done when |
|---|---|---|
| 1 | Control panels port (v1 panel set → Ring-2 HUD, token-only `--ops-*`, no raw hex/px) | every v1 control present, same order |
| 2 | Map markers port (v1 marker set → map + twin overlay) | positions match v1 ±1px @ same zoom; survive SAT↔TWIN slide |
| 3 | Panel↔marker wiring (select/hover/focus round-trip) | click marker → panel; panel action → focus lands <5px @ NEAR |
| 4 | Parity sweep (chromium+webkit, mix 0/50/100, TOP/NEAR, zero pageerrors) | screenshots match v1 stop-for-stop |

- REF GATE 0: owner confirms panels + markers feel like v1 on real Safari.

## Phase 01 — Real Sangachal terrain (source → DEM → imagery)
<!-- {#phase-01} -->
*Spec §§1–4, 7. Bootstrap: Ring-2's live Esri + Terrarium stays up until the real DEM + aligned imagery replace it — never a black/void regression.*

| # | Task | Done when |
|---|---|---|
| 5 | Source research — geography (BP Azerbaijan site; BP ACG ESIA PDF: topo maps, hills, coastline, coords/elevations/distances; treat facility layout as HISTORICAL, not current) | source manifest started; usable figures/coords extracted or gaps named |
| 6 | Source research — elevation (Copernicus Data Space vs OpenTopography vs NASA Earthdata over Sangachal; coverage + resolution + CRS + license compared) | best dataset chosen + documented; limitations written down |
| 7 | Source research — imagery/features (Google Earth, Copernicus, OSM, Overpass Turbo: footprint, hills, Caspian coastline, roads, tanks, buildings; check resolution + acquisition dates; respect licenses, no scraping) | reference set pinned with dates/licenses; area of interest bounded (whole terminal + hills + coastline, no arbitrary mega-tile) |
| 8 | Source research — 3D models/tech docs (GLB/GLTF/OBJ/FBX/IFC/STEP hunt; verify downloadable + usable before depending on anything) | verdict per format; procedural fallback confirmed if empty |
| 9 | DEM → Three.js terrain mesh (real elevations; true horizontal proportions + units; missing-value handling; geo→local coords, never raw lat/lon as positions; Caspian water separated; coastline matches imagery; normals + materials; tiles/LOD for perf; TOO-COARSE acknowledged, never invented detail) | mesh from real band; water/coastline consistent; bounds+CRS recorded |
| 10 | Geographically aligned imagery drape (bounds+projection honored, no stretch-to-fit; else best-permitted reference + clearly-labeled alternative material; source/resolution/date/license documented) | photo and DEM agree at control points; manifest entry complete |
| 11 | Processing workflow + metadata (GDAL/Rasterio/GeoPandas/GeoJSON scripts; compact browser outputs; per-dataset: name, URL, date, resolution, CRS, units, license, steps, limitations — metadata never silently dropped) | rerunnable scripts; source manifest covers every external file |

- REF GATE 1: owner confirms the terrain reads as the real Sangachal coast (screenshot vs reference imagery).

## Phase 02 — Reconstruct the terminal (honest provenance)
<!-- {#phase-02} -->
*Spec §§5–6. Procedural Three.js for the facility; reusable components (tank cylinder+roof, parametric buildings, road curves/extrusions, pipe-rack repeats, paved polys). Clean hierarchy: terrain / water / roads / buildings / industrial.*

| # | Task | Done when |
|---|---|---|
| 12 | Major structures from evidence (tanks, processing structures, frameworks, roads/paved, pipe racks — placed by geographic reference; NO fabricated hidden details or verified-claims on inferred dims/routes) | every object carries tier: **derived** (geo/tech data) / **reconstructed** (visible imagery) / **approximated** (visual fill, recorded as such) |
| 13 | Scene capabilities (orbit/pan/zoom; initial camera = facility + landscape; terrain materials + light; water + atmosphere; selection on major structures; efficient browser rendering) | interaction parity with Ring-2 feel; selection round-trips to panel |
| 14 | CC0 kit + Overpass where they help (Poly Haven pipes GLB → mounts; OSM corridors/roads; provenance per asset `osm\|parametric\|indicated`) | kit parts render on mounts; imports cached under budget |

- REF GATE 2: owner approves reconstruction honesty (toy / noisy / just right) + tier labels visible.

## Phase 03 — Hotspot launcher map
<!-- {#phase-03} -->
*The map is the launcher. (153000 Phase 3.)*

| # | Task | Done when |
|---|---|---|
| 15 | Map landing (MapLibre + deck.gl, Dark Matter vector; Esri satellite toggle) | loads keyless-ish; satellite toggle works |
| 16 | Circular hotspot rings (health-divided arcs, H3-hex sized) + pin fallback | ring matches feed worst-health per sector |
| 17 | Click → full-screen twin overlay (`?sector=<h3>`) | twin opens pre-selected on sector's worst asset |
| 18 | Close round-trip (X/Esc/back keeps hex + selection) | Esc mid-orbit returns to map, selection kept |

- REF GATE 3: owner picks map look + confirms ring reads right.

## Phase 04 — Time variance + sim
<!-- {#phase-04} -->
*(153000 Phase 4.)*

| # | Task | Done when |
|---|---|---|
| 19 | `feedAt(t)` + time slider (30 d history, live tick, +72 h sim) | scrub moves infra + weather + WOs + sim together |
| 20 | Open-Meteo weather overlays (rain tint, wind, temp shift) | cached fixtures offline; live fetch keyless |
| 21 | USGS seismic markers + risk-gated pulse | pulse fires only above threshold; markers match feed |
| 22 | Subsidence field (seeded now, labeled modeled) + sim presets + SIM watermark | same seed → same outcome; watermark whenever sim time active |

- REF GATE 4: owner approves slider feel + sim honesty.

## Phase 05 — Operations layer
<!-- {#phase-05} -->
*(153000 Phase 5.)*

| # | Task | Done when |
|---|---|---|
| 23 | WO fixtures + spatial markers/trails (survive map↔twin trip) | markers match fixtures; list survives trip |
| 24 | Field crews + activity (live pos, heading, ping age) | crews move; stale pings visibly age |
| 25 | Approval-gated actions (request → approve → execute → audit) | unapproved action never executes; audit entry each |
| 26 | Sonic + tactile (confirms, chime, pulse; `M` mutes) | all sounds post-gesture; mute covers all |

- REF GATE 5: owner approves the gate flow.

## Phase 06 — Lock
<!-- {#phase-06} -->
*Ships clean, stays clean. (153000 Phase 6.) Spec §9 deliverables land here.*

| # | Task | Done when |
|---|---|---|
| 27 | Perf budgets (pixel cap, instance counts, `?post=0`, reduced-motion) | budgets logged at boot; Safari holds |
| 28 | Docs + captures (README: setup, processing, architecture, accuracy limits; source manifest with licensing; captures TOP/ISO/NEAR + map) | fresh reader reproduces data pipeline from docs alone |
| 29 | Track-close (phases marked ✓ + sha, 0 wip) | every phase closed with sha; final walkthrough signed |

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
