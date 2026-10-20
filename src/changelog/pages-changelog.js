// safepipe changelog — pages composer · glob + state · [plan:2026-10-07_130000-safepipe-changelog.md#task-3]
// Exports: render, mount — eager glob + hits contract preserved (events live in changelog-events.js)
import { hits } from './changelog-links.js';
import { commits } from './changelog-links.js';
import { TAGS, tagsFor, planTags, parseExplicit } from './changelog-tags.js';
import { h1Of, planSentence } from './changelog-titles.js';

import names from '../ds/changelog-names.json';
import history from '../ds/plan-history.json';
import { goal, split, parseMeta, anchorOf, phash, dueOf } from './changelog-parse.js';
import { paint } from './changelog-paint.js';
import { planSealed } from './changelog/raw-detail.js';
import { duePreviewEdit } from './changelog-events.js';
import { loadDueOverrides, dropDueOverride, overrideVerdict, normHead, canonicalHead, readDueConfirm, clearDueConfirm, dueFetchVerdict, findHeadIndex, readDuePending, clearDuePending, dueDeployVerdict } from '../logic/due-overrides.js';
import { getSchedToken } from '../logic/schedule-auth.js';
import { TIMELINE_TILE_ICON } from './changelog/graph.js';
import { bindChangelogEvents } from './changelog-events.js';
import { setDueProgressStep, hideDueProgress } from './due-progress.js';
import { fetchSchedules, subscribeSchedules } from './supabase-schedule.js';

// Mobile drawer level (2-level nav; CSS teammate owns the visuals — JS only
// sets dataset/classes/HTML): L1 = rail list only, L2 = detail. Desktop
// ignores it entirely.
export const isMobile = () => {
  try { return typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches; }
  catch { return false; }
};

// Plan-iteration revisions: versions append (tracker hook + backfill), oldest first.
const revOf = (file) => {
  const vs = history[file] || [];
  return vs.length > 1 ? { n: vs.length, last: vs[vs.length - 1].date } : null;
};
const sectionEdited = (file, s) => {
  const vs = history[file] || [];
  if (vs.length < 2) return false;
  const cur = phash(s.head + '\n' + s.body);
  const olds = vs.slice(0, -1).flatMap((v) => v.sections.filter((x) => x.head === s.head.slice(0, 80)).map((x) => x.hash));
  if (!olds.length) return true; // head never seen before = added or renamed
  return olds.some((h) => h !== cur);
};

const bootRaws = import.meta.glob('../../.hermes/plans/*.md', { query: '?raw', import: 'default', eager: true });
const bootEntries = Object.entries(bootRaws).sort(([a], [b]) => b.localeCompare(a));
// File list for live refresh; the eager glob stays the instant boot content. [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
const planFiles = bootEntries.map(([p]) => p.split('/').pop());
let rawTexts = Object.fromEntries(bootEntries.map(([p, md]) => [p.split('/').pop(), md]));
const HIDDEN = /<!--\s*(?:changelog|builds):\s*hide\s*-->/;
let plans = [];
let texts = {};
let counts = [];
// Rebuild plans/texts/counts from a filename→markdown map (boot + live).
function rebuildPlans(next) {
  rawTexts = { ...next };
  const entries = Object.entries(rawTexts).sort(([a], [b]) => b.localeCompare(a));
  plans = entries.map(([p, md]) => {
  const file = p.split('/').pop();
  const { date, id, slug } = parseMeta(file);
  const h1 = h1Of(md), g = goal(md), nm = names[file] || {};
  const sprints = split(md), steer = parseExplicit(md.split(/^## /m)[0]);
  sprints.forEach((s) => { s.tags = tagsFor(s.head, s.body, steer); });
  return { file,
    date,
    id,
    slug,
    h1,
    title: nm.title || planSentence({ h1, goal: g, slug }),
    purpose: nm.purpose || '',
    goal: g,
    sprints,
    tags: planTags(md, sprints),
    raw: md };
  }).filter((pl) => pl.sprints.length && !HIDDEN.test(pl.raw));
  applyDueOverrides();
  // Augment texts with anchor tokens so boundary-aware matching sees section
  // numbers even when the raw markdown never spells the anchor literally.
  texts = { ...rawTexts };
  plans.forEach((p) => { p.sprints.forEach((s) => { const a = anchorOf(s.head); if (a) texts[p.file] += `\n{#${a}}`; }); });
  counts = TAGS.map((t) => [t, plans.filter((p) => p.tags.includes(t)).length]).filter(([, n]) => n);
}
// Re-apply same-device due overrides (production has no file writer): stored
// picks fill sections the FILE leaves dateless; a file-carried Due always
// wins, so hand edits and dev writes are never clobbered — stale entries drop.
// Verdicts come from overrideVerdict (src/logic/due-overrides.js): converged
// entries drop, fresh picks (optimistic or server-confirmed) paint while the
// file has not converged, and everything expires — a stale clear can never
// strip a Due committed after it.
// Factored per rebuild so live text swaps keep the same merge. [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
// Live Supabase overlay state: Map keyed plan_file\0section_key (same key as
// fetchSchedules in supabase-schedule.js) holding { due, atMs }. Swapped on
// every foreground refetch / Realtime push; painted in applyDueOverrides.
// [plan:2026-10-18_172008-supabase-scheduling-migration.md#task-8]
let supaDues = new Map();
let supaUnsub = null;
let supaInFlight = false;
function applyDueOverrides() {
  try {
    const now = Date.now();
    // Fresh same-device paints, keyed file\0normHead(head) for the Supabase
    // last-wins check below (a newer local pick shadows an older row).
    const painted = new Map();
    for (const o of loadDueOverrides()) {
      const plan = plans.find((p) => p.file === o.file);
      const sec = plan ? plan.sprints.find((s) => s.head === o.head) : null;
      if (!sec) { dropDueOverride(o.file, o.head); continue; }
      const current = dueOf(sec);
      const verdict = overrideVerdict(o, current, now);
      if (verdict === 'drop') { dropDueOverride(o.file, o.head); continue; }
      try {
        const at = Number.isFinite(o.at) ? o.at : 0;
        painted.set(o.file + '\0' + normHead(o.head), at);
      } catch {}
      sec.body = duePreviewEdit(sec.body, sec.head, verdict === 'apply' ? o.due : null);
    }
    // Live Supabase overlay: server-confirmed dues paint over file text until
    // the file converges, then the entry drops — same drop rule as above
    // (overrideVerdict on a synthesized fresh confirmed pick), so Supabase
    // truth outranks file and optimistic entries, and convergence heals.
    // [plan:2026-10-18_172008-supabase-scheduling-migration.md#task-8]
    if (supaDues.size) {
      for (const [key, row] of supaDues) {
        const cut = key.indexOf('\0');
        if (cut < 0) { try { supaDues.delete(key); } catch {} continue; }
        const file = key.slice(0, cut), skey = key.slice(cut + 1);
        const plan = plans.find((p) => p.file === file);
        const sec = plan ? plan.sprints.find((s) => {
          try { return normHead(s.head) === skey; } catch { return false; }
        }) : null;
        if (!sec) { try { supaDues.delete(key); } catch {} continue; }
        let current = null;
        try { current = dueOf(sec); } catch { current = null; }
        const atMs = row && Number.isFinite(row.atMs) ? row.atMs : 0;
        const synth = { file, head: sec.head, due: row ? row.due || null : null, committed: true, at: atMs || now };
        let verdict = 'drop';
        try { verdict = overrideVerdict(synth, current, now); } catch { verdict = 'drop'; }
        if (verdict === 'drop') { try { supaDues.delete(key); } catch {} continue; }
        try {
          const lat = painted.get(key);
          if (lat != null && lat >= atMs) continue;
        } catch {}
        sec.body = duePreviewEdit(sec.body, sec.head, verdict === 'apply' ? (row ? row.due || null : null) : null);
      }
    }
  } catch {}
}
rebuildPlans(rawTexts);
// Live plan refresh: re-fetch hosted markdown and rebuild on change, then
// repaint with selection/filter untouched (no reload).
// [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
let liveRefreshInFlight = false;
// Background repaints rebuild the detail shell, which would slam an open
// datepicker shut mid-pick. Snapshot an open picker across the repaint and
// transplant its month grid back (same DOM-delegated handlers, no focus
// steal) so sync/commit paints never disturb it.
function snapshotDuePop(root) {
  try {
    const p = root.querySelector('[data-due-pop]:not([hidden])');
    if (!p) return null;
    return { html: p.innerHTML };
  } catch { return null; }
}
function restoreDuePop(root, snap) {
  if (!snap) return;
  try {
    const p = root.querySelector('[data-due-pop]');
    if (p) { p.innerHTML = snap.html; p.hidden = false; }
  } catch {}
}
function paintPreservingPicker(root) {
  const snap = snapshotDuePop(root);
  doPaint(root);
  restoreDuePop(root, snap);
}
export async function refreshLivePlans(root) {
  if (!root || liveRefreshInFlight) return false;
  let src = null;
  try { src = await import('./plan-source.js'); } catch { return false; }
  if (!src || typeof src.fetchLiveTexts !== 'function') return false;
  liveRefreshInFlight = true;
  try {
    let live = null;
    try { live = await src.fetchLiveTexts(planFiles, {}); } catch { live = null; }
    if (!live) return false;
    const changed = typeof src.changedTexts === 'function' ? src.changedTexts(rawTexts, live) : {};
    const keys = Object.keys(changed);
    if (!keys.length) return false;
    // Post-commit fetch guard: a lagged sync fetch (CDN pre-commit bytes)
    // must not regress a just-published date to its previous value. While
    // our confirm claim is fresh, hold the current paint for files whose
    // fetched text predates the commit; clear the claim once file truth
    // carries our value.
    try {
      const rec = readDueConfirm();
      if (rec) {
        let settled = false;
        for (const k of keys) {
          if (k !== rec.file) continue;
          let curDue = null;
          let found = false;
          try {
            const secs = split(changed[k]);
            const heads = secs.map((s) => s.head);
            const ix = findHeadIndex(heads, rec.head);
            if (ix >= 0 && ix < secs.length) { curDue = dueOf(secs[ix]) || null; found = true; }
          } catch { found = false; }
          const v = dueFetchVerdict(rec, k, found ? curDue : undefined, Date.now());
          if (v === 'skip') { delete changed[k]; }
          else if (v === 'confirmed' || v === 'superseded') { settled = true; }
        }
        if (settled) { try { clearDueConfirm(); } catch {} }
        if (!Object.keys(changed).length) return false;
      }
    } catch {}
    const merged = { ...rawTexts };
    for (const k of Object.keys(changed)) merged[k] = changed[k];
    rebuildPlans(merged);
    paintPreservingPicker(root);
    return true;
  } catch { return false; }
  finally { liveRefreshInFlight = false; }
}
// Apply server-returned file content directly (own-pick commit response):
// swaps one file's live text, rebuilds, repaints with selection/filter/sort
// untouched. Returns true on success, false on bad args/unknown file.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
// Re-apply stored overrides to the in-memory plans and repaint (no fetch).
// The commit success path saves its confirmed override before swapping in
// the server text, so the rebuild confirms it immediately and the painted
// date equals the pick at the "published" moment, never stale.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-2]
export function reapplyDueOverrides(root) {
  if (!root) return false;
  try {
    applyDueOverrides();
    paintPreservingPicker(root);
    return true;
  } catch { return false; }
}
export function applyServerFileText(root, file, text) {
  if (!root || typeof file !== 'string' || !file || typeof text !== 'string') return false;
  try {
    if (!Object.prototype.hasOwnProperty.call(rawTexts, file)) return false;
    const merged = { ...rawTexts, [file]: text };
    rebuildPlans(merged);
    paintPreservingPicker(root);
    return true;
  } catch { return false; }
}
// Supabase foreground refresh: fetch live dues, swap the overlay, rebuild +
// repaint with selection/filters/datepicker intact (st untouched,
// paintPreservingPicker transplants an open picker). Null (unconfigured /
// offline / denied) keeps the current overlay — the sha-poll below stays the
// Realtime-off fallback. Never throws.
// [plan:2026-10-18_172008-supabase-scheduling-migration.md#task-9]
export async function refreshSupaOverlay(root) {
  if (!root || supaInFlight) return false;
  supaInFlight = true;
  try {
    let map = null;
    try { map = await fetchSchedules(); } catch { map = null; }
    if (!map) return false;
    const next = new Map();
    try {
      for (const [k, r] of map) {
        if (typeof k !== 'string' || !k || !r || typeof r !== 'object') continue;
        const due = typeof r.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : null;
        let atMs = 0;
        try { const t = Date.parse(r.updated_at); if (Number.isFinite(t)) atMs = t; } catch {}
        next.set(k, { due, atMs });
      }
    } catch {}
    supaDues = next;
    try { rebuildPlans(rawTexts); } catch {}
    try { paintPreservingPicker(root); } catch {}
    return true;
  } catch { return false; }
  finally { supaInFlight = false; }
}
// Polling + focus refresh, active only while the changelog root is mounted.
// The 20s full re-fetch is gone: a ~15s sha poll (commits API, no CDN lag)
// gates full fetches — raw fetch runs ONLY when the sha changed.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
let liveTimer = 0;
let liveFocusTimer = 0;
let liveRoot = null;
let lastSeenPlanSha = null;
// The newest sha a fetch has CONFIRMED (diff applied). A newer
// lastSeenPlanSha with no diff yet is CDN lag — keep a slow watch until
// some fetch confirms it instead of going quiet (mobile stalls forever
// otherwise: quiet until the NEXT commit, fixed only by a refresh).
let lastAppliedPlanSha = null;
let lastShaSlowAt = 0;
const SHA_SLOW_MS = 60000;
let lastPlanEtag = null;
let etagPolling = true;
let livePollMs = 15000;
let shaRetryArmed = false;
let shaRetries = 0;
// Quick follow-ups after a new sha with no diff yet (CDN lag). Past this,
// the slow watch (SHA_SLOW_MS) keeps confirming until a fetch lands the
// diff — the poll never goes quiet on an unconfirmed sha.
const SHA_RETRY_MAX = 2;
// Deploy self-update: the open page must never sit on a stale bundle. The
// boot deploy sha is recorded once; every poll compares the live
// /version.json — on mismatch the page reloads itself onto the new deploy
// (guards: once per sha, never mid-pick, never within 2min of our own
// commit whose deploy is still building). Content sync then converges.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
let bootDeploySha = null;
let deployCheckArmed = true;
async function pollAppVersion() {
  if (!deployCheckArmed) return;
  try {
    if (typeof fetch !== 'function' || typeof location === 'undefined') return;
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (!r || !r.ok) return;
    const v = await r.json();
    const sha = v && typeof v.sha === 'string' ? v.sha : null;
    if (!sha) return;
    if (bootDeploySha === null) { bootDeploySha = sha; return; }
    if (sha === bootDeploySha) {
      // No new deploy — but a stale deploy claim still needs healing: if
      // the redeploy never showed, dismiss the parked card deterministically
      // instead of leaving the toast up forever.
      try {
        const pend = readDuePending();
        if (pend && dueDeployVerdict(pend, Date.now()) === 'expired') {
          const key = { file: pend.file, head: pend.head, due: pend.due };
          try { hideDueProgress(key, 0); } catch {}
          try { clearDuePending(); } catch {}
        }
      } catch {}
      return;
    }
    // New deploy is live. Heal the update lifecycle first (any view): a
    // fresh deploy claim earns 'Live ✓' and dismisses the parked card.
    try {
      const pend = readDuePending();
      if (pend && dueDeployVerdict(pend, Date.now()) === 'pending') {
        const key = { file: pend.file, head: pend.head, due: pend.due };
        try { setDueProgressStep(key, 'live'); } catch {}
        try { hideDueProgress(key, 1800); } catch {}
      }
      try { clearDuePending(); } catch {}
    } catch {}
    // New deploy is live. Never yank an open drawer/detail — reload only
    // from the neutral timeline view. (A reload from detail reads as the
    // drawer slamming shut onto a dim scrim.)
    try { if (st.open || (st.view || 'timeline') !== 'timeline') return; } catch {}
    // New deploy is live. Guards before self-reload:
    try {
      const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
      if (ss && ss.getItem('safepipe-reloaded-for') === sha) { bootDeploySha = sha; return; }
    } catch {}
    try {
      // Mid-pick on this device: the datepicker popover is OPEN — wait.
      // (The popover shell exists in the DOM whenever detail paints, so the
      // guard must test openness, not presence — a presence test blocks every
      // self-update once an incomplete section has painted.)
      if (typeof document !== 'undefined' && document.querySelector('[data-due-pop]:not([hidden])')) return;
      // A commit is in flight (publishing…): never tear the page down
      // mid-POST — the reload waits for the next quiet tick.
      if (typeof document !== 'undefined' && document.querySelector('[data-due-status="saving"]')) return;
    } catch {}
    try {
      const ls = typeof localStorage !== 'undefined' ? localStorage : null;
      const last = ls ? Number(ls.getItem('safepipe-last-due-commit') || 0) : 0;
      if (last && Date.now() - last < 120000) return;
    } catch {}
    try {
      const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
      if (ss) ss.setItem('safepipe-reloaded-for', sha);
    } catch {}
    deployCheckArmed = false;
    // Safe reload: prime the HTTP cache with the fresh HTML first — a plain
    // reload could otherwise re-read a cached shell pointing at pruned
    // hashed assets and strand the boot. Fall back to plain reload.
    try { await fetch(location.pathname, { cache: 'reload' }); } catch {}
    try { location.reload(); } catch {}
  } catch {}
}
async function pollPlanSha() {
  if (!liveRoot) return;
  try { if (document.hidden) return; } catch {}
  if (liveRefreshInFlight) return;
  try { await pollAppVersion(); } catch {}
  let src = null;
  try { src = await import('./plan-source.js'); } catch { return; }
  if (!src || typeof src.fetchLatestPlanSha !== 'function') return;
  let token = null;
  try { token = getSchedToken() || null; } catch { token = null; }
  let info = null;
  try {
    const opts = {};
    if (token) opts.token = token;
    else if (etagPolling && lastPlanEtag) opts.etag = lastPlanEtag;
    info = await src.fetchLatestPlanSha(opts);
  } catch { info = null; }
  if (!info) return;
  if (info.notModified) {
    // No new commit — but an UNCONFIRMED sha (CDN lag on a known-new
    // commit) still needs its slow watch: refetch the raw texts directly,
    // since the commits API will keep 304-ing on the same sha forever.
    if (lastSeenPlanSha !== null && lastAppliedPlanSha !== lastSeenPlanSha) {
      let now = 0;
      try { now = Date.now(); } catch {}
      if (now - lastShaSlowAt >= SHA_SLOW_MS) {
        lastShaSlowAt = now;
        let changed = false;
        try { changed = await refreshLivePlans(liveRoot); } catch { changed = false; }
        if (changed) { lastAppliedPlanSha = lastSeenPlanSha; shaRetries = 0; }
      }
    } else { shaRetryArmed = false; shaRetries = 0; }
    return;
  }
  if (info.etag) {
    lastPlanEtag = info.etag;
  } else if (!token) {
    // No ETag on an unauthenticated response: conditional polling is
    // unsupported — stretch to 60s so the 60 req/hr cap can't bite.
    if (etagPolling) { etagPolling = false; livePollMs = 60000; restartLiveTimer(); }
  }
  if (!info.sha) return;
  // First sighting: the boot bundle is the baseline — record as seen AND
  // applied, don't fetch.
  if (lastSeenPlanSha === null) {
    lastSeenPlanSha = info.sha;
    lastAppliedPlanSha = info.sha;
    shaRetryArmed = false; shaRetries = 0; return;
  }
  if (info.sha === lastSeenPlanSha && !shaRetryArmed) return;
  // A brand-new sha gets fresh quick retries (a previous sha's backoff
  // must not starve it).
  if (info.sha !== lastSeenPlanSha) shaRetries = 0;
  lastSeenPlanSha = info.sha;
  shaRetryArmed = false;
  let changed = false;
  try { changed = await refreshLivePlans(liveRoot); } catch { changed = false; }
  if (changed) {
    // Some fetch confirmed this sha — converged, quiet until a newer one.
    shaRetries = 0;
    lastAppliedPlanSha = lastSeenPlanSha;
  } else if (lastAppliedPlanSha !== lastSeenPlanSha) {
    // New sha but no diff: the commit is fresher than the raw CDN. A couple
    // of quick follow-ups, then a slow watch (1/min) until some fetch
    // confirms it — never go quiet on an unconfirmed sha, or slow devices
    // stall until the NEXT commit and need a manual refresh.
    if (shaRetries < SHA_RETRY_MAX) { shaRetryArmed = true; shaRetries++; }
    else {
      let now = 0;
      try { now = Date.now(); } catch {}
      if (now - lastShaSlowAt >= SHA_SLOW_MS) { shaRetryArmed = true; lastShaSlowAt = now; }
    }
  }
}
function onLiveFocus() {
  try { window.clearTimeout(liveFocusTimer); } catch {}
  try {
    liveFocusTimer = window.setTimeout(() => {
      if (liveRoot) {
        pollPlanSha();
        try { if (!document.hidden) refreshSupaOverlay(liveRoot); } catch {}
      }
    }, 2000);
  } catch {}
}
function onLiveVisible() {
  try { if (document.hidden) return; } catch {}
  if (liveRoot) {
    pollPlanSha();
    try { refreshSupaOverlay(liveRoot); } catch {}
  }
}
function onLiveOnline() {
  if (liveRoot) {
    pollPlanSha();
    try { if (typeof document === 'undefined' || !document.hidden) refreshSupaOverlay(liveRoot); } catch {}
  }
}
const DUE_OVERRIDES_KEY = 'safepipe-due-overrides.v2';
function onLiveStorage(ev) {
  try {
    if (!ev || (ev.key !== DUE_OVERRIDES_KEY && ev.key !== null)) return;
    if (document.hidden) return;
  } catch { return; }
  // Same-device sibling tab saved an override: re-apply locally (no fetch —
  // the file did not change, so a full raw re-fetch only churns the DOM).
  if (liveRoot) reapplyDueOverrides(liveRoot);
}
function stopLiveRefresh() {
  try { if (liveTimer) window.clearInterval(liveTimer); } catch {}
  liveTimer = 0;
  try { if (liveFocusTimer) window.clearTimeout(liveFocusTimer); } catch {}
  liveFocusTimer = 0;
  try { if (supaUnsub) supaUnsub(); } catch {}
  supaUnsub = null;
  try { window.removeEventListener('focus', onLiveFocus); } catch {}
  try { document.removeEventListener('visibilitychange', onLiveVisible); } catch {}
  try { window.removeEventListener('online', onLiveOnline); } catch {}
  try { window.removeEventListener('storage', onLiveStorage); } catch {}
}
function restartLiveTimer() {
  try { if (liveTimer) window.clearInterval(liveTimer); } catch {}
  liveTimer = 0;
  try {
    liveTimer = window.setInterval(() => {
      try { if (document.hidden) return; } catch {}
      if (liveRoot) pollPlanSha();
    }, livePollMs);
  } catch {}
}
function startLiveRefresh() {
  stopLiveRefresh();
  try {
    restartLiveTimer();
    window.addEventListener('focus', onLiveFocus);
    document.addEventListener('visibilitychange', onLiveVisible);
    window.addEventListener('online', onLiveOnline);
    window.addEventListener('storage', onLiveStorage);
    // Boot overlay fetch + Realtime push: any schedules change refetches and
    // repaints with selection/filters/datepicker intact. Unconfigured/offline
    // resolves no-op — the sha-poll above stays the fallback.
    // [plan:2026-10-18_172008-supabase-scheduling-migration.md#task-9]
    try { if (liveRoot) refreshSupaOverlay(liveRoot); } catch {}
    try {
      supaUnsub = subscribeSchedules(() => {
        try { if (typeof document !== 'undefined' && document.hidden) return; } catch {}
        if (liveRoot) refreshSupaOverlay(liveRoot);
      });
    } catch { supaUnsub = null; }
  } catch {}
}
const st = { active: new Set(), incompleteOnly: false, day: '', sel: [0, 0], open: false, stage: 'list',
  mlevel: 1,
  view: 'list', tlSel: null, tlLast: null, tlSort: '', returnView: null, tlDate: '' };
let tlToken = 0;
const dueOnDay = (p, day) => (p.sprints || []).some((s) => { try { return dueOf(s) === day; } catch { return false; } });
const visiblePlans = () => plans
  .filter((p) => (!st.active.size || p.tags.some((t) => st.active.has(t)))
    && (!st.incompleteOnly || !planSealed(p))
    && (!st.day || p.date === st.day || commits.some((c) => c.plan === p.file && c.date === st.day) || dueOnDay(p, st.day)));
// Timeline ignores the landing day-blob filter: tracks always span the full
// range. Track chips (st.active) still apply.
const visiblePlansNoDay = () => plans
  .filter((p) => (!st.active.size || p.tags.some((t) => st.active.has(t)))
    && (!st.incompleteOnly || !planSealed(p)));
const visibleSprints = (plan) => {
  const ss = st.active.size ? plan.sprints.filter((s) => s.tags.some((t) => st.active.has(t))) : plan.sprints;
  return ss.length ? ss : plan.sprints;
};
// Canonical head for a due commit, resolved from the live plans at send
// time: a pick's closure head goes stale across sync rebuilds (live refresh,
// applyServerFileText) or renames, and the server 200s `unchanged`
// (head-not-found) for it. Matching core is canonicalHead
// (src/logic/due-overrides.js, server parity with api/due.js); else null.
export function canonicalDueHead(file, head) {
  try {
    const plan = plans.find((p) => p.file === file);
    if (!plan) return null;
    return canonicalHead(plan.sprints.map((s) => s.head), head);
  } catch {}
  return null;
}
// Read-back for publish verification: the Due currently painted for one
// section (string), null when the painted section carries none, undefined
// when the section (or file) is gone. commitDue confirms 'saved' only when
// this equals the pick — never assumed from the POST outcome.
export function readPaintedDue(file, head) {
  try {
    const plan = plans.find((p) => p.file === file);
    const sec = plan ? plan.sprints.find((s) => s.head === head) : null;
    if (!sec) return undefined;
    return dueOf(sec);
  } catch { return undefined; }
}
const cur = () => {
  const list = visiblePlans(), pi = Math.min(Math.max(st.sel[0], 0), Math.max(list.length - 1, 0));
  // An explicitly opened drawer keeps its detail even when its plan leaves
  // the day filter (e.g. a due edit moves it off the filtered day): the day
  // filter applies to lists only. Pinned by file identity; the list cursor
  // (pi) stays day-filtered for highlight/nav.
  if (st.open) {
    if (!st.openFile) {
      const fplan = list[pi];
      if (fplan) st.openFile = fplan.file;
    }
    if (st.openFile) {
      const pinned = plans.find((p) => p.file === st.openFile);
      if (pinned) {
        const sprints = visibleSprints(pinned);
        // Mobile L1 parks the detail with sel[1] === -1 (nothing selected):
        // pass it through so paint renders the placeholder instead of the
        // first phase. Desktop never sets -1, so its clamp is unchanged.
        const rawSi = st.sel[1];
        const si = rawSi < 0 ? -1 : Math.min(Math.max(rawSi, 0), Math.max(sprints.length - 1, 0));
        return { list, pi, plan: pinned, sprints, si };
      }
      st.openFile = null;
    }
  } else if (st.openFile) st.openFile = null;
  const plan = list[pi], sprints = plan ? visibleSprints(plan) : [];
  const rawSi = st.sel[1];
  const si = rawSi < 0 ? -1 : Math.min(Math.max(rawSi, 0), Math.max(sprints.length - 1, 0));
  return { list, pi, plan, sprints, si };
};
export function render() {
  return [
    `<p class="ds-crumb">Start · Changelog</p><div class="ds-hero wide"><h1>What shipped, in order.</h1></div>`,
    `<hr class="ds-hr"><div class="ds-graph" data-col="graph"></div>`,
    `<hr class="ds-hr"><div class="ds-chips" data-col="chips"></div>`,
    `<div class="ds-plan-grid"><div class="ds-col" data-col="plan"></div></div><div class="ds-md" data-col="triage">`,
    `</div><div class="ds-scrim" data-scrim aria-hidden="true"></div><span class="ds-cursor-tip" hidden role="tooltip"><span class="ds-cursor-tip__text"></span></span>`,
    `<aside class="ds-timeline" data-timeline aria-label="Plan timeline" aria-hidden="true" inert></aside>`,
    `<div class="ds-tl-pop" data-tl-pop hidden role="status"></div>`,
    `<aside class="ds-drawer" data-drawer aria-label="Build detail" aria-hidden="true" inert>`,
    `<div class="ds-rail" data-col="sprint"></div><div class="ds-task" data-col="tasks"></div></aside>`,
  ].join('');
}
function syncTimelineURL() {
  try {
    const q = new URLSearchParams(location.search);
    if (st.view === 'timeline') {
      q.set('view', 'timeline');
      if (st.tlSel) { q.set('plan', st.tlSel.planFile); q.set('bout', String(st.tlSel.boutIdx)); }
      else q.delete('plan'), q.delete('bout');
    } else q.delete('view'), q.delete('plan'), q.delete('bout');
    const s = q.toString();
    globalThis.history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  } catch {}
}
function doPaint(root) {
  const { list, pi, plan, sprints, si } = cur();
  // Mobile L1 keeps sel[1] === -1 (nothing selected) across repaints —
  // never let the clamp write-back resurrect the first phase. Desktop (and
  // L2) keep the old write-back exactly.
  if (isMobile() && st.open && st.mlevel === 1 && st.sel[1] < 0) st.sel = [pi, -1];
  else st.sel = [pi, Math.max(si, 0)];
  paint(root, { list, pi, plan, sprints, si: st.sel[1], active: st.active, day: st.day,
    incompleteOnly: st.incompleteOnly,
    sel: st.sel, open: st.open, stage: st.stage, mlevel: st.mlevel || 1, counts, plans, texts,
    dueCommit: st.dueCommit || null,
    rev: plan ? revOf(plan.file) : null, revOf, edited: plan ? (s) => sectionEdited(plan.file, s) : () => false,
    revs: plan ? (history[plan.file] || []) : [] });
  const scrim = root.querySelector('[data-scrim]');
  if (scrim) {
    const scrimOpen = st.open || st.view === 'timeline';
    scrim.classList.toggle('is-open', scrimOpen);
    scrim.setAttribute('aria-hidden', String(!scrimOpen));
  }
  const btn = root.querySelector('[data-view="timeline"]');
  if (btn) {
    const n = list.length, on = st.view === 'timeline';
    btn.innerHTML = `<span class="ds-chip-timeline__icon" aria-hidden="true">${TIMELINE_TILE_ICON}</span> All ${n} track${n === 1 ? '' : 's'}`;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', `${n} plans in timeline — ${on ? 'close' : 'open'} timeline view`);
  }
  syncTimelineURL();
  const my = ++tlToken;
  const panel = root.querySelector('[data-timeline]');
  const syncTl = (open) => {
    if (!panel) return;
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    panel.toggleAttribute('inert', !open);
  };
  if (st.view !== 'timeline') { syncTl(false); return; }
  // Drawer open over the timeline: the panel is covered — glide it out now
  // and skip the async grid repaint until the drawer closes. Repainting
  // underneath mid-flight janks the drawer's own entrance.
  if (st.open) { syncTl(false); return; }
  import('./changelog/timeline-paint.js').then((m) => {
    if (my !== tlToken || st.view !== 'timeline') return;
    m.paintTimeline(root, { list: st.view === 'timeline' ? visiblePlansNoDay() : list, st });
  }).catch(() => {
    if (my !== tlToken || !panel) return;
    syncTl(true);
    panel.innerHTML = `<div class="ds-tl-head"><b>Timeline</b>` +
      `<button data-tl-close aria-label="Close timeline">✕</button></div>` +
      `<p class="ds-tl-fallback">Timeline tracks are unavailable — the timeline model module has not landed yet.</p>`;
  });
}
export function mount(root) {
  st.open = false; st.stage = 'list'; st.mlevel = 1;
  // Survive file-watch reloads (setting a deadline rewrites the plan file,
  // and the dev server reloads on the .md change): restore the UI snapshot
  // taken at unload so the drawer reopens where the author left it.
  try {
    const raw = sessionStorage.getItem('safepipe-ui-snapshot');
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.sel)) st.sel = s.sel;
      if (typeof s.open === 'boolean') st.open = s.open;
      if (typeof s.stage === 'string') st.stage = s.stage;
      if (s.view === 'timeline' || s.view === 'list') st.view = s.view;
      // mlevel compat: old snapshots predate it. An open drawer with a real
      // section selection restores at L2, otherwise L1 (mobile only matters).
      if (s.mlevel === 1 || s.mlevel === 2) st.mlevel = s.mlevel;
      else if (st.open && isMobile()) st.mlevel = (Array.isArray(st.sel) && st.sel[1] >= 0) ? 2 : 1;
      sessionStorage.removeItem('safepipe-ui-snapshot');
    }
  } catch {}
  try {
    window.addEventListener('beforeunload', () => {
      try {
        sessionStorage.setItem('safepipe-ui-snapshot',
          JSON.stringify({ sel: st.sel, open: st.open, stage: st.stage, view: st.view, mlevel: st.mlevel }));
      } catch {}
    });
  } catch {}
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('view') === 'timeline') {
      st.view = 'timeline';
      const f = q.get('plan'), b = q.get('bout');
      if (f && plans.some((p) => p.file === f)) {
        const li = visiblePlans().findIndex((p) => p.file === f);
        st.sel = [Math.max(li, 0), 0]; st.open = true; st.openFile = f; st.stage = 'tasks'; st.returnView = 'timeline';
        // Timeline deep links land on the detail (L2) with the bout selected.
        st.mlevel = 2;
        if (b !== null && b !== '' && Number.isInteger(Number(b))) {
          st.tlSel = { planFile: f, boutIdx: Number(b) };
          st.tlLast = st.tlSel;
        }
      }
    }
  } catch {}
  doPaint(root);
  liveRoot = root;
  startLiveRefresh();
  const unbind = bindChangelogEvents(root, st, { cur, doPaint });
  return () => {
    try { unbind(); } catch {}
    if (liveRoot === root) { liveRoot = null; stopLiveRefresh(); }
  };
}
