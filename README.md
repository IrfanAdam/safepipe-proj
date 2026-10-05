# Safepipe — Oil & Gas Pipeline Management (boilerplate)

Web-first starter for pipeline operations: network overview, ontology-based
asset model, and a digital-twin placeholder. Modern revamped UI (not a replica
of the 2022 `Safepipe - UI.fig` reference).

Structure mirrors `crm_proj` conventions:

- **webapp (web-first)** — root Vite app (`index.html`, `src/`) — the live prototype
- **mobile app** — `apps/mobile/` stub (later shell, PWA or native)
- **design system** — `design-system/` tokens + component source (`src/components/`)
- **architecture** — `ARCHITECTURE.md` + `docs/` (ontology, digital twin)

## Quickstart

```bash
npm install
npm run dev      # http://127.0.0.1:5175/
npm run build
```

## Reference

Old design exploration (2022, superseded — modern revamp planned):
`~/Documents/2023 before/Figs/Clarity/Safepipe - UI.fig` — see `docs/reference.md`.
