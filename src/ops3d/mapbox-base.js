/* Safepipe Ops 3D — src/ops3d/mapbox-base.js · backward-compat adapter.
 *
 * The paid Mapbox base was replaced by the open-source MapLibre + Esri /
 * Terrarium base in ./sat-base.js (tokenless by design, no paid SDK
 * anywhere). This module re-exports the same API so existing imports keep
 * working with zero edits; new code should import from './sat-base.js'.
 */
export {
  SITE,
  LS_MIX_KEY,
  TILE_ATTRIBUTION,
  clampMix,
  twinViewToMap,
  twinViewToMapbox,
  initSatBase,
  initMapboxBase,
} from './sat-base.js';
