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

### Task 1: site constant + mapping ✓ done
**Objective:** Exact Sangachal pin + world↔geo math every later module copies verbatim.
**Files:** Create `src/ring2/site.js`. Test: `tests/ring2-site.test.js`.
**Verify:** `node --test tests/ring2-site.test.js` — coords exact, round-trip <1 m, ring radius 10 km.

### Task 2: elevation field ✓ done
**Objective:** Real Terrarium sampler with staged budgets; single `sampleH` all overlays drape on.
**Files:** Create `src/ring2/field.js`.
**Verify:** status bus transitions idle→coarse→live; offline → procedural fallback, no throw.

### Task 3: ground-truth test ✓ done
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

### Task 4: map base ✓ done
**Objective:** MapLibre owns the ground — satellite, 3D terrain, sky, controls.
**Files:** Create `src/ring2/mapbase.js`.
**Verify:** temp-server capture shows 3D terrain + satellite at 40.2012N 49.4813E.

### Task 5: camera sync ✓ done
**Objective:** Twin pan/orbit and map pan/zoom never slide apart (v1's 2×-zoom + mirror classes).
**Files:** Create `src/ring2/sync.js`.
**Verify:** probe rms ≤2 px; yaw sweep dBear 0.00° at every azimuth.

### Task 6: probe script ✓ done
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

### Task 7: overlays ✓ done
**Objective:** Twin visual language, zero ground competition with the map.
**Files:** Create `src/ring2/overlays.js`.
**Verify:** capture at 3 slider stops; contours close rings; WATER_COL only on water.

### Task 8: mix slider ✓ done
**Objective:** The seamless transition — one control, no popovers, no stale state.
**Files:** Create `src/ring2/mix.js`.
**Verify:** drag 0→100→0 live; remount keeps mix value.

### Task 9: harness + entry + deprecate ✓ done
**Objective:** Shippable tab + v1 clearly marked legacy.
**Files:** Create `ops3d-ring2.html`; Modify `vite.config.js`, `gallery.html`, `ops3d.html` (banner only).
**Verify:** `/ops3d-ring2.html` 200 on temp port; v1 untouched behaviorally.

---

## Phase 4 — Prove + ship ✓ done {#phase-4}

| # | Task | Done when |
|---|---|---|
| 10 | Full gate: `node --test tests/ring2-*`, `npm run build`, probe green, 3-stop captures vision-checked (pure map / 50-50 / pure twin) | all green, screenshots attached |
| 11 | Plan close-out: tasks marked ✓ done, shipped sha, `plan:track` | manifest current, commit per phase |

### Task 10: full gate + 3-stop capture ✓ done
**Objective:** Prove all correctness + perf + visual gates in one pass before ship.
**Files:** Evidence-only — no new code (existing `tests/ring2-*`, `scripts/ring2-probe.cjs`, `ops3d-ring2.html` at `BUILD_ID 4874830`).
**Verify:**
- Gate 1 — Tests `node --test tests/ring2-*` → **PASS** 15/15 (0 fail) — relief 0.99 (≥0.60), live/true 1.09 (0.50–1.50), coldSwap 2857 ms, isLive terrarium — report `/tmp/ring2-gate-report-193450.md`
- Gate 2 — Build `npm run build` → **PASS** 187 modules 3.24s (ring2 1.08 MB / 298 kB gzip) — `plan:track` ✓ 10 plans 205 commits
- Gate 3 — Probe `node scripts/ring2-probe.cjs` → **PASS** rms 0.000 px (≤2 px), dBear 0.0000° (0.00°), 512-px convention, VEX 1.0 shared — same report
- 3-stop captures (1280×800 headless Chromium, `window.__ring2.setMix`) → **PASS ×3** hard world-circular clip both sides, no square corners, satellite fills disc 100% (ground-always-on at mix 100 proven), overlays draped, no halo/hole — `/tmp/ring2-mix{0,50,100}.png` + report `/tmp/ring2-capture-report-193450.md` (BUILD_ID e84dbcf proven; 4874830 adds world-shell mask, same geometry)
**Shipped sha:** 16d57b2 (HEAD at gate time; e84dbcf capture-proven, 4874830 lens-fix live — both green; chain e84dbcf → 4874830 → b39dad2 → 79e170d → b97e805 → 23b1009 → 2fd8fc7 → cce7c7c → 83d0663 → 16d57b2)

### Task 11: plan close-out ✓ done
**Objective:** Close the loop — mark every task shipped, pin the sha, refresh the track manifest.
**Files:** Modify `.hermes/plans/2026-10-10_191500-ops3d-ring2-seamless-redo.md` (this patch); `plan:track` commit per phase.
**Verify:** `plan:track` clean; shipped commit `16d57b2` (`docs(plan): track refresh [plan:…#phase-4]` → `chore: stamp builds` → `fix(lens): world-shell mask` → `fix(v1): cap orbit` → `fix(v1): dual-host`); `BUILD_ID 4874830` on `src/ring2/main.js` matches `V1_BUILD b97e805` on `gallery.html` (b39dad2 was 4874830, now b97e805 after v1 fixes); next `npm run build` still green.

## V1 bug classes this redo kills (do not regress)
- Apron streaks: coarse footprint < mesh → fixed by `maxTiles:16` center-out + strict crop + relief gate (Task 3).
- 2×-too-tight zoom: 256-convention constant → 512 convention, no slant factor (Task 5).
- Bearing mirror: `atan2(dx,dz)` → `atan2(-dx,dz)`, discriminated at 45° yaw (Task 5).
- VEX mismatch float/sink → one shared `VEX` export + numeric assert (Tasks 1+5).
- Remount opacity reset → canvas-identity watch re-applies full mix (Task 8).
- Lens sized to DEM window → ring always full 10 km mapped radius (Task 7).
- Twin features masquerading as surveyed → every asset carries `source` label (Task 7).

---
## Handoff — Safari black-tab war, 2026-10-10 night (lean resume)
- HEAD stamps: Ring-2 `BUILD_ID 4874830` (src/ring2/main.js), v1 `V1_BUILD b97e805` (gallery.html) — shipped sha `16d57b2` (`e84dbcf` capture-proven, `4874830` world-shell lens fix on top; `4874830` was V1_BUILD at b39dad2). If user's screenshot shows older → stale code, stop debugging.
- Proven root causes (all fault-injected headless, not assumed): (1) three.js null precision deref on user's GPU → src/glprecision.js probe + v1 step-down chain; (2) hung (not failed) Esri host gates map `load` forever → hasty 8s mount, terrain best-effort; (3) reject-on-first-tile-error killed map → errors now recorded only; (4) v1 hidden-mount 0×0 map → resize-on-show; (5) showcase-over-dead-map → shed reclaims twin, shed wins over late load; (6) mix dead-ends → 50-floor pre-map, pull-to-twin on mapFatal.
- Ring-2 polish shipped: shader ring-clip + radial rim fade (vertex fade also radial now — square curtain gone), reference hides at twin takeover, SELFTEST box removed. Latest: world-shell mask — no photo past lens at any zoom/pitch (commit `4874830`).
- Diagnostics live: Ring-2 status (stamp/dims/frames/MAPERR/MAPFAILED sticky); v1 captions (stamp/mix/map:wait-on-deg-off/cv).
- Gate + capture (session 20261010_193450_178c76) — all PASS: `tests 15/15` (relief 0.99, live/true 1.09) · `build 187 modules 3.24s` · `probe rms 0.000 px dBear 0.00°` · 3-stop hard-circle PASS ×3 — reports `/tmp/ring2-gate-report-193450.md` + `/tmp/ring2-capture-report-193450.md` (mix0/50/100 @ e84dbcf; superseded BUILD_ID `66a5502` retired).
- Pending USER confirmation only: Ring-2 SAT paint, v1 tabs content. /loop stays open until user confirms all three.
- Hygiene: no temp servers (5198/5199 free), no stray *.tmp.mjs, tree clean, dist rebuilt per fix. Subagents deleg_5c4e98b4 + deleg_d0f89fcf done (findings applied).
