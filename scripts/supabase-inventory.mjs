// Due inventory probe — read-only, never writes.
// Reuses split + dueOf (nearest-level rule) and normHead (shared key core).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { split, dueOf } from '../src/changelog/changelog-parse.js';
import { normHead } from '../src/logic/due-overrides.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.hermes', 'plans');
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const out = [];
for (const file of files) {
  const md = readFileSync(join(dir, file), 'utf8');
  for (const sec of split(md)) {
    const due = dueOf(sec);
    if (due) out.push({ file, head: sec.head, section_key: normHead(sec.head), due });
  }
}
console.log(JSON.stringify(out, null, 2));
console.error(`INVENTORY count=${out.length} files=${files.length}`);
