# ARCHITECTURE — Safepipe (boilerplate, mirrors crm_proj layers)

Web-first. Root Vite app is the prototype; mobile is a stub shell.

## Layer map

| Layer | Owns | Never imports |
| --- | --- | --- |
| mounts (`index.html`) | stylesheet/script links + `#app` mounts | styling, logic |
| `src/patterns/` | app screens (Network, Twin, Integrity, WorkOrders), vanilla, no device knowledge | device/os |
| `src/logic/` | pure ontology + state machines, zero DOM, unit-testable | DOM, always |
| `src/components/` | DS single source (cards, pills, tables), gallery-proven later | prototype screens |
| `design-system/` | tokens (`tokens.css`) + docs; only `var(--token)` colours elsewhere | — |
| `apps/mobile/` | future mobile shell (PWA/native wrapper around same ontology) | web chrome |
| `docs/` | ontology graph, digital-twin contract, reference notes | code |

Rules (from crm_proj): patterns → components/tokens only; logic never touches
DOM; every colour/size via `var(--token)`; no raw hex outside `tokens.css`.

## Ontology (v0 stub)

`Field → Pipeline → Segment → Sensor | Inspection | WorkOrder | RiskEvent`
See `docs/ontology.md` and `src/logic/ontology.js`.

## Digital twin (v0 stub)

Static SVG schematic + sensor dots in `index.html`; live twin (map + telemetry)
lands per `docs/digital-twin.md`. No backend yet — stub data in `src/app.js`.
