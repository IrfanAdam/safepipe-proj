# Network Ops 3D (theatre-style) Implementation Plan

> **For Hermes:** execute with `subagent-fanout` — parallel file-disjoint lanes, parent integrates.

**Goal:** Build a dark cinematic digital-twin monitoring view ("Network Ops 3D") in safepipe_proj, styled on theatre-fawn.vercel.app — a real-world pipeline network + facilities rendered as dotted traces on a dark table, with health/faulty/sensitive zones highlighted so what matters is instantly visible. Zoom flows network → segment → asset/facility. Serves oil & gas compliance/safety/maintenance now; data-model stays energy-generic. Upstream triangulation (drones, ground cameras, sensors) feeds a unified asset-health input — the view consumes that feed, it doesn't ingest raw sources.

**Architecture:** Container-agnostic twin module (`src/ops3d/twin.js`: `createTwin(container, {feed, onSelect})` → `{setSelection, setFeed, dispose}`) + vanilla JS Three.js modules under `src/ops3d/`. Core idea: a **unified asset-health feed** (`assetId → {health, faults[], sensitivity, compliance[]}`) drives all highlighting — drone/camera/sensor triangulation lands in that feed upstream, the view never parses raw sources. Three semantic zoom levels (network → segment → asset/facility) with per-level detail. DOM for HUD (not WebGL text). Cheap post chain (bloom + single composite) instead of their deferred MRT.

**Health visual language (disciplined, still theatre-like):** nominal = faint bone-white dots (recede); watch = amber `#ff8c39`; critical/fault = red `#e31919` + ring + table wash. Sensitive zones (e.g. high-consequence areas) = dashed outline + hatch, not a third glow color — so at a glance, glow means health, outline means sensitivity. Compliance flags (overdue inspection, open MOC) surface as HUD badges on the selected asset, not scene color.

**Tech Stack:** three (pinned, + `three/addons/` EffectComposer/UnrealBloomPass/OutputPass), Vite MPA (existing), vanilla JS modules matching `src/patterns/*` style, canvas-sprite labels, existing tokens (`color.semantic.warning #ff8c39` = signal accent, `font.mono`).
### Execution (how this plan runs — read before Task 1)
- **Fan-out, one build:** independent modules go to parallel subagents in ONE `delegate_task` batch (lanes below); parent owns `twin.js` API + integration + all commits. Children never run git, never touch shared files (`twin.js`, configs). Child summaries are unverified — parent re-runs build + captures before integrating.
- **Lanes:** A = `table.js` + `post.js` (shaders); B = `network.js` + `zones.js` + `levels.js` (twin geometry); C = `health-feed.js` (feed shape + seed data, TDD: feed-shape assertions first); D = `hud.js` + `hud.css` (DOM overlay, token-only). Parent: Task 1 API, Task 7 selection wiring, Task 8 gates.
- **Skills per lane:** A+B → `pixel-proof` (SwiftShader captures: `--use-angle=swiftshader --enable-unsafe-swiftshader`; prove effects with on/off diffs, attach shots not prose) + `systematic-debugging` for shader issues; C → `test-driven-development` (feed-shape tests before code); D → `ds-token-pipeline` (no raw hex/px outside tokens; page-local `--ops-*` prefix, never `--space-N`); all → `concise-delivery` reports.
- **Standing rules (prior learnings, non-negotiable):** dev server stays `5175` (package.json); never touch/kill `:5173`/`:5174`; temp capture servers on other ports. `npm run build` green before every commit. Path-limited commits (`git add <paths>`, never bare) with `[plan:ops3d-theatre-style#task-N]` trailer; mark `✓ done` per task. No `git push` without explicit `y`. User verifies in Safari — Chrome captures are not proof; keep shaders WebGL1-safe GLSL so WebKit holds.
- **Reference already mined:** `theatre-fawn` bundle analysis (camera presets, dot-pitch LOD, bloom/CA/grain values, seeded-RNG layout) is in this chat — lanes receive numbers inline, no re-fetch.

---

### Decisions for you to tweak (before build)
1. **Placement — RESOLVED (user-owned):** you handle all mounting — inline `.sp-map` slot now, fullscreen view later. The plan delivers a container-agnostic twin module only: `createTwin(container, feed)` + `dispose()`, sized by ResizeObserver so any container (slot or fullscreen) just works. No edits to `src/patterns/operations.js` in this plan; selection sync happens through callbacks you wire (`onSelect`, `setSelection`).
2. **Health states:** plan uses 3-level nominal/watch/critical mapping to bone/amber/red (`color.semantic.*` tokens). Say if you need more grades (e.g. 5-level POF scale) — more grades weaken the at-a-glance read, so default stays 3.
3. **Data:** plan defines a `health-feed.json` shape (asset → health/faults/sensitivity/compliance) seeded from `src/logic/fixtures.json` + deterministic synthetic geometry. Real GIS geometry and live triangulation plug into the same shape later — the view never changes.
4. **Scope cuts already made:** no audio reactivity, no volumetric haze, no depth-of-field tiles, no autoplay gate. Pulse animation is time-based flow direction, not BPM.

---

### Task 1: Pin three.js + twin module API

**Objective:** `three` installed and the twin exposes a container-agnostic API you can mount anywhere.

**Files:**
- Modify: `package.json` (add `three@0.170.0`)
- Create: `src/ops3d/twin.js` (`createTwin(container, {feed, onSelect})` → `{setSelection, setFeed, dispose}`; owns canvas, ResizeObserver sizing, RAF loop)
- Create: `src/ops3d/main.js` (dev harness only: mounts twin in a bare page for screenshots — not shipped UI)

**Step 1: Install**
Run: `npm i three@0.170.0` — Expected: `package.json` gains three dep.

**Step 2: Module API** — `createTwin` creates `<canvas>` in any container, sizes via ResizeObserver (slot and fullscreen both work, zero config); `dispose()` cancels RAF + releases renderer + disconnects observer. Selection flows OUT via `onSelect(assetId)` and IN via `setSelection(assetId)` — you wire these to your views.

**Step 3: Verify**
Run: `npm run build` — Expected: PASS. Dev harness renders dark canvas at any container size.

**Step 4: Commit**
```bash
git add package.json src/ops3d/twin.js src/ops3d/main.js
git commit -m "feat: twin module with container-agnostic mount API"
```

### Task 2: Renderer + camera rig + table

**Objective:** Dark scene, low oblique camera, satin table plane, orbit/zoom.

**Files:**
- Create: `src/ops3d/scene.js` (renderer, scene, fog)
- Create: `src/ops3d/camera.js` (3 presets: plan / sector / wide)
- Create: `src/ops3d/table.js` (dark plane + faint grid shader)

**Details:**
- Renderer: `WebGLRenderer({antialias:true})`, `setClearColor(#0b0c0c)`, ACES tone mapping, `?scale=` px-ratio cap like theirs (max 2).
- Cameras (copy their numbers from world.js, retargeted): sector `{yaw 4, pitch 25, dist 16, fov 40}`, plan `{pitch 82, dist 40}`, wide `{pitch 36, dist 42}`. Keys `1/2/3` switch with 600ms ease.
- Controls: OrbitControls (import from addons), damping, `maxPolarAngle ~80°`, pan = RMB, wheel = zoom, `distMin 4 / distMax 140`.
- Table: big plane, custom ShaderMaterial — base `#141516→#1E1F20`, GGX-ish specular streak top-right, diagonal micro-grid (pitch uniform), subtle noise smudge. Keep it one 80-line shader, not their raymarched volume.

**Verify:** `npm run dev -- --port 5175`, open the operations screen, table visible in the map slot, keys 1-3 move camera. Screenshot via SwiftShader if headless.

### Task 3: Health feed + dotted network layer (faults glow, sensitive zones outlined)

**Objective:** Pipelines render as dotted traces driven by a unified health feed — faults glow, sensitive zones get outlines, nominal recedes.

**Files:**
- Create: `src/ops3d/health-feed.js` (feed shape + fixture-seeded sample data)
- Create: `src/ops3d/network.js` (polyline → instanced dot capsules, health-colored)
- Create: `src/ops3d/zones.js` (sensitive-area dashed outlines + hatch)

**Details:**
- Feed shape (energy-generic, O&G now): `{assetId, kind: 'pipeline'|'facility'|'sensor', health: 'nominal'|'watch'|'critical', faults: [{type, chainage, severity}], sensitivity: 'normal'|'hca'|'environmental', compliance: [{flag:'inspection-overdue'|'moc-open'|'permit-due', ref}]}`. Seed from `src/logic/fixtures.json` work orders + deterministic RNG; document shape in `docs/ops-3d-style.md` so future drone/sensor triangulation targets it.
- Network: per-asset polylines (seeded stable layout ~10×10 area). Instance color by health — nominal faint bone, watch amber `#ff8c39`, critical red `#e31919` + 1.5× gain. Fault chainage points get brighter bead + expanding ring on select.
- Zones: HCA/environmentally-sensitive areas as dashed-outline ground decals + diagonal hatch (their border-dash idiom), NO glow color — glow always means health.
- Facilities (compressor stations, valve yards): low wireframe boxes at line junctions (their city-block idiom, miniature), colored by worst child-asset health.

**Verify:** sample feed shows ≥1 critical segment glowing red with ring, ≥1 HCA outline hatched, nominal lines faint. `npm run build` PASS.

### Task 4: Semantic zoom — network → segment → asset (the twin core)

**Objective:** Zooming (or clicking) descends the twin hierarchy with per-level detail; this is what makes it a twin, not a picture.

**Files:**
- Create: `src/ops3d/levels.js` (zoom thresholds + per-level visibility/content)
- Modify: `src/ops3d/camera.js` (add `asset` preset: low close-up; smooth fly-to on select)
- Modify: `src/ops3d/network.js` (LOD: dot pitch + label density per level)

**Details:**
- L0 network (dist ~40, plan-ish): whole system, health glow only, facility boxes, zone outlines. Minor laterals faded out (their `lod` fade).
- L1 segment (dist ~16, sector view): selected line brightens, chainage ticks + fault beads appear, neighboring lines dim to 40%.
- L2 asset (dist ~6–8, low close): facility resolves into tagged components (valve/pump/meter as labeled boxes), sensor points as small diamonds with last-reading age, fault zone gets hoop rings + chainage span; click sensor → HUD shows reading + source (drone/cam/sensor) + age.
- Transitions: 600ms eased fly-to on click/`1-3` keys; ESC or zoom-out ascends. URL deep-links `?asset=PIPE-07` land at L2.
- `prefers-reduced-motion`: jumps, no fly-to; pulses frozen.

**Verify:** scroll/click walks L0→L1→L2 and back; `?asset=` lands at L2 with component labels; reduced-motion jumps.

### Task 5: HUD in DOM (not WebGL)

**Objective:** Theatre-style HUD framing with zero WebGL text.

**Files:**
- Create: `src/ops3d/hud.js` + `src/ops3d/hud.css`

**Details (positions mirror theirs):**
- Top-left: sector block — network name + live clock + `HEALTH x/y/z` rollup (counts by state from feed).
- Top-center: thin scale ruler + current level chip (`NETWORK / SEGMENT / ASSET`).
- Top-right: worst-health banner — highest-severity open fault (`CRITICAL · PIPE-07 ch. 12.4km · corrosion`) or `ALL NOMINAL`.
- Left-mid: controls legend (`DRAG ORBIT · WHEEL ZOOM · CLICK DRILL-DOWN · 1-3 LEVELS · ESC UP · H HUD`).
- Bottom-left: selected asset panel — health, fault list with chainage, sensitivity badge, open work orders (from fixtures), sensor last-readings with source + age.
- Bottom-right: compliance strip — overdue inspections / open MOCs / permits due for selection (badges, not scene color), plus maintenance action (`Create WO` hook into existing workorder flow).
- `H` toggles HUD; all text uses `font.mono` token; corner brackets via CSS `::before/::after`.

**Verify:** HUD overlays canvas, `H` hides/shows, no layout break at 1280×720 and 1920×1080.

### Task 6: Post chain — bloom + CA + grain/vignette

**Objective:** Cinematic finish with two passes, not their full MRT.

**Files:**
- Create: `src/ops3d/post.js` (EffectComposer: RenderPass → UnrealBloomPass → composite ShaderPass → OutputPass)

**Details:**
- Bloom: `strength 0.55, radius 0.6, threshold 0.75` (only bright dots bloom).
- Composite shader: lateral chromatic aberration (2px max at edges, toggle `C`), film grain (hash-based, `0.05`), vignette (`0.3`), subtle scanline optional off by default. All uniforms driven by a tiny `fx` object `{ca:1, grain:0.05}`.
- Fallback: `?post=0` query param renders raw (debug + perf).

**Verify:** white lines show slight red/cyan fringe at edges; `C` toggles CA; FPS ≥ 45 on integrated GPU at 1280×720.

### Task 7: Drill-down + selection API (you wire it to your views)

**Objective:** Clicks drill down the twin and report selection; all view-wiring stays on your side.

**Files:**
- Modify: `src/ops3d/twin.js` (raycast drill-down, `onSelect` out / `setSelection` in)
- Modify: `src/ops3d/hud.js` (asset panel + compliance strip; `Create WO` emits via callback, you handle it)

**Details:**
- Raycast against invisible fat tubes per pipeline + boxes per facility (never the dots). Hover → pointer + 1.5× gain; click → fly-to next level + `onSelect(assetId)`; `setSelection(assetId)` drives highlight + HUD from your side (list clicks, map search, deep-links — all yours).
- No-WebGL: `createTwin` throws a catchable error; you keep whatever placeholder you want (twin data still works in your panes).
- HUD ships as an optional overlay layer inside the twin container (toggle `H`); your fullscreen view can hide it and use native panels instead via `setSelection` + feed reads.

**Verify:** clicks drill L0→L2 and fire `onSelect`; `setSelection` from console updates highlight + HUD; forced WebGL-off throws catchable error.

### Task 9: Realism pass — terrain, structures, night-vision readability (NEW)
**Objective:** Kill the blocks-and-lines read — real relief, real facilities, Arkham/Crysis night-vision intuition.
**Files (NEW, file-disjoint lanes):** `src/ops3d/terrain.js` (procedural relief + carved corridors/pads) · `src/ops3d/structures.js` (compressor, valve yard, tanks, sensor masts, trestles; emissive health lamps) · `src/ops3d/beacons.js` (trunk-lateral flow pulses, fault light-pillars + rings, selection halo). Parent wires all three in `twin.js`.
**Verify:** close-up reads as a place (relief + facility + glowing fault), flow direction visible, fault findable in 2s. `npm run build` PASS + capture.
**Note:** real GIS geometry plugs into the `health-feed` shape later — synthetic layout reads as real until then.

### Task 10: True-scale 20 km pass — real place, attention hierarchy, capped camera (NEW)
**Objective:** The map is a believable 20 km-radius operating area, not a toy: 1 unit = 1 km, gentle representative Permian-basin floor (dip + swells + one dry draw, ±40 m true, VEX 2 — no fantasy peaks, no rim mountains), smooth chained contour strips (no joint-dots, no POI dots on terrain), faults glow brightest while terrain whispers, camera can't leave the mapped circle.
**Files:** `health-feed.js` (km layout inside r=19, chainages from true lengths) · `terrain.js` (SIZE 44, R_MAP 20 ring, chained Line2 strips, dim palette, periphery fade) · `structures.js` (FAC×0.05 / SEN×0.015 true-scale groups, buried trunk runs at y 0.02, no mid-run trestles) · `network.js` (true km chainage beads via per-pipe length) · `beacons.js` (PILLAR_H 0.45, beads 0.07/0.45 op) · `levels.js` (dists 55 / 9 / 0.55, TARGET_Y 0.05) · `camera.js` (DIST_MIN 0.05, maxDistance cap + pan clamp each frame, presets 55/9/60, fog 70–220 in `scene.js`) · `hud.js` (`SECTOR 7G — PERMIAN BASIN · R 20 KM`) · `twin.js` (clickPoint y 0.05).
**Verify:** TOP shows full circle + faint terrain; fault found in 2 s; zoom-out/pan stop at the ring; NEAR frames a 180 m pad from 550 m. Build PASS + TOP/NEAR captures + commit.
**Note:** geometry is representative of the basin, not surveyed DEM — real GIS plugs into the feed shape later.

### Task 8: Perf + tracker + docs

**Objective:** Ships clean, tracked, documented, performant.

**Files:**
- Shipped: `scripts/plan-track.mjs` + `src/ds/plan-manifest.json` (tracker — see below, landed before Task 1)
- Modify: `gallery.html` / `src/ds/gallery-shell.js` (add Ops-3D specimen link, only if trivial)
- Create: `docs/ops-3d-style.md` (tokens used, shader list, tweak knobs)

**Steps:**
0. Tracker (DONE — `chore(tracker)` commit): `npm run plan:track` reads `.hermes/plans/*.md` + `git log -- <tracked paths>` and writes `src/ds/plan-manifest.json` `{generated, plans, commits, wip}`; merges over previous manifest (shallow-clone safe); byte-identical rewrite when nothing changed so the `build` hook never churns. Tracked paths: `src/ds design-system src/ops3d docs gallery.html`. Every later commit carries `[plan:<file>#task-N]`; close each task with `✓ done` + shipped sha in this file.
1. Cap pixel ratio at 1.75, instance counts logged to console (`geo.stats`-style).
2. Run: `npm run build` — Expected: PASS, no new warnings; check `dist/` has ops-3d assets.
3. Capture 2 screenshots (sector view + plan view) with SwiftShader flags for the docs.
4. Commit.

---

### Risks / tradeoffs
- **Bloom cost** on low-end iGPU: mitigated by half-res bloom (UnrealBloom default) + `?post=0` escape hatch.
- **Dotted-line shimmer** when zooming: mitigated by LOD fade (Task 3); accept minor aliasing over solid tubes (that's the style).
- **Twin module weight:** `three` chunk (~600KB, cached) ships only where `twin.js` is imported — no separate page, no code-split needed for v1.
- **Don't port:** their MRT depth targets, DoF tiles, audio graph, volumetric air — explicitly out of scope; revisit only if v1 looks flat.

### Open questions (tweak before/without blocking build)
- Accent stays `#ff8c39`, or promote a new `color.signal` token? (Recommend new token aliasing warning for v1.)
- Second accent for "selected" vs "alert", or single-orange discipline? (Recommend single.)
