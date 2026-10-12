---
name: crisp-webgl
description: Use when three.js scenes must stay sharp zoomed in.
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [three.js, webgl, rendering, sharpness, picking]
---

# Crisp WebGL

Realtime three.js scenes that hold up at close zoom: resolution-independent lines, AA'd shader grids, retina pixel ratio, round point sprites, and forgiving picking. Default 1px GL primitives rasterize into staircases the moment the camera dives — fix the primitive choice, not the pixel count.

## When to Use

Load this skill when building or fixing a realtime three.js/WebGL view the user will zoom into: digital twins, 3D maps, model viewers, or any scene where lines, grids, dots, or click targets must stay crisp and hittable at close range.

## Procedure

1. Render at `Math.min(window.devicePixelRatio || 1, 2)` — never cap below the display density; a 1.75 cap softens every retina screen for no real perf win at these scene sizes.
2. Hero linework (boxes, outlines, traces that the user inspects up close) gets fat lines: `Line2`/`LineSegments2` + `LineMaterial` with a px `linewidth` (2–3), never 1px `LineBasicMaterial`/`LineSegments`.
3. Keep a `resMats` registry of every resolution-dependent material; on every resize (including `ResizeObserver` fires) set each to the drawing-buffer size `floor(cssSize * pixelRatio)` — fat lines with stale resolution render at the wrong width.
4. Shader grids use `fwidth` coverage (`abs(fract(p - 0.5) - 0.5) / max(fwidth(p), eps)`, clamp to 1) so lines hold ~1px at any zoom instead of a fixed `smoothstep` width that crawls and moirés.
5. Point clouds always get a radial-gradient `CanvasTexture` sprite map at 128px with a soft falloff — untextured `Points` rasterize as squares, and hard-edged 64px dots do the same on zoom-in, which reads as pixelation up close. Share one texture across materials; color still comes from the material.
6. Picking raycasts invisible fat proxies (tubes/boxes/spheres with `colorWrite:false, depthWrite:false`, generously sized), never the visible dots or 1px lines.
7. Rank overlapping hits by kind (discrete sensor/facility beats pipeline tube within tolerance) and add hover feedback (target swell + pointer cursor) — without it, clicks feel erratic because the user cannot see what will hit.
8. Verify zoomed, not wide: capture with `--force-device-scale-factor=2` and crop-read the subject geometry. A dpr=1 wide shot hides exactly the rasterization the user will see on retina.
9. Armor every RAF-owning mount against `webglcontextlost`: `preventDefault` the event, cancel the RAF, show a visible DOM badge, and resume the loop on `webglcontextrestored` (three re-uploads on next render) — remove listeners and badge in `dispose`. A dead context never recovers on its own.

## Pitfalls

- `LineMaterial.dashScale` multiplies line-distance, so RAISING it makes dashes tinier — a subpixel dash pattern fixed by stretching reads as sparser scratches, not longer dashes. Restore legibility with opacity/width/contrast (or a smaller `dashScale`), never a bigger one.
- Chained contour/polylines read as matchsticks at zoom — resample with Chaikin corner-cutting (2–3 passes + light Laplacian relax) or Catmull-Rom before Line2 batching, preserving endpoints and sampled values, so curves bend continuously instead of jointing at every vertex.
- A green wide-shot capture proves nothing about close-up sharpness — always re-shoot cropped at 2x before calling linework done, since thin lines alias only at glancing zoom angles.
- `LineMaterial` with unset resolution silently renders wrong-width lines — register every fat-line material at creation and sync on resize, because the failure mode is subtle thinning, not an error.
- Fixed-width `smoothstep` grid lines shimmer under zoom by construction — they sample the grid function, not the pixel, so only derivative (`fwidth`) coverage converges.
- Geometry sunk beneath a semi-opaque surface never shows through: `transparent: true` still writes depth by default, so buried traces vanish under the body mesh instead of reading as underground — drape buried runs onto the surface (x-ray plan view: dimmer, dashed, plus explicit dive markers) rather than lowering their Y.
- Path-aligned markers need `rotation.order = 'YXZ'` with the lay-flat on X and the heading yaw on Y — under the default `XYZ` order the yaw is consumed first, so every marker points the same compass way regardless of tangent.
- Canvas-sprite text at full white blows out under bloom at close zoom — render label copy a step below white so the selected tag stays legible instead of a glowing pill.
- Restrain the camera as well as the primitives: raise the orbit min-distance and per-kind close-up distances so markers never grow into soup on drill-in. Shrinking and dimming blips has a floor, and zooming onto the skin past it re-rasterizes every sprite — camera restraint is the backstop, round sprites are the fix.
- Pipeline walls whisper, flow owns the read: once attention is guided, dim wall linewidth/opacity (e.g. nominal 1.35px @0.20 vs critical 1.9px @0.62) and let flow lines breathe prominently (solid traveling envelope, no hard dashes, additive off). Remove blur-glow sprite halos when the user says they distract — zero `PULSES_PER_PIPE`/opacity and skip the sprite layer entirely; flow reads via the chunked line envelope alone.
- Keep blue for water only: every contour/shore/drain line stays neutral grey; only flat water fills plus their internal isobaths carry `WATER_COL`. A terrain that tints contours blue reads as bathymetry error and breaks the attention budget.
- A black canvas with live DOM and zero console errors is a dead GL context, not a broken scene — repro the same URL in headless SwiftShader before touching materials; if it renders there, the browser's GPU process killed the context, so add the step-9 handling, not new shaders.
- When probing forced context loss, stash the `WEBGL_lose_context` extension object before calling `loseContext` — re-fetching it after the loss returns null, so restore must use the kept reference.
