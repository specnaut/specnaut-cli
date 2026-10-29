# Brief — Merge, close and fixup mechanics as scripts

Backlog item: specnaut-cli#677 "Move merge, close and fixup mechanics from phase prose into scripts"
(https://github.com/specnaut/specnaut-cli/issues/677), child of epic specnaut-cli#674. Branch:
`042-merge-scripts`. Lands on a green suite, no content guard weakened, bytes reported.

## 1. Task and out of scope

**Task.** The deterministic git and board steps of `merge`, `merge-close` and `epic-fixups` move
into four bundled scripts with documented exit codes; the three docs shrink to the judgement the
scripts cannot make, and invoke them.

| Script                      | Does                                                                                                                                                                                                                                                                                                     | Exit codes                                                                                                                                                                               |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `land-feature.sh [<base>]`  | merge steps 2–3 and 6–10: clean tree, fetch, branch contains `origin/<base>`, checkout base, `merge --ff-only`, push, `branch -d`, verify `HEAD` is the base; prints `LANDED <base> <first>..<last>`                                                                                                     | 0 landed and pushed · 2 usage · 3 base unknown · 4 dirty tree · 5 behind the base · 6 not a fast-forward · 7 push rejected (merge left local, nothing retried) · 8 branch delete refused |
| `fold-fixups.sh [<base>]`   | captures the diff, `rebase --autosquash --keep-base`, then the three checks: tree unchanged, worktree clean, one commit per child in order (through `epic-status.sh`)                                                                                                                                    | 0 folded · 2 usage · 3 base unknown · 10 tree moved · 11 worktree not clean · 12 not one commit per child · 13 rebase stopped on a conflict                                              |
| `epic-status.sh [<base>]`   | reads the branch's commits: `EPIC #<n>`, one `CHILD T<NN> #<child> <sha>` per child, `FIXUP <sha>` per surviving fixup; checks ordinals dense from 1, each child once, subject and ordinal agree                                                                                                         | 0 consistent · 2 usage · 3 base unknown · 12 inconsistent (named on stderr) · 14 not an epic branch                                                                                      |
| `close-shipped.sh <issue>…` | after the product-owner closed them: per issue, refuses an issue still open, else `move.sh <n> Done`; then removes the spec directory under its five conditions, in its own commit, pushed; then `sweep-closed.sh --passes 2` and one `move-batch.sh Done` for every `DRIFTED`; prints one line per item | 0 all done · 2 usage · 20 an issue was still open (its card left alone) · 21 a card move failed · 22 spec removal skipped (reason printed; not a failure of the close)                   |

What stays prose, because it is judgement: squash grouping (`merge-squash.md`), the `--pr` path,
attributing a fixup to its child, the product-owner's close and comment, the report.

**Out of scope.** The `/board` and `/ship` scripts; slimming other phase docs; the Go port.

## 2. Guardrails

| The decision                                                                                                                                                                                                                                                                            | Its single home                                                                                     | What would duplicate it                                                    |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| How a branch lands on the base                                                                                                                                                                                                                                                          | `templates/core/specnaut/scripts/bash/land-feature.sh`                                              | `git merge --ff-only` / push steps left in `merge.md`                      |
| What counts as a valid epic history (ordinals, child ids, fixups)                                                                                                                                                                                                                       | `epic-status.sh`                                                                                    | the parse restated in `fold-fixups.sh`, `merge-close.md` or `epic-loop.md` |
| How fixups fold, and the three checks                                                                                                                                                                                                                                                   | `fold-fixups.sh`                                                                                    | the rebase and diff commands left in `epic-fixups.md`                      |
| Close order: issue first, then card                                                                                                                                                                                                                                                     | `close-shipped.sh` refuses an open issue; the rule's prose stays once in `merge-close.md`           | a `move.sh Done` in the docs before the close                              |
| The five spec-removal conditions                                                                                                                                                                                                                                                        | `close-shipped.sh`                                                                                  | the conditions restated in the doc                                         |
| The land-time board reconcile                                                                                                                                                                                                                                                           | `close-shipped.sh`, calling the existing `sweep-closed.sh` and `move-batch.sh`                      | a second sweep in the doc                                                  |
| Which command lands on the base under `merge: manual`                                                                                                                                                                                                                                   | `guard-merge.sh` — gains `land-feature.sh`, matched by basename however it is reached               | the script checking the mode itself                                        |
| The base branch                                                                                                                                                                                                                                                                         | the existing `base-branch.sh`                                                                       | a default `main` in a script                                               |
| New helpers? (a) inventoried: `base-branch.sh`, `merge-mode.sh`, `run-gate.sh`, `cascade-check.sh`, `move.sh`, `move-batch.sh`, `sweep-closed.sh`; (b) recurrence: every merge since spec 033 re-derives these steps by hand, and #552, #557, #560, #587 each repaired one; (c) outcome | **add** four scripts that call the existing helpers and take data only (a base name, issue numbers) | a script that takes a command to run                                       |

Constitution: none of the four principles is at risk — this is tooling around the phases. Surfaces
added or widened: **one** — a script that pushes to the base branch, which is an agent instruction
surface; `guard-merge.sh` must gate it under `merge: manual` exactly as it gates `git push`. The
scripts are bash only, like `base-branch.sh`, `merge-mode.sh` and `size-ratchet.sh` that the merge
phase already calls: they drive `git`, which ships Git Bash on Windows; a PowerShell twin would be a
second implementation of the same git sequence (the issue's AC asks for twins — the architecture
seat rules).

## 3. Done, as runnable checks

- `tests/scripts/` gains one test file per script, each driving a real temp git repo (bare remote
  - clone) through every exit code; red-probed.
- `guard-merge` tests: `land-feature.sh` (bare, by path, as `bash …`) is gated under `manual` and
  allowed under `auto`.
- The rewritten locks: `merge_squash_by_scope_test` (its `merge-close.md` half),
  `phase_mentions_resolve_test`, `routable_phases_test`, `init_test` / `init_codex_test`,
  `plugin_sync_test`, `plugin_coverage.ts`, `chain_stops_test`, `smoke-features.sh` greps — each
  rule pinned at its new home.
- An upgrade installs the four scripts; `deno task test` green; `size-ratchet.sh` passes.
- Bytes before/after for `merge.md` + `merge-close.md` + `epic-fixups.md` (25,619 B at `d6c0f095`).

## 4. Audit findings

_To be filled._

## 5. Open questions

None for the user.
