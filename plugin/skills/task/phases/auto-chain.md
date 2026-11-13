# Auto-chain control

What the `/task` router follows after a chainable verb (`plan`, `implement`, `review`) completes —
unless `--manual` was passed, or the re-entry table below runs the verb alone.

```
plan → implement → review → merge → push
  ▲                           ▲
  STOP 1                      STOP 2
  (a question only the user   (only under merge: manual)
   can answer is open)
```

## Autopilot is the default. There is ONE stop, and a second only on request.

1. **The end of `plan`**, **only if something only the user can answer is open** — who decides the
   rest is `phases/plan.md` step 6. Nothing open → a report, then `implement`.
2. **The review verdict — only under `manual`.** The merge mode is read here and nowhere else,
   the per-run instruction first: `--manual-merge`, or "stop before merging" / "do not push", means
   `manual`; "merge it" means `auto`. Then run `phases/merge.md` step 0, which alone decides an
   untrusted verdict: behind the base only, it rebases and the mode is read below; any other
   untrusted reason is step 0's one question, asked instead of "Ready to merge?", so nothing is
   asked twice; anything else stops. A `NAMES_FILE` listing `.specnaut/workflow.yml` means `manual`
   and the script below does not run; so it is, and the script does not run, unless the gate
   printed both `VERDICT workflow trusted` and `VERDICT backlog-config trusted`
   (`phases/script-gate.md`): a missing line is an untrusted one. So it is, too, for an
   `instructions` line other than `VERDICT instructions trusted`, but `behind base: rebase`: step 0
   asks its one question. A dirty tree (`git -c core.fsmonitor=false status
   --porcelain` prints a line) is never `auto`: say so. Otherwise:

   ```
   bash .specnaut/scripts/bash/merge-mode.sh
   ```

   It prints `auto` or `manual` and says why on stderr. No file or no key is `auto`; an unreadable
   value is `manual` — say so in one line.

   - **`auto`** — a verdict with no unresolved CRITICAL or HIGH invokes `merge` in the same turn.
   - **`manual`** — ask once: "Ready to merge?" A yes lands it, merge and push; anything else stays
     on the branch.

When the project is in remote mode (`specnaut gate status` exits 0), read `phases/remote-gates.md`:
it raises the plan and merge approvals as gates, and remote mode keeps its gate under either mode.
Remote mode is on, whatever the verdict, when the tree or the base tip's copy turns it on (`git
show <BASE_TIP>:.specnaut/backlog-config.yml`); a copy that does not parse never turns it off, so a
branch never turns it off. On, and the gate did not print `VERDICT backlog-config trusted`: stop on
the branch, nothing lands. `specnaut gate` reads the tree's address, which the branch chose.

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

A verb invoked directly chains, or runs alone, by this table and nothing else:

| Invoked | Chains when |
|---|---|
| `plan <id>` | the item is open and `wip-audit.sh` classed it `IDLE`, `ACTIVE` or `LANDED` (`phases/plan-reentry.md`, which says whose class an epic's child takes — its own open state governs either way): an open item whose work landed has more to do. Closed or a non-zero exit runs alone; `UNPUSHED` is the intake gate's stop (below) |
| `plan` with no id | always: a new feature |
| `implement` | the branch is not merged into the base branch |
| `review` | always one-shot |

Before a `plan` or `implement` row chains, HEAD's branch passes checks 2 to 6 of `resume.md` § 3,
checked when the verb completes (for `plan`, after its commit): a fresh plan branches from HEAD and
inherits whatever it carries. A failure ends the run there and names the check and the first failing
sha. Inside a running chain the next
verb is invoked without this table.

## The intake gate — no new work over an unsettled landing

`plan` (with or without an id), `implement` where it creates the branch, `merge` before its step 2
and before every run of its step 3, and every re-entry `resume.md` makes run, before anything else:

```bash
bash .specnaut/scripts/bash/wip-audit.sh --gate --own <id> --own <its parent epic> --since <id>@<epoch>
```

`--own` and `--since` for the item the run is about, and `--own` for its parent epic when it has
one; with no item yet, no flag. What each line means is the header of `_intake_gate.sh`.
**Proceed only on exit 0 whose last line is `gate clear`; any other exit or last line stops,
quoting the gate's lines.** Where each stop points:

| Line | The way out |
| :--- | :--- |
| `PENDING closeout <n> …` | `/task resume <n>` |
| `PARTIAL closeout <n> …` | `/task plan <n>`: the delivery continues |
| `PENDING push <sha>` | `/task resume <id>` for the item that landed: its push row is the refused-push recovery |
| `FENCED closeout <n> …` | the question below, for the run's own `<n>`; another item's, `/task resume <n>` |
| `INVALID closeout …` | by hand: remove `.specnaut/feature.json` in its own commit, and push; a line ending `fenced` asks the question below first |

**`FENCED`, for the run's own `<n>`.** Ask once, as `phases/merge.md` step 0 asks: *"The landing
changed `.specnaut/backlog-config.yml`. Yes runs against the board it now names."* A yes reruns the
gate with `--fence-ack <n>` added, for that run only, and goes on from the line it prints. Anything
else runs no backlog script and stops.

**An `INVALID` line ending `fenced`** gets the same question before its hand fix, whose run it is
or not: that landing moved the config too, and the fix clears the gate for the board it names. A
yes is the hand fix, and its removal commit is the next anchor; anything else leaves the marker.

## Failure

A hard failure in `implement` or `review`: stop, surface it, ask how to proceed; never retry
silently. **Genuinely blocked is not stopped**: say in a sentence or two what is blocked, build
everything that is not, and name the rest. If context runs out mid-chain, say so; re-entry resumes
from what is on disk.
