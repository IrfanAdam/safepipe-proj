# Ops 3D style — terrain topo (nested plan 2026-10-06_153000)

Provenance: `.hermes/plans/2026-10-06_153000-ops3d-terrain-topo.md` (Tasks 1–8, closed 2026-10-06).

## Field (procedural Permian floor, `terrain.js:field`)
- Relief ≈ −42…+88 m true, VEX 3.2 (single source: `export const VEX`, imported by `network.js`/`gridfloor.js` — never duplicated).
- Dip 1.8 m/km E + swells + 2 auto-nudged hills (clear of pipe corridors) + hollow + winding dry draw + organic playa-lake depression. No rim mountains, no body fill — contours glow on the void (neon-plate).

## Contour engine (`terrain.js`)
- Marching-squares N 160 grid, LEVELS 32, symmetric power spacing 1.35 (dense mid-ground, open extremes — density plots the terrain).
- SLOPE_MIN 2.8 m/km skip: flats go truly clean, no stray segments.
- Batched: all base levels → 1 draw call, all index → 1 (chained + smoothed paths, pixel-identical).
- Materials: BASE `#dde3e6` 1.15px 0.52 / INDEX `#ffffff` 2.35px 0.98 / BELOW `#8fa0a8`, additive, periphery fade; static opacities (no per-frame pulse) with `dimF` drill-in dimming only.
- Below-datum rings muted blue-grey; above-datum bone→white. Warm hues (amber/red) reserved for health data only.

## Elevation language
- Index pills: small inline meter readouts on rings (≤3 per level, cap 18, skip outside R19) + 2 summit tags. Legible at ISO/segment; texture at full TOP distance (accepted tradeoff).
- Drainage: thread + shoreline `#6fa8dc` 1.05px 0.40–0.42, V-kink enforcement where contours cross the draw.

## Graticule (both subordinate to index white)
- Checker: static radial gradient wash, peak 0.075, drill-in dimming (segment 0.060 / asset 0.045). No pattern, no pulse.
- Red survey grid: fine/index tiers in `gridfloor.js`, draped on `field×VEX`.

## Camera / fog / post
- Caged camera, TOP fly-out default; `?view=ISO|NEAR`, `?asset=X`, `?overlay=weather|tectonic|forecast` deep links.
- Post: threshold 0.36 / bloom 0.62 (neon-plate) / CA 1.0 / grain 0.006 / scan 0.05 / vignette 0.28. All gain uniforms static — only grain uses time.

## Verification (Task 8, 2026-10-06, SwiftShader 1280×720)
- `after-TOP.png`: 2 closed bullseyes (8–10 + 6–8 rings) ✓; pills sub-legible at full distance (known tradeoff) △; Vs unresolved at TOP, visible at ISO ✓/△.
- `after-OBLIQUE.png` (PIPE-02 ISO): depth-stacked rings, bullseye + V bends, pills legible (`29 m`, `▲79 m`) ✓.
- `after-NEAR.png` (PIPE-02): fault red dominant over dimmed topo, 9/10 ✓.
- `npm run build` PASS ✓. Captures are scratch (`/tmp/theatre/`), not committed.
