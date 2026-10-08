// safepipe changelog — title nomenclature (pure) · [plan:2026-10-07_130000-safepipe-changelog.md#task-2]
// Cards show a sentence-style title derived from plan context (goal first,
// then H1, then slug); the raw file identity moves into the drawer above
// the footer. Full goal stays in tooltip + footer, untruncated.
const clean = (s) => String(s || '')
  .replace(/\\"/g, '"')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[`*~]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const clip = (s,
  max) => { s = String(s || '').trim(); if (s.length <= max) return s; const cut = s.slice(0,
      max - 1).replace(/\s+\S*$/,
      ''); return (cut || s.slice(0, max - 1)).trim().replace(/["'“‘(\[]$/,
      '') + '…'; };
const CLAUSE_RE = /\s[—–]\s|[.?!;:](?:\s|$)/;
const clauses = (s) => String(s)
  .split(CLAUSE_RE).map((x) => x.trim()).filter(Boolean);
/* First clause wins when substantive (≥32 chars); else the whole text clipped at a word boundary. */
const sentOf = (s,
  max) => { const c = clean(s);
    if (!c) return '';
    const f = clauses(c)[0] || '';
    return clip(cap(f.length >= 32 ? f : c),
      max); };
const cleanH1 = (h1) => String(h1 || '')
  .replace(/^Plan\s*[—–-]\s*/i, '')
  .replace(/\s*[—–-]\s*Continuation\s+\S+\s*$/i, '')
  .replace(/\s+Implementation Plan\s*$/i, '')
  .replace(/\s+Plan\s*$/i, '')
  .replace(/\s*[—–-]\s*$/, '')
  .trim();
export const h1Of = (md) => ((md.match(/^#\s+(.+)$/m) || [])[1] || '').trim();
// Single-line plain text for [data-tip] attributes: strip markdown
// (**bold**, `code`, links, {#anchors}, HTML) and collapse all whitespace so
// no raw newlines ever land inside an attribute value.
export const oneLine = (s) => String(s || '')
  .replace(/\{#[^}]*\}/g, ' ')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<\/?[^>]+>/g, ' ')
  .replace(/[`*_~]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
// Tooltip text: first substantive clause of the section description; falls
// back to the short head title so the tip is never an empty tiny box.
// (descOf returns '' for norm()-collapsed `- [ ] **Title** …` checkbox bodies,
// which previously produced empty popovers.)
export const tipOf = (head, body, max = 100) => {
  const raw = clip(oneLine(sentOf(descOf(body), max) || shortPhase(head)), max)
    || clip(oneLine(shortPhase(head)), max);
  return String(raw || '').replace(/^Objective:\s*/i, '');
};
// Generalized: `Phase 2 — X`, `Task 10: X`, `Step 0 — X` → `X`.
export const shortPhase = (h) => String(h || '')
  .replace(/`/g, '')
  .replace(/^(Phase|Task|Step)\s+[\d–-]+\s*[—–\-:]\s*/i, '')
  .replace(/\s*\{#[^}]*\}\s*$/g, '')
  .replace(/\s*[✓✗]\s*(done|cancelled)?\s*[—–\-–]?/gi, '')
  .trim().replace(/\.+$/, '');
// Rail label: `Task 01`, `Phase 02`, `Step 00` (fallback: position).
export const unitLabel = (h, i) => {
  const m = String(h || '').match(/^(Phase|Task|Step)\s+([\d–-]+)/i);
  if (m) {
    const word = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return `${word} ${String(m[2]).padStart(2, '0')}`;
  }
  return `Item ${String(i + 1).padStart(2, '0')}`;
};
export const planSentence = ({ h1, goal, slug },
  max = 76) => sentOf(goal,
  max) || sentOf(cleanH1(h1),
  max) || clip(cap(clean(String(slug || '').replace(/[_-]+/g, ' '))),
  max);
export const descOf = (body) => {
  let text = String(body || '').replace(/^## .*$/m, '');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\{#[^}]*\}/g, ' ');
  for (const b of text.split(/\n\n+/)) {
    const t = b.trim();
    if (!t || /^(#|\*Tags\*?|\*Shipped|- |\* |\d\. |\||>|---)/.test(t)) continue;
    const d = t
      .replace(/^\*|\*$/g, '')
      .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/[*`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!d || /^[-—–…\s]+$/.test(d)) continue;
    return d;
  } return '';
};
export const phaseSentence = (head, body, max = 64) => sentOf(descOf(body), max) || clip(shortPhase(head), max);
const words = (s) => clean(String(s).toLowerCase()).replace(/[^a-z0-9/+\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
/* Provenance: stable slug + generalized purpose. Drops timestamps/boilerplate;
   when the H1 head just echoes the slug, only the tail (the purpose) is kept. */
export const provenance = ({ file,
    h1,
    slug,
    purpose }) => { const id = String(slug || file || '').replace(/\.md$/,
    '');
    let topic = clean(purpose || '') || cleanH1(clean(h1 || ''));
    const m = topic
      .match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (m && words(m[2]).length >= 3) { const head = words(m[1]);
      const set = new Set(words(id));
      if (head.length && head.filter((w) => set.has(w)).length >= Math.ceil(head.length / 2)) topic = m[2]
        .trim();
    } return [id,
    topic].filter(Boolean).join(' · '); };
