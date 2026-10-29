# The epic loop — one branch, one commit per child, one merge

Loaded by `phases/implement.md` when the item being worked is an **epic with
open sub-issues**. `plan` and `tasks` treat an epic as one unit too; the short
version of why is in each of them, and the whole of it is here.

Nothing in this file applies to a standalone item. A standalone item is one
commit and one merge, exactly as before — this is an additional path, not a
replacement.

## What the loop iterates

**Board sub-issues, one per commit.** One child = one sub-issue = one commit.

`tasks.md` is the decomposition *inside* a child: several `T00N` entries may
belong to one sub-issue and still produce a single commit. It is not the loop's
unit and never was — a loop over `tasks.md` entries would commit several times
per child and break the one-to-one match resume depends on.

`#553` has already put the whole epic on one branch and moved the epic's card
to In progress. This phase never creates a branch.

## One plan, one tasks, one stop

**One `plan` for the whole epic** — one decision table covering every child,
not one per child. **One `tasks.md`**, whose breakdown is the child list in
dependency order. And **exactly one `plan` stop**, for the epic.

That last one is the point of the whole exercise. N children used to mean N
stops arriving after each child's work was already done, which is the most
expensive moment to interrupt anyone: the context is spent and the answer is
almost always yes.

## The loop

For each child, in dependency order:

1. **Move its card to In progress.** Its own card, not the epic's — the epic
   moved when the branch was created.
2. **Implement it**, following `tasks.md` for the entries that belong to it.
3. **Commit it** — one commit, per `phases/epic-commits.md`. The scope position
   carries `T<NN>`, the child's ordinal in the epic's dependency order, minted
   here by this loop.
4. **Run the fast gate tier** — `.specnaut/scripts/bash/run-gate.sh fast`, or
   its PowerShell twin. `phases/quality-gates.md` says what it is for.
   A child that fails it is **fixed in place**: fix, re-run the gate for that
   child, carry on. It is not an escalation and it does not hand back.
5. **Move its card to In review.** Its commit is written; it is not Done, and
   its issue is not closed. Both of those happen at the epic's merge (#560).
6. **Next child.**

**The loop does not return to the user between children.** Not for a review
finding, not for a failed fast gate, not to confirm the next child. The one
user-facing checkpoint is the last child's review.

**Re-read the open-children list at each iteration.** A child added mid-flight
is picked up if it arrives before its turn. Freezing the list when the loop
starts is a decision to ignore work somebody added on purpose.

**A child's commit contains only that child's work.** Do not accumulate an
uncommitted tree across children — if two children's changes land in one
commit, the match resume depends on is gone and no amount of later tidying
brings it back.

## Reviews inside the loop

A child's review **never stops the loop**. Findings go to the lead, who
triages, fixes, commits against that child and moves on **in the same turn**.

**The last child's review is the stop** — the single checkpoint before the
merge, and the one the whole chain has been saving up for.

## Resuming, without a state file

The loop is interrupted often: a session ends, a machine sleeps, somebody
closes the terminal. There is **no state file** — resume reconstructs from git
and the board:

1. Read the commits already on the branch.
2. Match each to its sub-issue through the commit convention. The match is
   one-to-one because the ordinal is the child's position in dependency order.
3. **Resume at the first child with no commit.**

**Do not use issue state as a progress signal.** Child issues stay open for the
entire loop by design (D10) — "open" says nothing about whether the work is
done, and a resume that trusted it would redo every child. What is finished is
what has a commit. That is the only reading.

If a commit matches no sub-issue, or a child matches two, **stop and say so.**
That is the case the no-state-file decision was taken on the assumption would
not happen; if it does, it is worth knowing rather than working around.

## The two `T` counters are not the same counter

`tasks.md` mints `T001`, `T002`, … in execution order across the whole epic.
The commit scope position carries `T01`, `T02`, … over the **sub-issues**. A
reader will assume they are one counter unless told, so say which is which
whenever either appears. `phases/epic-commits.md` carries the format and the
parse.
