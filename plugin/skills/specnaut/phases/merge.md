
## User Input

```text
$ARGUMENTS
```

## Preconditions

- The feature branch must be checked out.
- All Specnaut phases must have completed successfully (plan, tasks, implement, review).
- `$ARGUMENTS` is optional and may contain, in any order:
  - a **base branch** — the first token that is not a flag. Defaults to `main`.
  - **`--pr`** — deliver through a pull request instead of merging locally. Off by default.
  - **`--no-close`** — merge and push, but leave the backlog item open (step 11 is skipped): for a
    feature delivered across several branches, on every branch but the last.

## The default is a local merge. `--pr` is the opt-in.

This phase lands the branch on the base branch with a local fast-forward. It does not open a pull
request, does not push a branch for review, and does not need a forge to exist. That is the default
because it is what most work actually needs, and because a merge you can perform is a merge that
cannot be left half-done in somebody else's queue.

Pass `--pr` when the project genuinely requires the round-trip — a protected base branch, a review
another human must sign off, or a CI job that only triggers on `pull_request`. The squash still runs
first (step 4), so the PR carries the same readable history; the phase then pushes the branch, opens
the PR, and stops.

**Do not infer `--pr` from the presence of a remote, a forge, or an open issue.** A project that
wanted pull requests will say so.

## Steps

1. Determine the base branch from `$ARGUMENTS` (default `main`), and whether `--pr` or `--no-close`
   was passed.
2. Run `git status --porcelain` — abort if the working tree is dirty.
3. Run `git fetch origin <base>` and verify the current branch is up-to-date with `origin/<base>`
   (fast-forward or rebase first if behind).
4. **Decide which history rule applies, then apply it.** Ask the branch, not the board:

   ```
   git log <base>..HEAD --format=%B | grep -m1 '^Epic: #'
   ```

   - **A match — this is an epic branch.** Follow "An epic branch merges flat" below. Do **not**
     squash.
   - **No match — standalone.** Load `phases/merge-squash.md` and follow it.

   This phase performs whichever applies; it does not check that somebody else did it, and it does
   not ask permission to do its own job.
5. **`--pr` only** — push the feature branch, open the pull request against `<base>`, and **stop
   here**. First run `gh pr view <n> --json closingIssuesReferences` and name any issue the
   body references but that list omits — mentioned, not closed. Report only. Then: report the PR URL and end. Nothing below this line applies, because nothing has merged
   yet. In particular the backlog item stays where it is — a PR that is open is not work that is
   done, and flipping the column now would make the board claim an outcome the repository cannot
   corroborate. Re-run `/specnaut merge` (without `--pr`) after the PR lands, or let the forge's own
   close-keyword handle it.
6. Run `git checkout <base>`.
7. Run `git merge --ff-only <feature-branch>`. If fast-forward is not possible, stop and ask the
   user whether to rebase.
8. Print the merge summary (files changed, commits merged).
9. **Push `<base>` to `origin` — push without asking, in either merge mode.** Reaching this step
   *is* the instruction: the chain only invokes `merge` once the mode allowed it
   (`phases/auto-chain.md` reads the mode, this phase does not), and a user typing `/specnaut merge`
   asked for it. Asking again re-collects permission at the most expensive moment of the chain.
   **If the push is rejected**, report the remote's exact message and stop: the merge stays on the
   local base branch (no reset), nothing is retried — never `--force`, never an automatic rebase —
   and the close below does not run. Name the recovery: `git fetch`, reconcile, re-run
   `/specnaut merge`.
10. **End on the base branch.** A merge is not finished while `HEAD` is still on the feature branch —
    landing the commits is half of it; the other half is that the person who asked is back where they
    work. Delete the merged branch (`git branch -d`, never `-D`: a refusal means the merge did not
    actually land, which is a finding, not an obstacle), then **verify with
    `git rev-parse --abbrev-ref HEAD` and quote the result in the report.** This failure is invisible
    from your side — the commits ARE on the base branch, everything looks right, and only the human
    sees the wrong branch name in their prompt.

11. **Close what shipped, and reconcile the board** — only if the push happened and `--no-close`
    was not passed. Load
    `phases/merge-close.md` and follow it. It covers both paths: one item and one card on the
    standalone path, N children plus the epic on an epic branch, and the reconcile sweep that asks
    the board whether it agrees with the repository.

## Squash by scope

Read `phases/merge-squash.md` and follow it. It carries the scope table, the four-step procedure,
the verification that is not optional, and the `--pr` clause. Nothing was cut in the move — the
rules live there in full, and this phase performs them.

## An epic branch merges flat

One merge decision for the whole epic, at the end — not one per child. That is the cost #552 exists
to remove, and it is removed here: the loop never calls this phase, and this phase is reached once.

**The epic branch is not squashed.** Its history is already what a squash would be trying to
produce: one commit per child, in dependency order, each carrying its child's own issue number and
an `Epic:` trailer (`phases/epic-commits.md`). Collapsing it would destroy exactly the readable
history the loop just built, and would attribute every child's work to one id.

So **on an epic branch the scope is the task**: one commit per child, and children never merge
together however related two of them look. `git merge --ff-only` at step 7 preserves that; the
forge's "Squash and merge" button destroys it, on this path as on the other.

### The full gate tier, once

Before the merge, run the **full** tier exactly once —
`.specnaut/scripts/bash/run-gate.sh full`, or its PowerShell twin. Never per child: that is the
fast tier's job and it already ran, per child, as each commit was written. `phases/quality-gates.md`
carries what each tier is for.

A project that has declared no gates keeps today's behaviour: the run reports that the tier is not
declared and continues.

**If the full tier fails, fix it on the branch and run it again.** Commit the fix as
`git commit --fixup=<that child's commit>`, then re-run the tier. This does **not** abandon the
merge and does **not** hand the epic back — the whole point of one merge decision is that a late
failure is repaired, not escalated.

### Fold the fixups before merging

A child fixed after its commit was written — here, or earlier when its fast gate failed — leaves a
`fixup!` commit on the branch. Load `phases/epic-fixups.md` and follow it: the fixups fold into
their own children, and three checks confirm the tree did not move, the worktree is clean, and the
branch is one commit per child in order. Do not merge past a failed fold.

## 🔒 Merge is not a filing desk

Nothing gets opened here that could have been fixed in `implement` or `review`.
If a leftover surfaces at merge time and it is repairable inside what the branch
already touches, **fix it and amend the branch** — you are one commit away, and
that is the cheapest this repair will ever be.

Open an item at merge only for the four reasons the earlier phases use: a
**product decision**, a **boundary this branch does not touch**, a **migration**,
or a fix **larger than the work being merged**. Those are opened at **P0 or P1**;
anything smaller was a fix, not a ticket.

The measure of a good merge is a backlog that is **shorter** than before it —
one item closed, none opened. When that is not true, the report says why, by
name, in one sentence per item.

## Output

Every backlog item this report names is named per the `backlog-reference-contract` skill — number,
title, and a resolved link, never a bare number. The reader uses this report to check the work, and
a bare number is not checkable.


A structured report with: files merged, commits merged, whether the push ran (or the remote's
message if it was rejected), and — when
the close ran — whether the linked issue was closed (and via which backend), or skipped (and why:
no `linked_issue`, user declined, or `cascade-check` returned any non-zero exit — quote which,
since "a child is still open" and "the children could not be read" are different reasons to stop). It must also quote
the branch `HEAD` is on after the merge, from `git rev-parse --abbrev-ref HEAD` — a merge report
that claims success without naming the branch is unverifiable.

When the reconcile ran, quote `sweep-closed.sh`'s summary line verbatim and list any card it moved and
any `REOPENED` it reported. Report the summary even when nothing moved: "drifted 0" is the evidence
that the board was checked, and omitting it makes a checked board indistinguishable from a skipped
step.

On the `--pr` path the report is shorter and must say so plainly: the branch pushed, the PR URL,
and the fact that **nothing has merged and the backlog item has not moved**. A report that reads
like a completed merge when a PR is merely open is the failure this phase is most likely to produce.
