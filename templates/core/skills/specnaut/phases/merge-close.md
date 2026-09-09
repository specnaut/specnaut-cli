# Closing and reconciling after a merge

Loaded by `phases/merge.md` at its steps 11 and 12, **only when the push
happened**. If the merge did not push, nothing here runs: nothing is closed and
no card is moved. A repository that has not published the work cannot
corroborate a board that says it is done.

Two paths, the same as the merge itself. `merge.md` has already decided which
one you are on.

## Order matters, and it is derived rather than chosen

**For every item: close the issue first, then move the card.** Both paths
below obey this. It is stated here, once, above both of them — a rule written
out separately in each place is a rule that will eventually be written two
ways, which is exactly how the standalone path came to do the opposite of what
this section says.

`sweep-closed.sh` reports a card in `Done` whose issue is still **open** as
`REOPENED` drift. Moving the card first therefore manufactures exactly the
state an existing tool is built to flag — for every item, for as long as the
close takes. Closing first leaves the opposite transient (a closed issue whose
card is not yet Done), which the same sweep reports as `DRIFTED` and which the
reconcile below resolves anyway.

That is what an item's card and its issue changing **together** means: not
simultaneity, which shell cannot offer, but never resting in the state that
lies.

## Standalone — one item, one card

11. **Close the linked backlog issue** (only if push happened and `feature.json.linked_issue` is set):
    1. Read `.specnaut/feature.json`. Extract `linked_issue` (`jq -r '.linked_issue // empty'`).
       If absent / null / empty, skip the rest of this section silently — no backlog backend wiring
       to act on.
    2. Detect the backend by checking `.specnaut/installed.lock` (`backlog_backend: <local|github|gitlab>`)
       or, equivalently, the presence of `.specnaut/backlog-config.yml` (github/gitlab) vs
       `.specnaut/backlog.md` (local).
    3. **github + gitlab only** — run `bash .specnaut/scripts/backlog/cascade-check.sh <linked_issue>`.
       **Only exit 0 authorises the close. Treat EVERY non-zero exit as "do not close"** — this is
       a safety gate, and a gate that could not answer must never read as a yes. Exit 11 means the
       parent has open sub-issues: report them to the user and stop (the issue stays in
       `In progress` / `Ready` until the children are closed). Exit 3 means the parent was not
       found **or its children could not be read** — a token, scope or network problem, not a
       verdict; say so and stop rather than closing. Exit 12 means it is already closed, so there
       is nothing to do.
    4. Ask the user to confirm, naming the item per the `backlog-reference-contract`
       skill — number, title, and a resolved link, never a bare number. The user is being
       asked to authorise an action on an item they must be able to identify. On `no`, skip the
       rest of this section — leave the column flip to a future run or to a manual `move.sh`.
    5. On `yes`, **github + gitlab only** — close the issue, before touching the card. Dispatch
       the `product-owner` subagent with the prompt:
       "The branch for issue #<linked_issue> just landed on `main`. Please run the close half of
       the two-step close: post a close comment on the issue referencing the merged commit range
       `<first-sha>..<last-sha>` (from step 8's summary), then
       `gh issue close <linked_issue> --reason completed`. Leave the card alone — the merge phase
       moves it next. Confirm with a one-line report." This keeps the audit comment under PO
       ownership and surfaces the `docs audit` line from the PO's close-step contract.

       The order is not this step's to argue — see "Order matters, and it is derived rather than
       chosen" above, which governs both paths.
    6. **Then** run `bash .specnaut/scripts/backlog/move.sh <linked_issue> Done`. This is the
       mechanical column flip — `move.sh` is idempotent and the working contract permits the merge
       phase to call it directly (the PO retains exclusive ownership of the close + comment, not
       the column move). If step 5 reported that the close did not land, **report it and leave the
       card where it is**: moving it then produces the one state the order above exists to avoid,
       and step 12's reconcile cannot tell that state from a real one.
    7. **local backend only** — step 5 does not apply, and the ordering above is a two-object
       problem this backend does not have: there is no "issue" object beyond the task file itself,
       so `move.sh <id> Done` in step 6 flips the frontmatter and *is* the close, in one write.
       Nothing precedes it and nothing follows it.

    Backward-compat: feature trees without `linked_issue` (created before this field existed)
    skip the close silently. A feature delivered across several branches — the last one has not
    landed yet — the user answers `no` at the confirmation above and re-runs `/specnaut merge` on the last one.

12. **Reconcile the board** (only if push happened; github + gitlab backends only).
    Run `bash .specnaut/scripts/backlog/sweep-closed.sh --passes 2` — its header
    explains the second pass. It reports; it moves nothing.

    - Collect every `DRIFTED <number>` and move them in **one** call:
      `bash .specnaut/scripts/backlog/move-batch.sh Done <n> <n> …` (github) or a
      `move.sh` per item (gitlab). A card it reports as absent from the project is
      reported and skipped — one bad card never aborts the rest, and nothing here
      may fail the merge, which has already happened.
    - For each `REOPENED <number>` line, **report it and move nothing.** `Ready` vs
      `In progress` is not guessable, and guessing wrong is worse than saying so.
    - Quote the script's **summary line** in the report, not your own count.

    The close only ever sees `feature.json.linked_issue`; a `Closes #N` in a commit
    body, a web-UI close or another agent's close is invisible to it. This step asks
    the board whether it agrees with the repository, rather than asking the merge
    what it believes it closed — the second question is answerable without being
    true.

## An epic — N children plus the epic itself

An epic merge closes N children **and** the epic, and moves N+1 cards. Under
D17 the children's cards arrive here sitting in **In review**: the loop put
them there as each commit was written, and deliberately did not take them
further. This is where they become Done.

### The procedure

1. **Enumerate the children from the branch, not from memory.** Every child's
   commit carries its own issue number and an `Epic:` trailer
   (`phases/epic-commits.md`):

   ```
   git log <base>..HEAD --format='%s%n%b' | grep -oE '\(#[0-9]+\)|^Epic: #[0-9]+'
   ```

   The subjects give the children; the trailer gives the epic. A child whose
   commit is not on the branch did not ship, and must not be closed.

2. **Per child, in order:** close the issue with a reason, then move its card to
   `Done`. Name each one per the `backlog-reference-contract` — number, title,
   resolved link — because the report is what the reader uses to check the work,
   and a bare number is not checkable.

3. **Then the epic.** Run `cascade-check.sh <epic>` first, exactly as the
   standalone path does. **Only exit 0 authorises the close.** Exit 11 means a
   child is still open — stop and say which. It is a gate, not a formality: if
   it fires here, step 2 missed a child, and closing the parent over it would
   hide that permanently. Exit 3 means the children could not be read at all;
   that is not a clean bill of health, and closing on it is the failure the
   gate exists to prevent.

4. **Then reconcile, once, over everything the merge touched.** The sweep in
   the standalone section covers the whole board, so it already sees all N+1
   cards; the only change is that the batch move may now carry N+1 numbers
   rather than one. Quote the script's summary line, not your own count.

### The report names every item, one line each

Not a count. `closed 9 issues, moved 9 cards` is unverifiable by the reader,
and it is exactly as easy to write when three of them silently failed.

One line per issue closed and per card moved, **including every item it could
not move and why** — an item the sweep reported as absent from the project, a
close the gate refused, an API call that failed. Anything the merge could not
finish is stated. A merge report that omits its own failures is how a board and
a repository drift apart while both look healthy.
