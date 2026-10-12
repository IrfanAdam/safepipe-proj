# Headless panel screenshots

Capture showcase panels with stock Chrome — no extra dependencies.

## Command

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1280,2600 --virtual-time-budget=8000 \
  --screenshot="<out>/<panel>.png" "http://127.0.0.1:<port>/gallery.html#<panel>"
```

- `--virtual-time-budget` fast-forwards timers so `fetch` partials and fonts settle before capture.
- Tall viewports (2600px+) fit a whole panel; the `#panel` hash selects the tab when the shell deep-links it.
- If the panel sits below long above-fold content, the shell should `scrollIntoView()` the active panel on navigation — otherwise capture shows the wrong section.
- For interaction probes keep a reusable CDP steps driver (JSON list of `viewport | goto | eval | click | key | shot` steps over the remote-debugging port) instead of re-typing one-off scripts each round.
- Blank canvas with no readable console text? Capture the whole `Runtime.exceptionThrown` details object plus the `Log.entryAdded` URL, not the truncated message — the failing module specifier (or resource URL) names the missing import or mapping directly.
- The one-shot `--screenshot` flag is for static or settled pages: on a live Vite page it can hang forever (the HMR socket and rAF loop keep it 'busy'; `--virtual-time-budget` does not cap the wait), so the process never exits and no file appears. On a timeout, switch to the Playwright harness (below) or the CDP driver (`scripts/capture-page.mjs`) — navigate, wait in real time, then `Page.captureScreenshot` — never retry the flag.

## Playwright harness for WebGL / live-SPA pages

When the page needs real frames + software GL (three.js scenes, live Vite dev server), prefer Playwright over a hand-rolled raw-socket CDP driver (breaks on Node <21 — no global `WebSocket`).

Setup once per project: `npm i -D playwright && npx playwright install chromium` (browsers land in ~/Library/Caches/ms-playwright/).

A small `shot.mjs` in the project root: launch chromium headless with `['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']`, viewport 1440×900, `page.goto(url, {waitUntil:'domcontentloaded'})`, then `waitForTimeout(8000)` for real-time rAF settle, `page.evaluate` a STATE probe (canvas present + size, HUD `innerText`, collected console/pageerror lines), `page.screenshot`, close. Run: `node shot.mjs "<url>?<state-params>" shot.png` — URL params (e.g. `?asset=X&view=near`) drive pre-select/deep-link states so a drilled-in view captures with no interaction.

- The STATE JSON is the machine-readable proof (canvas size, HUD text, zero console errors); attach the PNG as illustration. Both, or it's not verified.
- Under software WebGL, keep input cheap: small viewport, settled state, single camera moves and synthetic wheel events. Multi-step drag storms can hang the renderer and surface as browser-closed flakes; on such a flake, wait for settle and retry once rather than debugging app code.
- **Check the dev server first** (`curl -s -o /dev/null -w '%{http_code}' <url>`) before capturing or dispatching capture subagents — a dead server yields `ERR_CONNECTION_REFUSED` and a batch of agent failures that prove nothing about the code. A dispatched child's background processes die with it: relaunch anything the child started, in the parent session.

## Server choice

- Prefer the live dev server that owns the routing (it resolves framework mappings like Vite `public/` → root). Temp `python3 -m http.server` on another port works for plain static trees but 404s framework-mapped paths — treat its 404s as suspect, never as deletion orders.
- Read from the user's dev server freely (plain GETs); never kill or reclaim an occupied user port. Run temp servers on other ports. A silent pinned port is different from an occupied one: if `curl` fails and no listener owns the port, start that project's own dev command on its pinned port, verify HTTP 200, and report the restart.

## Static SVG files

- `qlmanage -t` renders blank white PNGs for SVG files (identical byte sizes across outputs is the tell) — never use it to rasterize vector artifacts.
- Capture static SVGs with the one-shot flag against a `file://` URL and a `--window-size` matched to the SVG's own dimensions; unlike live pages, static files settle and the process exits cleanly:
```sh
"$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=1440,810 --screenshot="<out>.png" "file://<abs-path>/<screen>.svg"
```
- For frames taller than the viewport, size the window to the full height (e.g. `--window-size=545,4574`) or capture the visible slice knowingly — a viewport crop of a 4574px record proves nothing about the sections below it.

## Verification loop

1. Capture every panel, not just the first — identical file sizes across shots mean identical (likely broken) renders.
2. Inspect each shot (`vision_analyze`) for the expected rows: every variant present, no clipping, no error blocks, no duplicated labels.
3. Back every 'no clipping' claim with a number — `[...panel.querySelectorAll('*')].filter(n=>n.scrollWidth>n.clientWidth+2).length` must be 0; screenshots catch visible truncation, the scan catches 1-2px edge clips the eye forgives. Click/select the tab first: nodes in hidden panes measure 0x0 and fake a clean scan.
4. Fix markup/CSS from what the shot shows, re-capture, and only then present. The attached shots are the deliverable.

## Measure pixels, don't estimate them

Vision models misread coordinates — two passes over the same shot can disagree on whether a layer is docked or floating — so any claim about *where* something sits gets measured.

- `sips -s format bmp <shot>.png --out <shot>.bmp`, then parse with Python `struct`: pixel-data offset at byte 10, width/height at byte 18, bpp at 28, rows bottom-up unless the height is negative, row stride padded to 4 bytes. No PIL needed.
- Long horizontal runs of dark pixels locate borders and box edges; long vertical runs locate panel edges. That turns 'the drawer floats mid-stage' into exact left/right/height numbers to compare before and after.
- Measure the live DOM the same way — `getBoundingClientRect()` evals on stage vs layer (right gap, height, trigger centre) are the assertion; the screenshot is the illustration.

## On/off feature probes

When a screenshot looks identical with and without the fix (blur over flat fills, subtle motion), eyeballing proves nothing — diff pixels instead.

1. Settle the page into the state that should show the effect (scrolled so textured content sits under a blur trail, mid-morph for a color transition).
2. Capture A via `Page.captureScreenshot`.
3. Inject a disabling style through `Runtime.evaluate` (e.g. `.mount::before,.mount::after{display:none}`), wait a tick, capture B.
4. Compare with numpy: mean abs diff overall plus per-zone (bar / effect / below), then `where(diff > 10)` bounding box to name exactly which glyphs or region the effect touches.
- Validate the harness with a trivial control first (a plain-element blur over text must diff large) — otherwise the environment, not the code, is blind.
- A max diff in the noise range (≤3/255) with empty zones means the layer renders nothing: debug the layer's existence (zero size? mask killing it? nested `backdrop-filter` starving it?) before touching its strength.
- For masked/clipped overlays, mask the diff: compare ON vs OFF inside the mask (expect large change) and outside it (expect near zero), excluding animated HUD/chip repaints. Allow only the designed feather at the rim (about a pixel) before calling leakage a bug.

## Interaction captures

- Scroll the target into view before dispatching a click (`el.scrollIntoView({block:'center'})`, then a tick): a synthetic click at off-viewport coordinates silently does nothing and the capture then shows the resting state.
- Capture motion inside the transition window: click, then eval + shot within ~90 ms to catch mid-travel (`getComputedStyle(layer).transform` reading e.g. `matrix(1, 0, 0, 1, 120, 0)` out of 384), and again after ~600 ms for the settled state. Before/after crops of the same region prove the animation instead of claiming it.
- Assert dismissal by state, not just the shot: closing class present, layer still unhidden mid-exit, then `hidden` with focus returned to the trigger.

## Stale renders: when the user's shot contradicts the files

The user's screenshot or recording can be a stale page rather than a bug in the code — triage that before debugging CSS.

- Check their dev server still answers (`curl -s -o /dev/null -w '%{http_code}' <url>`): a server that died mid-session leaves the tab rendering an old in-memory snapshot, mixing an old stylesheet with fresh markup.
- Look for text in their shot that no longer exists on disk (a caption you already rewrote) — that is proof of a stale render, and saying so plainly beats re-fixing code that already works.
- Fragments loaded with `fetch()` are cached even when the page carries no-cache headers: append `?v='+Date.now()` to partial/doc fetches in the shell so a panel can never render old markup against fresh CSS.