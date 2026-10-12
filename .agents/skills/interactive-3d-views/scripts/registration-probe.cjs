/* registration-probe.cjs — screen-px registration between a MapLibre base and a custom
 * twin canvas. Prints a JSON rms table per camera pose: candidates swept = bearing
 * {b0, mirrored} x zoom {z0 - 1 + w*log2(slant)} x the pose's own pitch.
 *
 * Run from the app repo root (needs the repo's playwright):
 *   node "$HOME/.hermes/skills/interactive-3d-views/scripts/registration-probe.cjs"
 * Env: PROBE_URL (default http://127.0.0.1:5175/ops3d.html)
 *
 * App contract (safepipe ops3d): window.__twin.debug.{camera,target},
 * window.__twin.setView(pos, tgt), window.__satbase, window.maplibregl, module
 * '/src/ops3d/sat-base.js' exporting twinViewToMap / projectPinhole /
 * twinTargetToLatLon / SITE. Adapt module path + hooks for other apps.
 * Expected after the correct law: 'bmir w1' is the best row and rms <= ~2.5 px
 * on the central ring; if 'b0' or w!=1 wins, the sync math regressed.
 */
const { chromium } = require('playwright');

const URL = process.env.PROBE_URL || 'http://127.0.0.1:5175/ops3d.html';

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!(window.__twin && window.__twin.debug && window.__satbase), null, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.maplibregl && window.maplibregl.Map), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const result = await page.evaluate(async () => {
    const out = { conv: null, blocks: {}, err: null };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const sat = await import('/src/ops3d/sat-base.js'); // pure fns only: forked copy is fine
      const site = sat.SITE;
      const cont = document.getElementById('ops3d-dev');
      const W = cont.clientWidth || 1280;
      const H = cont.clientHeight || 800;

      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + W + 'px;height:' + H + 'px;';
      document.body.appendChild(div);
      const map = new window.maplibregl.Map({
        container: div,
        style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#000' } }] },
        center: [site.lon, site.lat], zoom: 11, bearing: 0, pitch: 0,
        interactive: false, attributionControl: false,
        maxPitch: 70, // default 60 silently clamps high-pitch candidates
      });
      await new Promise((res) => { const t = setTimeout(res, 9000); map.on('load', () => { clearTimeout(t); res(); }); map.on('error', () => {}); });

      // --- convention micro-tests ---
      const mppAt = (zm, bearing, pitch) => {
        map.jumpTo({ center: [site.lon, site.lat], zoom: zm, bearing, pitch });
        const c = map.getCenter();
        const a = map.project([c.lng, c.lat]);
        const n = map.project([c.lng, c.lat + 1000 / 111320]);
        const east = map.project([c.lng + 1000 / (111320 * Math.cos((c.lat * Math.PI) / 180)), c.lat]);
        return { ns: 1000 / Math.hypot(n.x - a.x, n.y - a.y), ew: 1000 / Math.hypot(east.x - a.x, east.y - a.y), a, east };
      };
      const f = mppAt(12, 0, 0);
      const cosLat = Math.cos((site.lat * Math.PI) / 180);
      out.conv = {
        z12_ns: +f.ns.toFixed(3),
        c512: +(78271.51696 * cosLat / 4096).toFixed(3),
        c256: +(156543.03392 * cosLat / 4096).toFixed(3),
      };
      const b90 = mppAt(12, 90, 0);
      out.conv.eastRelAtBearing90 = [+(b90.east.x - b90.a.x).toFixed(1), +(b90.east.y - b90.a.y).toFixed(1)]; // ~ [0, -d] means east is up

      const ring = (r, n = 8) => {
        const pts = [[0, 0]];
        for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)]); }
        pts.push([+(r * 0.5).toFixed(2), 0], [0, +(r * 0.5).toFixed(2)]);
        return pts;
      };

      const snap = () => {
        const c = window.__twin.debug.camera;
        const t = window.__twin.debug.target();
        return { cp: [c.position.x, c.position.y, c.position.z], tg: [t.x, t.y, t.z], fov: c.fov };
      };
      const slantOf = (pose) => {
        const dx = pose.cp[0] - pose.tg[0], dy = pose.cp[1] - pose.tg[1], dz = pose.cp[2] - pose.tg[2];
        const dist = Math.hypot(dx, dy, dz) || 1;
        const elev = (Math.asin(Math.min(1, Math.max(-1, dy / dist))) * 180) / Math.PI;
        return Math.min(3, 1 / Math.max(Math.sin((Math.max(elev, 5) * Math.PI) / 180), 1 / 3));
      };
      const run = (name, pose, cand, offs) => {
        const v = sat.twinViewToMap(
          { x: pose.cp[0], y: pose.cp[1], z: pose.cp[2] },
          { x: pose.tg[0], y: pose.tg[1], z: pose.tg[2] },
          { heightPx: H, fovDeg: pose.fov, site }
        );
        const b = cand.b !== undefined ? cand.b : v.bearing;
        const z = cand.z !== undefined ? cand.z : v.zoom;
        const p = cand.p !== undefined ? cand.p : v.pitch;
        map.jumpTo({ center: [v.center.lon, v.center.lat], bearing: b, pitch: p, zoom: z });
        const deltas = [];
        for (const uv of offs) {
          const P = { x: pose.tg[0] + uv[0], y: pose.tg[1], z: pose.tg[2] + uv[1] };
          const tp = sat.projectPinhole(
            { x: pose.cp[0], y: pose.cp[1], z: pose.cp[2] },
            { x: pose.tg[0], y: pose.tg[1], z: pose.tg[2] },
            pose.fov, W, H, P
          );
          if (!tp) continue;
          const ll = sat.twinTargetToLatLon({ x: P.x, z: P.z }, site);
          const mp = map.project([ll.lon, ll.lat]);
          deltas.push([uv[0], uv[1], +(mp.x - tp.x).toFixed(1), +(mp.y - tp.y).toFixed(1)]);
        }
        const mag = deltas.map((d) => Math.hypot(d[2], d[3]));
        const rms = Math.sqrt(mag.reduce((s, m) => s + m * m, 0) / Math.max(1, mag.length));
        return {
          name,
          base: { b0: +v.bearing.toFixed(2), z0: +v.zoom.toFixed(3), p0: +v.pitch.toFixed(2) },
          applied: { b: +b.toFixed(2), z: +z.toFixed(4), p: +p.toFixed(2) },
          rms: +rms.toFixed(2),
          max: mag.length ? +Math.max(...mag).toFixed(1) : null,
        };
      };
      const doPose = async (tag, pos, offs) => {
        window.__twin.setView(pos, [0, 0, 0]);
        await sleep(350);
        const pose = snap();
        const v0 = sat.twinViewToMap(
          { x: pose.cp[0], y: pose.cp[1], z: pose.cp[2] },
          { x: pose.tg[0], y: pose.tg[1], z: pose.tg[2] },
          { heightPx: H, fovDeg: pose.fov, site }
        );
        const slant = slantOf(pose);
        const bm = +(((360 - v0.bearing) % 360).toFixed(2));
        const cases = [];
        for (const w of [0, 0.5, 1, -0.25]) {
          const z = +(v0.zoom - 1 + w * Math.log2(slant)).toFixed(4);
          cases.push(run(tag + ' bmir w' + w, pose, { b: bm, z }, offs));
          cases.push(run(tag + ' b0 w' + w, pose, { b: +v0.bearing.toFixed(2), z }, offs));
        }
        cases.sort((a, b2) => a.rms - b2.rms);
        return {
          tag,
          z0: +v0.zoom.toFixed(3),
          b0: +v0.bearing.toFixed(2),
          slant: +slant.toFixed(3),
          best: cases[0].name + ' rms=' + cases[0].rms + ' max=' + cases[0].max,
          top: cases.slice(0, 4).map((c) => c.name + ' rms=' + c.rms + ' max=' + c.max),
          win: (cases.find((c) => c.name.indexOf('bmir w1') >= 0) || {}).rms,
        };
      };
      const presetPos = (yaw, pitch, dist) => {
        const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
        return [dist * Math.cos(p) * Math.sin(y), dist * Math.sin(p), dist * Math.cos(p) * Math.cos(y)];
      };
      out.blocks.plan = await doPose('plan(4/78/62)', presetPos(4, 78, 62), ring(8));
      out.blocks.yaw45 = await doPose('yaw45(45/78/62)', presetPos(45, 78, 62), ring(8));
      out.blocks.elev60 = await doPose('elev60(26/60/34)', presetPos(26, 60, 34), ring(6));
      out.blocks.elev25 = await doPose('elev25(26/25/34)', presetPos(26, 25, 34), ring(6));
      map.remove();
      out.done = true;
    } catch (e) {
      out.err = String((e && e.stack) || e);
    }
    return out;
  });

  console.log(JSON.stringify({ errors: errors.slice(0, 6), ...result }, null, 1));
  await browser.close();
})().catch((e) => {
  console.log(JSON.stringify({ fatal: String((e && e.stack) || e) }));
  process.exit(0);
});
