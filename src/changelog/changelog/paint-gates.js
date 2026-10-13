// safepipe changelog — gate seals stepper · [plan:2026-10-07_130000-safepipe-changelog.md#task-12]
// One quiet node per phase; the node's check IS its gate — sealed nodes carry
// the Phosphor `check` glyph inlined verbatim (polyline points + round caps,
// Light weight stroke-width 12, small box, currentColor so it stays a quiet
// token-muted mark, never a bold badge). Awaiting-review nodes are a hollow
// ring, locked/future nodes a muted dot. Click/focus a node → popover with
// verdict + reviewer + evidence + next-phase unlock (CSS :focus-within, so no
// event wiring is needed and drawer repaints never strand it open).
import { esc } from './esc.js';

// Phosphor `check` (light): verbatim glyph geometry, stroke only.
const CHECK = '<svg viewBox="0 0 256 256" width="12" height="12" fill="none" aria-hidden="true"><polyline points="216 72 104 184 48 128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="12"/></svg>';

const verdictOf = (disp) =>
  disp === 'passed' ? '✓ Passed'
  : disp === 'waiver' ? '✓ Passed — owner waiver'
  : disp === 'failed' ? '✗ Failed'
  : disp === 'locked' ? '· Locked'
  : '○ Awaiting review';

const oneLine = (s, max = 220) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
};

export function paintGates(gates) {
  if (!gates || !gates.length) return '';
  const gs = [...gates].sort((a, b) => a.n - b.n);
  const last = gs[gs.length - 1].n;
  const firstOpen = gs.findIndex((g) => g.state === 'open' || g.state === 'failed');
  const nodes = gs.map((g, i) => {
    const disp = (g.state === 'passed' || g.state === 'waiver') ? g.state
      : (i === firstOpen ? g.state : 'locked');
    const mark = (disp === 'passed' || disp === 'waiver') ? CHECK
      : disp === 'open' ? '<span class="ds-gate-ring" aria-hidden="true"></span>'
      : disp === 'failed' ? '<span class="ds-gate-ring" aria-hidden="true"></span>'
      : '<span class="ds-gate-dot" aria-hidden="true"></span>';
    const verdict = verdictOf(disp);
    const by = g.reviewer ? `reviewed by ${g.reviewer === 'owner' ? 'Irfan' : g.reviewer}${g.date ? ` · ${g.date}` : ''}` : 'not yet reviewed';
    const ev = oneLine(g.evidence || g.judge || g.note);
    const next = g.n < last ? `unlocks Phase ${String(g.n + 1).padStart(2, '0')}` : 'final sign-off';
    return `<li class="ds-gate-wrap"><button type="button" class="ds-gate" data-gate="${g.n}" data-gate-state="${disp}" aria-label="Gate ${g.n}: ${esc(verdict)}">` +
      `<span class="ds-gate-node" aria-hidden="true">${mark}</span><span class="ds-gate-label">G${g.n}</span></button>` +
      `<div class="ds-gate-pop" data-gate-pop="${g.n}" role="status"><b>${esc(verdict)}</b>` +
      `<span>${esc(by)}</span><span>${esc(ev)}</span><span>${esc(next)}</span></div></li>`;
  }).join('');
  return `<div class="ds-gates" data-gates="${gs.length}">` +
    `<div class="ds-gates-title">Gates</div>` +
    `<ol class="ds-gate-rail">${nodes}</ol></div>`;
}
