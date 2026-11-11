# Closing and reconciling after a merge

Loaded by `phases/merge.md` at its step 5, **only when the push happened** and `--no-close` was
not passed, and by `resume.md` through **Re-entry**, below. If nothing was pushed, nothing here
runs: a repository that has not published the work cannot corroborate a board that says it is done.

## Order matters: close the issue first, then move the card

`sweep-closed.sh` reports a card in `Done` over an **open** issue as `REOPENED` drift; moving the
card first manufactures exactly that state. Closing first leaves the opposite transient, which the
reconcile resolves. `close-shipped.sh` enforces the order: it moves no card whose issue is not
confirmed closed.

## The procedure

The scripts below are the ones `phases/merge.md` step 0 verified, or the user approved, before
`land-feature.sh` ran: run them only while `HEAD` is the commit `LANDED` ends at, and only past
the board fence of `phases/merge.md` step 5. Re-entry differs only where it says.

1. **What shipped.** Standalone: `linked_issue` from `.specnaut/feature.json` (absent → skip this
   file; a tree from before the field existed). Epic: the children are the `CHILD` lines, and the
   epic the `EPIC` line, that `epic-status.sh` printed at `phases/merge.md` step 1, before the landing
   — or at its re-run after a clean rebase (step 4, exit 5), whose lines replace the first. Never
   re-run it now: its range is empty after the landing. A child whose commit is not on the
   branch did not ship, and is not closed.
2. **Close each one — one order, on every backend, on the first run and on re-entry.**
   **Do not ask.** The push was the authorisation. Children first, the epic last. For each item, run
   `bash .specnaut/scripts/backlog/cascade-check.sh <n>` before its close: **0** authorises it;
   **12** — already closed: skip its close, it still goes to step 3; **11** — a child is still
   open: name it and stop before step 3; **3** — the check could not answer: say so and stop
   before step 3. The close itself — yours, no `product-owner` dispatch, it is mechanical — on
   github and gitlab is `close.sh` with a comment and nothing else, leaving the card alone:

   ```bash
   d=$(mktemp -d) && chmod 700 "$d" && printf 'Shipped in %s.\n' "<shipped>" >"$d/close.md"
   bash .specnaut/scripts/backlog/close.sh <n> completed --body-file "$d/close.md"
   ```

   `<shipped>` is `<first>..<last>` from `land-feature.sh`'s `LANDED` line, matching
   `^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$`; on re-entry, the `<sha>` of the gate's line, matching
   `^[0-9a-f]{40}$`. No other text reaches it. On local and cloud there is no separate issue: the
   close is step 3 run for that one item, before the next item's check, so an epic's check sees
   the children this closeout closed.
3. **Settle the board** — the items that answered 0 or 12:

   ```
   bash .specnaut/scripts/backlog/close-shipped.sh <n>…
   ```

   It confirms each issue closed, moves its card to Done, then reconciles the whole board once and
   prints the sweep's summary line. Its exit table is the header of `_close_shipped.sh` beside it;
   this maps every exit there, and step 4 reads it. **0** — settled. **20** — an issue was not
   confirmed closed, its card left alone. **21** — a move or the reconcile failed: the close
   stands, and the card is reported as drift for groom's sweep. Neither fails the merge, which has
   happened: report it. **2** — usage: a bad number was passed; fix the call.
4. **Remove the marker — once, for the whole epic too, and only after step 3 exited 0 or 21.**
   On **20** the tracker did not confirm the close: remove nothing. `.specnaut/feature.json` stays
   on the base, so the item stays unsettled until `/task resume <n>` finishes it. With a feature
   directory, the removal takes it too; without one (cloud), the file goes alone:
   `bash .specnaut/scripts/bash/remove-spec.sh --marker-only <n>`. Otherwise:

   ```
   bash .specnaut/scripts/bash/remove-spec.sh <branch>
   ```

   `<branch>` is the feature branch `land-feature.sh` just landed — the one you merged, not one read
   back from `feature.json`; on re-entry, the last segment of the gate's `<dir>`. What it removes,
   and when it refuses, is the script's header; this list maps every exit that header lists — an
   exit it does not list is a failure: report it verbatim. Never run it before the close
   succeeded: nobody authorised a removal then.
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
   - **2 · 3** — usage, or the base branch is unknown: report it; nothing changed.

## Re-entry — finishing a closeout an earlier run left

`resume.md` comes here with one line of the intake gate, `OWN closeout <n> <dir> <sha>`, after a
`FENCED` one was answered yes when there was one. Landed scripts are the project's own: they are the
ones on the published base, so no `specnaut verify-scripts` runs first.

1. **The base.** Switch to it; when it is strictly behind `refs/remotes/origin/<base>`, fast-forward
   it there (`git merge --ff-only refs/remotes/origin/<base>`). Run the steps there.
2. **The item, the directory and the sha** come from the gate's line and nowhere else: never open
   `.specnaut/feature.json`.
3. **What shipped.** An epic is an item `bash .specnaut/scripts/bash/epic-status.sh --landed
   <n>@<epoch>` (`<epoch>`, its creation time) prints a `CHILD` line for. Its children are those
   that both that call and `cascade-check.sh --numbers <n>` list; any other child did not ship and
   is not closed, so the epic's own check answers 11 and its spec is kept. `epic-status.sh`'s
   exits other than 0 stop here, quoted.
4. **Steps 2 to 4, as written above.** A step that already ran answers the same way again: a
   closed issue is 12, a removed marker is no gate line at all.

A `PARTIAL` line over a closed item (`resume.md`) runs 1 and 2, then step 4 alone: nothing closes.

## The report names every item, one line each

Not a count: one line per issue closed and per card moved, each named per the
`backlog-reference-contract` skill, including every item that could not be settled and why, the
sweep's summary line verbatim (`drifted 0` is the evidence the board was checked), and the spec
removal or its reason. A feature delivered across several branches passes `--no-close` on every
branch but the last.
