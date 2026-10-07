# Ops 3D v2 — Real-World Safety / Compliance / Maintenance Twin

> Status: 🟡 DRAFT v2 — research-pinned, awaiting your `go` / ref steer. Nothing built yet.
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
- **map.html** (MapLibre + deck.gl overlay): dark vector basemap → hotspot hexes colored by worst sector health → click → `/twin.html?sector=<h3>&t=<current>` deep link, pre-selecting the worst asset in that sector.
- **twin.html** (`createTwin(container, {feed, onSelect}) → {setSelection, setFeedAt(t), setSectors, dispose}`): same `sectorId` set; "MAP" toggle round-trips to `map.html#<h3>` and keeps selection; browser back too.
- **Feed**: `feedAt(t)` unifies live+sim+history; assets carry `{assetId, sectorId, geo chainage, kind, health, faults[], sensitivity, compliance[], provenance}`; every visual consumes it; nothing reads raw sources directly.
- **Time**: one slider t: live ↔ 30 d past ↔ sim forward 72 h. DEM/weather/seismic/wind all keyed to t; scrubbing moves infrastructure status, weather light, ground displacement, WOs, crews, sim spread together.
- **Sim**: per-sector runner over `feedAt` — leak (plume + sensor triangulation), corrosion growth, ground shift (InSAR-style mm/yr field), storm (wind/temp risk tint) — reproducible seed, watermarked SIM in HUD.
- **Approvals**: valve/pump/isolate action = request → approve → execute → audit log entry; clients never mutate state directly; sci-fi honest: `POST /ops/actions` shape now, endpoint stub later.

---

### Phase 0 — Fix the foundation (the old build's bugs; unblocks everything)
**Goal:** zoom lands exactly on the object, boxes exist once, health changes don't crash, sound has a mute & warning gone.
- Camera: kill damping mid-fly, separate fly duration from distance (TOP→NEAR 1200–1600 ms not 600), target tracking the click (orbit intertia kill), terrain-height-aware raycast (y follow field, not y=0), fault-chainage aim (never pipe midpoint), target-Y lock to clicked terrain height.
- Double boxes: one facility layer, `mass()` honors params; radio boxes wrapping as geometry to base ground.
- Crash: define `BASE_DOT_SIZE`/`CRITICAL_GAIN`, TDD feed-shape test before code.
- Sound: mute button (`M`) + `M` toggle in HUD; AudioContext lazy on first pointerdown, not mousemove.
- Verify: click 3 assets → focus error <5px at NEAR; health flip nominal→critical no throw; build PASS.
- REF GATE 0 (your first steer): confirm focus feel + palette on 2 (TOP + NEAR) captures.

### Phase 1 — Real terrain: DEM, contours, volume, attention light
**Goal:** at-a-glance: landscape → infrastructure → health → what needs me.
- `terrainSource: 'dem'`: fetch 1° SRTM GL1 GeoTIFF (OpenTopography S3 mirror, geotiff.js in browser, no key) for the actual corner of the Permian you pin down; altitude → FK: mesh + contour engine; preserve 32-level power-spaced strips.
- Volume floor the epic way: height fog + ground-bleed = subtle vertical atmosphere at NEAR, NOT MRT; periphery fade keeps the 20 km read.
- Attention lock: terrain whispers at TOP (threshold drop), faults always brightest (bloom threshold won't catch white contours), flow color token distinct from watch amber `#ff8c39`, single sun direction.
- Verify: TOP fault found in 2s; NEAR frames a pad from 550 m; contour heights match DEM altitude ±2%.
- REF GATE 1: you pick the terrain mood (photo/map screenshot); also pin `?sector=<h3>` shape and real coord ranges.

### Phase 2 — Assets as real, inspectable models (to the rivet)
**Goal:** every asset/facility a defined model you can inspect to the last bolt.
- Import real OSM features per pinned region (Overpass GeoJSON): `man_made=pipeline` trunks, compressor stations, tank farms, valve yards — real corridor geometry feeds the twin, provenance-labeled.
- Physical kit: Poly Haven `modular_industrial_pipes_01` CC0 GLB, DRACO/KTX2, meshes→ our parametric mount (recolor via atlas, skin health accents as lamp/emissive overlays, consistent material tokens).
- Bolt-level detail: bolt rings, flange bolts, gauge dials, handwheel skeletons as instanced geometry per asset optional LOD; continental details at NEAR only or wow detail fades in L2 inspect mode (drill-in tween reveals parts).
- Verify: NEAR zoom holds bolts without shimmer; per-asset part count logged; provenance per asset visible in HUD.
- REF GATE 2: you approve detail level (toy / noisy / just right).

### Phase 3 — The real map: hotspots on vector basemap → twin handoff
**Goal:** find the exact location on a real map; hotspots open the twin.
- MapLibre GL JS map, Dark Matter vector style (free CARTO key — no friction), deck.gl overlay for hotspots sized by worst sector health.
- H3 hexes (`h3-js`) = sectorId — same hex keys on map and twin; click → `/twin.html?sector=<id>`; ESC/back returns to `map.html#<id>`; selection always survives the trip.
- Optional satellite toggle under same logic (Esri World Imagery raster, attribution kept).
- Verify: map↔twin round-trip keeps selection; hotspots match feed worst-health; satellites tiles still ≤ API budget; build PASS.
- REF GATE 3: you pick map look (Dark Matter vs satellite vs hybrid) + hotspot language (dot vs hex fill).

### Phase 4 — Time variance + simulation (the twin breathes)
**Goal:** infrastructure that changes with time; per-sector threat sim you can trust.
- `feedAt(t)`: real-fixtures history (last 30 d), live tick, and sim forward (72 h) behind one slider; dive replay of faults over time.
- Open-Meteo: pull archive + forecast for pinned coords (rainfall, wind, temp) — weather overlays are first-class on map and twin: rain tint, wind vectors on map extra subtle, temp ember sky shift; corrosion/rain risk correlated, notего cosmetic.
- USGS seismic: fetch last N events for region → markers on map + small tremor read on twin HUD; operational risk filter (magnitude > X nearby) gates a "check assets" pulse.
- DISP-S1 ground motion: seeded kelvin plume/region of subsidence in twin; real InSAR series drops in later when you want it serious.
- Per-sector sim: leak / corrosion / ground-shift / storm presets — spread + consequence over the same feed, seed reproducible, watermarked SIM.
- Verify: scrub → infra + weather + tracks + WOs + sim move together; sim honest ("what's modeled" in HUD); build PASS.
- REF GATE 4: you approve time-slider feel + sim honesty.

### Phase 5 — Operations layer: work orders, field activity, gated actions
**Goal:** safety/compliance/maintenance platform you can run, not just watch.
- Work orders + CDL/spatial history on map + twin (markers, trails, status); field crews + activity live positions + heading + age since last ping (triangulated feed from drones/cams/sensors upstream).
- Approval-gated actions: valve open/close, pump stop, isolate segment — request → approve → execute → audit log; permission stub; HUD confirms + suppresses scene-color use.
- Compliance flags HUD badges, never scene color; Create WO flows from asset panel; WO list survives map↔twin trip.
- Sonic+tactile: click confirms, approval chime, fault pulse; `M` mutes; haptics where available.
- Verify: valve action requires approval, lands in audit log; WO markers match fixtures; sound pre/post gesture reliable.
- REF GATE 5: you approve the gate flow (too many taps / too loose).

### Phase 6 — Lock + docs + perf
**Goal:** ships clean, stays clean.
- Pixel cap, instance budgets logged, `?post=0`, reduced-motion path, Safari WebGL1-safe GLSL.
- Docs: tokens, knobs, sim honesty, provenance map, DEM swap guide, map key setup; captures TOP/ISO/NEAR + map.
- `plan:track` clean; close each phase with ✓ + sha; phaes never restart silently.
- REF GATE 6 (final): full walkthrough sign-off.

## Standing rules (carried over)
- Dev `:5175` only; path-limited commits; `npm run build` green before every commit; `plan:track` clean; no push without your `y`.
- SwiftShader captures + on/off diffs per phase; every phase ends with your REF GATE before next build starts.
- Token-only HUD/CSS (`--ops-*`, no raw hex/px); WebGL1-safe GLSL so Safari holds.
