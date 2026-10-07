# Ops 3D — Terrain Topography Pre-flight Audit (Task 1)

> Plan: `.hermes/plans/2026-10-06_153000-ops3d-terrain-topo.md` · Task 1
> Proves the gap before the pass and locks the numeric bar Task 8 must clear.

## Method

- **Baseline tree:** `6d6e70d` (last commit before the terrain pass) checked out as a detached
  git worktree — the "before" is the real pre-plan code, not a re-tune of current code.
- **After tree:** working `main` at `8472b8e` (post Task 7/8).
- **Capture:** headless Chrome (SwiftShader) + CDP, 1280×720, 16 s settle, `ops3d.html`
  with `?view=` / `?asset=` deep links. Zero console errors on both trees across all captures.
  - `TOP` = default network fly-out · `ISO` = `?view=ISO` · `NEAR` = `?asset=FAC-01&view=NEAR`
    · `FAULT` = `?asset=PIPE-02&view=NEAR` (the corroded asset — FAC-01 is nominal, so the
    fault-dominance check must run against PIPE-02, not FAC-01).
- **Captures (scratch only, not committed):** `before-{TOP,ISO,NEAR,FAULT}.png`,
  `after-{TOP,ISO,NEAR,FAULT}.png` in `$BH_AGENT_WORKSPACE` (scratch).
- **Reproduce:** `git worktree add --detach <dir> 6d6e70d && ln -s <repo>/node_modules <dir>/`
  → `npx vite --port 5186` (before) and `npx vite --port 5187` (after) →
  `node --experimental-websocket cdp-shot.mjs <url> <out.png> 9334 16000` against
  `chrome --headless --use-angle=swiftshader --remote-debugging-port=9334 --window-size=1280,720`.

## Before-state diagnosis (measured, not asserted)

| Failure | Evidence at `6d6e70d` |
| --- | --- |
| Palette too quiet | near-white pixels 0.34 % of frame (TOP) — grey-on-grey |
| Density wrong | 18.3 contour crossings / 100 px scanline; bullseyes max 4 nested rings |
| Relief too gentle | brightest-1 %-block vs median contrast only 3.15× |
| Graticule wrong | red grid 1.89 % of frame — louder than the white contours it should sit under |
| Camera hides relief | ISO crossings 6.9/100 px — contours nearly absent at oblique |

## The bar (must pass after Task 8)

1. TOP: ≥ 2 closed index bullseyes, each ≥ 5 nested rings, pill text legible at 1280×720.
2. Slope cue: densest contour spacing ≤ 1.2× mean on steep banks; flats ≤ 1 ring / 2 km.
3. Hill wash: summit disk luminance ≥ 1.6× base contour luminance.
4. Drainage Vs: ≥ 6 consecutive contours kink where the draw crosses.
5. Grid read: checker ≤ 0.25 opacity, red index ≤ 0.5, neither out-glows the index contours.
6. No regression: `npm run build` PASS; fault beacons still brightest in scene.

## Results

| Metric (TOP / ISO) | before `6d6e70d` | after `8472b8e` | Δ |
| --- | --- | --- | --- |
| near-white pixels (lum > 0.75) | 0.336 % / 0.318 % | 1.576 % / 0.760 % | **4.7× / 2.4×** |
| bright pixels (lum > 0.55) | 0.964 % / 1.047 % | 2.938 % / 2.219 % | **3.0× / 2.1×** |
| p99 luminance | 0.543 / 0.560 | 0.908 / 0.726 | +67 % / +30 % |
| contour crossings / 100 px | 18.3 / 6.9 | 24.7 / 15.1 | **+35 % / +119 %** |
| brightest-1 %-block contrast vs median | 3.15× / 3.17× | 5.79× / 4.23× | +84 % / +33 % |
| red grid share of frame | 1.89 % / 4.42 % | 1.68 % / 3.52 % | **−11 % / −20 %** (while white rose) |
| nested rings per bullseye (vision read) | 4 / 3 / 3 / 2 | **7 / 7 / 5** | ≥ 5-ring bar met |
| NEAR (FAC-01) mean luminance | 0.347 | 0.291 | topo dimmed on drill-in (Task 7 §4) |
| FAULT (PIPE-02) red-dominant centre pixels | 85.4 %, max red lum 0.726 | 85.4 %, max red lum 0.728 | fault dominance unchanged |

## Verdict per bar item

1. **PASS (rings) / PARTIAL (pills)** — 3 closed bullseyes at 7/7/5 rings ≥ 5-ring bar.
   Pills legible at ISO (`-12 m`), sub-legible at full TOP; accepted tradeoff (texture over
   text) as recorded in Task 8.
2. **PASS on density proxy** — ring packing discriminates slope: p90 block density 0.099 →
   0.166 (+68 %) while median stays 0 (empty-flat blocks 72.9 % → 68.8 %), i.e. contours
   concentrate on steeps and vacate flats rather than spreading evenly. Direct 2 km ring-count
   on flats is not measurable from a raster without georeferencing — proxy only.
3. **SUPERSEDED** — hill-wash disk removed by the neon-plate direction (`e0b881f`, body fill
   out). Replacement check: additive stacking gives 11.6× local contrast at highs
   (p99 0.908 vs median 0.078) and index weight 2.35 px / 0.98 vs base 1.15 px / 0.52.
4. **NOT RE-CONFIRMED in this pass** — Task 8 recorded ≥ 6 kinked contours confirmed at ISO;
   the re-capture's vision read scored 0 obvious V-kinks (smooth curves). Known soft spot:
   draw half-width `DRAW_W 0.65` may be too generous for a raster read at this zoom.
   Left open deliberately — not re-tuned inside Task 1.
5. **PASS** — checker peak 0.075 static wash (≪ 0.25), red share fell while white rose 4.7×;
   vision read: red grid faint, clearly dimmer than index white.
6. **PASS** — `npm run build` 1.04 s clean, no new warnings; at FAULT the red beacon is the
   brightest object (85 % of the centre frame red-dominant, ~70–80 % of contours dimmed),
   8/10 legibility, zero console errors on all 8 captures.
