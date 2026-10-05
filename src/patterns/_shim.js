/* Local shims for Plan A components (src/components/* not yet landed).
 * Same-named exports; delete at integration when real components exist.
 * Uses only var(--sp-*) tokens with fallbacks to current tokens. */
export function pill(text, kind = '') {
  return `<span class="sp-pill ${kind}">${text}</span>`;
}
export function memberRow(m) {
  return `<div class="sp-member" data-member="${m.name}">
    <span class="sp-avatar" aria-hidden="true"></span>
    <span class="sp-member-main"><strong>${m.name}</strong><small>${m.role}</small></span>
    <span class="sp-member-work">In progress ${m.workload.wos} WOs, ${m.workload.tasks} tasks</span>
  </div>`;
}
export function woCard(wo) {
  return `<p class="sp-sys">${wo.system}</p><h3>${wo.title}</h3>
    <p class="sp-status">${wo.status} · ${wo.county}</p>
    <p class="sp-meta">${wo.lastInspected}</p>`;
}
export function tabStrip(tabs, active = 0) {
  return `<div class="sp-tabs" role="tablist">${tabs.map((t, i) =>
    `<button role="tab" aria-selected="${i === active}" data-tab="${i}">${t}</button>`).join('')}</div>`;
}
export function sectionBlock(title, body) {
  return `<section class="sp-section"><h4>${title}</h4><p>${body}</p></section>`;
}
