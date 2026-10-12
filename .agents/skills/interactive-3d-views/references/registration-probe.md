# Base↔twin registration probe (screen-px measurement)

Answers "is the satellite/base layer registered with the twin canvas?" with numbers instead of captures.
Recipe proven on the safepipe ops3d app (MapLibre base behind a three.js twin); adapt URL and module paths elsewhere. Keep validated probes in this skill's `scripts/` — scratch (`~/.hermes/cache`) is pruned after ~24 h idle, so probes parked there vanish.

## Method

1. Launch the project's own headless browser (Playwright is a devDependency there) at a fixed viewport; goto the live dev-server page (safepipe: `http://127.0.0.1:5175/ops3d.html`) — read-only against whichever server is live; never bounce the user's own.
2. Wait for the app's exposed hooks (`window.__twin.debug.{camera,target}`, `window.__satbase`, `window.maplibregl`).
3. In-page, create a PRIVATE MapLibre map (background-only style) in an offscreen container sized to the app canvas. Set `maxPitch: 70` — the default 60 silently clamps pitched candidates, and the tell is two different pitch inputs returning identical rms.
4. Dynamically import the app's own pure projection module (`await import('/src/ops3d/sat-base.js')`). For pure math the HMR-forked copy is fine; live mutable state must come from window handles instead (Vite dev serves `?t=` forks).
5. Drive the twin camera deterministically via its `setView(pos, target)` hook (world km), then SNAPSHOT the camera for each measurement case — a push-in dolly keeps moving after TOP-enter setViews, and per-case snapshots make every delta self-consistent.
6. Per candidate (bearing × zoom × pitch): jump the private map, then for each world point P compute twin px (`projectPinhole(cam, tgt, fov, W, H, P)`) and map px (`map.project(twinTargetToLatLon(P))`); delta = map − twin; report rms + max.
7. Grid: central ring (r ≈ 6–8 km normal, ≈ 3 km for close poses). Big ±18 km grids weight off-frame edge points whose perspective warp dominates at oblique pitch and flip the apparent winner.
8. Sweep FAMILIES, not single values: bearing {b0, (360−b0)%360, (b0+180)%360, (180−b0)%360}; zoom {z0 − 1 + w·log2(slant)} for w ∈ {−0.25, 0, 0.5, 0.75, 1}; pitch {p0, p0 ± 1.5}. The winner + its margin is the verdict.

## Verified constants and results (safepipe ops3d, 1280×800)

- Convention: MapLibre z12 @57.03N renders 10.398 m/px = `78271.51696·cos(lat)/2^z`; bearing 90 puts the east point straight up (heading-up convention).
- Winning law: bearing = 360−b0 (N–S mirror); zoom = z0 − 1 + log2(slant) — algebraically `log2(78271.51696·cos(lat) / (span_m/heightPx))`, i.e. the 512-convention constant with NO slant in the zoom; pitch = 90−elev (unchanged, correct).
- Registration after fix: elev90 0.32 px rms / 0.6 max · elev78 (plan/scope) 0.32 / 0.6 · elev60 1.18 / 1.8 · elev50 1.41 / 2.3 · elev25 1.38 / 2.4. With either error in place: 35–78 px at TOP poses, 78–244 oblique.
- Unit-test expectations move with the formula: an east-camera bearing asserts 270 (was 90); default-pose zooms top ≈ 9.73 / segment ≈ 12.52 (were 10.73 / 13.52); any 'oblique views widen the map' assertion dies — zoom is dist/fov-only once slant leaves the zoom path.
- Esri tile level at the corrected scope view: zoom ≈ 9.52 at H=800 → requests z10–z11 (+1 level per window-height doubling). For raster sources with `tileSize: 256` the requested tile z ≈ map zoom + 1.

## Orbit sweep — certify interaction, not just poses

Static poses can all pass while the orbit counter-rotates. Sweep azimuths (0, ±10, ±45, 90, 135, 180°) at one pitch/dist, apply the repo output verbatim, and score the central ring per row while recording map bearing vs expected `−camYaw mod 360`. Verified post-fix (Sangachal, pitch 60 / dist 34): every row dBear 0.00°, rms 0.96–1.27 px (max ≤ 1.9); plan pose 0.17 px. Failure reads: a constant dBear offset = bearing sign regression; dBear growing with |yaw| = axis-convention bug; one-sided rms rise = zoom floor/clamp biting. Runner: `scripts/orbit-sweep-probe.cjs`.

## After the fix lands, the sweep grid goes stale

The candidate sweep above is relative to the repo function's CURRENT output (`v0.zoom − 1 + …`, `360 − v0.bearing`). Once the corrected law lands in the sync function itself, re-running the same sweep double-applies the correction — every row degrades to 60+ px rms and a good fix reads as a regression. When that happens, stop sweeping and score the repo output verbatim: one candidate per pose with bearing/zoom/pitch straight from the function, no offsets. Expect ≤ ~2.5 px rms on the central ring at every elevation; if the verbatim row beats the old-law reconstruction by 30× or more, the fix holds. Pair the verbatim row with an OLD-law control in the same run (bearing `(360−b)%360`, zoom `z+1+log2(slant)`): post-fix, verbatim reads ≤ ~2.5 px while the control sits at 123–758 px — a probe that reads small for both laws is mis-wired and can neither clear nor convict. Rebuild the sweep only when testing a NEW candidate law, anchored on the new baseline.

## Tile-z measurement pitfall

To read which tile z a map requests: give the probe map's raster URL a unique query param (`?probe=1`), flip the layer visible only for the final measurement, wait ~2 s, then filter `performance.getEntriesByType('resource')` by the param. Cached tiles produce NO new entries (`clearResourceTimings` clears timings, not the tile cache) — absence of entries never proves a z wasn't requested. Boundary rounding (floor vs round of zoom+1) flips z by 1 either side of .5 — report the band, not a single boundary value.

## Blind spots to avoid

- A scope/lens disc that masks the base into the canvas is twin-side geometry only — its rim matching the bezel proves nothing about the imagery's scale/rotation; only the projection-delta table can clear or convict the base.
- 'Both views are north-up' is not a registration check: the bearing mirror error vanishes at yaw 0/180, so a single north-up pose cannot detect it. Test at a non-axis yaw.
- Site pinning: the probe measures its own `const site =` — the page's `?site=` param only moves the rendered app; edit the const to certify another site. The law is site-general (identical rms verified at 57.0N and 40.2N — `cos(lat)` carries latitude), but re-run per active site before certifying it.
- Certify the live path, not just the pure function: `grep -n 'twinViewToMap(' src/ops3d/*.js` — the probe clears the export only if the app's follow loop consumes that exact export (one call site feeds the live map).
