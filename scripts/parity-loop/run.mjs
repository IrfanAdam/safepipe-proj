#!/usr/bin/env node
/* parity-loop/run.mjs — recursive parity loop orchestrator.
 * One invocation = one build→capture→diff→refine pass. Re-runnable by design:
 * run N reads the append-only log, appends run N+1, and each entry carries a
 * delta vs the previous run so every pass visibly reinforces the next.
 * Missing board frames are reported as gaps, NEVER failures (exit 0).
 * Usage: node scripts/parity-loop/run.mjs [boardDir] [--runs K] [--base URL]
 * Constraints: no git/npm, no src/ring2 changes, never :5173/:5175. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const LOG = join(HERE, 'loop-log.jsonl');
const CORRECTIONS = join(HERE, 'corrections.md');
const SCRATCH = process.env.TMPDIR ?? process.env.TEMP ?? '/tmp';
const VIEWS = ['TOP', 'ISO', 'NEAR'];

const rawArgs = process.argv.slice(2).filter((a) => !a.startsWith('--') || a === '--');
const flags = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] == null ? '1' : arr[i + 1]]] : [],
  ),
);
let board = rawArgs.find((a) => a !== '--') ?? null;
for (const fallback of [join(ROOT, 'docs', 'parity-board'), join(ROOT, 'public', 'parity-board')]) {
  if (!board && existsSync(fallback)) board = fallback;
}
const RUNS = Math.max(1, Number(flags.runs ?? 1));
const BASE = flags.base ?? 'http://localhost:5198';
if (BASE.includes(':5173') || BASE.includes(':5175')) {
  console.error('run.mjs: :5173/:5175 are forbidden — use :5198');
  process.exit(2);
}

const tiers = JSON.parse(readFileSync(join(HERE, 'tiers.json'), 'utf8'));
const readLog = () => {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const prevEntries = () => readLog();

function onePass() {
  const log = readLog();
  const run = (log.reduce((m, e) => Math.max(m, e.run ?? 0), 0)) + 1;
  const prev = log.at(-1) ?? null;
  const runDir = join(SCRATCH, 'parity-loop', `run-${run}`);
  mkdirSync(runDir, { recursive: true });

  // 1-2. capture TOP/ISO/NEAR (headless Chromium, running server, scratch only)
  execFileSync('node', [join(HERE, 'capture.mjs'), '--out', runDir, '--base', BASE],
    { cwd: ROOT, stdio: 'inherit' });

  // 3. diff vs board frames
  const diffOut = join(runDir, 'diff.json');
  const diffArgs = [join(HERE, 'diff.mjs'), '--captures', runDir, '--board', board ?? '-', '--out', diffOut];
  if (prev) diffArgs.push('--prev-probes', join(SCRATCH, 'parity-loop', `run-${prev.run}`, 'probes.json'));
  execFileSync('node', diffArgs, { cwd: ROOT, stdio: 'inherit' });
  const diff = JSON.parse(readFileSync(diffOut, 'utf8'));

  // 4. delta vs previous run — the reinforcement link (pixel when comparable,
  // structural always, so even all-gap runs visibly reinforce the next pass)
  const prevProbes = prev
    ? JSON.parse(readFileSync(join(SCRATCH, 'parity-loop', `run-${prev.run}`, 'probes.json'), 'utf8'))
    : null;
  const curProbes = JSON.parse(readFileSync(join(runDir, 'probes.json'), 'utf8'));
  const deltaVsPrev = {};
  for (const v of VIEWS) {
    const curP = diff.views[v]?.pixel ?? null;
    const prevP = prev?.views?.[v]?.pixel ?? null;
    const d = { madDelta: null, trend: 'n/a' };
    if (curP && prevP) {
      const dd = +(curP.mad - prevP.mad).toFixed(2);
      d.madDelta = dd;
      d.trend = dd < -0.5 ? 'improved' : dd > 0.5 ? 'regressed' : 'stable';
    }
    if (prev) {
      let bytesDelta = null;
      try {
        bytesDelta = statSync(join(runDir, `${v}.png`)).size
          - statSync(join(SCRATCH, 'parity-loop', `run-${prev.run}`, `${v}.png`)).size;
      } catch { /* size delta best-effort */ }
      d.structural = {
        bytesDelta,
        errorsDelta: (curProbes.errors?.length ?? 0) - (prevProbes?.errors?.length ?? 0),
        probeSame: JSON.stringify(curProbes.views[v]?.preset) === JSON.stringify(prevProbes?.views?.[v]?.preset),
      };
    }
    deltaVsPrev[v] = d;
  }

  // 5. append loop-log entry (tier stamp on every measured object)
  const entry = {
    run,
    ts: new Date().toISOString(),
    board: board ?? null,
    base: BASE,
    runDir,
    views: Object.fromEntries(VIEWS.map((v) => [v, {
      status: diff.views[v].status,
      board: diff.views[v].board,
      pixel: diff.views[v].pixel,
      structural: diff.views[v].structural,
    }])),
    objects: tiers.objects,
    deltaVsPrev,
  };
  appendFileSync(LOG, JSON.stringify(entry) + '\n');

  // 6. corrections checklist with concrete params for the next build pass
  writeCorrections(readLog());
  console.log(`RUN ${run} appended to ${LOG}`);
  return run;
}

function writeCorrections(log) {
  const cur = log.at(-1);
  const lines = [
    '# Parity-loop corrections checklist',
    '',
    `Source: run ${cur.run} (${cur.ts}), board: ${cur.board ?? '(none — all gaps)'}.`,
    'Regenerated every pass; history lives in `loop-log.jsonl`.',
    '',
  ];
  for (const v of VIEWS) {
    const e = cur.views[v];
    const d = cur.deltaVsPrev[v];
    lines.push(`## ${v} — ${e.status}${e.pixel ? ` (MAD ${e.pixel.mad}, ${e.pixel.verdict})` : ''} — trend vs run ${cur.run - 1}: ${d.trend}`);
    if (e.status.startsWith('gap')) {
      lines.push(`- [ ] GAP: add board frame \`${v}.png\` (aliases: ${v.toLowerCase()}) to \`${cur.board ?? '<boardDir>'}/\` so run ${cur.run + 1} can compare instead of reporting a gap.`);
    } else if (e.pixel.verdict === 'major') {
      const preset = v === 'TOP' ? 'network' : v === 'ISO' ? 'segment' : 'asset';
      lines.push(`- [ ] MAJOR drift (MAD ${e.pixel.mad}): nudge \`VIEW_PRESETS.${preset}\` in \`src/ring2/main.js\` — try range ±10%, polarDeg ±2°, azimDeg ±5° — then re-run \`node scripts/parity-loop/run.mjs ${cur.board ?? '<boardDir>'}\`.`);
      lines.push(`- [ ] Check sat-base mix for \`${preset}\` level (\`setMix\` in \`window.__ring2\`): imagery-vs-twin blend is the usual TOP-band culprit.`);
    } else if (e.pixel.verdict === 'minor') {
      lines.push(`- [ ] MINOR drift (MAD ${e.pixel.mad}, changed ${e.pixel.changedPct}%): compare thumbnails in scratch \`${cur.runDir}/\`; likely DEM-tile pop-in — confirm with a second run before touching code.`);
    } else {
      lines.push('- [ ] Stable — no build-pass action; keep as the golden reference for this view.');
    }
    for (const s of e.structural) lines.push(`  - structural: ${s}`);
    lines.push('');
  }
  const approx = cur.objects.filter((o) => o.tier === 'approximated');
  if (approx.length) {
    lines.push('## Tier upgrades (approximated → reconstructed)');
    for (const o of approx) {
      lines.push(`- [ ] \`${o.id}\` (${o.category}, ${o.tier}): ${o.evidence} — promote with measured dims next build pass.`);
    }
    lines.push('');
  }
  lines.push(`Next: \`node scripts/parity-loop/run.mjs ${cur.board ?? '<boardDir>'}\` appends run ${cur.run + 1}.`);
  writeFileSync(CORRECTIONS, lines.join('\n') + '\n');
  console.log(`CORRECTIONS ${CORRECTIONS}`);
}

for (let i = 0; i < RUNS; i++) onePass();
console.log(`DONE runs=${RUNS} log=${LOG}`);
