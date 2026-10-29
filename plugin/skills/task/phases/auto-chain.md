# Auto-chain control

What the `/task` router follows after a chainable verb (`plan`, `implement`, `review`) completes —
unless `--manual` was passed, or what is on disk shows a single step is being re-run.

```
plan → implement → review → merge → push
  ▲                           ▲
  STOP 1                      STOP 2
  (a question only the user   (only under merge: manual)
   can answer is open)
```

## Autopilot is the default. There is ONE stop, and a second only on request.

1. **The end of `plan`**, **only if something only the user can answer is open**. Expert seats
   settle technical forks; nothing open → a report, then `implement`.
2. **The review verdict — only under `manual`.** The merge mode is read here and nowhere else,
   the per-run instruction first: `--manual-merge`, or "stop before merging" / "do not push", means
   `manual`; "merge it" means `auto`. Otherwise:

   ```
   bash .specnaut/scripts/bash/merge-mode.sh
   ```

   It prints `auto` or `manual` and says why on stderr. No file or no key is `auto`; an unreadable
   value is `manual` — say so in one line. **Under `merge: manual` in the file, a hook holds the
   landing whatever the run said**: every merge into, and push of, the base branch waits until the
   user's own prompt in that turn says `merge` or `/task merge`.

   - **`auto`** — a verdict with no unresolved CRITICAL or HIGH invokes `merge` in the same turn.
   - **`manual`** — ask once: "Ready to merge? Reply `merge` to land it, anything else to stay on the
     branch." A plain "yes" does not release the hook; if that is the answer, ask for the word.

When the project is in remote mode (`specnaut gate status` exits 0), read `phases/remote-gates.md`:
it raises the plan and merge approvals as gates, and remote mode keeps its gate under either mode.

Autopilot still halts, and says why: an unresolved CRITICAL/HIGH, a FAIL verdict, a missing review
seat, a merge that cannot fast-forward, a refused push. Those are failures, not stops. A quota hold
(a refused Skill call) is a clean stop: report it, never route around it.

## ⛔ No stop at any other boundary

After each verb, **invoke the next one yourself, in the same turn** — a one-line `✓ <verb> complete
— proceeding to <next>`, a statement, never a question. `plan` → `implement` (same turn as the last
answer) → `review` (gates green, tree frozen) → `merge` (`auto`) → push, never asked.

None of these is a reason to stop:

| The excuse | Why not |
| :--- | :--- |
| "That's a lot of tasks — confirm first?" | The size was known when the chain started. |
| "MVP only, or the whole thing?" | Build the full path; the MVP is a checkpoint inside it. |
| "This is where the real code gets written." | That is the point of the chain. |
| "The audits found a lot — re-confirm scope?" | The findings are in the approved plan. |
| "The user has been checkpointing each step." | An answer is not a request for another question. |

## The verdict summary

After `review`, present: the feature and its branch; files created and modified (count and key
paths); tests added and the full-suite status; deviations from the plan, with their reason; open
risks and deferred findings; the business outcome in one line. Under `auto` it is a statement and
`merge` follows; under `manual` it precedes the one question.

## The review loop ends

**Only a CRITICAL or HIGH finding buys another fix cycle**, before the merge, under either mode, and
never with a question between rounds. MEDIUM and LOW go to the backlog and the branch ships. Sort
findings by whether they **would hurt a user, a maintainer or the data if shipped**, not by the
severity word; "nothing here would hurt anyone" is a valid verdict. Re-reviewing because the last
review was not empty is a loop that does not terminate.

## Re-entry, without a flag

A verb invoked directly chains when what follows it is missing, and runs one-shot when it exists:

| Invoked | Chains when |
|---|---|
| `plan` | nothing is committed on the feature branch past `plan.md` |
| `implement` | the branch is not merged into the base branch |
| `review` | always one-shot |

## Failure

A hard failure in `implement` or `review`: stop, surface it, ask how to proceed; never retry
silently. **Genuinely blocked is not stopped**: say in a sentence or two what is blocked, build
everything that is not, and name the rest. If context runs out mid-chain, say so; re-entry resumes
from what is on disk.
