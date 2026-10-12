// src/ring2/facilities/dims.js — Phase 02 T0 structures lane, pure geometry math.
//
// NO three.js import here: node-testable dimension truth. Builders in
// tanks.js / trains.js / racks.js consume these numbers and stamp meshes
// with userData.tier. Board cites [board:F#/S#] pin every value to
// docs/reference/board-sangachal.md + scratch task10_shape_cards.md.
//
// Tier vocabulary (board § Reconciled structure list):
//   derived       — measured/quoted in a board frame (F1 seeds, F2 capacities)
//   reconstructed — dimensions computed from quoted capacities via analogues
//   approximated  — pattern/placement from EIA + practice, no surveyed fix

export const TIER = Object.freeze({
  DERIVED: 'derived',
  RECONSTRUCTED: 'reconstructed',
  APPROXIMATED: 'approximated',
});

export const BBL_TO_M3 = 0.158987;
const cylinderM3 = (dia, h) => Math.PI * (dia / 2) ** 2 * h;

/* ---- S1 crude tanks: 3× 880,000 bbl, F1-measured ~96.5 m dia [board:F1+§seeds].
 * Built dia = measured 96.5 m (board predicted 94 m — within 3%).
 * Shell h = 20 m Ceyhan anchor [board:S1]. Volume check:
 * π·48.25²·20 ≈ 146,283 m³ ≈ 920k bbl, +4.6% over nominal 880k — within 5%. */
export const CRUDE_TANK = Object.freeze({
  count: 3,
  dia: 96.5,
  shellH: 20,
  deckDrop: 0.8, // floating deck sits just below rim [board:S1]
  bundOffset: 12, // bund ring radius beyond shell [board:S1 CPC dyke pattern]
  bundH: 2.5,
  tier: TIER.DERIVED,
  // F1 OSM seed positions (lat/lon) [board:§Geometry seeds]
  seeds: Object.freeze([
    { lat: 40.205099, lon: 49.47717 },
    { lat: 40.203108, lon: 49.478951 },
    { lat: 40.20534, lon: 49.483263 },
  ]),
});
export const crudeTankVolumeM3 = () => cylinderM3(CRUDE_TANK.dia, CRUDE_TANK.shellH);
export const crudeTankVolumeBbl = () => crudeTankVolumeM3() / BBL_TO_M3;

/* ---- S1 EOP small tanks: 4× 25,500 bbl [board:F6/§Reconciled].
 * Cube-root scale from crude: (25.5/880)^(1/3) ≈ 0.307 → dia 30, h 6.
 * π·15²·6 ≈ 4,241 m³ ≈ 26.7k bbl (+4.6% over nominal — within 5%).
 * Placement approximated: row east of the crude cluster. */
export const EOP_TANK = Object.freeze({
  count: 4,
  dia: 30,
  shellH: 6,
  deckDrop: 0.5,
  bundOffset: 6,
  bundH: 1.8,
  tier: TIER.RECONSTRUCTED,
  rowSpacing: 62, // dia + bund clearance + margin
  // World-metre anchor (equirectangular, +x east / +z south of pin) [approx]
  anchor: Object.freeze({ x: 420, z: -560 }),
  tierPlacement: TIER.APPROXIMATED,
});
export const eopTankVolumeBbl = () => cylinderM3(EOP_TANK.dia, EOP_TANK.shellH) / BBL_TO_M3;

/* ---- S2 condensate + off-spec (SD block) [board:F6/S2].
 * Main 165,000 bbl ≈ 26,230 m³ → dia 42 × h 19: π·21²·19 ≈ 26,325 m³ (+0.4%).
 * Off-spec ≈ 1/4 volume → dia 26 × h 12 ≈ 6,369 m³ ≈ 40k bbl.
 * Placement approximated: SD block east of pin. */
export const CONDENSATE_TANK = Object.freeze({
  dia: 42,
  shellH: 19,
  coilH: 1.2, // heated-tank base coil cue [board:S2]
  tier: TIER.RECONSTRUCTED,
  anchor: Object.freeze({ x: 560, z: 320 }),
  tierPlacement: TIER.APPROXIMATED,
});
export const OFFSPEC_TANK = Object.freeze({
  dia: 26,
  shellH: 12,
  tier: TIER.RECONSTRUCTED,
  anchor: Object.freeze({ x: 640, z: 380 }),
  tierPlacement: TIER.APPROXIMATED,
});
export const condensateVolumeBbl = () =>
  cylinderM3(CONDENSATE_TANK.dia, CONDENSATE_TANK.shellH) / BBL_TO_M3;

/* ---- Gas spheres: F1-measured row [board:§Geometry seeds].
 * 4× ~50 m + 1× 60 m sphere. Derived positions, reconstructed supports. */
export const GAS_SPHERES = Object.freeze({
  tier: TIER.DERIVED,
  items: Object.freeze([
    { lat: 40.20123, lon: 49.480691, dia: 50 },
    { lat: 40.200474, lon: 49.479254, dia: 50 },
    { lat: 40.201997, lon: 49.482156, dia: 50 },
    { lat: 40.202747, lon: 49.48361, dia: 50 },
    { lat: 40.19338, lon: 49.459434, dia: 60 },
  ]),
});

/* ---- S3 trains: 6 oil + 2 gas modules [board:F6/S3].
 * Vessels 2–4 m dia × 10–20 m; columns 3–5 m dia × 15–30 m; parallel rows.
 * Mids of board ranges. Layout approximated (EBRD zone pattern, no fix). */
export const OIL_TRAIN = Object.freeze({
  count: 6,
  vesselDia: 3,
  vesselLen: 15,
  columnDia: 4,
  columnH: 22,
  skidW: 12,
  skidD: 8,
  skidH: 4,
  rowSpacing: 90,
  tier: TIER.APPROXIMATED,
  anchor: Object.freeze({ x: -950, z: 120 }),
});
export const GAS_TRAIN = Object.freeze({
  count: 2,
  vesselDia: 3.5,
  vesselLen: 18,
  columnDia: 5,
  columnH: 28,
  skidW: 14,
  skidD: 9,
  skidH: 4.5,
  rowSpacing: 110,
  tier: TIER.APPROXIMATED,
  anchor: Object.freeze({ x: -950, z: 420 }),
});

/* ---- S4 pipe racks: portal frames 8–12 m spacing, beam 5–6.5 m, 3–6 pipes,
 * 28–42 in mains [board:S4]. Corridors run site-scale (hundreds of metres). */
export const RACK = Object.freeze({
  frameSpacing: 10,
  beamH: 6,
  beamW: 8,
  colW: 0.6,
  pipeCount: 4,
  pipeDiaIn: 36, // mid of 28–42 in
  mains: Object.freeze([
    // E-W spine: trains → tank farm [approx]
    { from: { x: -1000, z: 40 }, to: { x: 400, z: -160 }, tier: TIER.APPROXIMATED },
    // N-S spine: SD block → spine [approx]
    { from: { x: 480, z: 420 }, to: { x: 480, z: -420 }, tier: TIER.APPROXIMATED },
    // Spur to EOP row [approx]
    { from: { x: 400, z: -160 }, to: { x: 700, z: -560 }, tier: TIER.APPROXIMATED },
  ]),
  tier: TIER.APPROXIMATED,
});
export const rackPipeDiaM = () => (RACK.pipeDiaIn * 0.0254);
export const rackLengthM = (m) => Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z);
