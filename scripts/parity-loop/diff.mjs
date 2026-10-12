#!/usr/bin/env node
/* parity-loop/diff.mjs — diff captures vs board frames (pixel + structural).
 * Pure node, zero new deps: minimal PNG decode (8-bit RGB/RGBA, non-interlaced
 * — what Chromium writes) + thumbnail MAD. Missing board frames are reported
 * as gaps, NEVER failures (exit 0, status gap:no-board-frame).
 * Usage: node scripts/parity-loop/diff.mjs --captures <dir> --board <dir|-> --out <diff.json> [--prev-probes <path>] */
import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]?.startsWith('--') ? '1' : arr[i + 1]]] : [],
  ),
);
const CAP = args.captures, BOARD = args.board, OUT = args.out;
if (!CAP || !OUT) { console.error('diff.mjs: --captures <dir> --out <file> required'); process.exit(1); }

const VIEWS = ['TOP', 'ISO', 'NEAR'];
const ALIASES = { TOP: ['top', 'network', 'level1'], ISO: ['iso', 'segment', 'level2'], NEAR: ['near', 'asset', 'level3'] };

// --- minimal PNG decode (color types 2/6, bit depth 8, interlace 0) ---
function decodePNG(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, ctype = 0, depth = 0, interlace = -1;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) {
    throw new Error(`unsupported PNG (depth=${depth} ctype=${ctype} interlace=${interlace})`);
  }
  const ch = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let p = 0;
  let prev = Buffer.alloc(stride, 0);
  const paeth = (a, b, c) => {
    const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const recon = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? recon[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      recon[i] = (raw[p++] + pred) & 255;
    }
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4, s = x * ch;
      out[d] = recon[s]; out[d + 1] = recon[s + 1]; out[d + 2] = recon[s + 2];
      out[d + 3] = ch === 4 ? recon[s + 3] : 255;
    }
    prev = recon;
  }
  return { w, h, data: out };
}

function thumbnail(img, tw = 256) {
  const th = Math.max(1, Math.round((img.h / img.w) * tw));
  const out = new Float32Array(tw * th * 3);
  const sx = img.w / tw, sy = img.h / th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const ix = Math.min(img.w - 1, x * sx | 0), iy = Math.min(img.h - 1, y * sy | 0);
      const s = (iy * img.w + ix) * 4, d = (y * tw + x) * 3;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2];
    }
  }
  return { tw, th, data: out };
}

function pixelDiff(aPath, bPath) {
  const a = thumbnail(decodePNG(readFileSync(aPath)));
  const b = thumbnail(decodePNG(readFileSync(bPath)));
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0, changed = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    sum += d;
    if (d > 12) changed++;
  }
  return {
    mad: +(sum / n).toFixed(2), // mean abs diff, 0-255 scale
    changedPct: +((changed / n) * 100).toFixed(2),
    verdict: sum / n < 3 ? 'stable' : sum / n <= 12 ? 'minor' : 'major',
  };
}

function findBoardFrame(dir, view) {
  if (!dir || dir === '-' || !existsSync(dir)) return null;
  const files = readdirSync(dir);
  const want = [view.toLowerCase(), ...ALIASES[view]];
  for (const f of files) {
    const base = basename(f).toLowerCase().replace(/\.(png|jpg|jpeg|webp)$/, '');
    if (want.includes(base)) return join(dir, f);
  }
  return null;
}

let prevProbes = null;
try { if (args['prev-probes']) prevProbes = JSON.parse(readFileSync(args['prev-probes'], 'utf8')); } catch { /* no history yet */ }
const probes = JSON.parse(readFileSync(join(CAP, 'probes.json'), 'utf8'));

const result = { views: {} };
for (const v of VIEWS) {
  const cap = join(CAP, `${v}.png`);
  const board = findBoardFrame(BOARD, v);
  const entry = { capture: cap, board, consoleErrors: probes.errors?.length ?? 0 };
  // structural notes: pose / canvas / liveness vs previous run
  const cur = probes.views[v] ?? {};
  const prev = prevProbes?.views?.[v] ?? null;
  const notes = [];
  const canvases = (cur.canvases ?? []).map((c) => `${c.w}x${c.h}`).join(',');
  notes.push(`canvases[${canvases || 'none'}] preset=${cur.preset ?? '?'}`);
  if (cur.pose) notes.push(`pose=${JSON.stringify(cur.pose).slice(0, 160)}`);
  if (cur.diag?.frames != null && prev?.diag?.frames != null) {
    notes.push(cur.diag.frames > prev.diag.frames ? 'renderer alive (frames advanced)' : 'frames STALLED vs prev run');
  }
  if ((probes.errors?.length ?? 0) > 0) notes.push(`console errors: ${probes.errors.length} (see probes.json)`);
  if (!board) {
    entry.status = 'gap:no-board-frame';
    entry.pixel = null;
    notes.push(`gap: no ${v}.png (or alias ${ALIASES[v].join('/')}) in board dir — capture kept, no verdict`);
  } else {
    try {
      entry.status = 'compared';
      entry.pixel = pixelDiff(cap, board);
      notes.push(`pixel MAD=${entry.pixel.mad} changed=${entry.pixel.changedPct}% verdict=${entry.pixel.verdict}`);
    } catch (e) {
      entry.status = 'gap:undecodable-frame';
      entry.pixel = null;
      notes.push(`gap: diff failed (${e.message}) — capture kept, no verdict`);
    }
  }
  entry.structural = notes;
  result.views[v] = entry;
}
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`DIFF ${OUT}`);
for (const v of VIEWS) {
  const e = result.views[v];
  console.log(` ${v}: ${e.status}${e.pixel ? ` MAD=${e.pixel.mad} ${e.pixel.verdict}` : ''}`);
}
