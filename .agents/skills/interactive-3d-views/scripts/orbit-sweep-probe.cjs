/* orbit-sweep-probe.cjs — interaction-parity sweep for a MapLibre base behind a twin canvas.
 * For each orbit azimuth, apply the repo twinViewToMap output VERBATIM to a private map and
 * score central-ring registration (map.project(latlon) vs twin projectPinhole) plus the
 * bearing law (map bearing must equal -camYaw mod 360 — the `expected` column).
 * Expected on a healthy build: dBear 0.00 at every row; rms ~1 px, flat across the family
 * (max <= ~2.5). Failure reads: constant dBear = bearing sign regression; dBear growing with
 * |yaw| = axis-convention bug; one-sided rms rise = zoom floor/clamp biting at that end.
 *
 * Run from the app repo root (needs the repo's playwright):
 *   node "$HOME/.hermes/skills/interactive-3d-views/scripts/orbit-sweep-probe.cjs"
 * Env: PROBE_URL (default http://127.0.0.1:5175/ops3d.html?site=40.20,49.48)
 * Site is pinned to Sangachal in `const site =` below — edit that line (or clone the file)
 * to certify another site; the page's ?site= param moves the rendered app, not this math.
 *
 * App contract (safepipe ops3d): window.__twin.debug.{camera,target}, window.__twin.setView,
 * window.maplibregl, module '/src/ops3d/sat-base.js' exporting twinViewToMap /
 * projectPinhole / twinTargetToLatLon. Adapt hooks + module path for other apps.
 */
const { chromium } = require('playwright');

const URL = process.env.PROBE_URL || 'http://127.0.0.1:5175/ops3d.html?site=40.20,49.48';

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!(window.__twin && window.__twin.debug), null, { timeout: 30000 }).catch(() => {});
  const hasML = await page
    .waitForFunction(() => !!(window.maplibregl && window.maplibregl.Map), null, { timeout: 15000 })
    .then(() => true).catch(() => false);
  if (!hasML) {
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js' }).catch(() => {});
    await page.waitForFunction(() => !!(window.maplibregl && window.maplibregl.Map), null, { timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { rows: [], err: null };
    try {
      const sat = await import('/src/ops3d/sat-base.js');
      const site = { lat: 40.2, lon: 49.48 };
      const cont = document.getElementById('ops3d-dev');
      const W = cont.clientWidth || 1280;
      const H = cont.clientHeight || 800;

      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + W + 'px;height:' + H + 'px;';
      document.body.appendChild(div);
      const map = new window.maplibregl.Map({
        container: div,
        style: {
          version: 8,
          sources: { s: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?p=1'], tileSize: 256 } },
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#000' } }],
        },
        center: [site.lon, site.lat], zoom: 11, bearing: 0, pitch: 0, maxPitch: 70,
        interactive: false, attributionControl: false, fadeDuration: 0,
      });
      await new Promise((res) => { const t = setTimeout(res, 8000); map.on('load', () => { clearTimeout(t); res(); }); map.on('error', () => {}); });

      const ring = (r, n = 6) => {
        const pts = [[0, 0]];
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * i) / n;
          pts.push([+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)]);
        }
        pts.push([+(r * 0.7).toFixed(2), +(r * 0.7).toFixed(2)], [-(r * 0.7).toFixed(2), -(r * 0.7).toFixed(2)]);
        return pts;
      };

      const poses = [];
      for (const yaw of [0, 4, 10, 25, 45, 90, 135, 180, -10, -45]) poses.push({ tag: 'yaw' + yaw, yaw, pitch: 60, dist: 34 });
      poses.push({ tag: 'planR', yaw: 4, pitch: 78, dist: 62 });

      for (const p of poses) {
        const y = (p.yaw * Math.PI) / 180, pt = (p.pitch * Math.PI) / 180, d = p.dist;
        const pos = [d * Math.cos(pt) * Math.sin(y), d * Math.sin(pt), d * Math.cos(pt) * Math.cos(y)];
        window.__twin.setView(pos, [0, 0, 0]);
        await sleep(300);
        const c = window.__twin.debug.camera;
        const t = window.__twin.debug.target();
        const pose = { cp: [c.position.x, c.position.y, c.position.z], tg: [t.x, t.y, t.z], fov: c.fov };
        const v = sat.twinViewToMap({ x: pose.cp[0], y: pose.cp[1], z: pose.cp[2] }, { x: pose.tg[0], y: pose.tg[1], z: pose.tg[2] }, { heightPx: H, fovDeg: pose.fov, site });
        map.jumpTo({ center: [v.center.lon, v.center.lat], bearing: v.bearing, pitch: v.pitch, zoom: v.zoom });
        const deltas = [];
        for (const uv of ring(6)) {
          const P = { x: pose.tg[0] + uv[0], y: pose.tg[1], z: pose.tg[2] + uv[1] };
          const tp = sat.projectPinhole({ x: pose.cp[0], y: pose.cp[1], z: pose.cp[2] }, { x: pose.tg[0], y: pose.tg[1], z: pose.tg[2] }, pose.fov, W, H, P);
          if (!tp) continue;
          const ll = sat.twinTargetToLatLon({ x: P.x, z: P.z }, site);
          const mp = map.project([ll.lon, ll.lat]);
          deltas.push(Math.hypot(mp.x - tp.x, mp.y - tp.y));
        }
        const rms = Math.sqrt(deltas.reduce((s, m) => s + m * m, 0) / Math.max(1, deltas.length));
        const dx = pose.cp[0] - pose.tg[0], dz = pose.cp[2] - pose.tg[2];
        const camYaw = +(((Math.atan2(dx, dz) * 180) / Math.PI)).toFixed(1);
        const expected = +(((360 - ((camYaw % 360) + 360) % 360) % 360)).toFixed(1);
        const dBear = +Math.min(Math.abs(v.bearing - expected), 360 - Math.abs(v.bearing - expected)).toFixed(2);
        out.rows.push({
          tag: p.tag, camYaw, bearing: +v.bearing.toFixed(1), expected, dBear,
          rms: +rms.toFixed(2), max: deltas.length ? +Math.max(...deltas).toFixed(1) : null,
        });
      }
      out.done = true;
    } catch (e) { out.err = String((e && e.stack) || e); }
    return out;
  });

  console.log(JSON.stringify({ errors: errors.slice(0, 6), ...result }));
  await browser.close();
})().catch((e) => {
  console.log(JSON.stringify({ fatal: String((e && e.stack) || e) }));
  process.exit(0);
});
