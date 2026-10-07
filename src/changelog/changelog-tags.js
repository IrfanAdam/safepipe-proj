// safepipe changelog — tag taxonomy + auto-tagger (pure) · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Closed set of five keeps the log scannable. Explicit `**Tags:**` (plan
// preamble) / `*Tags: …*` (section body) beats keyword inference; unmatched
// sections fall back to Design System.
export const TAGS = ['Ops 3D', 'Screens', 'Domain Logic', 'Design System', 'Tooling'];
const RULES = [
  ['Ops 3D', /ops.?3d|three\.js|\btwin\b|terrain|topo|beacon|theatre|relief|contour|hillshade|parterre|compressor|drainage/i],
  ['Screens', /screen|#\/operations|workforce|\bpip\b|mobile|pattern|router|gallery|shell|operations work/i],
  ['Domain Logic', /fixture|state machine|work.?order|\bOQ\b|qualification|compliance|questionnaire|inspection|\blogic\b/i],
  ['Tooling', /tracker|manifest|changelog|trailer|plan-track|subagent|\bvite\b|drift gate|build hook/i],
  ['Design System', /design.?system|token|component|specimen|foundation|semantic|evo|parity|narrative/i],
];
export const parseExplicit = (text) => {
  const m = String(text).match(/^>?\s*\*{1,2}Tags:\*{0,2}\s*(.+?)\s*\*{0,2}\s*$/m);
  if (!m) return [];
  return m[1]
    .split(/[,;|]/)
    .map((s) => TAGS.find((c) => c.toLowerCase() === s.trim().replace(/\.+$/, '').toLowerCase()) || null)
    .filter(Boolean)
    .filter((t,
      i,
      a) => a.indexOf(t) === i);
};
export const infer = (text) => {
  const found = RULES.filter(([, re]) => re.test(String(text))).map(([t]) => t);
  return (found.length ? found : ['Design System']).slice(0, 3);
};
/* Section tags: explicit wins; thin auto (bare fallback) inherits the plan steer. */
export const tagsFor = (head, body, planSteer = []) => {
  const explicit = parseExplicit(body);
  if (explicit.length) return explicit.slice(0, 3);
  const auto = infer(`${head}\n${body}`);
  if (auto.length === 1 && auto[0] === 'Design System' && planSteer.length) return [...planSteer].slice(0, 3);
  return auto;
};
/* Plan tags: explicit preamble steer ∪ every section's tags, order-stable. */
export const planTags = (md, phases) => {
  const steer = parseExplicit(String(md).split(/^## /m)[0]);
  const union = [...steer];
  phases.forEach((p) => tagsFor(p.head, p.body, steer).forEach((t) => { if (!union.includes(t)) union.push(t); }));
  return union.length ? union : ['Design System'];
};
