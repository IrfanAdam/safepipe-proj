# Digital twin (v0 placeholder)

Goal: ontology-driven digital replica — each `Segment` has a twin node with
live sensor state, inspection history, and predicted risk.

v0: static SVG schematic in `index.html`. Later: map/3D view bound to the same
`SEGMENTS` + telemetry feed. Contract: twin reads `src/logic/ontology.js`
shapes only, never DOM.
