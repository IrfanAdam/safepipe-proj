# Ops 3D v2 — Real-World Safety / Compliance / Maintenance Twin

> Status: 🟡 DRAFT — awaiting your steer on refs before Phase 1 build starts.
> Replaces: `2026-10-06_003000-ops3d-theatre-style.md` (all 10 tasks shipped, 40 commits) + spinout `2026-10-06_153000-ops3d-terrain-topo.md`.
> Server: `npm run dev` on `:5175`. Never touch `:5173`/`:5174`.

## TLDR
Rebuild the twin around a real place with real assets: fix the old build's bugs first (focus-miss, double boxes, health-crash, sound-no-mute), then land legible terrain with volume, a locked color/light system where faults always win, true asset models down to bolts, a map↔3D toggle with hotspots, time variance (weather + ground movement + history slider), per-sector threat sim, and approval-gated field actions (valve on/off). You steer each phase with a reference — visual style or logic — before we build it.

## Why the old plan fell short (audit, 2026-10-07)
- Terrain synthetic (procedural dip/swell/hills), not DEM-like → never reads as a real basin. Keep the contour engine, add a `terrainSource: procedural|dem` seam.
- No real-world model: layout was seeded RNG; feed shape is ready but no GIS import lane exists.
- Boxes: `network.js` facility boxes + `structures.js` outline facilities draw twice at the same spot; `structures.mass()` ignores its own params and drops a flat disc.
- Zoom/refocus off: focus falls back to pipe midpoint (`levels.js`), click-ray uses y=0 so aim sinks under hills, damping fights the 600ms fly-to, TOP→NEAR is too fast to follow.
- No at-a-glance read: bloom catches white index lines too; flow amber (~`#d8a93c`) is confusable with watch amber (`#ff8c39`); terrain outshines faults at TOP.
- Crash on health change: `BASE_DOT_SIZE` / `CRITICAL_GAIN` undefined in `network.js` → `update(feed)` throws.
- Sound exists but has no mute UI and creates AudioContext pre-gesture (autoplay warning).
- Explicitly cut in v1 and now owed: volume/atmosphere, sonic+tactile, map toggle, time series, simulation, spatial work orders, gated actions.

## Research stance (pragmatic, Vite + vanilla three.js)
- Map toggle: Leaflet + OpenStreetMap tiles (no API key) for 2D; hotspot markers → `?sector=` deep-link into the twin. Google tiles only if you bring a key later — the handoff stays identical.
- Asset models: no single open CC0 oil-and-gas kit covers valve yard + compressor + tanks + masts at bolt detail. Plan builds a parametric kit from your reference photos (one rich site you pick), instanced bolts/flanges/valves so zoom holds to rivet level. If you supply a photogrammetry/CAD export later, it slots into the same `assetId` mounts.
- Time series: history slider + live tick driving one `feedAt(t)` function; weather as overlay + light shift (not a new scene); ground movement as track displacement + crack highlight from a seeded series you can later swap for USGS-style feed.
- Simulation: per-sector runner over the same feed — scenario presets (leak, corrosion growth, ground shift, storm) with spread + consequence, cheap math, honest HUD labeling "SIM".
- Approvals: valve on/off as request → approve → execute with audit trail in the op log; never direct mutate.

## Reference checkpoints (your steering — built into every phase)
Each phase ends with: build green + captures + a **REF GATE** where you drop 1–3 refs (screenshot, photo, sketch, or "like X app"). No next phase starts until you say `go` or `fix: ...`. This is the anti-drift lock the old plan lacked.
- Visual refs steer: terrain mood, color/light harmony, asset detail level, map style, HUD density.
- Logic refs steer: time-slider behavior, sim honesty, approval flow, sound feel.

---

### Phase 0 — Foundations + bug kill (the unglamorous fix)
**Goal:** zoom lands on the object, boxes gone, health changes don't crash, sound has a mute.
- Fix focus: terrain-height-aware raycast, fault-chainage aim (no midpoint fallback), target-Y lock, longer eased fly-to, damping off mid-flight.
- Fix double boxes: single facility layer; `mass()` honors params.
- Fix crash: define gains, add feed-shape test before code (TDD).
- Sound: mute button (`M`), gesture-safe AudioContext, hover blips throttled, reduced-motion silences.
- Palette freeze: one bone / one amber / one red, flow color moved off amber; bloom threshold so only faults bloom at TOP.
- Verify: click 3 assets → focus error < 5px at NEAR; health flip nominal→critical no throw; `npm run build` PASS.
- REF GATE 0: confirm focus feel + palette on 2 captures (TOP + NEAR).

### Phase 1 — Terrain you believe + volume + attention light
**Goal:** at a glance: landscape → infrastructure → health → what needs me.
- `terrainSource` seam (procedural now, DEM later); real-basin floor: drainage, pads, corridors, subtle relief — no fantasy peaks.
- Volume on the cheap: height-fog + glow sprites, no MRT; periphery fade keeps the 20km read.
- Attention hierarchy lock: terrain whispers at TOP, faults brightest always; dim-topo-on-drill-in; single sun direction.
- Verify: TOP fault found in 2s test; NEAR pad frames correctly; light dir + palette in tokens.
- REF GATE 1: you pick the terrain mood (photo or map screenshot).

### Phase 2 — Assets as real models (down to the bolt)
**Goal:** each asset/facility a well-defined model you can inspect to the last rivet.
- Parametric kit: valve yard, compressor station, tank farm, sensor mast, pig launcher — flanges/bolts/handwheels as instanced geometry with LOD (bolt level only at NEAR).
- One exhaustive reference site: you nominate it (photos/P&ID), we model around it; liberty where data is missing, labeled as such.
- True-scale mounts, buried runs, no mid-run trestles; selection halo + chainage beads survive zoom.
- Verify: NEAR zoom holds rivets without shimmer; per-asset part count logged; build PASS.
- REF GATE 2: you approve detail level (too toy / too noisy / just right).

### Phase 3 — Map toggle + real-world grounding
**Goal:** locate it on a real map; hotspots open this twin.
- Leaflet/OSM 2D view + 3D twin toggle; shared `sectorId` URL; hotspot markers sized by worst health.
- Click hotspot → flies to twin sector at L1 with same selection; back-button returns to map.
- GIS import lane stub: GeoJSON drop-in for future real geometry (no view change).
- Verify: map↔twin round-trip keeps selection; hotspots match feed worst-health; no API key required.
- REF GATE 3: you pick map style (dark OSM vs satellite) + hotspot language.

### Phase 4 — Time variance + simulation
**Goal:** the twin breathes and threatens honestly.
- `feedAt(t)`: history slider (past states) + live tick; weather overlay (wind/rain/temp) shifting light + risk tint; ground-movement track with displacement + crack flags.
- Per-sector sim runner: leak / corrosion / ground-shift / storm presets, spread over time, consequence readout, watermarked SIM.
- Verify: scrub slider → infra + weather + tracks move together; sim run labeled, reproducible via seed.
- REF GATE 4: you approve time-slider feel + sim honesty (what's modeled vs faked).

### Phase 5 — Operations layer: work orders, field activity, gated actions
**Goal:** safety/compliance/maintenance you can run, not just see.
- Work orders + history spatialized on map and twin (markers + trails); field crew/activity live markers with age/source.
- Approval-gated actions: valve open/close, pump stop, isolate segment — request → approve → execute, full audit in op log, permissions stub.
- Compliance badges stay HUD-side; scene color stays health-only.
- Sonic+tactile: click confirms, approval chimes, fault pulse sound; `M` mutes all; haptics where available.
- Verify: valve action requires approval, lands in audit log; WO markers match fixtures; sound toggle works pre/post gesture.
- REF GATE 5: you approve the approval flow (too many taps / too loose).

### Phase 6 — Lock + docs + perf
**Goal:** ship clean and stay clean.
- Pixel-ratio cap, instance budgets logged, `?post=0` escape, reduced-motion path, Safari check (WebGL1-safe GLSL).
- Docs: tokens, knobs, sim honesty statement, GIS swap guide; captures TOP/ISO/NEAR + map.
- Tracker: every commit `[plan:2026-10-07_153000-ops3d-realworld-twin.md#phase-N]`; close phases with ✓ + sha.
- REF GATE 6 (final): full walkthrough sign-off.

## Standing rules (carried over)
Dev `:5175` only; path-limited commits; `npm run build` green before every commit; `plan:track` clean; no push without your `y`; SwiftShader captures with on/off diffs; token-only HUD/CSS (`--ops-*`).

## Open questions for you (answer whenever — they route into REF GATEs)
1. Which real site do we model around? (photos/P&ID or "pick a representative Permian valve yard")
2. Dark map or satellite for the 2D view?
3. Valve actions: single-approver or dual-approver for critical lines?
