# Ops 3D — Fidelity Review (vs user reference video)

> Written 2026-10-09 ~17:25 IST, bridge/QA session. Reviewed state: build `ae68eba` +
> uncommitted `src/ops3d/terrain.js` (water/glow iteration still in the working tree).
> Companion docs: `ops3d-terrain-audit.md` (numeric topo bar) · `ops-3d-style.md` (palette/voice) · `reference.md`.
> Loop protocol: after each improvement loop, re-run the capture set below and check every item in
> **Loop checklist** — an item is done only when its check passes in both the fit view and a drill view.

## The bar — user's reference video (dark digital-twin promo, 56 s)

| Part | What it shows |
| --- | --- |
| Opener (≈0–3 s, `ref-01`) | **Extruded map slab floating over near-black Earth · neon rim light on the slab edge · near-zero HUD · deep negative space · slow push-in.** User: "first few seconds, you'll get the idea." |
| Ops-map section (`ref-t16`) | Dark flyover: **glowing river, dense luminous network, emissive markers, atmospheric fade into void**; data density reads instantly. |
| Diorama finish (`ref-t28/52`) | Dusk material polish — bloom confined to emissives, controlled palette, crisp AA, deep DOF. |

Reference frames: `~/.hermes/cache/scratch/ops3d-qa/ref/ref-01.png, ref-t16.png, ref-t28.png, ref-t52.png`

## Verified gaps — 17:13 captures (native-res reads, 2×)

| # | Dimension | Current pixels | Bar target |
|---| --- | --- | --- |
| 1 | Terrain material | Uniform contour hairlines; relief shading does not read; index/intermediate weight modulation invisible → flat schematic | Lit surface: hillshade/hypsometric reads at a glance; clear index vs intermediate hierarchy |
| 2 | Atmosphere / edge | No distance falloff anywhere; plate ends in a bare hard clip | In-map fade/desaturation with distance; deliberate edge treatment (rim — see opener) |
| 3 | Emissive data | Only the orange pipe + alarm glow faintly; network, water, elevation pills all dull | Emissive hierarchy: alarms > pipes/flow > water > land; pills/markers readable |
| 4 | Water | River = ~1 px faint thread, weaker than the contours beside it; channel is drawn-not-derived (rides off the valley low line); lake = dull matte slab | DEM-derived channel seated in the contour-V low line; water reads at fit zoom |
| 5 | Presentation | Flat disc; HUD dense from frame one; no entrance move | Extruded slab + rim light; restrained opening; camera move (per opener) |
| 6 | Small artifacts | **"▼ 305 m · VALLEY" valley tag self-clips** (fixed 192 px canvas → renders "…305 m · VALI"); labels float without leaders; stray red dash fragment beyond the rim (NE); DEM tile paint gaps flash during refine (self-heals by settle) | No clipped text; anchored or faded labels; rim-clean edges; no paint gap visible after ≥9 s settle |

## Loop checklist (pass conditions)

1. **Relief** — in TOP + low-orbit captures, terrain shading reads *before* labels do (bright slopes / dark troughs visible at a glance).
2. **Edge/atmosphere** — distance falloff observable (far contours dimmer) or deliberate rim treatment present; no bare clip.
3. **Emissive hierarchy** — at fit zoom: alarms > pipe/flow > water > land; network + pills legible.
4. **Water** — straight-down crop: blue thread sits inside the contour V (low line), visible at fit zoom, not fainter than contours.
5. **Opener** (if adopted) — first-frame composition matches `ref-01`: slab thickness, rim light, sparse HUD.
6. **Artifacts** — no clipped text in any captured frame; no leader-less floaters; no tile-gap flash after settle.

## Capture recipe (reuse every loop)

- `node ~/.hermes/cache/scratch/ops3d-qa/capture.mjs` — TOP / low-orbit / near (keys `1`/`2`/`3`) + river & lake drills @2×.
- `node ~/.hermes/cache/scratch/ops3d-qa/capture2.mjs` — river top-down + river/lake full @2×.
- Run from repo root (repo Playwright + system Chrome). `QA_URL` env points at another port (default `127.0.0.1:5175`).
- Wait ≥9 s after load (DEM staged refine), then shoot the settled state.
- `window.__twin.setView([cam], [tgt])` — known-good drills: river `[11,13,5.5]→[11,0,2]` · river top-down `[11,13,2]→[11,0,2]` · lake `[-9,13,9.5]→[-9,0,6]`.
- Evidence set (17:13): `qa-top-1x/2x, qa-iso-1x, qa-near-1x, qa-river-2x, qa-lake-2x, qa-river-topdown, qa-river-full, qa-lake-full` + crops (`glow-quiet, pipe-center, edge-right, lake-tight, river-tight`) in `~/.hermes/cache/scratch/ops3d-qa/`.

## Status notes

- `src/ops3d/terrain.js` (water + glow iteration) is **uncommitted** — the water findings above describe that working-tree state.
- Already in motion (main session): satellite-overlay unit; water-channel re-derivation unit (`b0d0b4fb` — the drawn-not-derived fix).
- Fix focus, ranked: **1) terrain lighting + contour hierarchy · 2) atmosphere + edge rim · 3) emissive pass (data + water) · 4) presentation/opener per video · 5) small artifacts above.**

### Fix specs ready (bridge recon, 2026-10-09)

- **Valley tag clip** — source: `terrain.js:711` (the `▼ … m · VALLEY` tag). Mechanism: `elevLabel` (`terrain.js:410–439`) draws into a fixed **192×48** canvas, centered, no `maxWidth` — the ~289 px string clips at both edges ("…305 m · VALI"). Fix: measure text (`ctx.measureText`), `cv.width = Math.max(192, 56 + textW)`, expose `sp.userData.aspect = cv.width / cv.height`; derive sprite width at the five scale sites — `terrain.js:665, 703, 712, 971, 972` (line 972 is in `setDetail()` and re-scales the same sprites — all five must move together or the tag flickers by zoom level). One-site alternative: font auto-fit (`size = min(30, floor(30 * (cv.width − 56) / textW))`). Test-safe: no test references the canvas width or the tag literal. Line numbers per the 17:5x tree — anchor by symbol (`elevLabel`, the `VALLEY` tag) if shifted. Latent at-risk chips (fine today, clip if they grow): contour index pills (`:654`), summit pills (`:702`).
