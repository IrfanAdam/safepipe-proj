# Legacy Figma context — `Safepipe - UI.fig` (May 2022)

Source file: `Documents/2023 before/Figs/Clarity/Safepipe - UI.fig` (26 MB, fig-kiwi v15).
Decoded 4 Oct 2026 with `openfig-core`: **14,481 nodes across 26 pages**, 741 unique component masters
(1,227 with variants), 5,311 instances, 2,087 text nodes.
Machine-readable dump: [`design-context.json`](./design-context.json). Screen wireframes: `ops-desktop`,
`workforce-desktop`, `pip-readonly` (`.svg` vector + `.png` render).

> Reference only. The revamp is a modern, web-first UI — do not copy visuals. Use this for
> **domain ontology, screen inventory, and component coverage**.

## App map (pages → screens)

| Page | Contents |
|---|---|
| 🚩 Desktop - UI | Full 1440×810 screens: **Operations** (WO detail), **Workforce** (staff directory + profile), **Assets**, Construction, Questionnaire, ACS/VI edit, + modals, dropdowns, legends, tabs |
| 🚩 Mobile - UI | 375×812 Home screens, mobile tabs, modal |
| Read only | Fact-sheet records: **PIP** (pipeline, 4574px tall), **CRM**, **FAC**, Equipments, Annuals, Devices, Clients, Inspection Sheets, Valve box, Mapping form, Reports |
| WO Forms | Work-order forms: patrol main pipe (PMP), MOC, Construction, LHS/RHS lists |
| QC Forms | QC questionnaires for Pipelines / Facilities / CRM |
| Assets Forms | Add/edit forms: CRM, Facility (FAC), Pipeline (PIP) |
| Forms | MOC, Trainee, Evaluation, Mileage, Upload, boolean inputs |
| Cards | Employee, work-order, asset, operations, filter, OQ cards + panels |
| Charts | Dark/light analytics cards, heatmap + bar/histo items (most-used viz: `Heatmap 0-25…100%`, `Bar Blue`) |
| Filters | Facility, Profiles, Client, Asset Type, Tasks |
| Components | Foundation library: Colors, Icons, Typography, Inputs, Radios & Checkboxes, Tags |
| Compositions | Sidebar, Btn, Calendar, Main navigation, form structures |
| Landing componenets | Marketing: Artefact, Feature, Drive item, Contact, Tab, Field |
| Moodboard | Visual direction refs |

## Screen patterns (validated in renders)

- **Shell:** left icon nav rail + top date/search bar + right action buttons on every desktop screen.
- **Operations (WO detail):** left panel = map/canvas + toolbar + tabs; right panel = client (`Motiva
  enterprises`) → assignee (`Raymond Rangles, Assigned 2 days ago`) → WO card (system, due pill,
  title `Pipeline Patrol Main Pipe`, status `In progress · San Patricio County, Texas`, last-inspected
  line) → equipment checklist → start/end time → tabs.
- **Workforce:** master-detail — left list (`All the Workforce / Seeing all 423 staff`, search, member
  rows with workload `In progress 3 WOs, 32 tasks`) → right profile (certs, location, `20+ yrs Exp`,
  tab strip, history, notes).
- **PIP record:** tabbed fact sheet — Upcoming / History / **Fact sheet** / Constructions / Data.
  Sections: Correspondence, Right of Way and Permits, Inspection Team, Joining, Drawings and Design,
  Material Test Reports, Welding, Nondestructive Testing, As-Built Data, Map of the pipeline system,
  **HCA Mapping**, Drug & Alcohol Sup Training, Additional Documentation.

## Component library (by usage — top instances)

Tab (600), Icon (435), Heatmap items, Tag (101), Btn (98), Tabs (98), Field (84), Question (83),
Status (50), Header (49), Company (45), Upload (43), Search, Filter, Progress, Sidebar (28),
Asset lineitem, Status dot, Calendar, Modal, Member/Profile/Client cards, Checkbox/Radio/Switch/Boolean
(`Filled/Selected/Checked/Enabled=Yes/No`), On/Off power, Eval/3+1 questionnaire inputs, Mileage.

## Type system

- **Workhorse: Barlow** (Medium 939, SemiBold 555, Bold 46) — UI text. Display accents: MuseoModerno,
  Nunito, DM Sans. Roboto only in legacy named styles (`Body/14 sp • Body 2`, `24 sp • H5`…).
- Scale: 12 / **14** / **16** body · 18 / 20 / 28 / 36 headers (plus oversized 72–288 display canvases).

## Palette (by paint frequency)

Navy `#0f3b66` (brand deep blue) · Sky `#43a9ef` (status/links) · Violet `#7b61ff` (selected states) ·
supporting blues `#cae0f5/#86b6e5/#020bd6` · alert red `#e31919` · neutrals `#000/#828282/#9e9e9e/
#f0f0f0/#f3f3f4/#fafafa/#ffffff` · 302 image fills · 275 gradients. (Material-3 tokens `#6750a4/#eaddff`
appear in later explorations.)

## Domain ontology (mined from 2,087 text nodes)

Pipeline, Patrol, Leakage Survey, Compressor Inspection, Cathodic protection, HCA Mapping, Right of Way
and Permits, Joining, Welding, Nondestructive Testing, As-Built Data, Material Test Reports, Drawings
and Design, Alignment Sheets, MOC (Management of Change), OQ (Operator Qualification — `12 Valid OQs`,
expiry), Work Orders + tasks, Construction phases, Inspection Team/Annuals/Sheets, Grading, Valve box,
Mileage, Drug & Alcohol Training, Repair & maintenance, Equipment (gas leak detector, pressure gauge,
voltmeter), Clients (Motiva enterprises), Geography (Nueces Bay, San Patricio County, King Ranch,
Colorado, Texas).

## Demo data personas (reuse for prototype fixtures)

Client `Motiva enterprises` · tech `Raymond Rangel(s)` (Repair & maintenance, Colorado, 14 certs, 20+
yrs) · systems `Nueces Bay Pipeline System` · `Controls 3 Pipelines`.

## Gaps vs. new vision (ontology UI + digital twin)

Legacy covers CRUD/forms/records well; **no network-topology view, no twin canvas, no integrity
overlays** — those are net-new in `docs/digital-twin.md` / `docs/ontology.md`.
