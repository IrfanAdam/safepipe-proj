# Ops3D Ring-2 — Sangachal seamless Map→twin redo (fresh, deprecates v1)

**Goal:** A new `RING-2` tab pinned on Sangachal Terminal (40.201262N 49.481270E, 10 km radius ring) where MapLibre 3D terrain crossfades seamlessly into the twin, with surveyed elevations, real contours, pan/orbit camera, and one mix slider.

**Architecture:** MapLibre owns ALL ground (Esri satellite + Terrarium raster-dem 3D terrain + hillshade, one shared VEX). The twin renders overlays ONLY (10 km ring, schematic plant, real-DEM contours, labels) draped on the same field function. One `mix` slider (0 = pure map, 1 = pure twin) drives twin-canvas opacity + overlay emphasis; camera sync is bidirectional (orbit target ↔ map center, ground-resolution zoom, azimuth bearing). Fresh `src/ring2/` modules; v1 (`src/ops3d/`, `ops3d.html`) untouched except a deprecation banner.

**Tech Stack:** MapLibre GL JS 6.7 (`raster-dem` Terrarium tiles, `setTerrain`), Esri World Imagery + Reference (keyless), three.js overlays only, Open-Meteo elevation for ground-truth checks.

**Tags:** Function

---

## Phase 1 — Site + field truth (fresh seam) {#phase-1}

*One site constant, one elevation field, proven against real ground truth — no v1 imports.*

| # | Task | Done when |
|---|---|---|
| 1 | `src/ring2/site.js`: `SANGACHAL {lat 40.201262, lon 49.481270, radiusKm 10, extentKm 20}`, `VEX = 1.0` shared export, world↔geo equirectangular mapping | import gives exact wiki coords; mapping round-trips <1 m |
| 2 | `src/ring2/field.js`: Terrarium PNG sampler (center-out, concurrency 6, `maxTiles:16` coarse) + SRTM fallback + procedural fallback; `sampleH(x,z)` single field fn; status bus on `globalThis.__ring2dem` | `getStatus()` per stage; cold swap ≤60 s, warm ≤5 s |
| 3 | Ground-truth gate `tests/ring2-field.test.js`: 5×5 Open-Meteo grid values pinned as constants; assert relief/std-dev ≥60% of real; regression bands | `node --test tests/ring2-*` green |

### Task 1: site constant + mapping
**Objective:** Exact Sangachal pin + world↔geo math every later module copies verbatim.
**Files:** Create `src/ring2/site.js`. Test: `tests/ring2-site.test.js`.
**Verify:** `node --test tests/ring2-site.test.js` — coords exact, round-trip <1 m, ring radius 10 km.

### Task 2: elevation field
**Objective:** Real Terrarium sampler with staged budgets; single `sampleH` all overlays drape on.
**Files:** Create `src/ring2/field.js`.
**Verify:** status bus transitions idle→coarse→live; offline → procedural fallback, no throw.

### Task 3: ground-truth test
**Objective:** Procedural fallback can never silently pose as surveyed (v1 apron-streak class).
**Files:** Create `tests/ring2-field.test.js` (Open-Meteo 5×5 grid pinned).
**Verify:** green; relief ratio reported in output.

---

## Phase 2 — MapLibre ground + camera parity {#phase-2}

*Real 3D terrain base with registration math proven numerically, not by eyeballing captures.*

| # | Task | Done when |
|---|---|---|
| 4 | `src/ring2/mapbase.js`: MapLibre mount (Esri imagery + Terrarium raster-dem + neutral hillshade + `setTerrain({exaggeration: VEX})` + Esri reference labels + nav/terrain controls) | 3D terrain renders at Sangachal, pitch to 85° |
| 5 | `src/ring2/sync.js`: center-follows-target, zoom from ground resolution (512-px convention `78271.51696·cos(lat)/2^z`, NO slant factor), bearing `atan2(-dx,dz)` for +x-east/+z-south, VEX assert | numeric probe: central-ring grid rms ≤2 px at TOP + 45° yaw poses |
| 6 | Registration probe `scripts/ring2-probe.cjs` (pose sweep + yaw sweep, dBear 0.00°) | probe passes; method per interactive-3d-views registration-probe ref |

### Task 4: map base
**Objective:** MapLibre owns the ground — satellite, 3D terrain, sky, controls.
**Files:** Create `src/ring2/mapbase.js`.
**Verify:** temp-server capture shows 3D terrain + satellite at 40.2012N 49.4813E.

### Task 5: camera sync
**Objective:** Twin pan/orbit and map pan/zoom never slide apart (v1's 2×-zoom + mirror classes).
**Files:** Create `src/ring2/sync.js`.
**Verify:** probe rms ≤2 px; yaw sweep dBear 0.00° at every azimuth.

### Task 6: probe script
**Objective:** Repeatable numeric proof, runnable by any later lane.
**Files:** Create `scripts/ring2-probe.cjs`.
**Verify:** `node scripts/ring2-probe.cjs` exits 0 with rms table.

---

## Phase 3 — Twin overlays + seamless slider {#phase-3}

*Twin draws nothing but overlays; one slider owns the crossfade; remounts re-apply mix.*

| # | Task | Done when |
|---|---|---|
| 7 | `src/ring2/overlays.js`: 10 km ring (full mapped ring, NOT DEM-window sized), schematic terminal blocks (labelled `source:schematic`), contours from `sampleH` (2-tier + numbered index rings), every overlay ground-sat via `sampleH` | overlays sit on terrain at drill-in, no floaters/burials |
| 8 | `src/ring2/mix.js`: single slider 0–100 (map↔twin), drives twin-canvas opacity + overlay emphasis; TOP-only satellite rule (satellite full at TOP, twin takes over oblique); canvas-identity watch re-applies mix on remount | slider 0 = pure map photo, 100 = pure twin, mid = registered blend |
| 9 | `ops3d-ring2.html` harness + `vite.config.js` entry + gallery `RING-2` tab (lazy mount) + v1 deprecation banner on `ops3d.html` | new tab live; old tab shows "deprecated — use RING-2" note |

### Task 7: overlays
**Objective:** Twin visual language, zero ground competition with the map.
**Files:** Create `src/ring2/overlays.js`.
**Verify:** capture at 3 slider stops; contours close rings; WATER_COL only on water.

### Task 8: mix slider
**Objective:** The seamless transition — one control, no popovers, no stale state.
**Files:** Create `src/ring2/mix.js`.
**Verify:** drag 0→100→0 live; remount keeps mix value.

### Task 9: harness + entry + deprecate
**Objective:** Shippable tab + v1 clearly marked legacy.
**Files:** Create `ops3d-ring2.html`; Modify `vite.config.js`, `gallery.html`, `ops3d.html` (banner only).
**Verify:** `/ops3d-ring2.html` 200 on temp port; v1 untouched behaviorally.

---

## Phase 4 — Prove + ship {#phase-4}

| # | Task | Done when |
|---|---|---|
| 10 | Full gate: `node --test tests/ring2-*`, `npm run build`, probe green, 3-stop captures vision-checked (pure map / 50-50 / pure twin) | all green, screenshots attached |
| 11 | Plan close-out: tasks marked ✓ done, shipped sha, `plan:track` | manifest current, commit per phase |

## V1 bug classes this redo kills (do not regress)
- Apron streaks: coarse footprint < mesh → fixed by `maxTiles:16` center-out + strict crop + relief gate (Task 3).
- 2×-too-tight zoom: 256-convention constant → 512 convention, no slant factor (Task 5).
- Bearing mirror: `atan2(dx,dz)` → `atan2(-dx,dz)`, discriminated at 45° yaw (Task 5).
- VEX mismatch float/sink → one shared `VEX` export + numeric assert (Tasks 1+5).
- Remount opacity reset → canvas-identity watch re-applies full mix (Task 8).
- Lens sized to DEM window → ring always full 10 km mapped radius (Task 7).
- Twin features masquerading as surveyed → every asset carries `source` label (Task 7).
