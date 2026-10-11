/* Safepipe Ops3D Ring-2 — src/ring2/ctxmon.js (Phase 4, Safari context-loss).
 * Shared GL-context + tile telemetry registry. Dependency-free (no
 * maplibre, no three, no DOM at import) so node tests can pin the token
 * format. One instance is created in main.js and handed to mapbase (map
 * canvas) and the twin wiring (twin canvas).
 *
 * The six status-bar tokens (one real-Safari screenshot discriminates
 * every hypothesis in the defect-hunt report):
 *   px:<cw>x<ch>/c:<ew>x<eh>/dpr:<n>/pr:<r>  canvas backing vs container
 *     CSS vs devicePixelRatio vs map.getPixelRatio(). pr:0 proves the
 *     ratio-0 brick (resize through a lost context locks _maxCanvasSize
 *     to [0,0]; no resize can undo it — the instance must be remounted).
 *   ctx:<live>L:<lost>/R:<restored>  live GL context counter (up on
 *     mount, down on remove/dispose/loss). Rising across screenshots
 *     proves remount churn is exhausting the GPU.
 *   cxl:<map|twin>:<lost|restored>@<ms>  last context event per canvas
 *     with a performance.now()/Date.now() stamp. lost with no restored
 *     + black viewport = loss never escalated; followed by px:0x0 = brick.
 *   tile:<err>/<ok>:<lasthost>  cumulative tile error/success counters
 *     with the failing host suffix. Counts up with photo present =
 *     flaky-host noise; errors then cxl = GPU pressure, not network.
 *   ld:<0|1>/terr:<off|vex|mis>  map.loaded() plus terrain state (off /
 *     on-at-VEX / exaggeration-mismatch). terr:off + frozen view =
 *     sync-freeze family; ld:0 persistent with tile:0/0 = worker/style
 *     hung, not tiles.
 *   eff:<n>  effective mix next to stored mix:<n> (exposes the failMap
 *     floor lie when they differ).
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
 */

/** Fresh registry. nowFn injectable for deterministic tests. */
export function createCtxMon(nowFn = () => Date.now()) {
  return {
    live: 0, // live GL contexts (map mounts + twin; down on remove/dispose/loss)
    lost: 0, // cumulative context-lost events (map + twin)
    restored: 0, // cumulative context-restored events
    mapLostAt: 0,
    mapRestoredAt: 0,
    twinLostAt: 0,
    twinRestoredAt: 0,
    // Instance generation: every adoptMap bumps mapGen; a loss stamps the
    // generation it belongs to. A remount must clear another instance's
    // pending loss — otherwise CTXLOST (and the 5 s lost-escalation) sticks
    // to a healthy replacement forever.
    mapGen: 0,
    mapLostGen: -1,
    tileErr: 0,
    tileOk: 0,
    lastHost: '-',
    _now: nowFn,
  };
}

/** Adjust the live-context counter; never below zero. Returns the new value. */
export function ctxLive(mon, d) {
  mon.live = Math.max(0, (mon.live | 0) + (d | 0));
  return mon.live;
}

/** Record a context-lost event for 'map' or 'twin'. Returns the stamp. */
export function ctxLost(mon, which) {
  const at = mon._now();
  mon.lost += 1;
  if (which === 'twin') mon.twinLostAt = at;
  else {
    mon.mapLostAt = at;
    mon.mapLostGen = mon.mapGen;
  }
  return at;
}

/** Record a context-restored event for 'map' or 'twin'. Returns the stamp. */
export function ctxRestored(mon, which) {
  const at = mon._now();
  mon.restored += 1;
  if (which === 'twin') mon.twinRestoredAt = at;
  else mon.mapRestoredAt = at;
  return at;
}

/** True while the CURRENT map instance is lost without a later restore.
 * A remount adopts a new generation, clearing an older instance's pending
 * loss (the replacement is healthy even when the dead canvas never fires
 * restore — SwiftShader included). */
export function mapLostPending(mon) {
  return mon.mapLostAt > 0 && mon.mapRestoredAt < mon.mapLostAt && mon.mapLostGen === mon.mapGen;
}

/** Adopt a (re)mounted map instance: new generation, pending loss cleared. */
export function noteMapAdopted(mon) {
  mon.mapGen += 1;
  return mon.mapGen;
}

/* Hostname out of a tile URL or an error message embedding one.
 * Returns the bare hostname (no port/path), or '-' when none found. */
export function hostSuffix(input) {
  const s = String(input ?? '');
  const m = s.match(/https?:\/\/([^/:?\s#]+)/i);
  if (!m) return '-';
  return m[1].toLowerCase();
}

/** Record a tile/source error; keeps the failing host suffix. */
export function noteTileErr(mon, msgOrUrl) {
  mon.tileErr += 1;
  const h = hostSuffix(msgOrUrl);
  if (h !== '-') mon.lastHost = h;
  return mon.tileErr;
}

/** Record a successfully loaded tile. */
export function noteTileOk(mon) {
  mon.tileOk += 1;
  return mon.tileOk;
}

/* Single-shot GL teardown for a condemned canvas: exactly ONE getContext
 * call, so teardown never burns a second context on small-GPU browsers
 * (reuse-or-clean discipline — free the old context BEFORE constructing
 * the replacement, skip entirely when already lost). */
export function killGL(canvas, alreadyLost = false) {
  if (alreadyLost) return;
  try {
    const gl = canvas?.getContext?.('webgl2') || canvas?.getContext?.('webgl');
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  } catch {
    /* already lost or headless — remove() below still runs */
  }
}

/* Token builders — pure, pinned by tests. Numbers are ints; hosts raw. */
export function pxToken({ cw = 0, ch = 0, ew = 0, eh = 0, dpr = 1, pr = null } = {}) {
  const prS = pr === null || pr === undefined || Number.isNaN(pr) ? '-' : String(pr);
  return `px:${cw | 0}x${ch | 0}/c:${ew | 0}x${eh | 0}/dpr:${dpr}/pr:${prS}`;
}

export function ctxToken(mon) {
  return `ctx:${mon.live | 0}L:${mon.lost | 0}/R:${mon.restored | 0}`;
}

/* Most recent context event across both canvases, or cxl:- when none. */
export function cxlToken(mon) {
  const ev = [
    ['map', 'lost', mon.mapLostAt],
    ['map', 'restored', mon.mapRestoredAt],
    ['twin', 'lost', mon.twinLostAt],
    ['twin', 'restored', mon.twinRestoredAt],
  ];
  let best = null;
  for (const e of ev) {
    if (e[2] > 0 && (!best || e[2] >= best[2])) best = e;
  }
  if (!best) return 'cxl:-';
  return `cxl:${best[0]}:${best[1]}@${best[2] | 0}`;
}

export function tileToken(mon) {
  return `tile:${mon.tileErr | 0}/${mon.tileOk | 0}:${mon.lastHost}`;
}

/* loaded: map.loaded() boolean; terrain: 'off' | 'vex' | 'mis'. */
export function ldTerrToken({ loaded = false, terrain = 'off' } = {}) {
  const t = terrain === 'vex' || terrain === 'mis' ? terrain : 'off';
  return `ld:${loaded ? 1 : 0}/terr:${t}`;
}

export function effToken(eff) {
  return `eff:${eff | 0}`;
}

/* Compact decode for the status title tooltip: one line per token so an
 * owner hovering the bar (or reading the legend in a report) maps tokens
 * to hypotheses without the hunt doc open. */
export const CTX_DECODE =
  'px canvas/c container/dpr device/pr map-ratio (pr:0 = ratio-0 brick, remount only) · ' +
  'ctx live L lost R restored (rising live = context churn) · ' +
  'cxl last ctx event (lost w/o restored = P2; then 0x0 = P1) · ' +
  'tile err/ok:host (counts w/ photo = host noise; then cxl = GPU pressure) · ' +
  'ld loaded/terr terrain off|vex|mis · ' +
  'eff effective mix (differs from mix: = failMap floor)';
