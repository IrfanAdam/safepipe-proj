// safepipe changelog — due publish progress toast (DOM) · [plan:2026-10-18_172008-supabase-scheduling-migration.md]
// ONE horizontal linear progression in a single card: Saved → Syncing →
// Synced ✓. Saving stays silent (the painted date IS the UI — the card
// stays parked) and there is no deploy slot: sync commits carry [skip ci],
// so there is nothing to await after the save.
// Hook point: the Supabase success path calls setDueProgressStep('committed')
// right after POST /api/schedule lands (changelog-events.js, untouched) —
// that starts the sync watch below, which polls
// GET /api/schedule?sync=<file> bounded ~30s until the sync_state row for
// our section_key reads ok (→ Synced) or error (→ Retry). Timeout also lands
// in Retry. Retry parks the card — paint-detail's existing inline Retry owns
// recovery (data-due-retry="commit" re-fires the pipeline), never a popup.
// Deliberately NOT a modal: it never traps pointer or keyboard
// (pointer-events:none) and never blocks the page. Keyed per pick so a
// rapid re-pick never dismisses newer state.
import { normHead, dueFailureReason } from '../logic/due-overrides.js';

const CARD_ID = 'ds-due-progress';
// Visible linear vocabulary — the toast's only progression. Kept exported so
// tests can pin it: three steps in one horizontal track, never stacked slots.
export const DUE_PROGRESS_SYNC_STEPS = ['saved', 'syncing', 'synced'];
// Back-compat vocabulary (Supabase migration: deploy slot dropped). The
// success path still signals via the legacy 'committed' call, which now
// starts the sync watch instead of revealing a second slot; 'deploying' is
// a no-op and 'live' settles straight to Synced (dev-local path + deploy
// healing). Kept exported so legacy readers/tests don't crash.
export const DUE_PROGRESS_COMMIT_STEPS = ['publishing', 'committed'];
export const DUE_PROGRESS_DEPLOY_STEPS = ['deploying', 'live'];
// Back-compat union (ordered by lifecycle) for any legacy readers.
export const DUE_PROGRESS_STEPS = [...DUE_PROGRESS_COMMIT_STEPS, ...DUE_PROGRESS_DEPLOY_STEPS];
// Every step the card accepts, including the silent/parked control states:
// `saving` is silent (card parked), `retry` parks the card on failure.
const KNOWN_STEPS = { saving: true, saved: true, syncing: true, synced: true, retry: true,
  publishing: true, committed: true, deploying: true, live: true };
// Stage order along the track; the active stage shows a spinner, landed
// stages show dots, upcoming stages sit dimmed. A connector joins the steps.
const TRACK = ['saved', 'syncing', 'synced'];
const TRACK_LABELS = { saved: 'Saved', syncing: 'Syncing', synced: 'Synced' };

// Sync-watch registry: sectionKey-scoped settle state shared with
// paint-detail (which renders the inline Retry from it). Keyed by file::head
// so a neighboring section never reads another section's verdict; each entry
// also carries its pick's due so a newer pick for the same section can't
// inherit a stale verdict. Entries expire (prune on access).
const SYNC_TTL_MS = 10 * 60 * 1000;
const syncRegs = new Map();
const syncSeqs = new Map();
// Active-watch index keyed by file + section_key (the same key background
// heal reconciliation uses): lets a silent heal skip a section the toast's
// watch is already polling, so a heal never double-fires a live watch.
// Added in startSyncWatch, removed when the poll settles or bails — never
// read for UI, never painted.
const syncActive = new Set();
const syncActiveKey = (file, sectionKey) => `${String(file)}::${String(sectionKey)}`;
export function isSyncWatchActive(file, sectionKey) {
  try { return syncActive.has(syncActiveKey(file, sectionKey)); } catch { return false; }
}
const syncKeyOf = (detail) => {
  const f = detail && detail.file != null ? String(detail.file) : '';
  const h = detail && detail.head != null ? String(detail.head) : '';
  return `${f}::${h}`;
};
const pruneSyncRegs = () => {
  try {
    const now = Date.now();
    for (const [k, v] of syncRegs) {
      if (!v || !Number.isFinite(v.at) || now - v.at > SYNC_TTL_MS) syncRegs.delete(k);
    }
  } catch {}
};
// paint-detail consults this when it renders a saved/cleared section: an
// 'error' entry means the sync worker failed after the save landed, so the
// inline Retry (terse cause) takes over. Anything else → null (quiet).
export function dueSyncStatus(detail) {
  try {
    pruneSyncRegs();
    const v = syncRegs.get(syncKeyOf(detail));
    if (!v) return null;
    return { state: v.state, due: v.due ?? null, cause: v.cause || null };
  } catch { return null; }
}
// A newer authoritative state (saving/failed/needs-login) owns recovery, so
// it supersedes any in-flight watch: the watch's late settle becomes a no-op
// (seq guard) and the stale entry is dropped.
export function clearDueSync(detail) {
  try {
    const k = syncKeyOf(detail);
    syncRegs.delete(k);
    syncSeqs.set(k, (syncSeqs.get(k) || 0) + 1);
  } catch {}
}
// Single source for the inline Retry markup: paint-detail renders this when
// dueSyncStatus reports an error, and the watch patches it straight into an
// open detail on late settles (next doPaint regenerates the same string).
export function dueSyncRetryHTML(cause) {
  const c = String(cause || 'error').replace(/[<>&"']/g, (ch) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));
  return `<button class="ds-due-status is-err" data-due-retry="commit">couldn't sync (${c}) — tap to retry</button>`;
}

const doc = () => (typeof document !== 'undefined' ? document : null);

function cardEl() {
  const d = doc();
  return d ? d.getElementById(CARD_ID) : null;
}

function pickKey(detail) {
  const f = detail && detail.file ? String(detail.file) : '';
  const h = detail && detail.head ? String(detail.head) : '';
  const u = detail && detail.due != null ? String(detail.due) : 'none';
  return `${f}::${h}::${u}`;
}

function setNodeState(card, name, mode) {
  // mode: done (dot) | active (spinner) | todo (dimmed dot).
  try {
    const node = card.querySelector(`[data-prog-node-${name}]`);
    if (!node) return;
    try {
      node.classList.toggle('is-done', mode === 'done');
      node.classList.toggle('is-active', mode === 'active');
      node.classList.toggle('is-todo', mode === 'todo');
    } catch {}
    try {
      const spin = node.querySelector('[data-prog-spin]');
      if (spin) spin.hidden = mode !== 'active';
    } catch {}
    try {
      const dot = node.querySelector('[data-prog-dot]');
      if (dot) dot.hidden = mode === 'active';
    } catch {}
    try {
      const label = node.querySelector('[data-prog-label]');
      if (label) label.textContent = name === 'synced' && mode === 'done' ? 'Synced ✓' : TRACK_LABELS[name];
    } catch {}
  } catch {}
}

function setLinkState(card, name, done) {
  try {
    const link = card.querySelector(`[data-prog-link-${name}]`);
    if (!link) return;
    try { link.classList.toggle('is-done', !!done); } catch {}
  } catch {}
}

// Paint one linear stage: every step at or before it lands (dot), the stage
// itself spins when still working, everything after sits dimmed.
function paintTrack(card, stage) {
  const at = TRACK.indexOf(stage);
  const doneThrough = stage === 'synced' ? 2 : at;
  for (let i = 0; i < TRACK.length; i++) {
    const name = TRACK[i];
    setNodeState(card, name, i < doneThrough || (stage === 'synced') ? 'done' : (i === at ? 'active' : 'todo'));
  }
  setLinkState(card, 'saved', doneThrough >= 1 || stage === 'synced');
  setLinkState(card, 'syncing', stage === 'synced');
  try { card.dataset.progStage = stage; } catch {}
}

function buildNode(d, name) {
  const node = d.createElement('span');
  node.className = 'ds-due-progress__step';
  node.setAttribute(`data-prog-node-${name}`, '');
  const spin = d.createElement('span');
  spin.className = 'ds-due-spin';
  spin.setAttribute('data-prog-spin', '');
  spin.setAttribute('aria-hidden', 'true');
  const dot = d.createElement('span');
  dot.className = 'ds-due-dot';
  dot.setAttribute('data-prog-dot', '');
  dot.setAttribute('aria-hidden', 'true');
  const label = d.createElement('span');
  label.className = 'ds-due-progress__label';
  label.setAttribute('data-prog-label', '');
  label.textContent = TRACK_LABELS[name];
  node.appendChild(spin);
  node.appendChild(dot);
  node.appendChild(label);
  return node;
}

function buildLink(d, name) {
  const link = d.createElement('span');
  link.className = 'ds-due-progress__link';
  link.setAttribute(`data-prog-link-${name}`, '');
  link.setAttribute('aria-hidden', 'true');
  return link;
}

function parkCard(card, step) {
  // Silent/terminal states hide the card: saving (the painted date IS the
  // UI) and retry (paint-detail's inline Retry owns recovery).
  try { card.hidden = true; card.dataset.progStep = step; } catch {}
}

// Sync watch: after the Supabase write lands, poll the sync_state row for
// our section_key until it reads ok (Synced) or error (Retry), bounded ~30s.
// The fire-and-forget POST /api/sync-due sends { plan_file, section_key, token },
// and rows are readable via GET /api/schedule?sync=<file> — no token here,
// no auth handling (the 401-only login rule lives in changelog-events; this
// poll never touches the session).
const SYNC_POLL_BUDGET_MS = 30000;
const SYNC_POLL_TICK_MS = 3000;
const SYNC_FETCH_TIMEOUT_MS = 10000;
// Stale-verdict grace: an error row recorded just before this watch started
// (rapid re-pick after a failure) still belongs to the previous pick's story
// in wall-clock terms, but the new worker hasn't had time to overwrite it —
// treat rows fresher than this as the new verdict, older ones as stale.
// Server/client clocks both run UTC; 10s dwarfs real skew.
const SYNC_STALE_GRACE_MS = 10000;

function startSyncWatch(detail, opts) {
  if (!detail || !detail.file) return;
  // Canonical key first: the server resolves stale heads on write, so the
  // writer passes back r2's section_key — the watch must match the SAME key
  // or it never finds its row (bare 'error' on a landed sync). Falls back
  // to the pick-time head when the caller has no server answer.
  const sectionKey = (opts && typeof opts.sectionKey === 'string' && opts.sectionKey)
    ? opts.sectionKey
    : normHead(detail.head || '');
  const key = syncKeyOf(detail);
  const seq = (syncSeqs.get(key) || 0) + 1;
  syncSeqs.set(key, seq);
  try {
    syncRegs.set(key, { state: 'syncing', due: detail.due ?? null, cause: null, at: Date.now() });
  } catch {}
  try { syncActive.add(syncActiveKey(detail.file, sectionKey)); } catch {}
  try {
    const card = cardEl();
    if (card && card.dataset.progKey === pickKey(detail)) {
      paintTrack(card, 'syncing');
      setNodeState(card, 'saved', 'done');
      try { card.hidden = false; card.dataset.progStep = 'syncing'; } catch {}
    }
  } catch {}
  // Non-browser runtimes (node probes) paint only — no same-origin API, no
  // network. Browser-only work stays out of unit tests by construction.
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    try { syncActive.delete(syncActiveKey(detail.file, sectionKey)); } catch {}
    return;
  }
  pollDueSync(detail, key, seq, sectionKey);
}

function terseSyncCause(lastError) {
  // Sync-worker reasons pass through verbatim (github-write-403 names the
  // real failure); anything else compacts to dueFailureReason's bare error.
  // Full bodies go to console.error only.
  try {
    const s = String(lastError == null ? '' : lastError).trim();
    if (/^(github-(write|read)-(\d+|failed)|schedule-read-(\d+|failed)|sync-not-configured|row-not-found|head-not-found|unchanged|timeout|offline|http \d+)$/.test(s)) return s;
    return dueFailureReason({ reason: lastError });
  } catch { return 'error'; }
}

async function pollDueSync(detail, key, seq, sectionKey) {
  const file = String(detail.file);
  const matchKey = (typeof sectionKey === 'string' && sectionKey)
    ? sectionKey
    : normHead(detail.head || '');
  const wantDue = detail.due ?? null;
  const watchStart = Date.now();
  const url = `/api/schedule?sync=${encodeURIComponent(file)}`;
  const activeKey = syncActiveKey(file, matchKey);
  const deadline = Date.now() + SYNC_POLL_BUDGET_MS;
  let sawResponse = false;
  let sawNetworkError = false;
  let lastHttp = 0;
  try {
  for (;;) {
    try { if ((syncSeqs.get(key) || 0) !== seq) return; } catch { return; }
    try {
      const hasCtl = typeof AbortController !== 'undefined';
      const ctl = hasCtl ? new AbortController() : null;
      const t = ctl ? setTimeout(() => { try { ctl.abort(); } catch {} }, SYNC_FETCH_TIMEOUT_MS) : null;
      let r = null;
      try {
        r = await fetch(url, { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
      } finally { if (t) clearTimeout(t); }
      sawResponse = true;
      if (r && r.ok) {
        lastHttp = 0;
        const list = await r.json().catch(() => null);
        const row = Array.isArray(list) ? list.find((x) => x && x.section_key === matchKey) : null;
        if (row) {
          // Stale-verdict guard: a row left by an EARLIER pick must never
          // settle this watch. ok settles only when the synced value IS this
          // pick's due (an identical earlier value already converged reads
          // Synced truthfully); error settles only when recorded after this
          // watch started (a fresh verdict for this pick). Anything else
          // keeps polling for the worker's fresh row — never a false Synced
          // on a landed-then-changed section, never a stale retry that
          // preempts the in-flight sync.
          if (row.status === 'ok') {
            if ((row.last_synced_due ?? null) === wantDue) { settleSyncOk(detail, key, seq); return; }
          } else if (row.status === 'error') {
            const ts = Date.parse(row.updated_at);
            if (!Number.isFinite(ts) || ts > watchStart - SYNC_STALE_GRACE_MS) {
              settleSyncErr(detail, key, seq, terseSyncCause(row.last_error),
                `last_error=${row.last_error ?? null} attempts=${row.attempts ?? 0}`);
              return;
            }
          }
          // Row exists but unsettled (or stale) — the sync worker is still carrying it.
        }
      } else if (r) {
        lastHttp = r.status || 0;
        let body = '';
        try { body = await r.text(); } catch {}
        try { console.error('[due-sync] sync poll failed', r.status, String(body).slice(0, 300)); } catch {}
      }
    } catch {
      // Transient (offline / hung fetch): keep polling until the budget runs
      // out — the settle below names the cause.
      sawNetworkError = true;
    }
    try { if ((syncSeqs.get(key) || 0) !== seq) return; } catch { return; }
    if (Date.now() >= deadline) break;
    try { await new Promise((res) => setTimeout(res, SYNC_POLL_TICK_MS)); } catch { break; }
  }
  try { if ((syncSeqs.get(key) || 0) !== seq) return; } catch { return; }
  if (!sawResponse && sawNetworkError) settleSyncErr(detail, key, seq, 'offline', 'no poll response (offline)');
  else if (lastHttp) settleSyncErr(detail, key, seq, `http ${lastHttp}`, `sync poll http ${lastHttp}`);
  else settleSyncErr(detail, key, seq, 'timeout', 'sync unsettled after ~30s');
  } finally {
    // The watch is over (settled, superseded, or bailed) — background heals
    // may fire for this section again.
    try { syncActive.delete(activeKey); } catch {}
  }
}

function settleSyncOk(detail, key, seq) {
  try { if ((syncSeqs.get(key) || 0) !== seq) return; } catch { return; }
  try {
    syncRegs.set(key, { state: 'synced', due: detail.due ?? null, cause: null, at: Date.now() });
  } catch {}
  try {
    const card = cardEl();
    if (!card || card.dataset.progKey !== pickKey(detail)) return;
    paintTrack(card, 'synced');
    try { card.hidden = false; card.dataset.progStep = 'synced'; } catch {}
  } catch {}
  try { hideDueProgress(detail, 1800); } catch {}
}

function settleSyncErr(detail, key, seq, cause, info) {
  try { if ((syncSeqs.get(key) || 0) !== seq) return; } catch { return; }
  try {
    syncRegs.set(key, { state: 'error', due: detail.due ?? null, cause: cause || 'error', at: Date.now() });
  } catch {}
  try { console.error('[due-sync] sync failed', String(detail.file), String(detail.head), String(info || cause)); } catch {}
  // Into Retry: park the card and hand recovery to paint-detail's existing
  // inline Retry (data-due-retry="commit" re-fires the pipeline). Never a
  // popup — nothing here opens the login gate.
  try {
    const card = cardEl();
    if (card && card.dataset.progKey === pickKey(detail)) {
      try { paintTrack(card, 'syncing'); } catch {}
      parkCard(card, 'retry');
    }
  } catch {}
  // The save already repainted (markSaved's beat) — a slow worker settles
  // after the last paint, so patch the open detail's status straight into
  // the same Retry button the next repaint regenerates. Ownership is verified
  // from the row's stamped file/head plus the pick's due; anything else is
  // left for the next paint.
  try { patchInlineRetry(detail, cause || 'error'); } catch {}
}

function patchInlineRetry(detail, cause) {
  const d = doc();
  if (!d || typeof d.querySelectorAll !== 'function') return;
  const rows = d.querySelectorAll('[data-due-row]');
  if (!rows || !rows.length) return;
  const wantDue = detail.due ?? null;
  for (const row of rows) {
    try {
      const f = row.getAttribute ? row.getAttribute('data-due-file') : null;
      const h = row.getAttribute ? row.getAttribute('data-due-head') : null;
      if (f !== String(detail.file) || h !== String(detail.head || '')) continue;
      const open = row.querySelector ? row.querySelector('[data-due-open]') : null;
      const openDue = open && open.getAttribute ? open.getAttribute('data-due') : null;
      if ((openDue || '') !== (wantDue == null ? '' : String(wantDue))) continue;
      const slot = row.querySelector ? row.querySelector('[data-due-status]') : null;
      if (!slot || (slot.getAttribute && slot.getAttribute('data-due-retry'))) continue;
      slot.outerHTML = dueSyncRetryHTML(cause);
    } catch {}
  }
}

export function showDueProgress(detail, opts) {
  const d = doc();
  if (!d || !d.body) return null;
  const silent = !!(opts && opts.silent);
  let card = cardEl();
  if (!card) {
    card = d.createElement('div');
    card.id = CARD_ID;
    card.className = 'ds-due-progress';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    const track = d.createElement('div');
    track.className = 'ds-due-progress__track';
    track.appendChild(buildNode(d, 'saved'));
    track.appendChild(buildLink(d, 'saved'));
    track.appendChild(buildNode(d, 'syncing'));
    track.appendChild(buildLink(d, 'syncing'));
    track.appendChild(buildNode(d, 'synced'));
    try { track.hidden = false; } catch {}
    card.appendChild(track);
    try { d.body.appendChild(card); } catch { return null; }
  }
  try {
    card.dataset.progKey = pickKey(detail);
    // Instant by design: the track reveals the moment the pick fires, Saved
    // spinning as "Saving…" — the painted date IS the UI, the toast is its
    // lifecycle. (The silent flag is kept for API compat only.)
    paintTrack(card, 'saved');
    setNodeState(card, 'saved', 'active');
    try {
      const node = card.querySelector('[data-prog-node-saved]');
      const lbl = node && node.querySelector ? node.querySelector('[data-prog-label]') : null;
      if (lbl) lbl.textContent = 'Saving…';
    } catch {}
    try { card.hidden = false; card.dataset.progStep = 'saving'; card.dataset.progStage = 'saving'; } catch {}
  } catch {}
  return card;
}

export function setDueProgressStep(detail, step, opts) {
  try {
    const card = cardEl();
    if (!card) return;
    if (card.dataset.progKey !== pickKey(detail)) return;
    if (!KNOWN_STEPS[step]) return;
    // Supabase is the source of truth: the write landed, the save is final.
    // Git sync continues silently in the background (fire-and-forget POST in
    // changelog-events) and never surfaces in the UI — no Syncing state, no
    // retry, no error. The full track lands done and dismisses.
    if (step === 'committed') {
      paintTrack(card, 'synced');
      try { card.hidden = false; card.dataset.progStep = 'synced'; } catch {}
      try { hideDueProgress(detail, 1200); } catch {}
      return;
    }
    // Deploy narrative dropped: sync commits carry [skip ci], so there is
    // nothing to await. A live deploy flip never drives the toast.
    if (step === 'deploying') return;
    if (step === 'publishing') { parkCard(card, 'saving'); return; }
    // A parked card stays parked — except the confirm steps may still reveal
    // (the save landing, or the dev-local write completing). Anything else,
    // including a duplicate settle after dismissal, is ignored so a stale
    // step never resurrects a dismissed card.
    const stage = card.dataset.progStage;
    if (card.hidden && stage !== 'saving' && stage !== 'syncing' && step !== 'saved' && step !== 'live') return;
    if (step === 'saving' || step === 'retry') { parkCard(card, step); return; }
    if (step === 'saved') {
      paintTrack(card, 'saved');
      setNodeState(card, 'saved', 'done');
      try { card.hidden = false; card.dataset.progStep = step; } catch {}
      return;
    }
    if (step === 'syncing') {
      paintTrack(card, 'syncing');
      setNodeState(card, 'saved', 'done');
      try { card.hidden = false; card.dataset.progStep = step; } catch {}
      return;
    }
    if (step === 'synced' || step === 'live') {
      // Dev-local write (and legacy deploy healing) land here: no sync to
      // await, so the whole track lands done at once and dismisses.
      paintTrack(card, 'synced');
      try { card.hidden = false; card.dataset.progStep = 'synced'; } catch {}
      return;
    }
  } catch {}
}

export function hideDueProgress(detail, afterMs) {
  const key = pickKey(detail);
  const wait = Math.max(0, Number(afterMs) || 0);
  const hide = () => {
    try {
      const card = cardEl();
      if (!card) return;
      if (card.dataset.progKey !== key) return;
      card.hidden = true;
    } catch {}
  };
  if (!wait) { hide(); return; }
  try { setTimeout(hide, wait); } catch { hide(); }
}
