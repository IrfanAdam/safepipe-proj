// changelog-kit preflight — check → auto-patch → re-verify.
// Zero runtime deps: Node stdlib + `git` CLI only.
//   node preflight.mjs --fix    (default) patch what is safely patchable, then re-verify
//   node preflight.mjs --check  CI-strict: no writes, fail on any drift
// Loud fail only when it cannot fix: `PREFLIGHT FAIL:<reason>` + evidence, exit 1.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : 'fix';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const PLANS = join(root, opt('--plans', '.hermes/plans'));
const TRACKER = join(root, opt('--tracker', 'scripts/plan-track.mjs'));
const MANIFEST = join(root, opt('--manifest', 'src/ds/plan-manifest.json'));
const RETRO = join(root, opt('--retro', 'src/ds/plan-retro.json'));
const HISTORY = join(root, opt('--history', 'src/ds/plan-history.json'));

const git = (a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };
const fail = (reason, evidence) => { console.error(`PREFLIGHT FAIL:${reason}${evidence ? ` — ${evidence}` : ''}`); process.exit(1); };
const note = (m) => console.log(mode === 'check' ? `.. preflight(check): ${m}` : `.. preflight: ${m}`);
const write = (p, s) => { if (mode === 'check') return false; writeFileSync(p, s); return true; };

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); return !!ok; };

// 1. Plans dir + shape survey: every plan must yield sections (## Phase|Task|Step
//    or ### Task|Step fallback) or it renders zero sections with no error.
let planFiles = [];
try { planFiles = existsSync(PLANS) ? readdirSync(PLANS).filter((f) => f.endsWith('.md')).sort() : []; } catch { planFiles = []; }
check('plans-dir', planFiles.length > 0, `${PLANS} holds ${planFiles.length} md files`);
const SEC = /^## (Phase|Task|Step)\b/m;
const SEC_FALLBACK = /^### (Task|Step|Phase)\b/m;
const shapeless = planFiles.filter((f) => {
  let md = ''; try { md = readFileSync(join(PLANS, f), 'utf8'); } catch { return true; }
  return !SEC.test(md) && !SEC_FALLBACK.test(md);
});
check('shape-survey', shapeless.length === 0, shapeless.length ? `zero-section plans: ${shapeless.join(', ')} (see references/plan-shapes.md)` : `${planFiles.length} plans yield sections`);

// 2. Tracker script present with AUTOFIX config block (the only patch surface).
const trackerSrc = existsSync(TRACKER) ? readFileSync(TRACKER, 'utf8') : null;
check('tracker-present', !!trackerSrc, trackerSrc ? basename(TRACKER) : `missing ${TRACKER} — copy templates/tracker.mjs`);
if (!trackerSrc) fail('no-tracker', `copy templates/tracker.mjs to ${TRACKER}, configure AUTOFIX block, rerun`);
check('tracker-autofix', /AUTOFIX:CONFIG start/.test(trackerSrc || ''), 'AUTOFIX block markers intact');

// 3. Path coverage: every git commit must be visible to the tracker or
//    deliberately out of scope. Leftover commits name the exact gap.
const trackedList = (() => { const m = (trackerSrc || '').match(/const TRACKED = \[([^\]]*)\]/); return m ? m[1] : null; })();
let leftovers = [];
if (trackedList) {
  const all = (git(['log', '--format=%H']) || '').split('\n').filter(Boolean);
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { manifest = null; }
  const inManifest = new Set((manifest?.commits || []).map((c) => c.full || c.sha));
  // Commits absent from the manifest may still be plumbing (manifest-only
  // refreshes are GENERATED-excluded by design) — filter those before crying gap.
  const genRe = /plan-manifest\.json|plan-history\.json|changelog-manifest\.json/;
  for (const full of all) {
    if ([...inManifest].some((s) => String(s).startsWith(full) || full.startsWith(String(s)))) continue;
    let files = ''; try { files = execFileSync('git', ['show', '--name-only', '--format=', full], { cwd: root, encoding: 'utf8' }); } catch { files = 'unknown'; }
    if (files.trim() && files.trim().split('\n').every((f) => genRe.test(f))) continue;
    leftovers.push({ sha: full.slice(0, 7), files: files.trim().split('\n').filter(Boolean).slice(0, 4).join(', ') });
  }
}
if (leftovers.length && trackedList && mode === 'fix') {
  // Auto-patch: widen TRACKED with observed top-level paths (never shrinks).
  const tops = new Set();
  for (const l of leftovers) for (const f of l.files.split(', ')) { const t = f.split('/')[0]; if (t && !['unknown'].includes(t)) tops.add(t); }
  const cur = [...trackedList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missing = [...tops].filter((t) => !cur.some((c) => c === t || c.startsWith(t + '/') || t.startsWith(c.replace(/\/\*$/, ''))));
  if (missing.length) {
    const next = `const TRACKED = [${[...cur, ...missing].map((s) => `'${s}'`).join(', ')}];`;
    if (write(TRACKER, trackerSrc.replace(/const TRACKED = \[[^\]]*\]/, next))) note(`widened TRACKED += ${missing.join(', ')} — rerun the tracker`);
  }
}
check('path-coverage', leftovers.length === 0, leftovers.length ? `${leftovers.length} commits invisible to tracker, e.g. ${leftovers.slice(0, 3).map((l) => `${l.sha} (${l.files})`).join(' · ')}` : 'every commit accounted for');

// 4. Trailer coverage: manifest commits with no plan need a trailer next time
//    or a retro entry. HIGH-confidence only auto-retro: explicit `Phase N
//    Task M` subjects mapped to the single plan live at the commit date.
let manifest = null;
try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { manifest = null; }
check('manifest-present', !!manifest, manifest ? `${(manifest.commits || []).length} commits in manifest` : `missing ${MANIFEST} — run the tracker`);
const unlinked = (manifest?.commits || []).filter((c) => !c.plan);
const fileDate = (f) => { const m = f.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : '9999'; };
const retroRows = (() => { try { const r = JSON.parse(readFileSync(RETRO, 'utf8')); return Array.isArray(r) ? r : []; } catch { return null; } })();
if (unlinked.length && retroRows && mode === 'fix') {
  const have = new Set(retroRows.map((r) => r.sha));
  let added = 0;
  for (const c of unlinked) {
    if (have.has(c.sha)) continue;
    const m = String(c.subject || '').match(/Phase\s+(\d+).*Task\s+(\d+)/i);
    if (!m) continue;
    const cands = planFiles.filter((f) => fileDate(f) <= (c.date || '9999'));
    const pick = cands[cands.length - 1];
    if (!pick || cands.filter((f) => fileDate(f) === fileDate(pick)).length > 1) continue; // ambiguous — human maps it
    retroRows.push({ sha: c.sha, plan: pick, anchor: `{#phase-${Number(m[1])}}`, note: `preflight auto-retro HIGH: explicit Phase ${m[1]} Task ${m[2]} in subject` });
    added++;
  }
  if (added && write(RETRO, JSON.stringify(retroRows, null, 1) + '\n')) note(`auto-retro mapped ${added} HIGH-confidence commits — rerun the tracker`);
}
const stillUnlinked = unlinked.length;
check('trailer-coverage', stillUnlinked === 0, stillUnlinked ? `${stillUnlinked} unlinked (retro-map or cite [plan:<file>#<anchor>] next time)` : 'every commit linked');

// 5. Retro/history placeholders so static imports never crash.
if (retroRows === null) {
  if (write(RETRO, '[]\n')) note(`created empty retro placeholder ${RETRO}`);
  check('retro-file', false, `created ${RETRO}, rerun the tracker`);
} else check('retro-file', true, `${retroRows.length} retro rows`);
check('history-file', existsSync(HISTORY), existsSync(HISTORY) ? basename(HISTORY) : `missing ${HISTORY} — tracker writes it once Lane B parse module lands`);

// 6. Build-hook wiring: the tracker must ride the build or history goes stale.
let hooked = false;
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  hooked = /plan-track|preflight/.test(pkg.scripts?.build || '');
  if (!hooked && mode === 'fix' && pkg.scripts?.build) {
    pkg.scripts.build = `node ${opt('--tracker', 'scripts/plan-track.mjs')} && ${pkg.scripts.build}`;
    if (write(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')) { note('wired tracker into build script'); hooked = true; }
  }
} catch { /* no package.json — not a node host, skip */ }
check('build-hook', hooked, hooked ? 'tracker rides build' : 'build script lacks tracker — wire it or history goes stale');

// Report + loud fail on anything still red.
const bad = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} preflight ${r.name} — ${r.detail}`);
if (bad.length) fail(bad.map((r) => r.name).join(','), bad.map((r) => r.detail).join(' | '));
console.log(`✓ preflight — ${results.length}/${results.length} green (${mode})`);
