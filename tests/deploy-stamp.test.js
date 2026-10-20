// tests/deploy-stamp.test.js — the /version.json stamp must change on every
// deploy: an open page polls it and only reloads on change, so two consecutive
// deploys publishing the same value strand viewers on the older bundle.
// The stamp is "<head-sha>:<commit-count>" (see scripts/plan-track.mjs) —
// unique per commit, stable across rebuilds. This test walks recent history
// via git plumbing (fast, no checkouts) and asserts every NEW-format stamp
// differs from its parent commit's stamp. Old bare-sha stamps predate the fix
// and are exempt — the invariant applies from the new format on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const WINDOW = 20;
const shas = execFileSync('git', ['log', `--max-count=${WINDOW}`, '--format=%H'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

function stampAt(sha) {
  try {
    const raw = execFileSync('git', ['show', `${sha}:public/version.json`], { encoding: 'utf8' }).trim();
    return JSON.parse(raw).sha ?? null;
  } catch { return null; } // version.json not in this commit — nothing to compare
}

test('deploy stamp: every new-format stamp differs from its parent deploy', () => {
  assert.ok(shas.length > 1, 'needs history to compare');
  const stamps = shas.map(stampAt);
  let checked = 0;
  for (let i = 0; i < stamps.length - 1; i++) {
    const cur = stamps[i];
    if (typeof cur !== 'string' || !cur.includes(':')) continue; // pre-fix format, exempt
    const parent = stamps[i + 1];
    if (parent === null) continue;
    assert.notEqual(cur, parent, `commit ${shas[i]} publishes the same stamp as its parent — open pages would not reload`);
    checked++;
  }
  assert.ok(checked > 0, 'no new-format stamps in the window — nothing verified');
});
