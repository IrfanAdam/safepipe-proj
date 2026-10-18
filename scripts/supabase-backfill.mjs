// One-shot backfill: every live *Due* in .hermes/plans/*.md → Supabase.
// Usage: node scripts/supabase-backfill.mjs --dry | --apply
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side only).
// Idempotent: reruns converge (same due → no new version, no new event).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { split, dueOf } from '../src/changelog/changelog-parse.js';
import { normHead } from '../src/logic/due-overrides.js';
import { upsertSchedule } from '../api/schedule.js';

const mode = process.argv[2] === '--apply' ? 'apply' : 'dry';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.hermes', 'plans');
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const items = [];
for (const file of files) {
  const md = readFileSync(join(dir, file), 'utf8');
  for (const sec of split(md)) {
    const due = dueOf(sec);
    if (due) items.push({ file, section_key: normHead(sec.head), due });
  }
}
console.log(`BACKFILL ${mode}: ${items.length} dues`);
for (const it of items) console.log(`  ${it.file} :: ${it.section_key} -> ${it.due}`);
if (mode === 'dry') process.exit(0);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('BACKFILL-FAIL missing env'); process.exit(1); }
let bumped = 0;
for (const it of items) {
  const r = await upsertSchedule({ url, key, ...it, actor: 'backfill', idempotencyKey: randomUUID(), source: 'backfill' });
  if (!r.deduped) bumped++;
  console.log(`  ${r.deduped ? 'converged' : 'wrote v' + r.row.version} ${it.file}`);
}
console.log(`BACKFILL done: ${bumped} new versions, ${items.length - bumped} converged`);
