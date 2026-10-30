
Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

## Preconditions

- The feature branch is checked out, and `plan`, `implement` and `review` have completed.
- `$ARGUMENTS` may carry, in any order: **`--pr`** — deliver through a pull request instead of a
  local merge; **`--no-close`** — merge and push but leave the backlog item open (a feature
  delivered across several branches, on every branch but the last).
- The base branch is what `bash .specnaut/scripts/bash/base-branch.sh` prints. Exit 3 means it is
  unknown: stop and say so — never assume `main`.

## The default is a local merge. `--pr` is the opt-in.

This phase lands the branch on the base with a local fast-forward; it needs no forge. Pass `--pr`
when the project genuinely requires the round-trip — a protected base, a human sign-off, a CI job
that runs only on `pull_request`. **Do not infer `--pr` from a remote, a forge or an open issue.**

## Steps

1. **Shape the history.** Ask the branch, not the board — `bash .specnaut/scripts/bash/epic-status.sh`
   reads its `Epic: #` trailers, and only before the landing: after it, the range is empty. Keep its
   last `CHILD` and `EPIC` lines (after any fold) for the close.
   This list maps every exit `epic-status.sh`'s header lists; an exit it does not list is a
   finding: quote it and stop on the branch.
   - **Exit 14 — standalone**: load `phases/merge-squash.md` — **Squash by scope**.
   - **Exit 12** — the history does not read back to the board: fix it on the branch. **3** — the
     base is unknown: stop and say so. **15** — the history could not be read: stop and say so.
   - **Exit 16** — the range is empty but `.specnaut/feature.json` links an epic whose commits have
     landed (a re-run after the base moved): **stop** and say so — never squash, never close from
     here; the `CHILD` lines cannot be read back.
   - **Exit 0 — an epic**: do **not** squash. Run the full gate tier once,
     `.specnaut/scripts/bash/run-gate.sh full` (a failure is fixed on the branch as a `--fixup` of the
     child at fault, then the tier re-run — never escalated), then load `phases/epic-fixups.md` and
     fold. Do not merge past a failed fold.
2. **`--pr` only** — push the branch, open the pull request against the base, name any issue its
   body references that `gh pr view <n> --json closingIssuesReferences` omits, report the PR URL,
   and **stop**: nothing has merged, so the backlog item does not move. Re-run `/task merge` after
   the PR lands, or let the forge's close keyword handle it. Never use the forge's "Squash and
   merge": it collapses the scopes the squash produced.
3. **Land it:**

   ```
   bash .specnaut/scripts/bash/land-feature.sh
   ```

   It checks the tree is clean, that origin names `<base>` as its default, and that the branch
   contains `origin/<base>` and adds to it; it fast-forwards the base, pushes it, deletes the
   branch with `-d`, and verifies `HEAD` is the base; it prints `LANDED <base> <first>..<last> <n>
   commit(s)`. **It pushes without asking, in either merge mode**: reaching
   this step is the instruction — `phases/auto-chain.md` reads the mode, this phase does not.
   **Under `merge: manual` the landing hook holds it** until the user's own prompt this turn says
   `merge` or `/task merge`; a refusal is not an obstacle to route around — quote it, name the word,
   stop on the branch.
4. **Read its exit** — this table maps every exit `land-feature.sh`'s header lists; an exit it does
   not list is a finding: quote it and stop on the branch.

   | Exit | Meaning | What you do |
   | :--- | :--- | :--- |
   | 0 | landed and pushed | step 5 |
   | 2 | not on a feature branch | check out the feature branch, land again |
   | 3 | the base is unknown, or origin does not confirm it as its default | stop and say so, quoting its line — never land on a guessed branch |
   | 4 | the tree is dirty | commit, or stop whoever holds it |
   | 5 | behind `origin/<base>` | `git rebase refs/remotes/origin/<base>`. Applies cleanly → re-run the gates, land again. A conflict → `git rebase --abort`, and the branch goes back to `review` — a resolution is a change nobody reviewed |
   | 6 | the local base holds commits origin lacks (printed: `origin/<base>..<base>`) | **stop on that fact**, quoting the range: they are someone's work. Nothing was rebased or pushed, and the phase does not rebase |
   | 7 | the push was rejected | quote the remote's message — never `--force`. A rule refused it (protected base, hook): stop and say so. Origin moved: `git checkout <branch>`, `git branch -f <base> refs/remotes/origin/<base>` (the local base holds only this branch's fast-forward), land again — exit 5 follows and its row applies. The close does not run until a landing pushes |
   | 9 | `HEAD` is not the base | say so; the person who asked must be back where they work |
   | 10 | nothing to land | the branch has no commit origin lacks: say so — nothing merged, nothing to close |
   | 11 | landed and pushed; the branch would not delete with `-d` | the landing stands: step 5 runs. Report the branch that stayed |
   | 12 | an unexpected git failure before the push | quote it and stop: nothing was pushed |

5. **Close what shipped, and reconcile** — only after a push, and not under `--no-close`: load
   `phases/merge-close.md`.

## 🔒 Merge is not a filing desk

Nothing gets opened here that could have been fixed in `implement` or `review`. A leftover
repairable inside what the branch touches is fixed and the branch amended — the cheapest this repair
will ever be. Open an item only for a **product decision**, a **boundary this branch does not
touch**, a **migration**, or a fix **larger than the work being merged**, at **P0 or P1**. A good
merge leaves the backlog **shorter**: one item closed, none opened — or the report says why, by
name.

## Output

Files and commits merged (from `LANDED`), whether the push ran or the remote's message, the branch
`HEAD` is on, and — when the close ran — each item closed, each card moved and why any was not,
the sweep's summary line verbatim, and the spec removal or its reason. Every backlog item is named
per the `backlog-reference-contract` skill. On `--pr` the report is shorter and says plainly: the
branch pushed, the PR URL, and **nothing has merged and the backlog item has not moved**.
