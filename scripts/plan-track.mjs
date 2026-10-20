// plan-track.mjs — lightweight plan ↔ commit tracker for safepipe_proj.
// Reads .hermes/plans/*.md + git log over tracked paths, writes src/ds/plan-manifest.json.
// Safe in `build`: byte-identical output when nothing changed (no churn), placeholder when git is missing.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plansDir = join(root, '.hermes', 'plans');
const manifestPath = join(root, 'src', 'ds', 'plan-manifest.json');
const TRACKED = ['src', 'design-system', 'docs', 'scripts', 'public', '.agents', '.hermes', 'AGENTS.md', '*.html', 'vite.config.js', 'package.json'];
const TAG = /\[plan:([^\]#\s]+)(?:#([^\]]+))?\]/;

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch { return null; }
};

const plans = existsSync(plansDir)
  ? readdirSync(plansDir).filter((f) => f.endsWith('.md')).sort()
  : [];

let commits = [];
const log = git(['log', '--format=%H|%h|%ad|%s', '--date=format:%Y-%m-%d|%H:%M', '--', ...TRACKED]);
if (log) {
  for (const line of log.split('\n').filter(Boolean)) {
    const [full, sha, date, time, ...rest] = line.split('|');
    const subject = rest.join('|');
    const m = subject.match(TAG);
    commits.push({ sha, full, date, time, subject, plan: m ? m[1] : null, anchor: m ? (m[2] || null) : null });
  }
}

const status = git(['status', '--short', '--', ...TRACKED]) || '';
// Porcelain prefixes vary in width (` M ` staged/unstaged, renames, single-col
// forms) — drop the status columns, never a fixed slice, so a path char can
// never be eaten.
const wip = status.split('\n').filter(Boolean)
  .map((l) => l.slice(2).trimStart()).filter((f) => !f.endsWith('plan-manifest.json') && !f.endsWith('plan-history.json'));

// Shallow-clone guard: merge fresh log over previously committed manifest so
// truncated CI clones never shrink history (dedupe by sha, fresh first).
let prev = { commits: [], generated: null };
if (existsSync(manifestPath)) {
  try { prev = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* corrupt → rebuild */ }
}
const seen = new Set(commits.map((c) => c.sha));
for (const c of prev.commits || []) if (!seen.has(c.sha)) { commits.push(c); seen.add(c.sha); }

// Plumbing exclusion: commits touching only tracker files are tracker output,
// not work — drop them so triage can reach empty (skill: GENERATED filter).
const GENERATED = new Set(['src/ds/plan-manifest.json', 'src/ds/plan-history.json', 'public/version.json', 'src/ds/plan-retro.json']);
const filesOf = (sha) => {
  try { return execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
  catch { return ['unknown']; }
};
for (let i = commits.length - 1; i >= 0; i--) {
  if (!commits[i].plan) {
    const fs = filesOf(commits[i].full);
    if (fs.length && fs.every((f) => GENERATED.has(f))) commits.splice(i, 1);
  }
}

// Retro file: pre-trailer history (sha -> plan + anchor). Never rewrite git history.
let retro = [];
try { retro = JSON.parse(readFileSync(join(root, 'src', 'ds', 'plan-retro.json'), 'utf8')); } catch { /* no retro file yet */ }
if (retro.length) {
  const bySha = new Map(retro.map((r) => [r.sha, r]));
  for (const c of commits) {
    const r = bySha.get(c.sha);
    if (r) { c.plan = r.plan; c.anchor = r.anchor || null; }
  }
}

const linked = commits.filter((c) => c.plan).length;

// Plan-iteration history: append a version snapshot per plan whenever its
// content hash is unseen. Rides this hook — no convention needed beyond build.
// History file is generated: excluded from wip like the manifest.
const histPath = join(root, 'src', 'ds', 'plan-history.json');
let hist = {};
try { hist = JSON.parse(readFileSync(histPath, 'utf8')); } catch { /* start empty */ }
const { split, state, phash } = await import('../src/changelog/changelog-parse.js');
let histAdded = 0;
for (const f of plans) {
  const md = readFileSync(join(plansDir, f), 'utf8');
  const h = phash(md);
  hist[f] ||= [];
  // Invariant: last entry is always the current worktree (views compare against it).
  // Move-to-end preserves the entry's original sha/date provenance.
  const ix = hist[f].findIndex((v) => v.hash === h);
  if (ix === -1) {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    hist[f].push({ sha: null, date: now.toISOString().slice(0, 10), time: hhmm, hash: h,
      sections: split(md).map((s) => ({ head: s.head.slice(0, 80), hash: phash(s.head + '\n' + s.body), state: state(s.body) })) });
    histAdded++;
  } else if (ix !== hist[f].length - 1) {
    hist[f].push(...hist[f].splice(ix, 1));
    histAdded++;
  }
}
if (histAdded) writeFileSync(histPath, JSON.stringify(hist, null, 1) + '\n');
// Deploy version stamp: public/version.json carries the current HEAD sha
// plus the commit count (sha only — byte-stable per commit, no rebuild churn).
// The count makes the stamp unique per commit: the sha is written BEFORE the
// commit exists so it names the previous commit, and back-to-back commits
// (content + sync) would otherwise publish the same value twice — an open
// page polls this file and only reloads on change, so a repeated stamp
// strands viewers on the older bundle. "<sha>:<count>" increments on every
// commit and is stable across rebuilds of the same commit. The running app
// polls it and auto-reloads an open page onto a new deploy, so editors and
// viewers never sit on a stale bundle. Served from /version.json via public/.
try {
  const head = git(['rev-parse', 'HEAD']);
  const count = git(['rev-list', '--count', 'HEAD']);
  const stamp = head && count ? `${head}:${count}` : (head || null);
  const verPath = join(root, 'public', 'version.json');
  const verNext = JSON.stringify({ sha: stamp }) + '\n';
  let verPrev = null;
  try { verPrev = readFileSync(verPath, 'utf8'); } catch {}
  if (verPrev !== verNext) writeFileSync(verPath, verNext);
} catch { /* version stamp is best-effort — never fail the build */ }
const next = { generated: prev.generated || new Date().toISOString(), plans, commits, wip };
const same = (a, b) => JSON.stringify({ ...a, generated: 0 }) === JSON.stringify({ ...b, generated: 0 });
if (!existsSync(manifestPath) || !same(prev, next)) {
  next.generated = new Date().toISOString();
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`✓ plan-track — ${plans.length} plans · ${commits.length} commits (${linked} linked) · ${wip.length} wip · manifest updated`);
} else {
  console.log(`✓ plan-track — ${plans.length} plans · ${commits.length} commits (${linked} linked) · ${wip.length} wip · clean`);
}
