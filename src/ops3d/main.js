/* Safepipe Ops 3D — src/ops3d/main.js · dev-harness entry (not shipped UI).
 * Mounted by a bare harness page during development for screenshots.
 */
import { createTwin } from './twin.js';

const el = document.getElementById('ops3d-dev');
if (!el) throw new Error('ops3d dev harness: #ops3d-dev missing');
window.__twin = createTwin(el, {
  // eslint-disable-next-line no-console
  onSelect: (id) => console.log('[ops3d] select', id),
});
