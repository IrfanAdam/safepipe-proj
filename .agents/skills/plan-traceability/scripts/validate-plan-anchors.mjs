/* Validate plan ↔ commit anchors against the REAL renderer rules.
   Usage:
     node validate-plan-anchors.mjs [repoRoot]
       → checks every entry in <repoRoot>/.hermes/plan-links.json
     node validate-plan-anchors.mjs [repoRoot] <file.md> <anchor> [<file.md> <anchor> ...]
       → checks candidate pairs BEFORE writing plan-links.json or a trailer
   A valid anchor must be (a) a verbatim substring of the RAW plan text — else
   unlinked() keeps listing the commit — and (b) a substring of exactly ONE
   norm()-transformed phase body — else hits() badges zero or many phases.
   Ports chunks/norm/split from src/ds/pages-changelog.js; re-sync if changed.
   Exit 0 = all valid. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
let root = process.cwd();
if (args.length && !args[0].endsWith('.md')) root = args.shift();
const pairs = [];
while (args.length) {
  const file = args.shift(); const anchor = args.shift();
  if (!anchor) { console.error('need <file.md> <anchor> pairs'); process.exit(2); }
  pairs.push([file, anchor]);
}

const plansDir = join(root, '.hermes/plans');
const read = (f) => { try { return readFileSync(join(plansDir, f), 'utf8'); } catch { return ''; } };

/* —— ports of pages-changelog.js (keep in sync) —— */
const chunks = (md) => md.split(/^## /m);
const norm = (body) => {
  if (/^- \[[ xX]\]/m.test(body)) return body;
  const parts = body.split(/^### /m); const head = parts.shift();
  const items = parts.map((p) => {
    const lines = p.split('\n'); const title = lines.shift().trim();
    const m = title.match(/^Task\s+([\d-]+):\s*(.+)$/); const num = m ? m[1] : ''; let name = m ? m[2] : title;
    const done = /✓/i.test(title); name = name.replace(/✓\s*done\s*—?/i, '').replace(/✓/g, '').trim().replace(/\.*$/, '.');
    const detail = lines.join(' ').replace(/\s+/g, ' ').trim();
    return `- [${done ? 'x' : ' '}] **${num} ${name}** ${done ? '✓ done — ' : ''}${detail}`;
  }); return head + items.join('\n');
};
const split = (md) => chunks(md).slice(1).map((s) => {
  const nl = s.indexOf('\n'); return { head: s.slice(0, nl).trim(), body: norm('## ' + s) };
}).filter((s) => /^Phase /.test(s.head));
/* ————————————————————————————————————————————— */

let allOk = true;
const check = (file, anchor) => {
  const md = read(file);
  if (!md) { console.log(`✗ ${file} — not found under ${plansDir}`); return false; }
  const raw = md.includes(anchor);
  const bodies = split(md).filter((s) => s.body.includes(anchor)).map((s) => s.head);
  const ok = raw && bodies.length === 1;
  console.log(`${ok ? '✓' : '✗'} ${file}  «${anchor}»  raw:${raw}  phaseBodies:${bodies.length}  -> ${JSON.stringify(bodies)}`);
  if (!raw) console.log('   raw miss → unlinked() will keep listing the commit');
  else if (bodies.length !== 1) console.log('   body hits ≠ 1 → badge lands nowhere (0) or duplicates (>1)');
  return ok;
};

const linksPath = join(root, '.hermes/plan-links.json');
if (existsSync(linksPath)) {
  const links = JSON.parse(readFileSync(linksPath, 'utf8')).links || {};
  const shas = Object.keys(links);
  console.log(`— .hermes/plan-links.json: ${shas.length} entries —`);
  for (const sha of shas) {
    const { plan, anchor } = links[sha];
    if (anchor == null) {
      const sp = split(read(plan));
      const ok = sp.length > 0;
      console.log(`${ok ? '✓' : '✗'} ${sha} ${plan}  null → first phase: ${sp[0] ? sp[0].head : 'NONE'}`);
      allOk = allOk && ok;
    } else {
      allOk = check(plan, anchor) && allOk;
    }
  }
} else if (!pairs.length) {
  console.log(`(no ${linksPath})`);
}

for (const [file, anchor] of pairs) allOk = check(file, anchor) && allOk;
console.log(allOk ? '✓ all anchors valid' : '✗ failures present — fix before writing plan-links.json / the trailer');
process.exit(allOk ? 0 : 1);
