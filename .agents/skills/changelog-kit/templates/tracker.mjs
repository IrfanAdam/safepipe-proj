// changelog-kit tracker template — style-agnostic, configure and copy.
// Zero runtime deps: Node stdlib + `git` CLI only. Mirrors the live
// `plan-track.mjs` defaults; the five machine-editable values live in the
// AUTOFIX block below — preflight patches the block, never hand-edits.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// AUTOFIX:CONFIG start — preflight may rewrite these lines, keep the markers.
const PLANS = join(root, '.hermes', 'plans'); // AUTOFIX:PLANS dir with plan md files
const OUT = join(root, 'src', 'ds', 'plan-manifest.json'); // AUTOFIX:OUT manifest path
const HIST = join(root, 'src', 'ds', 'plan-history.json'); // AUTOFIX:HIST history path
const RETRO = join(root, 'src', 'ds', 'plan-retro.json'); // AUTOFIX:RETRO array-form [{sha,plan,anchor,note}]
const TRACKED = ['src', 'design-system', 'docs', 'scripts', 'public', '.agents', 'AGENTS.md', '*.html', 'vite.config.js', 'package.json']; // AUTOFIX:TRACKED paths whose commits count
const GENERATED = ['src/ds/plan-manifest.json', 'src/ds/plan-history.json']; // AUTOFIX:GENERATED build outputs, never wip
const CONTINUATION = 'REPLACE-WITH-SESSION-ID'; // AUTOFIX:CONTINUATION session id
const PARSE_MODULE = '../src/changelog/changelog-parse.js'; // AUTOFIX:PARSE split/state/phash module (Lane B)
// AUTOFIX:CONFIG end.

const TAG = /\[plan:([^\]#\s]+)(?:#([^\]]+))?\]/;
const sh = (args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

const plans = existsSync(PLANS) ? readdirSync(PLANS).filter((f) => f.endsWith('.md')).sort() : [];

let commits = [];
const log = sh(['log', '--format=%H|%h|%ad|%s', '--date=format:%Y-%m-%d|%H:%M', '--', ...TRACKED]);
if (log) {
  for (const line of log.split('\n').filter(Boolean)) {
    // Subjects may contain `|` — rejoin the tail, never a fixed index.
    // `%ad` expands to `date|time`, so fields are full|sha|date|time|subject.
    const [full, sha, date, time, ...rest] = line.split('|');
    const subject = rest.join('|');
    const m = subject.match(TAG);
    commits.push({ sha, full, date, time, subject, plan: m ? m[1] : null, anchor: m ? (m[2] || null) : null });
  }
}

// Porcelain prefixes vary in width — drop the status columns, never a fixed
// slice, so a path char can never be eaten.
const status = sh(['status', '--short', '--', ...TRACKED]) || '';
const genBase = new Set(GENERATED.map((g) => g.split('/').pop()));
const wip = status.split('\n').filter(Boolean)
  .map((l) => l.slice(2).trimStart())
  .filter((f) => ![...genBase].some((g) => f.endsWith(g)));

// Shallow-clone guard: merge fresh log OVER the previous manifest (dedupe by
// sha, fresh first) so truncated CI clones never shrink history.
let prev = { commits: [], generated: null };
if (existsSync(OUT)) {
  try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* corrupt → rebuild */ }
}
const seen = new Set(commits.map((c) => c.sha));
for (const c of prev.commits || []) if (!seen.has(c.sha)) { commits.push(c); seen.add(c.sha); }

// Plumbing exclusion: commits touching only GENERATED files are tracker
// output, not work — drop the plan-less ones so triage can reach empty.
const genSet = new Set(GENERATED);
const filesOf = (sha) => {
  try { return execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
  catch { return ['unknown']; }
};
for (let i = commits.length - 1; i >= 0; i--) {
  if (!commits[i].plan) {
    const fs = filesOf(commits[i].full);
    if (fs.length && fs.every((f) => genSet.has(f))) commits.splice(i, 1);
  }
}

// Retro: pre-trailer history, array-form current, legacy map-form parses.
// Never rewrite git history.
let retroRows = [];
try {
  const raw = JSON.parse(readFileSync(RETRO, 'utf8'));
  retroRows = Array.isArray(raw) ? raw : Object.entries(raw.links || {}).map(([sha, r]) => ({ sha, ...r }));
} catch { /* no retro file yet */ }
if (retroRows.length) {
  const bySha = new Map(retroRows.map((r) => [r.sha, r]));
  for (const c of commits) {
    const r = bySha.get(c.sha);
    if (r) { c.plan = r.plan; c.anchor = r.anchor || null; }
  }
}

const linked = commits.filter((c) => c.plan).length;

// Plan-iteration history: one snapshot per plan per unseen content hash.
// Shared hash fn comes from the Lane B parse module — the SAME fnv1a the
// views use, never a second implementation. If Lane B has not landed yet,
// the manifest still writes; preflight reports history as pending.
let hist = {};
try { hist = JSON.parse(readFileSync(HIST, 'utf8')); } catch { /* start empty */ }
let histAdded = 0;
try {
  const { split, state, phash } = await import(PARSE_MODULE);
  for (const f of plans) {
    const md = readFileSync(join(PLANS, f), 'utf8');
    const h = phash(md);
    hist[f] ||= [];
    const ix = hist[f].findIndex((v) => v.hash === h);
    if (ix === -1) {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      hist[f].push({ sha: null, date: now.toISOString().slice(0, 10), time: hhmm, hash: h,
        sections: split(md).map((s) => ({ head: s.head.slice(0, 80), hash: phash(s.head + '\n' + s.body), state: state(s.body) })) });
      histAdded++;
    } else if (ix !== hist[f].length - 1) {
      hist[f].push(...hist[f].splice(ix, 1)); // move-to-end, keep provenance
      histAdded++;
    }
  }
  if (histAdded) writeFileSync(HIST, JSON.stringify(hist, null, 1) + '\n');
} catch {
  console.log('.. track: parse module unavailable, history skipped (Lane B pending)');
}

const next = { generated: prev.generated || new Date().toISOString(), plans, commits, wip };
const same = (a, b) => JSON.stringify({ ...a, generated: 0 }) === JSON.stringify({ ...b, generated: 0 });
if (!existsSync(OUT) || !same(prev, next)) {
  next.generated = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
  console.log(`track — ${plans.length} plans · ${commits.length} commits (${linked} linked) · ${wip.length} wip · manifest updated`);
} else {
  console.log(`track — ${plans.length} plans · ${commits.length} commits (${linked} linked) · ${wip.length} wip · clean`);
}
