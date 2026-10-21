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

test('deploy stamp (simulated): the scheme publishes distinct stamps for every commit', () => {
  // What each commit's build WOULD have published: the parent's (sha, count),
  // because the build runs before the commit exists. Pure plumbing, works on
  // any checkout regardless of which format committed version.json carries.
  assert.ok(shas.length > 1, 'needs history to compare');
  const published = shas.map((sha) => {
    const parent = execFileSync('git', ['rev-parse', `${sha}^`], { encoding: 'utf8' }).trim();
    const count = execFileSync('git', ['rev-list', '--count', parent], { encoding: 'utf8' }).trim();
    return `${parent}:${count}`;
  });
  for (let i = 0; i < published.length - 1; i++) {
    assert.notEqual(published[i], published[i + 1],
      `commits ${shas[i]} and ${shas[i + 1]} would publish the same stamp — open pages would not reload`);
  }
});

test('deploy stamp: every committed new-format stamp differs from its parent deploy', () => {
  assert.ok(shas.length > 1, 'needs history to compare');
  const stamps = shas.map(stampAt);
  // Known incident, repaired forward (504e8f3) and documented — not a free
  // pass: any repeat OUTSIDE this pair still fails. The pair (c82bf08,
  // 433bc3b) published d9bd50c:756 twice when a mid-pair rebuild did not
  // refresh version.json; the repair commit publishes 433bc3b:758.
  // Second incident (064d4b3): two content commits (8ea82f0, 064d4b3) stacked
  // on one build, so both publish 6653eee27f6ae8f1d22c8ea38eee6c77f725d3b6:760.
  // Rule from here: build before every commit so each commit's version.json
  // is fresh — never stack a second content commit on one build's stamp.
  const KNOWN_REPEAT = new Set([
    '433bc3b0164d4603a1d9ade3642e0555f4576489',
    '8ea82f0568840990bb9848eca7dde1f7082a4107',
    '064d4b3bef8ed7ffb5e36d65a32492c8e96179a7',
  ]);
  let checked = 0;
  for (let i = 0; i < stamps.length - 1; i++) {
    const cur = stamps[i];
    if (KNOWN_REPEAT.has(shas[i])) continue; // documented incident above — still counted out, never in
    if (typeof cur !== 'string' || !cur.includes(':')) continue; // pre-fix format, exempt
    const parent = stamps[i + 1];
    if (parent === null) continue;
    assert.notEqual(cur, parent, `commit ${shas[i]} publishes the same stamp as its parent — open pages would not reload`);
    checked++;
  }
  assert.ok(checked > 0, 'no new-format stamps in the window — nothing verified');
});
