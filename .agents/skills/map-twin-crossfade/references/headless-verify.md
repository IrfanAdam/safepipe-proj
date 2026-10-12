# Headless verify + watch — MapLibre satellite × three.js twin

Self-test matrix, probe constraints, and the silent-on-green cron pattern for this view class.

## Self-test matrix (one batch, three lanes)

- **A — user flow (chromium):** open `/gallery.html`, click the Ring-2 tab, confirm iframe `src` set, poll status ≤60s until map canvas non-zero, then drive mix 0/50/100 with settle ≥2.5s and screenshot each. PASS per stop: expected mix value + non-zero `map:WxH` + expected layer content.
- **B — forced wedge (chromium):** stub the healer dead (`map.resize = () => {}`), zero the canvas, confirm the status shows the wedged state with container dims, then require auto-heal with zero manual touch and confirm the heal came from a fresh instance. Finish with a mix:0 content check.
- **C — hidden→shown (webkit):** mount the harness hidden, show after 5s, poll until map non-zero. WebKit is the Safari proxy lane.
- **D — forced context loss (chromium + webkit):** kill map and twin contexts in-page via the `WEBGL_lose_context` extension; require the loss to surface in the status (`CTXLOST` / `cxl:<which>:lost`), then restore and require a FULL clean remount — new canvas object, non-zero size, pixel ratio back to 1, loss flags cleared — never a bare `resize()`. Zero pageerrors. This is the only headless proof a context-loss recovery path works; software GL never loses contexts on its own, so unforced runs cannot exercise it.
- **F — parity acceptance vs the working variant:** when a sibling view renders where this one fails, run both side-by-side (same engine, viewport, waits) through open → SAT(0) → mid → TWIN(100) → back-to-SAT → one travel frame, and table map-canvas size, tile counts, outside-disc coverage, and errors per stop. Ship only when the fixed view matches the working one stop-for-stop; pixel-diff the untouched mid-range before/after (mean ≈ 0) to prove the fix didn't move the blend. One mid-load travel frame may catch a stale status tick — tick lag, not a bug. (a) retina gallery click flow at `deviceScaleFactor:2` (1194×601 → 2388×1202 backing) through the real tab click; (b) throttled tiles — delay Esri/Terrarium tile responses ~2.5s, slam the slider 100→0 mid-load, require every frame to stay disc-confined; (c) rapid 0/100 oscillation ×5, then confirm nominal state. WebKit has no CDP network emulation — implement the throttle as Playwright route-fulfillment delays, which work on both engines.

## Probe-script constraints

- Playwright resolves only under the project tree: write probes as `./_tmp-*.mjs` (underscore prefix is gitignored), delete before committing.
- Reuse the live temp server; never start/stop the user's dev server and never bind their ports. If no server is up, start one on a free temp port with `--strictPort` and kill it after.
- Screenshot each verdict; record status-bar text verbatim (it carries build id + tile counts).

## Pixel-truth gate

- Never `drawImage`/`getImageData` off a live WebGL canvas headless: `preserveDrawingBuffer:false` returns zeros even over full imagery. Gate on the compositor PNG (a black disc compresses tiny, detailed satellite doesn't) plus vision.
- No black verdicts before `dem:live` / `tiles:16/16` — mid-load captures read black; re-run the stop after warm-up.

## Watchdog (silent-on-green cron)

- `no_agent` script: unit tests + one live mix:0 probe; print ONLY on failure (empty stdout = silent, no delivery).
- Budget well under the cron hard interrupt (~3 min); reuse the live temp port, else start-then-kill a temp one.
- Non-zero exit or timeout alerts automatically; `deliver` set to all user channels.
