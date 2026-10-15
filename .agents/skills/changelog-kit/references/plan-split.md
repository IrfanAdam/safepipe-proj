# Plan split — moving phases between plans with history migration

Plans split as work re-scopes (e.g. time/sim/ops phases moving out of a v3
iteration plan into a twin-work plan). The changelog must follow the PHASE,
not the file: after a split, revs render under the new file and the old file
holds no pointer.

## Recipe (canonical: split → migrate → drop pointers → backfill → assert)

1. Create the new plan file; move the phase bodies verbatim (heads + anchors
   unchanged so existing commit anchors still `anchorHit`).
2. Migrate history: move the matching section entries to the new file key in
   `plan-history.json` (same section hashes — hashes are content-addressed,
   so they survive the move). Tag migrated snapshots with
   `movedFrom: {file, head}` provenance. Never duplicate the phase in both
   files' histories.
3. Drop the moved phases from the old file AND delete any pointer stubs left
   behind — the new file is the record, pointers double-count revs.
4. Run tracker + backfill; assert: new file shows the full rev count, old file
   shows none for the moved phases, every live section hash-matches its
   plan's last history entry.
5. Close with the split recorded (which phases moved where) so the thin
   pre-split provenance is explicit, not implied.

## Pitfalls

- Renaming the phase head in the same commit as the move breaks the hash
  chain (rename reads as remove + add). Move first, rename later: two
  commits, two snapshots.
- Moving without migrating history strands revs under a file that no longer
  contains the phase — `fileFor` attribution then misfires to the wrong plan.
