# Browser Raster Sources — CORS-vetted elevation/imagery for in-browser fetch

Probe a source with Origin-headered curl BEFORE wiring it into a loader. Plain-`curl` range speed means nothing if the browser preflight fails.

```bash
curl -sI -H "Origin: http://localhost:5176" -H "Range: bytes=0-1023" <url> | grep -i -E "access-control|HTTP/"
curl -s -X OPTIONS -H "Origin: http://localhost:5176" -H "Access-Control-Request-Method: GET" <url> -o /dev/null -w "%{http_code}\n"
```

## Decision table (verified Oct 2026, site 57.03N 111.68W)

| Source | URL pattern | Res | CORS | Verdict |
|---|---|---|---|---|
| AWS Terrarium PNG | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (maxzoom 15) | z13 ≈10 m/px, z14 ≈5, z15 ≈2.6 @57°N; pixels resampled NRCan CDEM (~20 m effective, header `x-amz-meta-x-imagery-sources` proves provenance) | `Access-Control-Allow-Origin: *` on all responses incl. 404s | Primary: canvas-decodable, ~1 s/tile, massively parallel |
| SRTM GL1 via OpenTopography S3 | `https://opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/{tile}.tif` | 30 m | echoes request Origin, 206 partials OK | Fallback: full tile ~6 MB, needs sequential IFD-chasing range reads (tens of seconds cold) |
| Copernicus GLO-30 COG (AWS) | `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{N.._W..}_DEM/..._DEM.tif` | 30 m | NO `Access-Control-*` headers; OPTIONS → 403 | Dead in browsers — proxy/server use only |
| NRCAN direct (HRDEM/CDEM), OpenTopography API | `ftp.maps.canada.ca`, `maps.canada.ca`, OT data API | up to 1–2 m | no CORS or key required | Unusable keyless; moot — NRCAN quality already arrives via Terrarium |

## Terrarium decode (verified: site pixel → 323.1 m, consistent z13–z15)

`elev = R*256 + G + B/256 − 32768` per pixel via ImageBitmap/canvas `getImageData` — no geotiff.js, no range state machine.

## Staging rule

Full-window high zoom is tile-count-prohibitive (44 km @z15 ≈ 66×66 tiles): fetch coarse full-window (z13) first, refine z14/z15 progressively near the camera target only.
