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
import { duePreviewEdit } from './changelog-events.js';
import { loadDueOverrides, dropDueOverride } from '../logic/due-overrides.js';
import { getSchedToken } from '../logic/schedule-auth.js';
import { TIMELINE_TILE_ICON } from './changelog/graph.js';
import { bindChangelogEvents } from './changelog-events.js';

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
// Factored per rebuild so live text swaps keep the same merge. [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
function applyDueOverrides() {
  try {
    for (const o of loadDueOverrides()) {
      const plan = plans.find((p) => p.file === o.file);
      const sec = plan ? plan.sprints.find((s) => s.head === o.head) : null;
      if (!sec) { dropDueOverride(o.file, o.head); continue; }
      const current = dueOf(sec);
      if (o.due) {
        if (current === o.due) { dropDueOverride(o.file, o.head); continue; }
        // Server-confirmed pick (committed to git): the repo is newer than this
        // bundle during the deploy window, so it outranks the file. Expires in
        // a day — by then the redeploy carries the value (or a hand-edit won,
        // and the file takes over again).
        if (o.committed && Date.now() - (o.at || 0) < 86400000) {
          sec.body = duePreviewEdit(sec.body, sec.head, o.due);
          continue;
        }
        if (current) { dropDueOverride(o.file, o.head); continue; }
        sec.body = duePreviewEdit(sec.body, sec.head, o.due);
      } else {
        if (!current) { dropDueOverride(o.file, o.head); continue; }
        sec.body = duePreviewEdit(sec.body, sec.head, null);
      }
    }
  } catch {}
}
rebuildPlans(rawTexts);
// Live plan refresh: re-fetch hosted markdown and rebuild on change, then
// repaint with selection/filter untouched (no reload).
// [plan:2026-10-15_120000-safepipe-changelog-timeline.md#scheduling]
let liveRefreshInFlight = false;
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
    const merged = { ...rawTexts };
    for (const k of keys) merged[k] = changed[k];
    rebuildPlans(merged);
    doPaint(root);
    return true;
  } catch { return false; }
  finally { liveRefreshInFlight = false; }
}
// Apply server-returned file content directly (own-pick commit response):
// swaps one file's live text, rebuilds, repaints with selection/filter/sort
// untouched. Returns true on success, false on bad args/unknown file.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
export function applyServerFileText(root, file, text) {
  if (!root || typeof file !== 'string' || !file || typeof text !== 'string') return false;
  try {
    if (!Object.prototype.hasOwnProperty.call(rawTexts, file)) return false;
    const merged = { ...rawTexts, [file]: text };
    rebuildPlans(merged);
    doPaint(root);
    return true;
  } catch { return false; }
}
// Polling + focus refresh, active only while the changelog root is mounted.
// The 20s full re-fetch is gone: a ~15s sha poll (commits API, no CDN lag)
// gates full fetches — raw fetch runs ONLY when the sha changed.
// [plan:2026-10-17_180000-safepipe-smooth-scheduling.md#task-3]
let liveTimer = 0;
let liveFocusTimer = 0;
let liveRoot = null;
let lastSeenPlanSha = null;
let lastPlanEtag = null;
let etagPolling = true;
let livePollMs = 15000;
let shaRetryArmed = false;
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
    if (sha === bootDeploySha) return;
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
      // Mid-pick on this device: the datepicker popover is open — wait.
      if (typeof document !== 'undefined' && document.querySelector('.ds-due-pop')) return;
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
  if (info.notModified) { shaRetryArmed = false; return; }
  if (info.etag) {
    lastPlanEtag = info.etag;
  } else if (!token) {
    // No ETag on an unauthenticated response: conditional polling is
    // unsupported — stretch to 60s so the 60 req/hr cap can't bite.
    if (etagPolling) { etagPolling = false; livePollMs = 60000; restartLiveTimer(); }
  }
  if (!info.sha) return;
  // First sighting: the boot bundle is the baseline — record, don't fetch.
  if (lastSeenPlanSha === null) { lastSeenPlanSha = info.sha; shaRetryArmed = false; return; }
  if (info.sha === lastSeenPlanSha && !shaRetryArmed) return;
  lastSeenPlanSha = info.sha;
  shaRetryArmed = false;
  let changed = false;
  try { changed = await refreshLivePlans(liveRoot); } catch { changed = false; }
  // New sha but no diff: the commit is fresher than the raw CDN — one
  // follow-up fetch next tick, then quiet regardless.
  if (!changed) shaRetryArmed = true;
}
function onLiveFocus() {
  try { window.clearTimeout(liveFocusTimer); } catch {}
  try {
    liveFocusTimer = window.setTimeout(() => { if (liveRoot) pollPlanSha(); }, 2000);
  } catch {}
}
function onLiveVisible() {
  try { if (document.hidden) return; } catch {}
  if (liveRoot) pollPlanSha();
}
function onLiveOnline() {
  if (liveRoot) pollPlanSha();
}
const DUE_OVERRIDES_KEY = 'safepipe-due-overrides.v2';
function onLiveStorage(ev) {
  try {
    if (!ev || (ev.key !== DUE_OVERRIDES_KEY && ev.key !== null)) return;
    if (document.hidden) return;
  } catch { return; }
  if (liveRoot) refreshLivePlans(liveRoot);
}
function stopLiveRefresh() {
  try { if (liveTimer) window.clearInterval(liveTimer); } catch {}
  liveTimer = 0;
  try { if (liveFocusTimer) window.clearTimeout(liveFocusTimer); } catch {}
  liveFocusTimer = 0;
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
  } catch {}
}
const st = { active: new Set(), day: '', sel: [0, 0], open: false, stage: 'list',
  view: 'list', tlSel: null, tlLast: null, tlSort: '', returnView: null, tlDate: '' };
let tlToken = 0;
const dueOnDay = (p, day) => (p.sprints || []).some((s) => { try { return dueOf(s) === day; } catch { return false; } });
const visiblePlans = () => plans
  .filter((p) => (!st.active.size || p.tags.some((t) => st.active.has(t)))
    && (!st.day || p.date === st.day || commits.some((c) => c.plan === p.file && c.date === st.day) || dueOnDay(p, st.day)));
// Timeline ignores the landing day-blob filter: tracks always span the full
// range. Track chips (st.active) still apply.
const visiblePlansNoDay = () => plans
  .filter((p) => !st.active.size || p.tags.some((t) => st.active.has(t)));
const visibleSprints = (plan) => {
  const ss = st.active.size ? plan.sprints.filter((s) => s.tags.some((t) => st.active.has(t))) : plan.sprints;
  return ss.length ? ss : plan.sprints;
};
// Canonical head for a due commit, resolved from the live plans at send
// time: a pick's closure head goes stale across sync rebuilds (live refresh,
// applyServerFileText) or renames, and the server 200s `unchanged`
// (head-not-found) for it. Exact match wins; then server-parity normalized
// and single-candidate prefix-fuzzy matches (api/due.js); else null.
export function canonicalDueHead(file, head) {
  try {
    const plan = plans.find((p) => p.file === file);
    if (!plan) return null;
    const want = String(head || '');
    if (plan.sprints.some((s) => s.head === want)) return want;
    const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const nw = norm(want);
    const byNorm = plan.sprints.find((s) => norm(s.head) === nw);
    if (byNorm) return byNorm.head;
    const key = nw.slice(0, 40);
    if (key) {
      const cand = plan.sprints.filter((s) => norm(s.head).includes(key));
      if (cand.length === 1) return cand[0].head;
    }
  } catch {}
  return null;
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
        return { list, pi, plan: pinned, sprints, si: Math.min(Math.max(st.sel[1], 0), Math.max(sprints.length - 1, 0)) };
      }
      st.openFile = null;
    }
  } else if (st.openFile) st.openFile = null;
  const plan = list[pi], sprints = plan ? visibleSprints(plan) : [];
  return { list, pi, plan, sprints, si: Math.min(Math.max(st.sel[1], 0), Math.max(sprints.length - 1, 0)) };
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
  st.sel = [pi, si];
  paint(root, { list, pi, plan, sprints, si, active: st.active, day: st.day,
    sel: st.sel, open: st.open, stage: st.stage, counts, plans, texts,
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
  st.open = false; st.stage = 'list';
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
      sessionStorage.removeItem('safepipe-ui-snapshot');
    }
  } catch {}
  try {
    window.addEventListener('beforeunload', () => {
      try {
        sessionStorage.setItem('safepipe-ui-snapshot',
          JSON.stringify({ sel: st.sel, open: st.open, stage: st.stage, view: st.view }));
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
