# Safepipe Domain Logic — Frozen API (Plan C / Task 5)

> **Source of truth:** `Safepipe - UI.fig` (25 MB, fig-kiwi v15) — 14,481 nodes, 2,087 TEXT nodes, 83 Question instances. Every rule below is mined live via `openfig-core` and cited per module header. Behavior disputes → live `.fig` text is arbiter.

## Layer rule

`src/logic/*` — pure ESM, zero DOM, zero CSS. No `document`/`window` imports. Plan B (`src/patterns/*`) consumes only the frozen signatures below.

## Fixtures (frozen contract with Plan B)

`src/logic/fixtures.json` + `src/logic/fixtures.js`

Shape:
```js
{
  client: { name: "Motiva enterprises" },
  staff: [{ id, name, role, location, certs: string[], experienceYears, availability, workload:{wos,tasks}, qualifications:[{name, expiryDate, status}] }], // 12
  workOrders: [{ id, system, title, status, county, dueInDays, dueDate, lastInspected, assigneeId, equipment:[{name, checked}] }], // 8
  pipelines: [{ id, name, system, tabs:[Upcoming,History,Fact sheet,Constructions,Data], sections:[14] }] // 3
}
```
Values sampled verbatim from `.fig` (Motiva enterprises 10 hits, Raymond Rangel 43 hits, Nueces Bay Pipeline System, Pipeline Patrol Main Pipe, In progress 3 WOs 32 tasks, Due in 23/32 days, 50 % complete, Last inspected 12th Sep 2021, Gas Leak detector/Pressure gauge/Voltmeter, Correspondence/…/HCA Mapping, etc).

Loader:
```js
import { loadFixtures, getClient, getStaff, getWorkOrders, getPipelines, getStaffById, getWorkOrderById, getPipelineById } from './fixtures.js'
const { client, staff, workOrders, pipelines } = loadFixtures() // deep clone
```

## Frozen API — Plan B integrates against these and only these

No signature changes after this without bumping `.hermes/plans/2026-10-05_150017-safepipe-domain-logic.md`.

| Signature | Module | Description |
|---|---|---|
| `loadFixtures() → {client, staff[], workOrders[], pipelines[]}` | `fixtures.js` | Deep-clone of `fixtures.json` |
| `listWorkOrders(workOrders, filter?) → WorkOrder[]` | `workorders.js` | Filter by `{status, assigneeId|assignee, system}` — status normalized (Complated→completed, In progress→in_progress, 50 %→in_progress) case-insensitive |
| `transitionWO(wo, toStatus) → WorkOrder` | `workorders.js` | Immutable; throws on disallowed edge or `completed` with unchecked equipment. States `draft → assigned → in_progress → completed` (created==draft). |
| `woProgress(wo) → {percent, checked, total}` | `workorders.js` | `checked/total` from `equipment:{name,checked}` (legacy string/boolean fallbacks). |
| `filterStaff(staffList, {query?, availableOnly?}) → Staff[]` | `workforce.js` | Query substring over name/role/location/certs/qualifications (case-insensitive); `availableOnly` strict `availability===true` |
| `openWorkload(staffId, workOrders) → {wos, tasks}` | `workforce.js` | Counts non-completed WOs assigned to staff; `tasks = sum(equipment.length)` — mirrors fig row `In progress 3 WOs, 32 tasks` |
| `expiringOQs(staffList, withinDays=30, now?) → [{staffId, oq, daysUntilExpiry}]` | `qualifications.js` | OQs expiring in `0..withinDays` days (`daysUntilExpiry = ceil((expiry-now)/86400000)`); sorted soonest first |
| `answerQuestionnaire(formId, answers) → {complete, missing:string[], answered, total, score?}` | `inspections.js` | Data-driven `FORMS` (6 forms × 39 qs: pipelinePatrol, qcPipeline, qcFacility, moc, evaluation, mileage); `evaluation` scores Good=3…Critical=0 |

### Additional helpers (stable, non-frozen)

- `workorders.js`: `normalizeStatus(raw)`, `canTransition(from,to)`, `dueInDays(wo, now?)`, `isOverdue(wo, now?)`, `STATES`, `TRANSITIONS`
- `qualifications.js`: `daysUntilExpiry(date, now?)`, `isOQExpired(oq, now?)`, `oqStatus(oq, now?) → 'valid'|'expiring'|'grace'|'expired'`
- `workforce.js`: — (filterStaff/openWorkload are frozen)
- `inspections.js`: `FORMS`, `getForm(id)`, `validateForm(id, answers)`, `toggleQC({items}, itemId)` (Added=No→Added=Yes)
- `fixtures.js`: `getClient()`, `getStaff()`, `getWorkOrders()`, `getPipelines()`, `getStaffById(id)`, etc.

## Evidence pointers

- `workorders.js` header: FRAME `WO status` (90014:32635) Complated=Yes/No, TEXT `In progress . San Patricio County, Texas` (7), `Active` (8), `50 % complete` (8), `Due in 23/32 days` (8), Knob/Progress bar/Completed SYMBOL variants (139 hits)
- `qualifications.js` header: `Qualification expires in 1m` (10), `12 Valid OQs` (5), `32 Veriforce/NCCER/eWebOQ/Worldnet`, `Status=Compliant/Grace period/Non Compliant/Due 30<`
- `workforce.js` header: `In progress 3 WOs, 32 tasks` (2), `Search the members` (2), `Staff available` (9)
- `inspections.js` header: 83× `Question` instances, Added=Yes/No (33), Switched On/Off, 3+1/Evaluation/Grade, Mileage (MOC input, Evaluation, Mileage forms)
- `fixtures.json` strings: all 14 PIP sections, 5 tabs, equipment names, counties, last-inspected phrasing — each asserted verbatim in `tests/fixtures.test.js`

## Verification

```bash
node --test tests/           # expect 111 pass, 0 fail
npm run build                # expect vite 5.4.21 ✓ 14 modules
```

Live `.fig` audit: each seeded string in `fixtures.json`/`FORMS` exists verbatim in the binary (checked via `openfig-core` parsing in sub-agent transcripts — see `/Users/irfan/.hermes/cache/delegation/live/deleg_c799e010/task-*.log`).

## Tests

- `tests/fixtures.test.js` — 10 tests (shape, clone, verbatim)
- `tests/workorders.test.js` — 48 tests (states, guards, progress, due, filtering)
- `tests/qualifications.test.js` — 17 tests (days, expiry, status, expiringOQs)
- `tests/workforce.test.js` — 15 tests (filterStaff, openWorkload)
- `tests/inspections.test.js` — 21 tests (FORMS, answerQuestionnaire, toggleQC, verbatim)

Total: **111 tests, 21 suites, 0 fail**.
