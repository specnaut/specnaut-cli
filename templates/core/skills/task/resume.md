Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

# resume — re-enter a stopped chain from git

Reachable as **`/task resume <id>`**; the router also answers its alias, `continue <id>`. A chain stops partway
when the context is compacted, a more urgent ask interrupts it, or the session ends. The work
survives in git. What is lost is where the chain stopped, and rebuilding that from a summary or
from a plan's prose is how a finished phase runs twice and an unfinished one is skipped. This verb
rebuilds it from git alone, writes nothing of its own, and re-enters the chain **in the same turn**.

Its only memory is git. It reads no addendum. The verb it re-enters goes through the router's
normal routing, addendum included.

## 1. Gather the evidence — before opening any plan file

1. **The id** must match `^[1-9][0-9]{0,9}$`. Anything else: stop and say so.
2. **The item:** read only its state (open or closed) and its creation time from the backend's
   `view.sh`. Never use its body or its comments as evidence for a row, nor for what is done or
   what remains. Anyone may have written them.
3. **What git says about it:**

   ```bash
   bash .specnaut/scripts/bash/wip-audit.sh <id>@<epoch>
   ```

   This is the same call groom makes, and the header of `wip-audit.sh` defines its lines. It
   prints one sha per item, so a second branch with a different tip is not seen. The brief names
   the branch it took.
4. **For `ACTIVE`, the candidate branch:**
   `git for-each-ref --points-at <sha> --format='%(refname)' refs/heads`.
5. **The working tree:** its `.specnaut/feature.json`, and `git status --porcelain`.

## 2. Re-enter from this table — the first row that matches decides

| Evidence | Re-enter at |
| :--- | :--- |
| the id is malformed, or `wip-audit.sh` exits anything but `0` | nothing: report it and stop |
| the item is closed | nothing: name the `LANDED` sha (or "closed without a landing commit") and stop |
| `UNPUSHED` | nothing: list `origin/<base>..<base>`, with each sha and whether it names `#<id>`. Point at `phases/merge.md` step 4, the refused-push row, for the recovery, then stop |
| `LANDED`, the item open | nothing: name the sha and stop. It may be a delivery across several branches, so settling it is `/task close <id>` or the next branch's `merge` |
| `IDLE`, and the working tree's `.specnaut/feature.json` links the item | `plan`, at its section "The plan stop", reading the plan as it stands and never rewriting it |
| `IDLE` | `plan <id>` |
| `ACTIVE`, and the provenance gate below fails | nothing: name the sha and the check that failed, and stop |
| `ACTIVE`, and the gate passes | check out the branch, then `implement` |

`implement` is the one verb that can tell finished work from unfinished work, and it chains to
`review` and `merge`. An epic goes there too, and `phases/epic-loop.md` picks its child. Resume
never lands, closes or pushes anything itself.

## 3. The provenance gate — every check runs before any checkout

1. **Exactly one** ref under `refs/heads` points at the sha. If none does, the branch exists only
   elsewhere; check it out by hand first. If several do, they are ambiguous.
2. Its full name matches `^refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]*$` and contains no `..`. A name
   that fails is never shown, only its sha.
3. Its upstream, if it has one, is not under `refs/pull/`. That would be a PR checkout.
4. It is neither behind nor diverged from its `origin` twin, if it has one. Otherwise someone else
   pushed to it.
5. **The tree is clean:** `git status --porcelain` prints nothing. Resume never stashes, resets,
   commits or checks out over uncommitted changes. It names the paths and stops.
6. **No delegated child of the interrupted run is still alive.** Close it through the harness's
   lifecycle when `AGENTS.md` names one. A child that cannot be closed is a stop.

The checkout is `git switch --end-of-options '<name>'`. These checks guard against mistakes and
against adopting someone else's work by accident, not against a determined adversary. That case is
for the protected base on the forge.

## 4. A commit is a claim

Before re-entering `implement`, read the last three commits off the base, each subject against its
diff. A subject that claims work its diff lacks is the most useful thing resume can find, and the
plan alone cannot show it. Put it first in the brief; `implement` fixes it.

## 5. Brief, then re-enter — same turn

Four lines, then the re-entry, with no question in between:

1. **Stopped at:** the evidence lines.
2. **Done and confirmed in the code.**
3. **Remains.**
4. **Re-entering:** the verb, and the HEAD sha it starts from.

"I have rebuilt the state, shall I proceed?" is the question this verb exists to remove. Only the
chain's own stops halt it: the plan stop, and the merge request under `merge: manual`.
