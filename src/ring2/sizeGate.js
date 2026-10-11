/* Safepipe Ops3D Ring-2 — src/ring2/sizeGate.js (Phase 4, Task: Safari-black).
 * MapLibre snapshots container size AT CONSTRUCTION: a map born into a
 * 0x0 box (hidden gallery iframe) can keep a zero canvas past every
 * resize() on real Safari. So construction is gated on a non-zero box —
 * wait/defer the mount until visible with size — and the remount ladder
 * stays as backup only.
 * Dependency-free (no maplibre, no DOM at import) so node tests can pin
 * the predicate.
 * [plan:2026-10-10_191500-ops3d-ring2-seamless-redo.md#phase-4]
 */

/** True when a (w, h) pair can host a live canvas. */
export function isSizedWH(w, h) {
  return (w | 0) > 0 && (h | 0) > 0;
}

/* Wait until getEl() reports a non-zero box. Resolves true when sized,
 * false on timeout. timeoutMs <= 0 waits unbounded (caller keeps its own
 * loop/status alive meanwhile). Never rejects. Poll-only on purpose: a
 * ResizeObserver held open across a display:none->block transition trips
 * WebKit's "loop completed with undelivered notifications" pageerror. */
export function waitForSized(getEl, { timeoutMs = 8000, pollMs = 120 } = {}) {
  return new Promise((resolve) => {
    const sizedNow = () => {
      try {
        const el = getEl?.();
        if (!el) return false;
        return isSizedWH(el.clientWidth | 0, el.clientHeight | 0);
      } catch {
        return false;
      }
    };
    if (sizedNow()) {
      resolve(true);
      return;
    }
    let done = false;
    let timer = 0;
    let to = 0;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      if (to) clearTimeout(to);
      resolve(v);
    };
    timer = setInterval(() => {
      if (sizedNow()) finish(true);
    }, pollMs);
    if (timeoutMs > 0) to = setTimeout(() => finish(sizedNow()), timeoutMs);
  });
}
