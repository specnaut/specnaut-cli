# Closing and reconciling after a merge

Loaded by `phases/merge.md` at its steps 11 and 12, **only when the push
happened**. If the merge did not push, nothing here runs: nothing is closed and
no card is moved. A repository that has not published the work cannot
corroborate a board that says it is done.

Two paths, the same as the merge itself. `merge.md` has already decided which
one you are on.

## Order matters, and it is derived rather than chosen

**For every item: close the issue first, then move the card.** Both paths below
obey this. Stated here once, above both: a rule written out separately in each
place will eventually be written two ways — which is how the standalone path came
to do the opposite of it.

`sweep-closed.sh` reports a card in `Done` whose issue is still **open** as
`REOPENED` drift. Moving the card first therefore manufactures exactly the
state an existing tool is built to flag — for every item, for as long as the
close takes. Closing first leaves the opposite transient (a closed issue whose
card is not yet Done), which the same sweep reports as `DRIFTED` and which the
reconcile below resolves anyway.

An item's card and its issue thus change **together**: not simultaneously,
which shell cannot offer, but never resting in the state that lies.

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
       asked to authorise an action on an item they must be able to identify.

       Name **both** consequences in that one question: the issue is closed and its card moved,
       **and** the spec directory is removed in its own commit (step 8). One `yes` authorises
       both — a second prompt would only invite the state where the item is closed and its
       consumed artefact still sits in the tree.

       On `no`, skip the rest of this section — leave the column flip to a future run or to a
       manual `move.sh`, and leave the directory alone.
    5. On `yes`, **github + gitlab only** — close the issue, before touching the card. Dispatch
       the `product-owner` subagent with the prompt:
       "The branch for issue #<linked_issue> just landed on `main`. Please run the close half of
       the two-step close: post a close comment on the issue referencing the merged commit range
       `<first-sha>..<last-sha>` (from step 8's summary), then
       `gh issue close <linked_issue> --reason completed`. Leave the card alone — the merge phase
       moves it next. Confirm with a one-line report." This keeps the audit comment under PO
       ownership.

       The order is not this step's to argue — see "Order matters" above, which governs both.
    6. **Then** run `bash .specnaut/scripts/backlog/move.sh <linked_issue> Done`. This is the
       mechanical column flip — `move.sh` is idempotent and the working contract permits the merge
       phase to call it directly (the PO retains exclusive ownership of the close + comment, not
       the column move). If step 5 reported the close did not land, **report it and leave the
       card alone**: moving it produces the one state the order above exists to avoid.
    7. **local backend only** — step 5 does not apply. The ordering above is a two-object
       problem this backend does not have: there is no "issue" beyond the task file, so step 6's
       `move.sh <id> Done` flips the frontmatter and *is* the close, in one write.
    8. **Remove the feature's spec directory** — the planning artefact is consumed, the code
       is the authority, and the intent survives on the item just closed. After the close
       landed, before step 12.

       Five conditions, **all** required. Any one failing is a skip — reported (see below),
       never silent — that changes nothing else here:

       - the push happened — the entry condition for this file;
       - **the close succeeded** — a refused `cascade-check.sh` gate, a non-zero exit or a `no`
         at step 4 leaves the directory alone: nobody authorised a removal;
       - `.specnaut/feature.json` carries a non-empty `feature_directory`
         (`jq -r '.feature_directory // empty' .specnaut/feature.json`) — absent in
         `spec-backend=cloud` trees, where the spec never lived on disk, and in older trees;
       - the directory exists on disk;
       - **the directory is in git history** — `git log --all --oneline -- "<dir>"` returns at
         least one commit. This is what makes the removal lossless rather than destructive, and
         it is not a formality: `phases/plan.md` commits the directory at plan time, so one with
         no history never got that commit, and deleting it destroys the only copy.

       Then, on the base branch step 10 left you on — its own commit, since the merge was
       pushed several steps ago and there is nothing left to fold into:

       ```
       git rm -r --quiet "<feature_directory>" .specnaut/feature.json
       git commit -m "chore(<id>): remove the spec directory for the shipped feature"
       git push
       ```

       `feature.json` goes with it: it names the directory and nothing verifies the name
       still resolves, so `get_feature_paths` hands callers a path to nothing — exit 0, no
       warning, its branch guard skipped off a feature branch.

       A feature with no `linked_issue` reaches none of this: step 1 skipped the section, so
       nobody was asked, and that `yes` is the authorisation. Intended.

    **Report the removal, or the reason there wasn't one.** One line naming the removed path
    and how to get it back (`git log --all -- <dir>`), or one line naming the unmet condition.
    The epic report's rule — anything the merge could not finish is stated — is not a property
    of epics: a silent non-removal is how a report comes to agree with a tree it does not
    describe.

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

4. **Then remove the spec directory — once, for the whole epic.** Same five conditions and
   commands as the standalone path's step 8, after step 3's close. Not repeated here: a second
   copy is a second thing to keep in step with the first.

   **Never per child.** `/specnaut plan` creates one directory per invocation and an epic is
   one branch over one tree carrying N child commits — a per-child removal would aim at the same
   directory N times, the first taking the plan out from under every child still to be closed.

5. **Then reconcile, once, over everything the merge touched.** The sweep in
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
