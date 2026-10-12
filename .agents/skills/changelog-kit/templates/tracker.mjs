// changelog-kit tracker template — style-agnostic, configure and copy.
// Adapts personal_website scripts/ds-track.mjs to any repo.
// CONFIGURE: TRACKED paths, PLANS dir, OUT manifest, RETRO file, CONTINUATION id.
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANS = join(root, '.hermes/plans'); // CONFIGURE per repo
const OUT = join(root, 'src/changelog-manifest.json'); // CONFIGURE per repo
const RETRO = join(root, '.hermes/plan-links.json'); // {sha: {plan, anchor, note}}
const TRACKED = ['src', 'DESIGN.md']; // CONFIGURE: paths whose commits count
const GENERATED = ['src/changelog-manifest.json']; // build outputs, never wip
const CONTINUATION = 'REPLACE-WITH-SESSION-ID';
const TAG = /\[plan:([^\]#\s]+)(?:#([^\]]+))?\]/;
const sh = (cmd) => { try { return execSync(cmd, { cwd: root, encoding: 'utf8' }); } catch { return null; } };

const plans = existsSync(PLANS) ? readdirSync(PLANS).filter((f) => f.endsWith('.md')).sort() : [];
const read = (f) => { try { return readFileSync(join(PLANS, f), 'utf8'); } catch { return ''; } };
const phased = plans.filter((f) => /^## Phase /m.test(read(f)));
const retro = (() => { try { return JSON.parse(readFileSync(RETRO, 'utf8')).links || {}; } catch { return {}; } })();
const log = sh(`git log --format='@@%H|%h|%ad|%cI|%s' --name-only --date=short -- ${TRACKED.join(' ')}`);
if (!log || !log.trim()) {
  if (!existsSync(OUT)) writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), continuation: CONTINUATION, plans, commits: [], wip: [] }, null, 1) + '\n');
  console.log('.. track: no log or git unavailable, manifest untouched');
  process.exit(0);
}
const commits = log.split(/^@@/m).filter(Boolean).map((block) => {
  const [head, ...files] = block.split('\n');
  const [full, sha, date, iso, ...rest] = head.split('|');
  const subject = rest.join('|');
  const m = subject.match(TAG);
  return { sha, full, date, time: (iso.match(/T(\d{2}:\d{2})/) || [])[1] || '', subject: subject.replace(TAG, '').trim(), plan: m ? m[1] : null, anchor: m ? (m[2] || null) : null, files: files.map((f) => f.trim()).filter(Boolean) };
}).filter((c) => c.files.some((f) => !GENERATED.includes(f))).map(({ files, ...c }) => c);
const st = sh(`git status --short -- ${TRACKED.join(' ')}`) || '';
const wip = st.trim() ? st.trim().split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !GENERATED.some((g) => l.endsWith(g))) : [];
let prevDoc = null; let prev = [];
try { prevDoc = JSON.parse(readFileSync(OUT, 'utf8')); prev = prevDoc.commits || []; } catch { prev = []; }
const seen = new Set(commits.map((c) => c.sha));
prev.forEach((c) => { if (!seen.has(c.sha)) { commits.push(c); seen.add(c.sha); } });
commits.forEach((c) => { const r = retro[c.sha]; if (r) { c.plan = r.plan; c.anchor = r.anchor ?? null; } });
Object.keys(retro).forEach((short) => {
  if (commits.some((c) => c.sha === short)) return;
  const line = sh(`git show -s --format='%H|%h|%ad|%cI|%s' --date=short ${short}`);
  if (!line) return;
  const head = line.trim().split('\n')[0]; if (!head) return;
  const [full, sha, date, iso, ...rest] = head.split('|'); if (!full || !sha) return;
  const subject = rest.join('|'); const r = retro[sha] || retro[short]; if (!r) return;
  const m = subject.match(TAG);
  commits.push({ sha, full, date, time: (iso.match(/T(\d{2}:\d{2})/) || [])[1] || '', subject: m ? subject.replace(TAG, '').trim() : subject.trim(), plan: r.plan, anchor: r.anchor ?? null });
});
commits.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
const doc = { generated: new Date().toISOString(), continuation: CONTINUATION, plans, commits, wip };
const strip = (o) => JSON.stringify({ ...o, generated: null });
if (prevDoc && strip(prevDoc) === strip(doc)) doc.generated = prevDoc.generated;
writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
console.log(`track — ${plans.length} plans (${phased.length} phased) · ${commits.length} commits (${commits.filter((c) => c.plan).length} linked) · ${wip.length} wip · cont ${CONTINUATION}`);
