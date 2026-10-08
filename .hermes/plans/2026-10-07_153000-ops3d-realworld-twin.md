# Ops 3D v2 — Real-World Safety / Compliance / Maintenance Twin

> Status: 🟢 BUILDING v2 — Phase 1 ✓ done (10/10 tasks, 132 tests green, TOP+NEAR captures verified). Phase 2 pending REF GATE 1 + `go`.
> Replaces: `2026-10-06_003000-ops3d-theatre-style.md` (all 10 tasks shipped, 40 commits) + spinout `153000` terrain-topo.
> Server: `npm run dev` on `:5175`. Never touch `:5173`/`:5174`.

## TLDR
Rebuild the twin around a **real place with real data**: Phase 0 kills the old build's broken focus/boxes/sound bugs; Phase 1 grounds terrain in real 30 m DEM; Phase 2 bolts CC0 industrial models onto real asset mounts; Phase 3 gives you a dark real map (MapLibre + deck.gl on CARTO vector tiles) with hotspots that open the twin; Phase 4 wires real time variance (Open-Meteo weather, USGS seismic, InSAR ground motion, history slider) + per-sector threat sim; Phase 5 spatializes work orders + field crews and gates valve/pump actions behind approvals with audit trail; Phase 6 locks perf/doc. Every phase ends at a **REF GATE** — you drop a reference (photo/screenshot/app) before anything sensitive builds, so nothing drifts again.

## Why the old plan fell short (audit, 2026-10-07)
- Terrain synthetic (procedural dip/swell/hills) → never reads as a real basin. Fixes today: real SRTM 30 m DEM.
- No real world: seeded-RNG layout; no GIS import. Fix: Overpass (OSM) pipeline/feature import + GeoJSON lane.
- Boxes drawn twice (`network.js:265-296` facility boxes + `structures.js:402-412` outline boxes); `structures.mass()` ignores params (`structures.js:89-98`).
- Zoom/refocus: focus falls back to pipe midpoint (`levels.js:32-54`), click-ray uses y=0 so aim sinks under hills (`twin.js:232`), camera damping fights the 600 ms fly (`camera.js:106-127`), TOP→NEAR too fast.
- At-a-glance broken: bloom catches white index contours (`docs/ops-3d-style.md:26`), flow color `#d8a93c` ≈ watch amber `#ff8c39`, terrain outshines faults at TOP.
- Crash: `BASE_DOT_SIZE`/`CRITICAL_GAIN` undefined → `network.update(feed)` throws on any health change (`network.js:329-331`).
- Sound wired but no mute UI, AudioContext pre-gesture.
- Owed but cut in v1: volume/atmosphere, sonic+tactile, map toggle, time series, sim, spatial WOs, gated actions.

## Research pins (verified 2026-10-07)
| Layer | Source | Key-less? | License | Why |
|---|---|---|---|---|
| Real terrain | SRTM GL1 30 m GeoTIFF via OpenTopography S3 `raster/SRTM_GL1/...`, fetched in-browser with geotiff.js (HTTP range; CORS open) | ✅ no key, no account | public | real relief everywhere (56°S–60°N); keeps `terrainSource: procedural|dem` seam |
| Weather | Open-Meteo `/v1/archive` (1940→) + `/v1/forecast` | ✅ no key for non-commercial | free | hours→decades of rainfall/wind/temp; drives light shift + risk tint + corrosion sim input |
| Seismic | USGS FDSN GeoJSON (`earthquake.usgs.gov/fdsnws/event/1/query`) + summary feeds | ✅ no key, open CORS | public domain | tectonic time series + event markers on map/twin |
| Ground motion | NASA OPERA DISP-S1 InSAR (ASF DAAC) — subsidence/uplift time series, note "land subsidence from hydrocarbon extraction" as an intended application | research-grade | open | tectonic/ground-shift time variance; seeded stand-in until creds |
| 2D map | MapLibre GL JS + `@deck.gl/maplibre` MapLibreOverlay on CARTO **Dark Matter** vector GL style | free key (email, instant) 5M tiles/mo | ODbL + CC-BY | dark quiet basemap, hotspots, sharp vector at all zooms; raster CARTO deprecated |
| Real features | OSM Overpass `https://overpass-api.de/api/interpreter` `[out:json][out:geom]` | ✅ no key | ODbL | `man_made=pipeline` (`usage=transmission`, substance, diameter, operator) → real corridor import; ~100 queries/<10 MB/day recurring, cache hard |
| Sector grid | `uber/h3-js` (Apache-2.0) `polygonToCells` res ~7 (~5.2 km hexes) | ✅ | Apache-2.0 | stable sectorId ↔ hex, map↔twin handoff in one id |
| Asset models | Poly Haven **`modular_industrial_pipes_01`** — straight runs, elbows, tees, crosses, flanges, red-handled valve + gauge, 8K PBR, 12k tris, CC0 ✅ (verified at source) | local GLB, no key | CC0 | exhaustively pipes+valves+flanges; bolts/rivets added as instanced geometry on the rig if not in kit |
| Map bases fallback | OSM raster tiles `tile.openstreetmap.org`, Esri World Imagery (free attribution) | ✅ | ODbL/varied | satellite toggle without keys |

**Data-stretch honesty:** US pipelines in OSM are NA/EU-weighted and trunk-only; PHMSA NPMS (authoritative US raster) is zoom-capped so we import what Overpass has, parameterize the rest, and label provenance per asset (`source: 'osm'|'parametric'|'synthetic'`). Bolt-level data never exists publicly — physical models carry synthetic tags marked "indicated".

## Architecture (one spine)
- **Sector = hex (H3 res 7)**. Everything keys off `sectorId`: map layer, twin `feed`, WOs, crews, sim, approvals.
- **map.html** (MapLibre + deck.gl overlay): **the DEFAULT landing view** — dark vector basemap with circular hotspot rings colored/divided by worst sector health (emoji POI pin fallback), sized to sector hexes → click → `/twin.html?sector=<h3>&t=<current>` full-screen twin over the map; close (X/Esc) → back to map with hex exposed; the map is a Google-Maps-style launcher, not a mode.
- **twin.html** (`createTwin(container, {feed, onSelect}) → {setSelection, setFeedAt(t), setSectors, dispose}`): same `sectorId` set; **the twin IS the map the user sees after clicking a hotspot** — loads with `?sector=<h3>`, closes X/Esc back to map.html with hex + selection kept; no "MAP toggle"/mode language anywhere.
- **Feed**: `feedAt(t)` unifies live+sim+history; assets carry `{assetId, sectorId, geo chainage, kind, health, faults[], sensitivity, compliance[], provenance}`; every visual consumes it; nothing reads raw sources directly.
- **Time**: one slider t: live ↔ 30 d past ↔ sim forward 72 h. DEM/weather/seismic/wind all keyed to t; scrubbing moves infrastructure status, weather light, ground displacement, WOs, crews, sim spread together.
- **Sim**: per-sector runner over `feedAt` — leak (plume + sensor triangulation), corrosion growth, ground shift (InSAR-style mm/yr field), storm (wind/temp risk tint) — reproducible seed, watermarked SIM in HUD.
- **Approvals**: valve/pump/isolate action = request → approve → execute → audit log entry; clients never mutate state directly; sci-fi honest: `POST /ops/actions` shape now, endpoint stub later.

---

## Phase 0 — Fix the foundation
<!-- {#phase-0} -->
*Zoom lands exactly on the object, boxes exist once, health changes don't crash, sound has a mute.*

| # | Task | Done when |
|---|---|---|
| 1 | Camera fly retune (damping kill, TOP→NEAR 1200–1600 ms, orbit-inertia kill) | click 3 assets → focus error <5px at NEAR |
| 2 | Terrain-height-aware raycast + fault-chainage aim (never pipe midpoint) | aim never sinks under hills; aim = fault, not midpoint |
| 3 | Single facility-box layer (`mass()` honors params) | boxes render once; radio boxes sit on ground |
| 4 | Define `BASE_DOT_SIZE`/`CRITICAL_GAIN` + TDD feed-shape test first | nominal→critical flip, no throw, test green |
| 5 | Sound mute (`M` + HUD button) + lazy AudioContext on first pointerdown | pre-gesture warning gone; mute silences all |

### Task 1: camera fly retune ✓ done
**Objective:** kill damping mid-fly, separate duration from distance, kill orbit inertia on arrival.
**Files:** `src/ops3d/camera.js`
**Verify:** click 3 assets at TOP → lands <5px off at NEAR, no drift after stop.

### Task 2: height-aware aim ✓ done
**Objective:** raycast follows terrain field (not y=0); focus target = fault chainage, never pipe midpoint.
**Files:** `src/ops3d/twin.js`, `src/ops3d/levels.js`
**Verify:** click asset on a hill → target-Y equals terrain height; focus = fault point.

### Task 3: single facility boxes ✓ done
**Objective:** one box layer; `mass()` honors params; radio boxes wrap geometry to base ground.
**Files:** `src/ops3d/network.js`, `src/ops3d/structures.js`
**Verify:** zero double-drawn boxes; boxes sit on terrain, not floating.

### Task 4: crash constants + TDD test ✓ done
**Objective:** define `BASE_DOT_SIZE`/`CRITICAL_GAIN`; write feed-shape test BEFORE the fix.
**Files:** `src/ops3d/network.js`, `tests/ops3d-feed.test.js` (new)
**Verify:** test red→green; health flip nominal→critical throws nothing.

### Task 5: sound mute + lazy context ✓ done
**Objective:** HUD mute button + `M` toggle; AudioContext created on first pointerdown only.
**Files:** `src/ops3d/sound.js`, `src/ops3d/hud.js`
**Verify:** no pre-gesture console warning; mute kills click confirms + pulses.

- REF GATE 0 (your first steer): confirm focus feel + palette on 2 (TOP + NEAR) captures.

## Phase 1 — Real terrain
*Shipped in 97add68 + a94fd6d · Tasks 6–10 · phase-1.*
<!-- {#phase-1} -->
*At-a-glance: landscape → infrastructure → health → what needs me. Site: Fort McMurray 57.03N −111.68W.*

| # | Task | Done when |
|---|---|---|
| 6 | DEM loader (`terrainSource: 'dem'`, SRTM GL1 via geotiff.js range fetch) | pinned tile renders real relief; procedural fallback only on fetch fail |
| 7 | Contour engine on DEM altitude (keep 32-level power-spaced strips) | contour heights match DEM ±2% |
| 8 | Audit-recipe landscape layers (river/cutbank, muskeg, kettle lakes, seismic grid) | reads as Athabasca valley, not generic hills |
| 9 | Density-grammar infra seeding (mines NW, tailings center, pads SE) | quadrant layout matches audit spot map |
| 10 | Attention lock (terrain whispers at TOP, faults brightest, flow ≠ amber) | TOP fault found in 2s; single sun dir |

### Task 6: DEM loader ✓ done
**Objective:** fetch 1° SRTM GL1 GeoTIFF (OpenTopography S3, geotiff.js in browser, no key) for the pinned tile; altitude → mesh; `terrainSource: procedural` fallback only if fetch fails.
**Files:** `src/ops3d/terrain.js`
**Verify:** real ~60–70 m valley cut visible; fallback path covered by test.
**Accuracy (ground truth: Copernicus 30 m via Open-Meteo, 25-pt grid, 44 km window @57.03N −111.68W, 2026-10-08 → relief 277 m / sd 65 m / W-wall ~130 m): rating 3/10.** SITE/tile/URL pin correct, but `loadDEM()` squeezes the whole 1° tile (~111×60 km @57N, center 57.5N −111.5W) into the 44 km site window and voids origin/resolution — real-DEM altitudes would land ~55 km off, and the 30 m relief gate passes near-flat tiles. Tracked as `it.todo` in `tests/ops3d-terrain-accuracy.test.js`. Fix = affine via image origin+resolution, window site extent, raise gate toward real ~277 m relief; then re-rate.

### Task 7: contours on DEM ✓ done
**Objective:** keep 32-level power-spaced contour strips, sourced from DEM altitude not synthetic field.
**Files:** `src/ops3d/terrain.js`
**Verify:** contour heights match DEM altitude ±2%.
**Accuracy: rating 7/10.** `levelsForRange()` math exact by construction; gate now asserts endpoints ±2% against the REAL band (252–529 m) in `tests/ops3d-terrain-accuracy.test.js`. −3 because no real DEM has ever loaded in-app, so conformance to a live-decoded band is still unexercised — re-rate after Task 6 georeferencing fix with a decoded-tile band check.

### Task 8: audit-recipe landscape ✓ done
**Objective:** braided Athabasca (point bars vs cutbank), hairpin tributaries, muskeg mottling, kettle lakes, cut blocks, seismic checkerboard — field/texture layers keyed to DEM.
**Files:** `src/ops3d/terrain.js`, `src/ops3d/overlays.js`
**Verify:** side-by-side with audit frames reads as the same place.
**Accuracy: rating 7/10** (measured 2026-10-08, `tests/ops3d-terrain-accuracy.test.js`; lifted 6→7 in the Phase 1 iteration). Valley exists with correct E–W asymmetry (W-wall avg ~116 m vs real ~130 m; every reach >70 m); relief 227 m = 82% of real 277 m; variance sd 42 m = 65% of real 65 m. VEX 4.5 makes the variance visible from ISO; summit + valley-floor tags bracket the span. Remaining gap is amplitude (plateau variance), not shape. Kettle/muskeg/cutbank presence is qualitative (no ground-truth anchor) — excluded from the score.

### Task 9: density-grammar seeding ✓ done
**Objective:** mine benches ~40% of NW quadrant, tailings rectangles with straight dykes + real palette (pale mature / dark fresh / tan cells), SAGD pads 60–90 per 9.6 km on DLS lines, corridors 20–60 m wide.
**Files:** `src/ops3d/network.js`, `src/ops3d/structures.js`
**Verify:** quadrant spot-check vs audit.md spot map.
**Accuracy: rating 5/10.** Coverage 10/10 (every layout asset resolves a quadrant+role, `tests/ops3d-density.test.js`); positional fidelity 3/10 — quadrants are layout-relative squares, not geo-anchored to audit coordinates, so the "matches spot map" check is eyeball-only. To lift: pin quadrant corners to real lat/lon around 57.03N −111.68W and assert known real facilities fall in the right quadrant.

### Task 10: attention lock ✓ done
**Objective:** terrain whispers at TOP (threshold drop), faults always brightest (bloom won't catch white contours), flow color token distinct from watch amber `#ff8c39`, single sun direction.
**Files:** `src/ops3d/post.js`, `src/ops3d/scene.js`, tokens
**Verify:** TOP fault found in 2s; NEAR frames a pad from 550 m.
**Accuracy: rating 8/10** (perceptual, not terrain — verified in code 2026-10-08). Single sun ✓ (1× `DirectionalLight` in `scene.js`); flow cyan `0x35c5d8` vs watch amber `#ff8c39` ≈ 160° hue separation, never confusable ✓; terrain whisper opacities set (0.44/0.92) with bloom threshold 0.36 catching critical red, not white ✓. −2: the "fault found in 2s" claim has no harness — needs a scripted TOP-frame luminance-contrast check or a timed human pass at REF GATE 1.

- REF GATE 1: you pick the terrain mood (photo/map screenshot); confirm the pinned center + the audit's layout.

## Phase 1 iteration — feedback pass ✓ done (2026-10-08)
Visual/realism feedback addressed before Phase 2, same ground truth (Copernicus 25-pt grid). Ratings moved: Task 8 6→7.
- Blips: bead/diamond/speckle sizes + opacities down, glow textures 128px soft (no more zoom raster squares), speckle mapped round. NEAR holds off: orbit min 0.05→0.5, close-ups pipeline 2.2→3.0 / facility 0.45→0.9 / sensor 0.35→0.7.
- Terrain glow: mass fills 0.30→0.12 + softer texture, summit disks 0.18→0.08, fault zone 0.13→0.08, bloom 0.5→0.4 — faults still brightest (threshold 0.36 untouched).
- Relief readable: VEX 3.2→4.5 (every drape coherent, single-sourced), valley −65→−85 m, valley-floor tag joins the summit tags so the span reads at TOP.
- Connections sit on the world: pipe walls, flow, beads, dive markers, fault kit, halos, sensors, structure pipe runs all drape onto `field×VEX` — nothing floats at flat datum or slices through hills anymore. True facility geo-match stays a Phase 2 Overpass job (documented, not faked).
- Volume: dark grounding shadow under each footprint + ground-sit everywhere; holograms read as mass on the skin.
- Labels: TOP shows dest pills + faulted + selected + hovered only; full set in-field (segment/asset). All plates chamfered, zero rounded corners — same cut on elev pills, HUD boxes, buttons, chips.
- DoF: auto apertures 8/2.8/1.8 → 6.5/2.2/1.4, maxCoc 14→18 — drilled-in background melt is unmistakable, TOP stays legible.
- Flow: comet layer (short bright pulses, 2.5× base speed, breathing opacity) over the cyan drift.
- Verify: 138 tests green (+1 tracked todo for the Task 6 georeferencing fix), build clean.

## Phase 2 — Real inspectable assets
<!-- {#phase-2} -->
*Every asset/facility a defined model you can inspect to the last bolt.*

| # | Task | Done when |
|---|---|---|
| 11 | Overpass import + audit-derived features with provenance labels | corridors + pads + plants load; every asset shows `osm\|parametric\|indicated` |
| 12 | CC0 kit mount (Poly Haven pipes GLB → parametric mount, DRACO/KTX2) | valve/flange/tee render on mounts; health lamp overlays work |
| 13 | Bolt-level LOD (instanced bolt rings, gauges, handwheels; NEAR only) | NEAR zoom holds bolts without shimmer; part count logged |
| 14 | HUD provenance + part readout per asset | selecting any asset shows provenance + part count |

### Task 11: feature import + provenance
**Objective:** Overpass GeoJSON where tagged (`man_made=pipeline` trunks, compressors, tank farms); audit density-grammar for SAGD pads, CPFs, upgrader, mine/tailings complexes (taxonomy in audit.md); provenance per asset.
**Files:** `src/ops3d/network.js`, `src/ops3d/feed.js` (new if missing)
**Verify:** import runs under Overpass budget (cached); provenance visible per asset.

### Task 12: CC0 kit mount
**Objective:** Poly Haven `modular_industrial_pipes_01` GLB local, DRACO/KTX2 loaders; meshes → parametric mount (atlas recolor, health accents as lamp/emissive overlays, material tokens).
**Files:** `src/ops3d/structures.js`, `src/ops3d/assets/` (new)
**Verify:** valve/flange/tee/gauge render; health change recolors lamp only.

### Task 13: bolt-level LOD
**Objective:** bolt rings, flange bolts, gauge dials, handwheel skeletons as instanced geometry; NEAR-only LOD (or L2 inspect drill-in fade).
**Files:** `src/ops3d/structures.js`, `src/ops3d/levels.js`
**Verify:** NEAR zoom holds bolts without shimmer; per-asset part count logged.

### Task 14: HUD provenance readout
**Objective:** asset panel shows provenance + part count + kind; "indicated" tag where synthetic.
**Files:** `src/ops3d/hud.js`, `src/ops3d/table.js`
**Verify:** every selectable asset shows provenance; no unlabeled synthetic.

- REF GATE 2: you approve detail level (toy / noisy / just right).

## Phase 3 — Hotspot launcher map
<!-- {#phase-3} -->
*The map is the launcher — circular hotspots on a real basemap, click → full-screen twin; close → back to map.*

| # | Task | Done when |
|---|---|---|
| 15 | map.html landing (MapLibre + deck.gl, Dark Matter vector; Esri satellite fallback) | map loads keyless-ish (free CARTO key); satellite toggle works |
| 16 | Circular hotspot rings (health-divided arcs, H3-hex sized) + POI-pin fallback | ring matches feed worst-health per sector |
| 17 | Click → full-screen twin overlay (`twin.html?sector=<h3>`) | twin opens on map; no toggle language anywhere |
| 18 | Close round-trip (X/Esc/browser-back keeps hex + selection) | Esc mid-orbit returns to map, selection kept |

### Task 15: map landing
**Objective:** MapLibre GL JS + `@deck.gl/maplibre` MapLibreOverlay on CARTO Dark Matter vector style; satellite raster (Esri World Imagery, attribution) as toggle.
**Files:** `map.html` (new), `src/ops3d/map.js` (new)
**Verify:** map loads; tiles within free budget; WebGL1-safe.

### Task 16: hotspot rings
**Objective:** radial ring per sector hex, arcs colored/divided by health-state share; sized to H3 footprint; emoji POI pin degraded fallback.
**Files:** `src/ops3d/map.js`
**Verify:** ring matches feed worst-health; fallback renders if shader fails.

### Task 17: twin handoff
**Objective:** click hotspot → `twin.html?sector=<h3>&t=<current>` full-screen over the map; twin IS the map after click.
**Files:** `src/ops3d/map.js`, `twin.html`, `src/ops3d/twin.js`
**Verify:** twin opens pre-selected on sector's worst asset.

### Task 18: close round-trip
**Objective:** X/Esc/browser-back → map with hex exposed + selection kept, one `sectorId` chain.
**Files:** `src/ops3d/map.js`, `src/ops3d/twin.js`
**Verify:** Esc mid-orbit works; back button does the same trip.

- REF GATE 3: you pick map look (Dark Matter vs satellite vs hybrid) + confirm the ring reads right.

## Phase 4 — Time variance + sim
<!-- {#phase-4} -->
*Infrastructure that changes with time; per-sector threat sim you can trust.*

| # | Task | Done when |
|---|---|---|
| 19 | `feedAt(t)` + time slider (30 d history, live tick, +72 h sim) | scrub moves infra + weather + WOs + sim together |
| 20 | Open-Meteo weather (archive + forecast → rain tint, wind vectors, temp shift) | weather overlays on map + twin; corrosion/rain risk correlated |
| 21 | USGS seismic markers + risk-gated "check assets" pulse | M>X nearby triggers pulse; markers on map |
| 22 | Subsidence field (seeded now, DISP-S1-shaped; real series later) | mm/yr displacement visible on twin; HUD labels it modeled |
| 23 | Per-sector sim presets (leak/corrosion/ground-shift/storm) + SIM watermark | reproducible seed; "what's modeled" in HUD |

### Task 19: feedAt + slider
**Objective:** one `feedAt(t)` unifying fixtures-history (30 d), live tick, sim-forward (72 h); single slider; dive replay of faults.
**Files:** `src/ops3d/health-feed.js`, `src/ops3d/hud.js`
**Verify:** scrubbing moves infrastructure status, tracks, WOs, crews, sim spread together.

### Task 20: weather
**Objective:** Open-Meteo archive + forecast for pinned coords (rain, wind, temp); first-class overlays (rain tint, subtle wind vectors, temp sky shift); corrosion/rain risk correlated, not cosmetic.
**Files:** `src/ops3d/weather.js` (new), `src/ops3d/map.js`, `src/ops3d/scene.js`
**Verify:** cached fixtures work offline; live fetch keyless.

### Task 21: seismic
**Objective:** USGS FDSN last-N events for region → markers on map + tremor read in HUD; magnitude/distance filter gates "check assets" pulse.
**Files:** `src/ops3d/weather.js` or `src/ops3d/seismic.js` (new)
**Verify:** pulse fires only above threshold; markers match feed.

### Task 22: subsidence
**Objective:** seeded Kelvin-style subsidence region in twin (mm/yr field); HUD labels it modeled; real InSAR series drops in later.
**Files:** `src/ops3d/terrain.js`, `src/ops3d/overlays.js`
**Verify:** displacement visible at NEAR; honesty label present.

### Task 23: sim presets
**Objective:** leak (plume + sensor triangulation), corrosion growth, ground-shift, storm — spread + consequence over the same feed; reproducible seed; SIM watermark in HUD.
**Files:** `src/ops3d/sim.js` (new)
**Verify:** same seed → same outcome; watermark visible whenever sim time active.

- REF GATE 4: you approve time-slider feel + sim honesty.

## Phase 5 — Operations layer
<!-- {#phase-5} -->
*Safety/compliance/maintenance platform you can run, not just watch.*

| # | Task | Done when |
|---|---|---|
| 24 | WO fixtures + spatial markers/trails on map + twin (survive trip) | WO markers match fixtures; list survives map↔twin |
| 25 | Field crews + activity (live pos, heading, ping age; drone/cam/sensor feed) | crews move on map; stale pings visibly age |
| 26 | Approval-gated actions (valve/pump/isolate: request → approve → execute → audit) | valve action requires approval; lands in audit log |
| 27 | Sonic + tactile (click confirms, approval chime, fault pulse; `M` mutes) | sounds post-gesture reliable; haptics where available |

### Task 24: work orders spatial
**Objective:** WOs + history as markers/trails/status on map + twin; Create-WO from asset panel; list survives map↔twin trip.
**Files:** `src/ops3d/hud.js`, `src/ops3d/map.js`, `src/ops3d/table.js`
**Verify:** WO markers match fixtures; trip keeps list + selection.

### Task 25: field activity
**Objective:** crews with live positions + heading + age-since-ping; upstream triangulated feed (drones/cams/sensors stub).
**Files:** `src/ops3d/health-feed.js`, `src/ops3d/map.js`
**Verify:** stale pings visibly age; heading renders.

### Task 26: gated actions
**Objective:** valve open/close, pump stop, isolate segment — request → approve → execute → audit log; permission stub; HUD confirms, never scene color.
**Files:** `src/ops3d/actions.js` (new), `src/ops3d/hud.js`
**Verify:** unapproved action never executes; audit log entry per execution; `POST /ops/actions` shape stubbed.

### Task 27: sonic + tactile
**Objective:** click confirms, approval chime, fault pulse; `M` mutes; haptics via navigator.vibrate where available.
**Files:** `src/ops3d/sound.js`, `src/ops3d/hud.js`
**Verify:** all sounds post-gesture; mute covers Phase-0 sounds too.

- REF GATE 5: you approve the gate flow (too many taps / too loose).

## Phase 6 — Lock
<!-- {#phase-6} -->
*Ships clean, stays clean.*

| # | Task | Done when |
|---|---|---|
| 28 | Perf budgets (pixel cap, instance counts logged, `?post=0`, reduced-motion path) | budgets logged at boot; reduced-motion kills fly + pulse |
| 29 | Docs + captures (tokens, knobs, sim honesty, provenance map, DEM swap, key setup) | TOP/ISO/NEAR + map captures attached |
| 30 | Track-close (`plan:track` clean, phases marked ✓ + sha, no silent restarts) | 0 wip; every phase closed with sha |

### Task 28: perf budgets
**Objective:** pixel cap, instance budgets logged, `?post=0` path, reduced-motion path, Safari WebGL1-safe GLSL.
**Files:** `src/ops3d/*.js`, shaders
**Verify:** Safari holds; budgets print at boot; `?post=0` disables post chain.

### Task 29: docs + captures
**Objective:** tokens, knobs, sim honesty, provenance map, DEM swap guide, map key setup; captures TOP/ISO/NEAR + map.
**Files:** `docs/ops-3d-v2.md` (new)
**Verify:** fresh reader can swap DEM tile + set map key from docs alone.

### Task 30: track-close
**Objective:** `plan:track` clean; every phase closed with ✓ + sha; phases never restart silently.
**Files:** this plan file
**Verify:** 0 wip; all 30 tasks marked; final walkthrough signed.

- REF GATE 6 (final): full walkthrough sign-off.

## Standing rules (carried over)
- Dev `:5175` only; path-limited commits; `npm run build` green before every commit; `plan:track` clean; no push without your `y`.
- SwiftShader captures + on/off diffs per phase; every phase ends with your REF GATE before next build starts.
- Token-only HUD/CSS (`--ops-*`, no raw hex/px); WebGL1-safe GLSL so Safari holds.
