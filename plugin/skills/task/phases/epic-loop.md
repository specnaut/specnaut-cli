# The epic loop — one branch, one commit per child, one merge

Loaded by `phases/implement.md` when the item is an **epic with open sub-issues**. A standalone item
is one commit and one merge; none of this applies to it.

## One plan, one stop

**One `plan` for the whole epic** — one brief, one decision table covering every child — and exactly
**one plan stop**. N children used to mean N stops, each after the work was done: the most expensive
moment to interrupt anyone, for an answer that is almost always yes.

The whole epic is already on one branch and its card is In progress; this phase creates no branch.

## The loop

**Board sub-issues, one per commit**: one child = one sub-issue = one commit. For each child, in
dependency order:

1. **Move its own card to In progress.**
2. **Implement it**, from the brief's rows that concern it.
3. **Commit it** — one commit, per `phases/epic-commits.md`, its scope carrying `T<NN>`, the
   child's ordinal in dependency order.
4. **Run the fast gate** — `.specnaut/scripts/bash/run-gate.sh fast` (or its PowerShell twin;
   `phases/quality-gates.md`). A child that fails it is **fixed in place** and the gate re-run; it
   is not an escalation.
5. **Move its card to In review.** Its commit is written; it is not Done, and its issue stays open
   until the epic merges.
6. **Next child.**

**The loop does not return to the user between children** — not for a finding, a failed gate, or
the next child.
A child's review never stops the loop: the lead triages, fixes, commits and moves on in the same
turn. **The last child's review is the one checkpoint.**

Re-read the open-children list at each iteration: a child added mid-flight is picked up. A child's
commit holds only that child's work — two children in one commit break the match resume relies on.

## Resuming, without a state file

There is no state file: resume reconstructs from git. `bash .specnaut/scripts/bash/epic-status.sh`
reads the branch's commits — one `CHILD T<NN> #<child> <sha>` line per child done, one-to-one by
ordinal — and **resume at the first child with no commit** (none yet reads as not an epic branch:
start at the first child). Do not use issue state as a progress signal — child issues stay open for
the whole loop. Any other exit stops the loop: say which — its exits are mapped once, in
`phases/merge.md` step 1.
