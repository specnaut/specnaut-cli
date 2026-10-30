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
   — or at its re-run after a clean rebase (step 4, exit 5), whose lines replace the first. Never
   re-run it now: its range is empty after the landing. A child whose commit is not on the
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
   prints the sweep's summary line. Its exit table is the header of `_close_shipped.sh` beside it;
   this maps every exit there. **0** — settled. **20** — an issue was not confirmed closed, its card
   left alone; **21** — a move or the reconcile failed. Neither fails the merge, which has happened:
   report it. **2** — usage: a bad number was passed; fix the call.
4. **Remove the spec directory — once, for the whole epic too:**

   ```
   bash .specnaut/scripts/bash/remove-spec.sh <branch>
   ```

   `<branch>` is the feature branch `land-feature.sh` just landed — the one you merged, not one read
   back from `feature.json`. What it removes, and when it refuses, is the script's header; this list
   maps every exit that header lists — an exit it does not list is a failure: report it verbatim.
   Never run it before the close succeeded: nobody authorised a removal then.
   - **0** — removed and pushed: report its line.
   - **22** — skipped, nothing changed: its reason is printed — report it, never silently.
   - **24** — the tracked files are removed and pushed; the files it lists are in no commit and were
     kept. Report them by name and never delete them: they are someone's only copy.
   - **7** — the push was rejected; the removal commit is on the local base, and `feature.json` with
     it — so never re-run the script (it would skip, 22). `git pull --rebase --no-autostash origin
     <base>`, then `git push --no-follow-tags origin refs/heads/<base>:refs/heads/<base>`; a
     conflict: `git rebase --abort`, report it unpushed.
   - **23** — something else was staged while it ran: the removal is undone, nothing committed.
     Report the path it names; that staged work is someone else's — leave it staged.
   - **25** — the removal commit failed (a hook, signing): the removal is undone, nothing committed.
     Quote the failure it names and report it; never bypass the hook.
   - **13** — held by `merge: manual`: nothing changed. Quote its line; it names the remedy. The
     landing and the close stand — only the removal is held. On the next `merge`, run this step 4
     alone; never land again.
   - **2 · 3** — usage, or the base branch is unknown: report it; nothing changed.

## The report names every item, one line each

Not a count: one line per issue closed and per card moved, each named per the
`backlog-reference-contract` skill, including every item that could not be settled and why, the
sweep's summary line verbatim (`drifted 0` is the evidence the board was checked), and the spec
removal or its reason. A feature delivered across several branches passes `--no-close` on every
branch but the last.
