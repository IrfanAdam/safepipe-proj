// src/ring2/facilities/tanks.js — T0 tank builders (S1/S2 + F1 gas spheres).
// Floating-roof crude ×3 at F1 seeds + 4 small EOP + condensate/off-spec.
// Every mesh gets userData.tier. Base y=0; parent wires siting/grounding.
// Repeated geometries are module-level cached per dimension key: the 9 tanks
// + 5 spheres share identical shell/deck/rim/stair/bund/sphere geos instead
// of per-tank `new`s. EdgesGeometry rims on shells/decks give crisp
// NEAR/MACRO silhouettes (open-cylinder + disc boundary loops only —
// threshold 25° suppresses the 48 facet verticals/spokes).
// [board:§Geometry seeds, S1, S2]
import * as THREE from 'three';
import { geoToWorld } from '../site.js';
import { CRUDE_TANK, EOP_TANK, CONDENSATE_TANK, OFFSPEC_TANK, GAS_SPHERES, TIER } from './dims.js';

const shellMat = () => new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.75, metalness: 0.25, side: THREE.DoubleSide }); // weathered aluminum-steel, provisional [board:S1]
const deckMat = () => new THREE.MeshStandardMaterial({ color: 0x8f9296, roughness: 0.9, metalness: 0.2 }); // deck/rim shadow band [board:S1]
const bundMat = () => new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 }); // concrete bund [board:S1]
const stairMat = () => new THREE.MeshStandardMaterial({ color: 0xb99a2e, roughness: 0.7 }); // safety-yellow accent, low confidence [board:S1]
const sphereMat = () => new THREE.MeshStandardMaterial({ color: 0xdcd8cc, roughness: 0.6, metalness: 0.3 });
const coilMat = () => new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.8, metalness: 0.4 }); // heat-tracing [board:S2]

const tag = (mesh, tier, kind) => { mesh.userData.tier = tier; mesh.userData.kind = kind; return mesh; };

/* ---- Module-level geometry caches: identical dims reuse one geometry. ---- */
const tankGeoCache = new Map();
function tankGeos(dia, shellH, { deckDrop, bundOffset, bundH }) {
  const key = `${dia}|${shellH}|${deckDrop}|${bundOffset}|${bundH}`;
  let s = tankGeoCache.get(key);
  if (!s) {
    const r = dia / 2;
    const shell = new THREE.CylinderGeometry(r, r, shellH, 48, 1, true);
    const deck = new THREE.CircleGeometry(r - 0.5, 48);
    s = {
      shell,
      shellEdges: new THREE.EdgesGeometry(shell, 25), // top + bottom rim loops only
      deck,
      deckEdges: new THREE.EdgesGeometry(deck, 25), // deck perimeter loop only
      rim: new THREE.TorusGeometry(r, 0.3, 8, 48),
      stair: new THREE.BoxGeometry(1.4, shellH * 1.06, 0.5),
      bund: new THREE.CylinderGeometry(r + bundOffset, r + bundOffset, bundH, 48, 1, true),
    };
    tankGeoCache.set(key, s);
  }
  return s;
}

const sphereGeoCache = new Map();
function sphereGeos(dia) {
  let s = sphereGeoCache.get(dia);
  if (!s) {
    const r = dia / 2;
    const legH = Math.max(4, dia * 0.18);
    const ball = new THREE.SphereGeometry(r, 32, 24);
    s = {
      legH,
      ball,
      leg: new THREE.CylinderGeometry(0.5, 0.6, legH, 8),
      equator: new THREE.TorusGeometry(r + 0.3, 0.2, 8, 40),
    };
    sphereGeoCache.set(dia, s);
  }
  return s;
}

const coilGeoCache = new Map();
function coilGeo(dia) {
  let g = coilGeoCache.get(dia);
  if (!g) {
    g = new THREE.TorusGeometry(dia / 2 + 0.8, 0.25, 8, 40);
    coilGeoCache.set(dia, g);
  }
  return g;
}

const _edge = { v: null };
function edgeLineMat() { if (!_edge.v) _edge.v = new THREE.LineBasicMaterial({ color: 0x5a5e62, transparent: true, opacity: 0.85 }); return _edge.v; }

/** Floating-roof tank: open shell + deck disc below rim + rim torus + spiral-stair cue + bund ring. */
export function makeFloatingRoofTank(dia, shellH, { deckDrop = 0.8, bundOffset = 12, bundH = 2.5, shellTier = TIER.DERIVED } = {}) {
  const g = new THREE.Group();
  const r = dia / 2;
  const geos = tankGeos(dia, shellH, { deckDrop, bundOffset, bundH });
  const shell = tag(new THREE.Mesh(geos.shell, shellMat()), shellTier, 'tank-shell');
  shell.position.y = shellH / 2;
  g.add(shell);
  const shellRim = tag(new THREE.LineSegments(geos.shellEdges, edgeLineMat()), shellTier, 'tank-shell-edges');
  shellRim.position.y = shellH / 2;
  g.add(shellRim);
  const deck = tag(new THREE.Mesh(geos.deck, deckMat()), shellTier, 'tank-deck');
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = shellH - deckDrop;
  g.add(deck);
  const deckRim = tag(new THREE.LineSegments(geos.deckEdges, edgeLineMat()), shellTier, 'tank-deck-edges');
  deckRim.rotation.x = -Math.PI / 2;
  deckRim.position.y = shellH - deckDrop;
  g.add(deckRim);
  const rim = tag(new THREE.Mesh(geos.rim, deckMat()), TIER.RECONSTRUCTED, 'tank-rim');
  rim.rotation.x = Math.PI / 2;
  rim.position.y = shellH;
  g.add(rim);
  // Stair cue: slanted band on shell exterior (generic terminal convention) [board:S1]
  const stair = tag(new THREE.Mesh(geos.stair, stairMat()), TIER.APPROXIMATED, 'tank-stair');
  stair.position.set(r * Math.SQRT1_2, shellH / 2, r * Math.SQRT1_2);
  stair.rotation.y = Math.PI / 4;
  stair.rotation.z = 0.12;
  g.add(stair);
  // Bund (dyke) containment ring, CPC 120% pattern [board:S1]
  const bund = tag(new THREE.Mesh(geos.bund, bundMat()), TIER.RECONSTRUCTED, 'tank-bund');
  bund.position.y = bundH / 2;
  g.add(bund);
  return g;
}

/** Heated condensate variant: S1 builder + base coil ring [board:S2]. */
export function makeCondensateTank(dia, shellH, coilH = 1.2) {
  const g = makeFloatingRoofTank(dia, shellH, { deckDrop: 0.6, bundOffset: 8, bundH: 2, shellTier: TIER.RECONSTRUCTED });
  const coil = tag(new THREE.Mesh(coilGeo(dia), coilMat()), TIER.RECONSTRUCTED, 'tank-coil');
  coil.rotation.x = Math.PI / 2;
  coil.position.y = coilH;
  g.add(coil);
  return g;
}

/** Gas sphere on legs + equator pipe [board:§Geometry seeds positions; supports reconstructed]. */
export function makeGasSphere(dia) {
  const g = new THREE.Group();
  const r = dia / 2;
  const geos = sphereGeos(dia);
  const legH = geos.legH;
  const ball = tag(new THREE.Mesh(geos.ball, sphereMat()), TIER.DERIVED, 'sphere-shell');
  ball.position.y = legH + r;
  g.add(ball);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leg = tag(new THREE.Mesh(geos.leg, deckMatShared()), TIER.RECONSTRUCTED, 'sphere-leg');
    leg.position.set(Math.cos(a) * r * 0.7, legH / 2, Math.sin(a) * r * 0.7);
    g.add(leg);
  }
  const eq = tag(new THREE.Mesh(geos.equator, coilMat()), TIER.RECONSTRUCTED, 'sphere-pipe');
  eq.rotation.x = Math.PI / 2;
  eq.position.y = legH + r;
  g.add(eq);
  return g;
}
const _deck = { v: null };
function deckMatShared() { if (!_deck.v) _deck.v = deckMat(); return _deck.v; }

/** All T0 tanks sited in board world frame (+x east, +z south of pin). */
export function buildTanks() {
  const g = new THREE.Group();
  g.name = 'T0-tanks';
  for (const s of CRUDE_TANK.seeds) {
    const w = geoToWorld(s.lat, s.lon);
    const t = makeFloatingRoofTank(CRUDE_TANK.dia, CRUDE_TANK.shellH, { deckDrop: CRUDE_TANK.deckDrop, bundOffset: CRUDE_TANK.bundOffset, bundH: CRUDE_TANK.bundH });
    t.position.set(w.x, 0, w.z);
    g.add(t);
  }
  for (let i = 0; i < EOP_TANK.count; i++) {
    const t = makeFloatingRoofTank(EOP_TANK.dia, EOP_TANK.shellH, { deckDrop: EOP_TANK.deckDrop, bundOffset: EOP_TANK.bundOffset, bundH: EOP_TANK.bundH, shellTier: TIER.RECONSTRUCTED });
    t.position.set(EOP_TANK.anchor.x + i * EOP_TANK.rowSpacing, 0, EOP_TANK.anchor.z);
    t.userData.tierPlacement = EOP_TANK.tierPlacement;
    g.add(t);
  }
  const c = makeCondensateTank(CONDENSATE_TANK.dia, CONDENSATE_TANK.shellH, CONDENSATE_TANK.coilH);
  c.position.set(CONDENSATE_TANK.anchor.x, 0, CONDENSATE_TANK.anchor.z);
  c.userData.tierPlacement = CONDENSATE_TANK.tierPlacement;
  g.add(c);
  const o = makeFloatingRoofTank(OFFSPEC_TANK.dia, OFFSPEC_TANK.shellH, { deckDrop: 0.6, bundOffset: 6, bundH: 1.8, shellTier: TIER.RECONSTRUCTED });
  o.position.set(OFFSPEC_TANK.anchor.x, 0, OFFSPEC_TANK.anchor.z);
  o.userData.tierPlacement = OFFSPEC_TANK.tierPlacement;
  g.add(o);
  for (const s of GAS_SPHERES.items) {
    const w = geoToWorld(s.lat, s.lon);
    const sp = makeGasSphere(s.dia);
    sp.position.set(w.x, 0, w.z);
    g.add(sp);
  }
  return g;
}
