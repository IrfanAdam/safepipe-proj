# OPS 3D V3 — REAL-WORLD SA… (Ring-2 chassis iteration)

> Status: 🟡 BUILDING v3 — Phase 00 pending owner's go. Awaiting owner's real-world-assets / terrain-accuracy prompt as binding optimization input (more to follow).
> Continues: `2026-10-07_153000-ops3d-realworld-twin.md` (Phases 00–01 done — foundation + real terrain in `src/ops3d/`, carried over, not rebuilt).
> Replaces as active plan: `2026-10-10_191500-ops3d-ring2-seamless-redo.md` (COMPLETE — pushed `c36d8d1`). Ring-2 @ Sangachal stays live as the shipped reference build.
> Chassis: `src/ring2/` + `ops3d-ring2.html` (gate-mount, context-loss recovery + telemetry, takeover endpoints, same-frame zoom sync, tilt-aware rim fade). v3 site constants already in `src/ops3d/sat-base.js` (SITE 57.03N −111.68W).
> Site: Fort McMurray 57.03N −111.68W (153000 ground truth: Copernicus 30 m 25-pt grid, 44 km window, relief 277 m / sd 65 m / W-wall ~130 m).

## TLDR

Rebuild the real-world twin on the shipped Ring-2 chassis: Phase 00 ports the v1 control panels + map markers (parity first); Phase 01 resumes the real terrain and optimizes accuracy at the Fort McMurray site; Phases 02–06 carry the 153000 scope (assets → launcher map → time+sim → ops → lock) adapted to the new chassis. Every phase ends at a **REF GATE** — owner drops a reference/screenshot before the next builds.

---

## Phase 00 — Fix the foundation (chassis parity)
<!-- {#phase-00} -->
*v1 control panels + map markers on Ring-2. Nothing else moves.*

| # | Task | Done when |
|---|---|---|
| 1 | Control panels port (v1 panel set → Ring-2 HUD, token-only `--ops-*`, no raw hex/px) | every v1 control present, same order |
| 2 | Map markers port (v1 marker set → map + twin overlay) | positions match v1 ±1px @ same zoom; survive SAT↔TWIN slide |
| 3 | Panel↔marker wiring (select/hover/focus round-trip) | click marker → panel; panel action → focus lands <5px @ NEAR |
| 4 | Parity sweep (chromium+webkit, mix 0/50/100, TOP/NEAR, zero pageerrors) | screenshots match v1 stop-for-stop |

- REF GATE 0: owner confirms panels + markers feel like v1 on real Safari.

## Phase 01 — Real terrain (resume + optimize)
<!-- {#phase-01} -->
*The optimization site. Owner's terrain-accuracy prompt overrides details below.*

| # | Task | Done when |
|---|---|---|
| 5 | Accuracy audit (live DEM vs Copernicus grid: relief/sd/W-wall/asymmetry) | scored 25-pt report; only sub-7 scores become work |
| 6 | Safari DEM decode pass (browser decode + fetch latency, real device) | closes 153000 −2; decode time in telemetry |
| 7 | Variance lift (sd −26% → ≥90% of real 65 m, valley+lake masked) | re-score ≥8; top-down pixel-check vs Phase-00 baseline |
| 8 | Contour conformance on live decoded band (±2% endpoints) | accuracy gate green on live band, not constants |

- REF GATE 1: owner picks terrain mood (photo/map capture) + confirms scores.

## Phase 02 — Real inspectable assets
<!-- {#phase-02} -->
*Import, don't scaffold. (153000 Phase 2, new chassis.)*

| # | Task | Done when |
|---|---|---|
| 9 | Overpass import run (cached, under budget; provenance per asset) | corridors + pads + plants load; every asset shows `osm\|parametric\|indicated` |
| 10 | CC0 kit mount (Poly Haven pipes GLB → parametric mount, DRACO/KTX2) | valve/flange/tee render; health lamp overlays work |
| 11 | Bolt-level LOD (instanced rings/dials/handwheels; NEAR only) | NEAR holds without shimmer; part count logged |
| 12 | HUD provenance + part readout per asset | every selectable asset shows provenance + count |

- REF GATE 2: owner approves detail level (toy / noisy / just right).

## Phase 03 — Hotspot launcher map
<!-- {#phase-03} -->
*The map is the launcher. (153000 Phase 3.)*

| # | Task | Done when |
|---|---|---|
| 13 | Map landing (MapLibre + deck.gl, Dark Matter vector; Esri satellite toggle) | loads keyless-ish; satellite toggle works |
| 14 | Circular hotspot rings (health-divided arcs, H3-hex sized) + pin fallback | ring matches feed worst-health per sector |
| 15 | Click → full-screen twin overlay (`?sector=<h3>`) | twin opens pre-selected on sector's worst asset |
| 16 | Close round-trip (X/Esc/back keeps hex + selection) | Esc mid-orbit returns to map, selection kept |

- REF GATE 3: owner picks map look + confirms ring reads right.

## Phase 04 — Time variance + sim
<!-- {#phase-04} -->
*(153000 Phase 4.)*

| # | Task | Done when |
|---|---|---|
| 17 | `feedAt(t)` + time slider (30 d history, live tick, +72 h sim) | scrub moves infra + weather + WOs + sim together |
| 18 | Open-Meteo weather overlays (rain tint, wind, temp shift) | cached fixtures offline; live fetch keyless |
| 19 | USGS seismic markers + risk-gated pulse | pulse fires only above threshold; markers match feed |
| 20 | Subsidence field (seeded now, labeled modeled) + sim presets + SIM watermark | same seed → same outcome; watermark whenever sim time active |

- REF GATE 4: owner approves slider feel + sim honesty.

## Phase 05 — Operations layer
<!-- {#phase-05} -->
*(153000 Phase 5.)*

| # | Task | Done when |
|---|---|---|
| 21 | WO fixtures + spatial markers/trails (survive map↔twin trip) | markers match fixtures; list survives trip |
| 22 | Field crews + activity (live pos, heading, ping age) | crews move; stale pings visibly age |
| 23 | Approval-gated actions (request → approve → execute → audit) | unapproved action never executes; audit entry each |
| 24 | Sonic + tactile (confirms, chime, pulse; `M` mutes) | all sounds post-gesture; mute covers all |

- REF GATE 5: owner approves the gate flow.

## Phase 06 — Lock
<!-- {#phase-06} -->
*Ships clean, stays clean. (153000 Phase 6.)*

| # | Task | Done when |
|---|---|---|
| 25 | Perf budgets (pixel cap, instance counts, `?post=0`, reduced-motion) | budgets logged at boot; Safari holds |
| 26 | Docs + captures (tokens, knobs, sim honesty, DEM swap, key setup) | fresh reader swaps DEM + sets keys from docs alone |
| 27 | Track-close (phases marked ✓ + sha, 0 wip) | every phase closed with sha; final walkthrough signed |

- REF GATE 6 (final): full walkthrough sign-off.

---

## Standing rules

- Ports: agents on `:5198`/`:5199` only — NEVER `:5173`/`:5175` (owner's). Reuse live `:5198`, never start/kill servers.
- Every fix via subagents; read-only audits write to `/tmp` only.
- `node --test tests/ring2-*` + `npm run build` green before every commit; commit carries `[plan:<this-file>#<phase>]`; no push without owner's `y`.
- Every phase ends at its REF GATE before the next starts. Phases never restart silently.
- Headless-WebKit green ≠ real-Safari proven: Safari proof is an owner-device screenshot with readable telemetry bar.
