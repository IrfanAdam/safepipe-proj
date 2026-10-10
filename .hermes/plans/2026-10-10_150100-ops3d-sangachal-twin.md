# Ops3D — Sangachal Terminal twin (10 km radius, real terrain + satellite)

**Goal:** A second gallery twin pinned on Sangachal Terminal, Azerbaijan (40.20N 49.48E, 10 km radius) with real Terrarium 3D terrain + Esri satellite underneath the existing twin visual language — same SAT/TWIN/SCOPE bar, same overlays, assets untouched.

**Architecture:** Reuse the `?site=` seam: twin (DEM tiles) + sat-base (MapLibre center/follow) both derive from one site object. New `SANGACHAL` pin carries `extentKm: 20`; `resolveSite` preserves extent; scope-disc radius + initial zoom scale with extent. Gallery mounts a second lazy specimen tab.

**Tech Stack:** MapLibre GL JS (raster-dem Terrarium, `setTerrain`), Esri World Imagery + Reference, AWS Terrarium PNG (DEM sampler), three.js overlays only.

**Tags:** Function

---

## Phase 1 — Sangachal site + gallery tab {#phase-1}

*Second Ops 3D tab: Sangachal 20 km window, real ground, same twin language.*

| # | Task | Done when |
|---|---|---|
| 1 | Site plumbing: `SANGACHAL` pin + extent-preserving `resolveSite`/`parseSiteParam` | `?site=40.20,49.48,20` resolves `{lat:40.20, lon:49.48, extentKm:20}`; default still Fort McMurray 44 km |
| 2 | sat-base per-site scope + zoom (`scopeRadiusForSite`, extent-scaled initial zoom) | Sangachal disc ≈ 9 km, FM disc stays 20 km; map opens one zoom closer on the 20 km window |
| 3 | Gallery: `ops3d-sangachal` tab + lazy second twin (`site: SANGACHAL`, namespaced storage) | New nav item shows a fresh twin; first tab byte-identical behavior |
| 4 | Tests: extent + Sangachal pins (dem + sat-base suites) | `node --test` green on both suites, old 3-part-reject assertion updated |
| 5 | Build + visual verify (both panels screenshotted) | `npm run build` green, captures show satellite ground + twin overlays |

### Task 1 ✓ done: site plumbing

**Objective:** `dem.js` gains `SANGACHAL = {name, lat: 40.20, lon: 49.48, extentKm: 20}`; `parseSiteParam` accepts optional `,extentKm` (5–100); `resolveSite` preserves object/param extent instead of forcing 44.

**Files:** `src/ops3d/dem.js`

**Verify:** `resolveSite('40.20,49.48,20')` → 20 km; `srtmTileNames(40.20, 49.48, 20)` → `['N40E049']` single tile.

### Task 2 ✓ done: sat-base per-site scope + zoom

**Objective:** `scopeRadiusForSite(site)` scales the TOP scope disc (`20 × extent/44`); `initSatBase` initial zoom gains `+log2(44/extent)` so the 20 km window opens at the same framing.

**Files:** `src/ops3d/sat-base.js`

**Verify:** unit asserts (20 km → ≈9.1 km disc, zoom 14); FM values unchanged.

### Task 3 ✓ done: gallery second tab

**Objective:** `#ops3d-specimen` CSS generalizes to `.ops3d-specimen`; new `Ops 3D — Sangachal` nav item + frame; lazy mount on first show with `site: SANGACHAL`, `search: ''`, namespaced mix/scope storage; per-specimen RAF sync.

**Files:** `gallery.html`

**Verify:** `#ops3d` panel unchanged; `#ops3d-sangachal` mounts twin + satellite on first open.

### Task 4 ✓ done: tests

**Objective:** Update `parseSiteParam` 3-part assertion; add extent-preservation, SANGACHAL tile, scope-radius asserts.

**Files:** `tests/ops3d-dem.test.js`, `tests/ops3d-sat-base.test.js`

**Verify:** `node --test tests/ops3d-dem.test.js tests/ops3d-sat-base.test.js` green.

### Task 5 ✓ done: build + visual verify

**Objective:** Full build green; serve on a non-dev port; screenshot both gallery panels; confirm satellite ground + overlays, no console errors.

**Files:** `dist/` (generated)

**Verify:** `npm run build` ✓; two captures vision-checked.

---

## Phase 2 — edge-streak fix (apron renders fake terrain) {#phase-2}

*Root cause: coarse Terrarium covered only the site window (Sangachal ±10 km, ragged on slow links), SRTM underlay timed out, edge queries clamp-smeared — procedural swells rendered as surveyed terrain (NE streaks). Previous terrain was right at center; only the ring edges were wrong.*

| # | Task | Done when |
|---|---|---|
| 1 | Coarse footprint covers the 44 km mesh (`TWIN_MESH_EXTENT_KM`, maxTiles 96), strict crop edges, site-scoped stage keys | Apron plateau test + key test green |
| 2 | Fan-out verify: Sangachal cold/warm + FM regression | 116–118/121 real, streaks gone, mid-fade + scope aligned, FM 121/121 same |
| 3 | Commit + close | Build green, 93/93 tests pass |

### Task 1 ✓ done · Task 2 ✓ done · Task 3 ✓ done

---

## Phase 3 — true-scale landmass parity {#phase-3}

*VEX 4.5→1 (twin + MapLibre exaggeration), sea-level fill: sub-0 m fill verts tint WATER_COL so the Caspian coastline reads; bathymetry kept.*

| # | Task | Done when |
|---|---|---|
| 1 | VEX + TERRAIN_EXAGGERATION = 1, parity test | RED→GREEN, 330/330 suite green |
| 2 | Sea fill + capture | Coastline legible, contours clean, no streaks |
| 3 | Commit + close | Build green |

### Task 1 ✓ done · Task 2 ✓ done · Task 3 ✓ done
