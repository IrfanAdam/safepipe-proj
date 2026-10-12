# Sangachal Digital Twin — the platform demo (OPS 3D V3, real-world iteration on the Ring-2 chassis)

> Status: 🟢 CANVAS LOCKED — base map + twin locked as the canvas (Phase 00 ✓, Phase 01 ✓, both owner-verified). NEXT: twin-model build (Phase 02 facility reconstruction, scored by the parity rubric). Binding spec: `docs/reference/sangachal-spec.md` (owner's Sangachal outline, 277 lines, verbatim). Parity rubric: same file (the second snapshot was byte-identical to the first, so both point here).
> Continues method of: `2026-10-07_153000-ops3d-realworld-twin.md` (Phases 00–01 done — foundation + real-terrain workflow in `src/ops3d/`, carried over as method, not site).
> Replaces as active plan: `2026-10-10_191500-ops3d-ring2-seamless-redo.md` (COMPLETE — pushed `c36d8d1`). Ring-2 @ Sangachal stays live as the shipped reference build AND the v3 work site.
> Chassis: `src/ring2/` + `ops3d-ring2.html` (gate-mount, context-loss recovery + telemetry, takeover endpoints, same-frame zoom sync, tilt-aware rim fade).
> Site: **Sangachal Terminal, Azerbaijan — 40.201262N 49.481270E** (the Ring-2 ring center). 153000's Fort McMurray ground truth (Copernicus 25-pt grid) does NOT transfer — Sangachal ground truth is established by this plan's own source workflow below.

## Why this plan is the instrumental one

This is the plan that turns the platform into a demonstrable product: a geographically grounded twin of the REAL Sangachal Terminal that exercises every platform feature end-to-end — real-DEM terrain, satellite↔twin crossfade, reconstructed facilities, launcher map, time variance + sim, ops layer, lock. When it is done, one walkthrough shows everything the platform was built for. Read every phase below as *"what new thing can the demo do, and what do I look at to believe it."*

## What the owner supplied (inputs, not tasks)

- **Binding spec** — `docs/reference/sangachal-spec.md`: the owner's 277-line Sangachal outline, §§1–9. The phase tables are the index; this file is the text.
- **Parity rubric** — same file: the real→digital yardstick (toy / noisy / just right). Every REF GATE is scored against it; the rubric table near the bottom of this plan is the quick version.
- **Owner authorizations baked in** (commit-pinned, do not re-litigate): any-imagery-as-modeling-reference with procedural-only outputs (`4581a71`); public-data acquisition automated, Google views read interactively (`8adad1c`); markers follow models — panels-only Phase 00 (`fb2f707`); Phase 02 build order terrain→backdrops→pipelines→facilities with evidence loops (`8bf3a3b`); canvas locked, rubric scores every gate (`2b24407`).

## How to read a phase (nothing below changes task order)

Each phase has: a one-line *what the demo gains*, the task table (unchanged scope), a `### Task N: plain name` note saying **Objective** (what changes for the demo) + **Verify** (the exact check that closes it), then a **REF GATE checklist** — open this, look at that, pass means this. A gate passes only on its checklist; a prettier gate that breaks a parity check fails.

**Goal:** A demonstrable, geographically grounded twin of the REAL Sangachal Terminal — real-DEM terrain, satellite↔twin crossfade, reconstructed facilities — legible as the real coast in one walkthrough.

**Architecture:** Ring-2 chassis where MapLibre owns ground (Esri satellite + Terrarium DEM + one VEX) and Three.js renders procedural overlays (terrain detail, backdrops, pipelines, facilities) draped via shared field; one mix slider drives opacity + emphasis; camera sync bidirectional.

**Tech Stack:** Vite 5 MPA + Three.js 0.170 + MapLibre GL + deck.gl/H3 + GDAL/Rasterio processing; procedural Three.js components, no committed imagery.

**Tags:** Function

---

## TLDR

Build the geographically grounded twin of the REAL Sangachal Terminal on the shipped Ring-2 chassis: Phase 00 ports v1 control panels (parity first — markers wait for the models); Phase 01 researches/acquires/processes real Sangachal source data and builds real-DEM terrain with aligned imagery; Phase 02 builds the twin geometry in owner order (terrain detail → backdrops → pipelines → facilities) with evidence loops + honest 3-tier provenance, no new interactivity; Phases 03–06 carry the 153000 scope (launcher map → time+sim → ops → lock). Every phase ends at a **REF GATE**, every gate scored by the parity rubric.

**Non-negotiable (from spec):** real place from real data — never a generic facility. Implement end-to-end, don't stop at a research report. Never invent files, coverage, coordinates, or findings: if a dataset can't be obtained, name the exact missing file + its official download page, use the best alternative, and document the limitation.

---

## Phase 00 — Control panels reach parity with v1 ✓ done
<!-- {#phase-00} -->
*What the demo gains: the familiar v1 controls on the new chassis, so nothing feels lost. Panels only — markers pin to facility geometry that doesn't exist yet, so they move to Phase 05 after the models land. Nothing else moves.*

| # | Task | Done when |
|---|---|---|
| 1 | Control panels port (v1 panel set → Ring-2 HUD, token-only `--ops-*`, no raw hex/px) | every v1 control present, same order |
| 2 | Parity sweep (chromium+webkit, mix 0/50/100, TOP/NEAR, zero pageerrors) | screenshots match v1 stop-for-stop |

### Task 1: port the v1 control panels ✓ done (`1b7ca0b`)
**Objective:** Every v1 control exists in the Ring-2 HUD in the same order, styled token-only (`13c8514` laid the `--ops-*` set first, zero visual change).
**Verify:** Open v1 and Ring-2 side by side — same controls, same order. Shipped `1b7ca0b`, manifest `7738a96`.
**Slices (this pass):** P0 tokens `13c8514` · P1 static chrome `1b7ca0b` · P2 live controls `b689845` (clock, fullscreen, menu, TOP/ISO/NEAR presets, cam panel UI-only, keymap; overlay/sound rows UI-only till P3) · P3 feed wiring pending.
### Task 2: prove panels match v1 stop-for-stop ✓ done (owner Safari confirm)
**Objective:** No visual or behavior regression a demo viewer could spot.
**Verify:** Chromium + webkit captures at mix 0/50/100, TOP/NEAR, zero pageerrors — then the owner confirm below.

- REF GATE 0 ✓ PASSED: owner confirms panels feel like v1 on real Safari.

## Phase 01 — The ground becomes the real Sangachal coast ✓ done
<!-- {#phase-01} -->
*What the demo gains: the floor under everything is real geography — surveyed elevations, a true Caspian shoreline, draped vectors — so the twin sits on a place, not a backdrop. Spec §§1–4, 7. Bootstrap: Ring-2's live Esri + Terrarium stays up until the real DEM + aligned imagery replace it — never a black/void regression.*

| # | Task | Done when |
|---|---|---|
| 3 | Source research — geography (BP Azerbaijan site; BP ACG ESIA PDF: topo maps, hills, coastline, coords/elevations/distances; treat facility layout as HISTORICAL, not current) | source manifest started; usable figures/coords extracted or gaps named |
| 4 | Source research — elevation (Copernicus Data Space vs OpenTopography vs NASA Earthdata over Sangachal; coverage + resolution + CRS + license compared) | best dataset chosen + documented; limitations written down |
| 5 | Source research — imagery/features (Google Earth, Copernicus, OSM, Overpass Turbo: footprint, hills, Caspian coastline, roads, tanks, buildings; check resolution + acquisition dates; acquisition per owner authorization — see Phase 02 reference strategy) | reference set pinned with dates/licenses; area of interest bounded (whole terminal + hills + coastline, no arbitrary mega-tile) |
| 6 | Source research — 3D models/tech docs (GLB/GLTF/OBJ/FBX/IFC/STEP hunt; verify downloadable + usable before depending on anything) | verdict per format; procedural fallback confirmed if empty |
| 7 | DEM → Three.js terrain mesh (real elevations; true horizontal proportions + units; missing-value handling; geo→local coords, never raw lat/lon as positions; Caspian water separated; coastline matches imagery; normals + materials; tiles/LOD for perf; TOO-COARSE acknowledged, never invented detail) | mesh from real band; water/coastline consistent; bounds+CRS recorded |
| 8 | Geographically aligned imagery drape (bounds+projection honored, no stretch-to-fit; else best-permitted reference + clearly-labeled alternative material; source/resolution/date/license documented) | photo and DEM agree at control points; manifest entry complete |
| 9 | Processing workflow + metadata (GDAL/Rasterio/GeoPandas/GeoJSON scripts; compact browser outputs; per-dataset: name, URL, date, resolution, CRS, units, license, steps, limitations — metadata never silently dropped) | rerunnable scripts; source manifest covers every external file |

### Task 3: learn the real geography ✓ done (Phase 01 chain → `141af13`)
**Objective:** The build works from surveyed facts (ESIA topo, hills, coastline, distances) — facility layout flagged HISTORICAL so nothing stale poses as current.
**Verify:** Source manifest exists with figures/coords or named gaps (`5978221` records manifest counts).
### Task 4: pick the elevation dataset honestly ✓ done (Phase 01 chain → `141af13`)
**Objective:** One chosen DEM with its limits written down — coverage, resolution, CRS, license compared across Copernicus / OpenTopography / NASA Earthdata.
**Verify:** Manifest names the winner + limitations; no invented detail anywhere downslope.
### Task 5: pin the imagery/feature reference set ✓ done (Phase 01 chain → `141af13`)
**Objective:** A dated, licensed reference set (footprint, hills, coastline, roads, tanks, buildings) bounded to terminal + hills + coastline.
**Verify:** Every frame dated + licensed; area of interest bounded; acquisition follows the owner authorization, not the old no-scrape rule (`cf36897`).
### Task 6: rule on 3D-model formats ✓ done (Phase 01 chain → `141af13`)
**Objective:** A verdict per format (GLB/GLTF/OBJ/FBX/IFC/STEP) — downloadable + usable, or procedural fallback confirmed.
**Verify:** Nothing downstream depends on a model that was never proven fetchable.
### Task 7: build the real-DEM terrain mesh ✓ done (Phase 01 chain → `141af13`)
**Objective:** The demo floor is measured earth: true proportions, Caspian water separated at `CASPIAN_SHORE_H=-24` (`b987047`, pinned by the 4-transect shore test `e9577f7`), fallback shoreline retuned to audited contours (`f1b0427`).
**Verify:** `node --test tests/ring2-*` green; mesh from a real band; water/coastline consistent; bounds + CRS recorded.
### Task 8: drape imagery the mesh agrees with ✓ done (Phase 01 chain → `141af13`)
**Objective:** Photo and DEM agree at control points — OSM vectors disc-clipped to the 10 km ring (`afe2666`), wired into boot (`bfa5191`/`fcbba51`, 946 el / 9859 vtx), tilt/pan drift killed (`a6ab678`, `3614032`, `7727ad9`, `8972aaf`).
**Verify:** Captures at control points — no float, no slide; manifest entry complete.
### Task 9: make the pipeline rerunnable ✓ done (Phase 01 chain → `141af13`)
**Objective:** A fresh reader reproduces the data pipeline from docs alone — scripts + per-dataset metadata (name, URL, date, resolution, CRS, units, license, steps, limits).
**Verify:** Scripts rerun clean; manifest covers every external file; close-out `ea7f7c8` + manifest `141af13`.

- REF GATE 1 ✓ PASSED — how it was judged: screenshot of the built terrain set against the pinned reference imagery; pass = owner confirms it reads as the real Sangachal coast.

## Phase 02 — Raise the terminal (ordered reconstruction, evidence loops)
<!-- {#phase-02} -->
*What the demo gains: the terminal itself — recognizable tanks, blocks, pipes on the real ground. Geometry only — no new interactivity in this phase; click-selection + panel round-trip is deferred to Phase 05 (ops layer). Build order per owner: terrain detail → non-facility backdrops → pipelines → facilities. Reference strategy (owner authorization: scrape *** publicly available data): automate acquisition from every open / API-permitted source — Copernicus Data Space, NASA Earthdata, OpenTopography, OSM / Overpass, Esri reference endpoints within their terms — plus Google views read interactively in-browser or via owner-supplied captures, satellite, open data, ground photos — to rebuild accurate models of the whole terminal within ring bounds. Standing boundary: Google tile endpoints are ToS-bound, so those are read, not bulk-downloaded; and no third-party imagery is committed to or redistributed from the repo — shipped models are procedural reconstructions informed by references, not imagery copies. Gaussian-splat / photogrammetry experiments wherever multi-view reference exists. Each category runs a self-improving loop: build → capture → diff vs board → refine or honestly tier. Procedural Three.js; reusable components (tank cylinder+roof, parametric buildings, road curves/extrusions, pipe-rack repeats, paved polys). Clean hierarchy: terrain / water / roads / buildings / industrial. Spec §5.*

| # | Task | Done when |
|---|---|---|
| 10 | Reference board (multi-source sweep: in-browser map views, Sentinel-2/Copernicus, Esri reference, OSM/Overpass vectors, BP ESIA figures, public terminal photography for shape/depth; owner supplies nothing — all public; dates pinned; unobtainable views named with official download pages) | every later task cites board frames; board holds references + captures, never third-party pixels in-repo |
| 11 | Terrain detail + roads (micro-relief within DEM limits, OSM road corridors draped, paved polys; never invented detail) | roads sit on terrain with no float; too-coarse spots recorded approximated |
| 12 | Backdrop objects (non-facility physical inside ring bounds: off-terminal structures, coastal features, landform furniture) | backdrops read at ISO without pulling focus from the terminal |
| 13 | Pipelines + pipe racks (parametric runs, rack repeats; routes from visible evidence only, inferred runs tiered never claimed) | runs continuous at NEAR; no verified-claims on hidden routing |
| 14 | Facilities (tanks, processing blocks, buildings; reusable components; splat-assisted where licensable multi-view exists) | terminal recognisable vs board at TOP / ISO / NEAR |
| 15 | Category parity loops + tier labels (per category: capture → diff → refine; every object stamped **derived** / **reconstructed** / **approximated**; loop log kept) | all objects tiered; loop log attached to gate note |

### Task 10: assemble the reference board
**Objective:** One cited source of visual truth every later task points at — dated frames from all sources, gaps named with download pages.
**Verify:** Tasks 11–14 each cite board frames; board contains references + captures only, zero third-party pixels in-repo.
### Task 11: detail the terrain + lay the roads
**Objective:** Ground you can drive on — micro-relief within DEM limits, road corridors draped, paved areas reading as paved.
**Verify:** Orbit NEAR along a road — no float, no sink; too-coarse spots stamped approximated, not smoothed over.
### Task 12: dress the backdrops
**Objective:** The world around the terminal reads (coast, off-terminal structures, landforms) without stealing focus.
**Verify:** ISO capture — backdrops present but the eye lands on the terminal first.
### Task 13: run the pipelines
**Objective:** Continuous parametric pipe runs + rack repeats, routed only where evidence shows them.
**Verify:** Trace a run at NEAR — unbroken; any inferred routing stamped as such, never claimed verified.
### Task 14: raise the facilities
**Objective:** The money shot — tanks, processing blocks, buildings a viewer recognizes as Sangachal against the board at TOP / ISO / NEAR.
**Verify:** Side-by-side board-vs-twin captures at all three distances; splat-assisted only where multi-view is licensable.
### Task 15: tier everything + keep the loop log
**Objective:** Honesty you can point at — every object stamped **derived** / **reconstructed** / **approximated**, with the capture→diff→refine log attached.
**Verify:** No unstamped objects; loop log attached to the gate note.

- REF GATE 2 (OPEN): owner scores captures against the reference board via the parity rubric (toy / noisy / just right) + tier labels visible. How to judge: open the TOP/ISO/NEAR captures next to the board frames; first check every object carries a tier stamp; then score realism — pass = "just right" with stamps visible.

## Phase 03 — Hotspot launcher map
<!-- {#phase-03} -->
*What the demo gains: the front door — a map you launch the twin from. The map is the launcher. (153000 Phase 3.)*

| # | Task | Done when |
|---|---|---|
| 16 | Map landing (MapLibre + deck.gl, Dark Matter vector; Esri satellite toggle) | loads keyless-ish; satellite toggle works |
| 17 | Circular hotspot rings (health-divided arcs, H3-hex sized) + pin fallback | ring matches feed worst-health per sector |
| 18 | Click → full-screen twin overlay (`?sector=<h3>`) | twin opens pre-selected on sector's worst asset |
| 19 | Close round-trip (X/Esc/back keeps hex + selection) | Esc mid-orbit returns to map, selection kept |

### Task 16: land the map
**Objective:** A map that loads with no keys and flips to satellite.
**Verify:** Fresh load — no key prompts; satellite toggle flips imagery.
### Task 17: draw the health rings
**Objective:** One glance shows worst-health per sector — health-divided arcs sized by H3 hex, pins where rings can't render.
**Verify:** Force a feed worst-health — the matching sector's ring shows it.
### Task 18: make a click open the twin
**Objective:** Click sector → full-screen twin, already focused on that sector's worst asset.
**Verify:** Click any ring — URL carries `?sector=<h3>`, twin opens pre-selected.
### Task 19: make Esc bring you home intact
**Objective:** Closing the twin never loses your place — hex + selection survive X / Esc / back.
**Verify:** Esc mid-orbit — map returns with selection kept.

- REF GATE 3 (OPEN): owner picks map look + confirms ring reads right. How to judge: open the map, toggle satellite, click a ring, Esc back; pass = look approved + ring matches feed worst-health per sector.

## Phase 04 — Time variance + sim
<!-- {#phase-04} -->
*What the demo gains: the demo moves through time — history, live, and an honest simulation. (153000 Phase 4.)*

| # | Task | Done when |
|---|---|---|
| 20 | `feedAt(t)` + time slider (30 d history, live tick, +72 h sim) | scrub moves infra + weather + WOs + sim together |
| 21 | Open-Meteo weather overlays (rain tint, wind, temp shift) | cached fixtures offline; live fetch keyless |
| 22 | USGS seismic markers + risk-gated pulse | pulse fires only above threshold; markers match feed |
| 23 | Subsidence field (seeded now, labeled modeled) + sim presets + SIM watermark | same seed → same outcome; watermark whenever sim time active |

### Task 20: scrub through time
**Objective:** One slider moves the whole scene — infrastructure, weather, work orders, sim together across 30 d back and 72 h forward.
**Verify:** Drag the slider — all four layers move together; live tick resumes on release.
### Task 21: show the weather
**Objective:** Rain, wind, temperature visibly shift the scene from keyless Open-Meteo data.
**Verify:** Offline — cached fixtures render; online — live fetch, no key.
### Task 22: mark the quakes
**Objective:** USGS seismic markers that pulse only when risk crosses threshold — no crying wolf.
**Verify:** Below threshold — silent; above — pulse; markers match feed entries.
### Task 23: model the ground honestly
**Objective:** A seeded subsidence field clearly labeled modeled, with presets — and a SIM watermark whenever sim time is active so nobody mistakes it for live.
**Verify:** Same seed twice — same outcome; watermark visible in every sim-time capture.

- REF GATE 4 (OPEN): owner approves slider feel + sim honesty. How to judge: scrub the slider, trigger a preset, go offline; pass = feel approved + watermark present in sim + fixtures hold offline.

## Phase 05 — Operations layer
<!-- {#phase-05} -->
*What the demo gains: the demo becomes operable — select things, work them, approve actions. (153000 Phase 5.)*

| # | Task | Done when |
|---|---|---|
| 24 | Map markers port (v1 marker set → map + twin overlay, pinned to Phase 02 geometry) | positions match facility models; survive SAT↔TWIN slide |
| 25 | Panel↔marker wiring (select/hover/focus round-trip) | click marker → panel; panel action → focus lands <5px @ NEAR |
| 26 | Twin selection + panel round-trip (deferred from Phase 02: click facility object → panel; panel action → focus) | click object → panel; panel action → focus lands <5px @ NEAR |
| 27 | WO fixtures + spatial markers/trails (survive map↔twin trip) | markers match fixtures; list survives trip |
| 28 | Field crews + activity (live pos, heading, ping age) | crews move; stale pings visibly age |
| 29 | Approval-gated actions (request → approve → execute → audit) | unapproved action never executes; audit entry each |
| 30 | Sonic + tactile (confirms, chime, pulse; `M` mutes) | all sounds post-gesture; mute covers all |

### Task 24: plant the markers on the models
**Objective:** The v1 marker set lives on the Phase 02 geometry — and survives the SAT↔TWIN slide.
**Verify:** Slide 0→100 — markers stay glued to their facilities.
### Task 25: wire panels to markers both ways
**Objective:** Click marker → panel; panel action → camera lands within 5 px at NEAR. Round trip, no dead ends.
**Verify:** Both directions measured <5 px @ NEAR.
### Task 26: make facility objects clickable
**Objective:** The deferred Phase 02 promise — click a tank/block → its panel; panel action → focus.
**Verify:** Click each facility class once; panel action lands <5 px @ NEAR.
### Task 27: show the work orders in space
**Objective:** WO fixtures as spatial markers + trails that survive the map↔twin trip.
**Verify:** Trip map→twin→map — markers match fixtures, list intact.
### Task 28: show the crews alive
**Objective:** Field crews with live position, heading, and visibly aging pings — stale is obvious.
**Verify:** Watch a crew move; age a ping — staleness reads at a glance.
### Task 29: gate actions behind approval
**Objective:** Request → approve → execute → audit, with unapproved actions never executing.
**Verify:** Attempt an unapproved action — blocked; audit holds one entry per action.
### Task 30: add sound that respects the user
**Objective:** Confirms, chime, pulse — all post-gesture, all killed by `M`.
**Verify:** Mute on — total silence; sounds never fire pre-gesture.

- REF GATE 5 (OPEN): owner approves the gate flow. How to judge: request → approve → execute an action, trip a marker map→twin→map, press M; pass = flow approved + audit complete + silence on mute.

## Phase 06 — Lock
<!-- {#phase-06} -->
*What the demo gains: it ships clean and stays clean. Spec §9 deliverables land here. (153000 Phase 6.)*

| # | Task | Done when |
|---|---|---|
| 31 | Perf budgets (pixel cap, instance counts, `?post=0`, reduced-motion) | budgets logged at boot; Safari holds |
| 32 | Docs + captures (README: setup, processing, architecture, accuracy limits; source manifest with licensing; captures TOP/ISO/NEAR + map) | fresh reader reproduces data pipeline from docs alone |
| 33 | Track-close (phases marked ✓ + sha, 0 wip) | every phase closed with sha; final walkthrough signed |

### Task 31: lock the perf budgets
**Objective:** The demo holds on real Safari — pixel caps, instance counts, `?post=0` fallback, reduced-motion honored.
**Verify:** Boot log shows budgets; Safari walkthrough holds them.
### Task 32: write the docs + take the captures
**Objective:** Spec §9 deliverables — README (setup, processing, architecture, accuracy limits), licensed source manifest, TOP/ISO/NEAR + map captures.
**Verify:** A fresh reader reproduces the data pipeline from docs alone.
### Task 33: close the track
**Objective:** Every phase marked ✓ with its sha, zero wip, walkthrough signed.
**Verify:** Manifest shows all phases closed; sign-off recorded.

- REF GATE 6 (final, OPEN): full walkthrough sign-off. **Success = recognisably the real Sangachal landscape** (real-DEM terrain, plausible coastline, evidence-placed structures) — accuracy + coherence over decoration. How to judge: end-to-end walkthrough map→twin→time→ops; pass = sign-off + the landscape reads as Sangachal.

---

## Twin parity rubric (real → digital evaluation)

*The parity doc is the yardstick, not a second build spec. Every REF GATE is scored against it — a gate passes only when its parity checks hold. Evidence wins over looks: geographic accuracy + coherent reconstruction over decorative effects.*

| Gate | Parity check (rubric §§) | Pass bar |
|---|---|---|
| REF 0 — panels ✅ | v1 control set present, same order, token-only styling | owner confirms panels feel like v1 on real Safari |
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
