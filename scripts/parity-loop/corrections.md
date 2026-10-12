# Parity-loop corrections checklist

Source: run 16 (hand-appended; captures = gate2-caps ring2-TOP/ISO/NEAR.png, page-errors.log=none), board: scripts/parity-loop/baseline/t3.
Regenerated every pass; history lives in `loop-log.jsonl`.
Object set refreshed to Phase-02 (21 tracked, 5 stale retired — see tiers.json `retired`).

## TOP — compared (MAD 3.5, minor) — trend vs run 15: regressed
- [ ] MINOR drift (MAD 3.5, changed 7.74%): gate2-caps Phase-02 scene (roads/backdrops/T0+T1 facilities) vs t3 old-twin golden baseline — expected content delta, not a regression. Confirm with a second live run before touching code.
  - structural: canvases[none] preset=? (hand-staged; presets/pose not re-probed — no :5198 server, no playwright browsers)
  - structural: pixel MAD=3.5 changed=7.74% verdict=minor

## ISO — compared (MAD 6.21, minor) — trend vs run 15: regressed
- [ ] MINOR drift (MAD 6.21, changed 14.59%): same expected Phase-02 content delta as TOP. Confirm with a second live run before touching code.
  - structural: canvases[none] preset=? (hand-staged; presets/pose not re-probed — no :5198 server, no playwright browsers)
  - structural: pixel MAD=6.21 changed=14.59% verdict=minor

## NEAR — compared (MAD 6.01, minor) — trend vs run 15: regressed
- [ ] MINOR drift (MAD 6.01, changed 14.38%): same expected Phase-02 content delta as TOP. Confirm with a second live run before touching code.
  - structural: canvases[none] preset=? (hand-staged; presets/pose not re-probed — no :5198 server, no playwright browsers)
  - structural: pixel MAD=6.01 changed=14.38% verdict=minor

## Tier upgrades (approximated → reconstructed)
- [ ] `offsite-quarry-naval` (backdrop, approximated): naval sheds/pier, quarry pits, M2 ribbon from EIA pattern, no surveyed fix (offsite.js) — promote with measured dims next build pass.
- [ ] `landform-hillocks` (backdrop, approximated): rock outcrops/domes from practice pattern, no surveyed fix (landform.js) — promote with measured dims next build pass.
- [ ] `trains-s3` (structures, approximated): 6 oil + 2 gas modules, mids of board ranges; EBRD-zone layout approximated (dims.js OIL/GAS_TRAIN) — promote with measured dims next build pass.
- [ ] `racks-s4-frames` (structures, approximated): portal frames 10 m spacing, 36 in mid-range pipes, practice-approximated; corridor anchors derived (see rack-corridors-t0) — promote with measured dims next build pass.
- [ ] `admin-camp` (structures, approximated): admin block + 10 camp units, generic massing, layout unknown [Gaps-3] (dims.js ADMIN_BLOCK/CAMP) — promote with measured dims next build pass.
- [ ] `sensor-masts` (markers, approximated): pole+head+lamp placeholder scale — promote with measured dims next build pass.
- [ ] `waypoint-markers` (markers, approximated): dim bone furniture dots — promote with measured dims next build pass.
- [ ] `hud-furniture` (hud, approximated): scale bar + level chrome, style-only — promote with measured dims next build pass.

Next: `node scripts/parity-loop/run.mjs scripts/parity-loop/baseline/t3` appends run 17 (requires live :5198 server).
