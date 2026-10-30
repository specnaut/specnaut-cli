# Closing and reconciling after a merge

Loaded by `phases/merge.md` at its step 5, **only when the push happened** and `--no-close` was
not passed. If nothing was pushed, nothing here runs: a repository that has not published the work
cannot corroborate a board that says it is done.

## Order matters: close the issue first, then move the card

`sweep-closed.sh` reports a card in `Done` over an **open** issue as `REOPENED` drift; moving the
card first manufactures exactly that state. Closing first leaves the opposite transient, which the
reconcile resolves. `close-shipped.sh` enforces the order: it moves no card whose issue is not
confirmed closed.

## The procedure

1. **What shipped.** Standalone: `linked_issue` from `.specnaut/feature.json` (absent → skip this
   file; a tree from before the field existed). Epic: the children are the `CHILD` lines, and the
   epic the `EPIC` line, that `epic-status.sh` printed at `phases/merge.md` step 1, before the landing
   — never re-run it now: its range is empty after the landing. A child whose commit is not on the
   branch did not ship, and is not closed.
2. **Close each one — github and gitlab.** **Do not ask.** The push was the authorisation. For the
   epic itself, and for a standalone item, run `bash .specnaut/scripts/backlog/cascade-check.sh <n>`
   first: **only exit 0 authorises the close**. 11 — a child is still open: name it and stop. 3 —
   the gate could not answer: say so and stop. 12 — already closed: nothing to close. Then dispatch
   the `product-owner` to post a close comment naming the merged range from `land-feature.sh`'s
   `LANDED` line and run `gh issue close <n> --reason completed` (gitlab: its equivalent), leaving
   the card alone. Children first, the epic last. On local and cloud there is no separate issue:
   skip to step 3, which is the close.
3. **Settle the board:**

   ```
   bash .specnaut/scripts/backlog/close-shipped.sh <n>…
   ```

   It confirms each issue closed, moves its card to Done, then reconciles the whole board once and
   prints the sweep's summary line. Exit 20 — an issue was still open, its card left alone; 21 — a
   move or the reconcile failed. Neither fails the merge, which has happened: report it.
4. **Remove the spec directory — once, for the whole epic too:**

   ```
   bash .specnaut/scripts/bash/remove-spec.sh <branch>
   ```

   `<branch>` is the feature branch `land-feature.sh` just landed — the one you merged, not one read
   back from `feature.json`. It runs only on the base branch, only for a `feature_directory` that is
   directly under `.specnaut/specs/`, named like that branch, and in git history, in its own commit,
   pushed. Exit 22 is a skip, and its reason is printed — report it, never silently.
   Never run it before the close succeeded: nobody authorised a removal then.

## The report names every item, one line each

Not a count: one line per issue closed and per card moved, each named per the
`backlog-reference-contract` skill, including every item that could not be settled and why, the
sweep's summary line verbatim (`drifted 0` is the evidence the board was checked), and the spec
removal or its reason. A feature delivered across several branches passes `--no-close` on every
branch but the last.
