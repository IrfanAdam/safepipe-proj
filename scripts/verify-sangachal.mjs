import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (f) => join(ROOT, f);
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && cond ? '' : ' — ' + extra}`);
  if (!cond) fail++;
};

// Guard: child-written files must exist (mid-run ENOENT = pending, not green)
for (const f of ['src/ops3d/dem.js', 'src/ops3d/sat-base.js', 'gallery.html']) {
  check(`exists ${f}`, existsSync(P(f)));
}
const dem = existsSync(P('src/ops3d/dem.js')) ? readFileSync(P('src/ops3d/dem.js'), 'utf8') : '';
const sat = existsSync(P('src/ops3d/sat-base.js')) ? readFileSync(P('src/ops3d/sat-base.js'), 'utf8') : '';
const gal = existsSync(P('gallery.html')) ? readFileSync(P('gallery.html'), 'utf8') : '';

// Non-vacuous baselines
check('dem non-empty', dem.length > 10000, `len=${dem.length}`);
check('sat non-empty', sat.length > 10000, `len=${sat.length}`);
check('gallery non-empty', gal.length > 5000, `len=${gal.length}`);

// Lane A contract
check('SANGACHAL pin', /export const SANGACHAL/.test(dem) && /40\.20/.test(dem) && /49\.48/.test(dem));
check('extent-aware parseSiteParam', /extentKm/.test(dem));
check('FM default intact', /57\.03/.test(dem) && /extentKm: 44/.test(dem));

// Lane B contract
check('scopeRadiusForSite', /scopeRadiusForSite/.test(sat));
check('SCOPE_R_KM compat', /SCOPE_R_KM/.test(sat));
check('extent-scaled zoom', /Math\.log2\(44/.test(sat));

// Lane C contract
check('sangachal frame', gal.includes('ops3d-sangachal'));
check('namespaced storage', gal.includes('sangachal') && /ops3d\.(mix|scope)\.sangachal/.test(gal));
check('first tab intact', gal.includes('data-panel="ops3d"') && gal.includes('data-tab="ops3d"') && gal.includes("getElementById('ops3d-specimen')"));

process.exit(fail ? 1 : 0);
