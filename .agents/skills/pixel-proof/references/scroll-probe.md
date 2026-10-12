# Headless scroll-frame probe

Continuous frame-timing measurement for scroll-linked motion — the complement to `headless-shots.md` (which proves single frames). Run after any chase/ticker/reveal change before claiming smooth.

## Harness

`scripts/scroll-probe.mjs` (Playwright Chromium, must run from inside the repo dir so `playwright` resolves — ESM ignores `NODE_PATH`):

```sh
node scripts/scroll-probe.mjs <url> <waitSel> <xformSel> [--click <sel>]... [--snap <sel>] [--reload]
```

- `<waitSel>` view-specific selector proving the target view mounted (a class only that view sets).
- `<xformSel>` elements carrying the animated inline transforms (asserted `NaN`-free).
- `--click` selectors are clicked in order when present: gate dismissals, view tabs. Repeat as needed.
- `--snap` selector whose per-element `dataset` is snapshotted; with `--reload` the page reloads, re-runs clicks, and reports `snapMatch` (cold vs warm determinism).
- Output JSON `{stats: {frames, p50, p95, max, longtasks, transforms}, snapMatch, errors}`; exits non-zero with `PROBE-FAIL` on `NaN` transforms or any pageerror/console error.

## Server

Serve the built bundle on a temp port, never the user's dev port: `vite preview --port 5199 --host 127.0.0.1 --strictPort` in background, `curl -s -o /dev/null -w "%{http_code}"` for readiness, kill plus a second curl proving connection-refused when done.

## Interpretation

- Clean 60fps headless reads ~`p50 16.7 / p95 16.8`, single `max` ≤33, `longtasks: []`, `errors: []` over 200+ sampled frames spanning slow wheel scroll plus full-height flicks.
- `p95` at 2× frame time with entries in `longtasks` means main-thread work (decode, probe canvases, buffer allocs) is landing mid-scroll — time-slice it or move it off the scroll path, don't tune the easing.
- `snapMatch: false` across reload means geometry or timing still depends on load order (measured heights, random stagger, un-cached decode) — fix the source, not the snapshot.

## Pitfalls

- Drive to the target view explicitly (click its tab) and wait on a view-specific class — the default route may render a different view and `waitForSelector` on a shared id passes while measuring the wrong surface.
- Dismiss first-visit gates before interacting, and re-dismiss after reload — gates keyed on a fresh gesture reappear on every load and intercept pointer events, so the run times out on an overlay instead of failing the assertion.
- Headless rAF still ticks, but its clock is indicative: it catches longtasks, errors, and non-determinism reliably, while real-device feel (momentum curves, thermal throttle) needs the user's engine. Report both, claim only what each proves.
