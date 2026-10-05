export function renderAssets(root, fx) {
  root.innerHTML = `
  <div class="sp-assets">
    <h2>Assets</h2><p class="sp-meta">${fx.assetCards.length} cards · ${fx.pipelines[0].name}</p>
    <div class="sp-grid">${fx.assetCards.map(a => `
      <a class="sp-asset" href="#/pip"><strong>${a.name}</strong>
        <small>${a.id} · ${a.kind}</small>
        <span class="sp-pill">${a.status}</span></a>`).join('')}</div>
  </div>`;
}
