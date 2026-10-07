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
const TRACKED = ['src', 'design-system', 'docs', 'scripts', 'public', '*.html', 'vite.config.js', 'package.json'];
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
const log = git(['log', '--format=%H|%h|%ad|%s', '--date=short', '--', ...TRACKED]);
if (log) {
  for (const line of log.split('\n').filter(Boolean)) {
    const [full, sha, date, ...rest] = line.split('|');
    const subject = rest.join('|');
    const m = subject.match(TAG);
    commits.push({ sha, full, date, subject, plan: m ? m[1] : null, anchor: m ? (m[2] || null) : null });
  }
}

const status = git(['status', '--short', '--', ...TRACKED]) || '';
// Porcelain prefixes vary in width (` M ` staged/unstaged, renames, single-col
// forms) — drop the status columns, never a fixed slice, so a path char can
// never be eaten.
const wip = status.split('\n').filter(Boolean)
  .map((l) => l.slice(2).trimStart()).filter((f) => !f.endsWith('plan-manifest.json'));

// Shallow-clone guard: merge fresh log over previously committed manifest so
// truncated CI clones never shrink history (dedupe by sha, fresh first).
let prev = { commits: [], generated: null };
if (existsSync(manifestPath)) {
  try { prev = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* corrupt → rebuild */ }
}
const seen = new Set(commits.map((c) => c.sha));
for (const c of prev.commits || []) if (!seen.has(c.sha)) { commits.push(c); seen.add(c.sha); }

// Retro file: pre-trailer history (sha -> plan + anchor). Never rewrite git history.
let retro = [];
try { retro = JSON.parse(readFileSync(join(root, 'src', 'ds', 'plan-retro.json'), 'utf8')); } catch { /* no retro file yet */ }
if (retro.length) {
  const bySha = new Map(retro.map((r) => [r.sha, r]));
  for (const c of commits) {
    const r = !c.plan && bySha.get(c.sha);
    if (r) { c.plan = r.plan; c.anchor = r.anchor || null; }
  }
}

const linked = commits.filter((c) => c.plan).length;
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
