# Parity-loop corrections checklist

Source: run 9 (2026-10-12T11:36:10.816Z), board: scripts/parity-loop/baseline/t2.
Regenerated every pass; history lives in `loop-log.jsonl`.

## TOP — compared (MAD 0.44, stable) — trend vs run 8: stable
- [ ] Stable — no build-pass action; keep as the golden reference for this view.
  - structural: canvases[1280x800,1280x800] preset=network
  - structural: pose={"eye":{"x":0,"y":27999.999999987773,"z":0.028011436828369218},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: frames STALLED vs prev run
  - structural: pixel MAD=0.44 changed=0.15% verdict=stable

## ISO — compared (MAD 0.88, stable) — trend vs run 8: improved
- [ ] Stable — no build-pass action; keep as the golden reference for this view.
  - structural: canvases[1280x800,1280x800] preset=segment
  - structural: pose={"eye":{"x":4866.957452071664,"y":8485.281374238572,"z":6950.735584074829},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: frames STALLED vs prev run
  - structural: pixel MAD=0.88 changed=0.13% verdict=stable

## NEAR — compared (MAD 3.74, minor) — trend vs run 8: stable
- [ ] MINOR drift (MAD 3.74, changed 4.13%): compare thumbnails in scratch `/var/folders/lv/v81n4kks6yn02hxy4kq_yw2c0000gn/T/parity-loop/run-9/`; likely DEM-tile pop-in — confirm with a second run before touching code.
  - structural: canvases[1280x800,1280x800] preset=asset
  - structural: pose={"eye":{"x":1490.195294676462,"y":1500,"z":2128.2194397486674},"target":{"x":0,"y":-10.191794860351365,"z":0}}
  - structural: frames STALLED vs prev run
  - structural: pixel MAD=3.74 changed=4.13% verdict=minor

## Tier upgrades (approximated → reconstructed)
- [ ] `sensor-masts` (markers, approximated): pole+head+lamp placeholder scale — promote with measured dims next build pass.
- [ ] `waypoint-markers` (markers, approximated): dim bone furniture dots — promote with measured dims next build pass.
- [ ] `hud-furniture` (hud, approximated): scale bar + level chrome, style-only — promote with measured dims next build pass.

Next: `node scripts/parity-loop/run.mjs scripts/parity-loop/baseline/t2` appends run 10.
