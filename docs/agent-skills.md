# Agent skills this project depends on

Snapshots vendored under `.agents/skills/` (2026-10-12, source:
Hermes profile skills dir). Total ~324KB. Any harness: the `SKILL.md`
in each folder is self-contained — read it, follow it.

| Skill | Covers in this project | Used by |
| --- | --- | --- |
| `plan-traceability` | Plan ↔ commit linking, phase-shipped marking, changelog rendering (`src/ds/plan-manifest.json` via `scripts/plan-track.mjs`) | every phase close |
| `pixel-proof` | Screenshot verification (chromium + webkit probes, scroll probes) for REF GATEs | every REF GATE |
| `map-twin-crossfade` | MapLibre satellite ↔ 3D twin crossfade + headless verify | ops3d terrain phases |
| `crisp-webgl` | Sharp Three.js rendering (no-zoom-blur) | ops3d scene work |
| `interactive-3d-views` | Orbit sweeps, registration probes for twin alignment | twin geometry phases |
| `changelog-kit` | Changelog lanes + plan shapes for `changelog.html` | changelog updates |

## Without Hermes

1. Read `.agents/skills/<name>/SKILL.md` directly — procedures are plain
   markdown, no Hermes runtime needed.
2. Scripts under `.agents/skills/*/scripts/` run with plain `node`.
3. If your harness ships a newer upstream copy of the same skill, prefer
   upstream and note the version in your commit message.

## History note

Plans before `2026-10-11_202541` may cite machine-local scratch paths
(`~/.hermes/cache/...`, `~/.hermes/attachments/...`). Those are completed
phases; their evidence is in the shipped commits. The live dependency
(`docs/reference/sangachal-spec.md`) is repo-relative since 2026-10-12.
