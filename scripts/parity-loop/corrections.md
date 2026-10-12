# Parity-loop corrections checklist

Source: run 5 (2026-10-12T11:05:28.351Z), board: docs/reference.
Regenerated every pass; history lives in `loop-log.jsonl`.

## TOP — gap:no-board-frame — trend vs run 4: n/a
- [ ] GAP: add board frame `TOP.png` (aliases: top) to `docs/reference/` so run 6 can compare instead of reporting a gap.
  - structural: canvases[1280x800,1280x800] preset=network
  - structural: pose={"eye":{"x":0,"y":27999.999999987773,"z":0.028011436828369218},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: frames STALLED vs prev run
  - structural: gap: no TOP.png (or alias top/network/level1) in board dir — capture kept, no verdict

## ISO — gap:no-board-frame — trend vs run 4: n/a
- [ ] GAP: add board frame `ISO.png` (aliases: iso) to `docs/reference/` so run 6 can compare instead of reporting a gap.
  - structural: canvases[1280x800,1280x800] preset=segment
  - structural: pose={"eye":{"x":4866.957452071664,"y":8485.281374238572,"z":6950.735584074829},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: frames STALLED vs prev run
  - structural: gap: no ISO.png (or alias iso/segment/level2) in board dir — capture kept, no verdict

## NEAR — gap:no-board-frame — trend vs run 4: n/a
- [ ] GAP: add board frame `NEAR.png` (aliases: near) to `docs/reference/` so run 6 can compare instead of reporting a gap.
  - structural: canvases[1280x800,1280x800] preset=asset
  - structural: pose={"eye":{"x":1490.195294676462,"y":1500,"z":2128.2194397486674},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: frames STALLED vs prev run
  - structural: gap: no NEAR.png (or alias near/asset/level3) in board dir — capture kept, no verdict

## Tier upgrades (approximated → reconstructed)
- [ ] `sensor-masts` (markers, approximated): pole+head+lamp placeholder scale — promote with measured dims next build pass.
- [ ] `waypoint-markers` (markers, approximated): dim bone furniture dots — promote with measured dims next build pass.
- [ ] `hud-furniture` (hud, approximated): scale bar + level chrome, style-only — promote with measured dims next build pass.

Next: `node scripts/parity-loop/run.mjs docs/reference` appends run 6.
