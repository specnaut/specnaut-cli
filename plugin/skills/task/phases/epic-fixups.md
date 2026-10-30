# Folding an epic's fixups — one commit per child, still

Loaded by `phases/merge.md` on the epic path, before the merge.

A child fixed after its commit is written — its fast gate failed as the loop moved on, or the full
gate failed at the end and the fault was traced to it — must fold back into **its own child's**
commit, so the default branch still reads one commit per child.

## Write the fixup so it already knows where it goes

```
git commit --fixup=<sha-of-that-child's-commit>
```

The commit is titled `fixup! <that child's subject>`: attributed to the child at fault by
construction, with no id of its own (no `T<NN>`, no `(#N)`, no `Epic:` trailer), and unable to
inherit a sibling's, because its target is a sha you named. A fixup matched to a child by reading
it is a match that can be wrong.

## The fold

```
bash .specnaut/scripts/bash/fold-fixups.sh
```

It prints `PRE <sha>`, folds each fixup into the commit it names (`rebase --autosquash
--keep-base`), and runs three checks: the tree is the one recorded before the fold, the worktree is
clean, and `epic-status.sh` reads one commit per child in order with no `fixup!` left.

This table maps every exit `fold-fixups.sh`'s header lists; an exit it does not list is a finding:
quote it and stop.

| Exit | Meaning | What you do |
| :--- | :--- | :--- |
| 0 | folded | merge |
| 2 | usage, or `--verify` given a sha that is not the `PRE` the stopped fold printed | re-run `--verify` with that `PRE` sha — never `HEAD`, never another |
| 3 | the base is unknown, `epic-status.sh` could not read the branch, or the rebase failed without stopping (nothing folded, nothing recorded) | stop and say so |
| 13 | the rebase stopped on a conflict — or, on `--verify`, is still in progress — or, on a plain run, a stopped fold awaits `--verify <pre>` (it names the sha) | resolve it, `git rebase --continue` (check it exits 0), then `fold-fixups.sh --verify <PRE sha>` — the checks run against the tree recorded before the fold. Never a plain re-run: only a passing `--verify` spends the record |
| 10 | the tree moved | stop: a fold that changes the tree is a rewrite. The record stays, so a plain run is refused (13) — the fold is not retried over a moved tree |
| 11 | the worktree is not clean | untracked output belongs in the child's commit or `.gitignore`; a modified file means something still holds the tree — stop it first |
| 12 | not one commit per child | a surviving `fixup!` lost its target or was written by hand; attribute it by sha |
| 14 | not an epic branch | this file does not apply |

**Do not merge past a failed fold**, and say which check failed: a history nobody can read back to
the board is the thing the epic loop exists to prevent.
