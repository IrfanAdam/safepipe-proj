# Reference Board — Sangachal Terminal (Phase 02, Task 10)

Assembled 2026-10-12 from PUBLIC sources only. Owner supplies nothing. No
third-party pixels in-repo: this board holds citations, counts, and our own
captures. Shipped models are procedural reconstructions informed by these
references, never imagery copies.

Pin: 40.201262, 49.48127 (Garadagh district, ~45–55 km S of Baku, Caspian coast).

## Frames (dated)

- F1 OSM/Overpass full sweep 2026-10-12T10:41:56Z (ODbL): 2,876 elements in
  12 km — storage_tank 157 · building 1,125 · highway 1,320 · pipeline 153 ·
  landuse 200 · waterway 26. Raw: `public/data/osm-sangachal.json` (2.4 MB).
- F2 bp.com Sangachal terminal page (current, incl. H1 2026 figures): 688+ ha,
  bp-operated; EOP + STEP halves; 1.2M bbl/d oil, ~81M scm/d SD gas; 8 pipes
  in, 8 out. https://www.bp.com/en_az/azerbaijan/home/who-we-are/operationsprojects/sangachal_terminal.html
- F3 Wikipedia Sangachal Terminal (2026-08-27; older ~2009-era figures flagged).
  https://en.wikipedia.org/wiki/Sangachal_Terminal
- F4 GlobalData via Offshore-Technology (2021-10-27): 7 tanks, 3,281,560 bbl,
  access pipeline + road, NO marine mode. https://offshore-technology.com/marketdata/sangachal-liquids-storage-terminal-azerbaijan
- F5 SD2 ESIA Ch.12 (bp.com PDF, snippet): single 107 m HP/LP main flare.
- F6 EBRD EIAs (ACG Phase 1, Shah Deniz): zone areas (EOP 40.5 / ACG-P1 41.8 /
  SD 33.3 / flare 34.7 ha), 6 oil + 2 gas trains, 165k bbl condensate tank.
  https://www.ebrd.com/english/pages/project/eia/phase1.pdf
  https://www.ebrd.com/english/pages/project/eia/shahdeni.pdf
- F7 View-only photo refs (rights-managed, read in browser, never downloaded):
  Granger 2007 aerial; Getty Laski 2006-10-26 file photo; Suau Dec 2006
  control-room series. Open-license geometry anchors: CPC floating-roof farm
  (cpc.ru), Ceyhan dimensions (bp.com).
- F8 STEL electrification $230M, Stage 1 mid-2027 (bp.com H1 2026 update).

## Pin verification (F1)

Terminal footprint centered on pin — nearest tank 49 m, nearest
landuse=industrial 171 m. No move needed. Tank cluster bbox S 40.179248 /
N 40.207724 / W 49.448454 / E 49.486778 (~4.5 km diagonal), centroid ~1.9 km
SW of pin; pin sits in the NE tank group, field extends SW.

## Reconciled structure list (modeling targets)

- T1 crude tanks ×3: 880,000 bbl each → ~94 m dia × 20 m floating-roof
  (volume-verified: π·47²·20 ≈ 139k m³ ≈ 880k bbl; Ceyhan anchor 100×20 m).
- T1 crude tanks ×4 (EOP): 25,500 bbl → ~1/3-scale instances.
- T2 condensate + off-spec tanks (SD block): ~40–45 m dia × 18–20 m.
- T1 processing: 6 oil + 2 gas train modules (vessels 2–4 m dia × 10–20 m;
  columns 3–5 m dia × 15–30 m; parallel rows).
- T1 pipe racks: portal frames ~8–12 m spacing, 5–6.5 m beam height, 3–6 pipes.
- T2 flare: one confirmed 107 m SD2 stack; KO drum ≤100 m; own ~35 ha zone.
- T2 BTC pump hall + SCP compressor + 7 turbine halls with exhaust stacks.
- T3 admin/camp massing: generic, stamped indicative.
- NEVER: no jetty (all export overland pipe); no rail siding (unverified).

Tank-count note: OSM's 157 storage_tank ≠ bp's 7 export tanks — OSM counts
every vessel/sphere/process tank; the 7 crude tanks are the modeled T1 set.
OSM ~136 m max tank bboxes read as bund (dyke) areas, not shells.

## Contradictions (use bp current, footnote rest)

- Storage: bp ~4.0M max / 3.2M working vs Wiki 3.0M vs GlobalData 3.28M.
- Area: bp 688 ha vs Interfax ~550 ha.
- Train count ("4 oil trains") NOT explicitly sourced anywhere — board asserts
  6 oil + 2 gas train *modules* per EBRD, never "4 trains".

## Gaps (with download pages)

1. No open-license Sangachal tank close-up — colors provisional; follow-ups:
   Wikimedia Commons, Geograph, Flickr (Sangachal queries).
2. Pre-SD2 flare inventory unconfirmed — model the one 107 m stack only.
3. Admin/camp permanent layout unknown — generic massing, indicative stamp.
4. Rail siding unverified — retry Overpass later; assert nothing.
5. 373 highway=living_street likely mis-tagged town streets — filter in Task 11.
6. landuse=military ×3 nearby (incl. naval terminal ~10.4 km S) — backdrops only.

## T0/T1 cut list (pinned for Tasks 11–14)

T0: terrain + roads + 7 crude tanks + train module rows + rack corridors.
T1: condensate tanks + flare stack + pump/compressor halls + dyke perimeter.
T2/T3 per tier loop (Task 15).

## Geometry seeds (measured from F1 OSM geometry, 2026-10-12)

- 3× crude tanks ~96.5 m dia (predicted 94 m — match within 3%):
  (40.205099,49.477170) · (40.203108,49.478951) · (40.205340,49.483263).
- Gas spheres ~50 m row near pin: (40.201230,49.480691) · (40.200474,49.479254) ·
  (40.201997,49.482156) · (40.202747,49.483610); 60 m sphere (40.193380,49.459434).
- 116 tank ways in F1 (157 counting nodes); shells not bunds at these diameters.

## T1 candidate seeds (measured F1 footprints ≥40 m, function UNVERIFIED)

Function TBD by T1 lane against EBRD zone tables + aerial pattern — positions
are derived, purposes approximated until confirmed:
- 101.7×74.3 m @ (40.197546,49.476970) — hall candidate (600 m SW of pin).
- 81.7×65.2 m industrial @ (40.202211,49.488507) — pump/compressor candidate.
- 77.1×62.1 m @ (40.198704,49.492264) — hall candidate.
- 70.2 m industrial @ (40.201341,49.489620); 68.9 m @ (40.202176,49.477174).
- East row 49.505–49.509 (90×68, 76×58 ×several) — camp/hall row candidates.
- 39 such footprints within 2.5 km; full sort in F1 query (building + ≥40 m).
