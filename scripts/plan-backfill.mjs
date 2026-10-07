// Backfills src/ds/plan-history.json from committed plan versions.
// Walks `git log --follow` per plan, rehashes each version (dedupe by hash),
// merges with tracker-appended entries. Idempotent — rerun anytime.
// [plan:2026-10-07_130000-safepipe-changelog.md#task-6]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { split, state, phash } from '../src/changelog/changelog-parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plansDir = join(root, '.hermes', 'plans');
const histPath = join(root, 'src', 'ds', 'plan-history.json');
const hash = phash;

const git = (args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

let hist = {};
try { hist = JSON.parse(readFileSync(histPath, 'utf8')); } catch { /* start empty */ }

const snap = (md, sha, date) => ({
  sha, date, hash: hash(md),
  sections: split(md).map((s) => ({ head: s.head.slice(0, 80), hash: hash(s.head + '\n' + s.body), state: state(s.body) })),
});

let added = 0;
for (const f of readdirSync(plansDir).filter((x) => x.endsWith('.md')).sort()) {
  hist[f] ||= [];
  const seen = new Set(hist[f].map((v) => v.hash));
  // --follow --name-only --reverse: oldest first; first path per commit is the name at that commit
  const log = git(['log', '--follow', '--reverse', '--format=COMMIT:%H|%ad', '--date=short', '--name-only', '--', join('.hermes/plans', f)]);
  let cur = null;
  for (const line of log.split('\n')) {
    const m = line.match(/^COMMIT:([0-9a-f]+)\|(\d{4}-\d{2}-\d{2})$/);
    if (m) { cur = { sha: m[1].slice(0, 7), date: m[2], path: null }; continue; }
    if (cur && !cur.path && line.trim()) {
      cur.path = line.trim();
      const content = git(['show', `${cur.sha}:${cur.path}`]);
      if (content) {
        const v = snap(content, cur.sha, cur.date);
        if (!seen.has(v.hash)) { hist[f].push(v); seen.add(v.hash); added++; }
      }
      cur = null;
    }
  }
  hist[f].sort((a, b) => a.date.localeCompare(b.date));
}

mkdirSync(dirname(histPath), { recursive: true });
writeFileSync(histPath, JSON.stringify(hist, null, 1) + '\n');
const files = Object.keys(hist).length;
console.log(`✓ plan-backfill — ${files} plans · +${added} versions`);
