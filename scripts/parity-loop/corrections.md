# Parity-loop corrections checklist

Source: run 15 (2026-10-12T12:13:22.767Z), board: scripts/parity-loop/baseline/t3.
Regenerated every pass; history lives in `loop-log.jsonl`.

## TOP — compared (MAD 0, stable) — trend vs run 14: improved
- [ ] Stable — no build-pass action; keep as the golden reference for this view.
  - structural: canvases[1280x800,1280x800] preset=network
  - structural: pose={"eye":{"x":0,"y":27999.999999987773,"z":0.028011436828369218},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: renderer alive (frames advanced)
  - structural: pixel MAD=0 changed=0% verdict=stable

## ISO — compared (MAD 1.53, stable) — trend vs run 14: improved
- [ ] Stable — no build-pass action; keep as the golden reference for this view.
  - structural: canvases[1280x800,1280x800] preset=segment
  - structural: pose={"eye":{"x":4866.957452071664,"y":8485.281374238572,"z":6950.735584074829},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: renderer alive (frames advanced)
  - structural: pixel MAD=1.53 changed=0.55% verdict=stable

## NEAR — compared (MAD 2.95, stable) — trend vs run 14: improved
- [ ] Stable — no build-pass action; keep as the golden reference for this view.
  - structural: canvases[1280x800,1280x800] preset=asset
  - structural: pose={"eye":{"x":1490.195294676462,"y":1500,"z":2128.2194397486674},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: renderer alive (frames advanced)
  - structural: pixel MAD=2.95 changed=2.22% verdict=stable

## Tier upgrades (approximated → reconstructed)
- [ ] `sensor-masts` (markers, approximated): pole+head+lamp placeholder scale — promote with measured dims next build pass.
- [ ] `waypoint-markers` (markers, approximated): dim bone furniture dots — promote with measured dims next build pass.
- [ ] `hud-furniture` (hud, approximated): scale bar + level chrome, style-only — promote with measured dims next build pass.

Next: `node scripts/parity-loop/run.mjs scripts/parity-loop/baseline/t3` appends run 16.
