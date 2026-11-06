**An epic whose last child finishes now moves to In review, not Done.**

If you use epics on a GitHub board, this is a visible change and the only one in this release.

`propagate-parent-status.sh` advanced a parent to **Done** the moment its last open child reached
Done. It calls the move script and closes nothing, so the parent's _card_ read Done while the parent
_issue_ was still open — which the board's own drift detector names in its header as
`REOPENED — open, but sitting
in Done`, one of the three states it exists to report. One shipped
component manufactured, on purpose, the state another reports as a defect. The previous release made
that detector honest about what it had and had not read, which only made the contradiction easier to
see.

The window was never a race. The promotion fires at the _child's_ move, which necessarily precedes
any close of the parent, and nothing obliges a caller to close the parent at all. The merge phase
closes an epic itself, under the cascade gate, and never calls this hook — so the only path where
the promotion decided anything was the one where nobody closes the parent.

What it asserted is the point. `Done` means the work is finished, and "every child is Done" is not
that: an epic can carry residual work of its own, and nothing had checked — `cascade-check.sh`
exists to gate exactly that judgement, and this hook deliberately does not consult it.

Two other repairs were considered and rejected. Having the hook close the issue bypasses the gate
and makes a status hook do something much larger than advancing a column. Teaching the detector to
tolerate the state weakens a detector to accommodate a hook, and an exception carved into a drift
report is how a report stops meaning anything.

So: **`In review`** — the column that means "everything below is finished, awaiting this item's own
closure" — while the issue is open, and **`Done`** once it is closed, where the card is merely
lagging a fact already established. A parent already sitting in the target column is left alone
rather than re-moved, because printing a promotion for a transition that did not happen is a smaller
version of the same lie.

The local Markdown backend is deliberately untouched, and its header now says why: it keeps one
field, so a card reading Done over an open item is not a state it can represent.
