
Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

## User Input

```text
$ARGUMENTS
```

## Outline

<!-- BEGIN: spec-backend=cloud -->
**Materialise the spec (cloud backend):** run `specnaut spec pull <task>` ONCE now. It
writes the spec's tabs to the gitignored `.specnaut/specs/.cache/<task>/`; read the spec
from there as files. A non-zero exit stops with its message — exit 6 too, Cloud unreachable
and an older cache reused: do not review against an empty or stale spec.

<!-- END: spec-backend=cloud -->
0. **Untrusted or trusted — decided here, nowhere else.** A `<remote>/<branch>` makes the review
   untrusted. A PR number `<n>` is trusted only when this prints the one line `trusted`, exit 0:

   ```bash
   sha=$(git ls-remote origin "refs/pull/<n>/head" | cut -f1); specnaut review trust "<n>" "$sha"
   ```

   Then `git fetch origin "refs/pull/<n>/head"`, `git switch --detach "$sha"`, and step 1 reviews
   that commit. Any other line or exit makes the review untrusted: follow `phases/review-untrusted.md`.
1. **Check the helper scripts, then fix the range.** Run this block as written, from the project's
   root, before any script under `.specnaut/scripts/` runs — again after each fix cycle (Phase 3):

   <!-- review-gate: verify-scripts -->
   ```bash
   out=$(specnaut verify-scripts); rc=$?; printf '%s\n' "$out"
   base=$(printf '%s\n' "$out" | sed -n 's/^BASE \([0-9a-f]\{40,64\}\)$/\1/p')
   last=$(printf '%s\n' "$out" | tail -n 1)
   if [ "$rc" -eq 0 ] && [ -n "$base" ] && [ "$last" = "VERDICT scripts trusted" ]; then
     bash .specnaut/scripts/audit/collect-audit-scope.sh --range "$base..HEAD"
   else
     echo "SCRIPTS NOT RUN: verify-scripts exit $rc"
   fi
   ```

   The files under review are the lines of the file `NAMES_FILE` names. **No `BASE` line** — exit
   2 or 3, or no `specnaut` on the PATH — **stops the review**: say the base or the verifier is
   missing; never fall back to a script of the tree. Any outcome but the trusted one runs no script
   of the tree in this review: `phases/review-seats.md` § Review — Phase 0 says how each step is
   briefed. Phase 0 and Seat selection read the CATEGORY SIGNALS the scope script printed.
2. Measure (Phase 0), then fan the review seats out from this session (Phase 1) and aggregate
   their reports per `phases/review-seats.md`.
3. Detect the project's toolchain and run its quality gates.
4. If CRITICAL or HIGH findings exist, route fixes to the implementer and re-run. A HIGH size
   finding (`.specnaut/memory/size-limits.md`) is routed the same way — no special case, and
   its severity is fixed there, not re-judged.
5. Produce a final pass/fail report, then `rm -f` each `NAMES_FILE` step 1 printed.

## Phase 0 — Measure

You measure; the seats read. What you run before the first brief, and how each exit is briefed,
is `phases/review-seats.md` § Review — Phase 0.

## Phase 1 — Structural review

Read `phases/review-seats.md` before the first brief: what a brief may carry, and how the reports
become one verdict, live there.

### Seat selection

Read the CATEGORY SIGNALS of the scope block step 1 printed. The script decides; this table only
names what each signal selects.

| Seat                   | Runs when                                                                 |
| :--------------------- | :------------------------------------------------------------------------ |
| `code-reviewer`        | always — and runs its test checklist when `TEST_COUNT > 0`                |
| `security-expert`      | always                                                                    |
| `accessibility-expert` | `FRONTEND_COUNT > 0`                                                      |
| `dependency-expert`    | `DEP_COUNT > 0`                                                           |
| `performance-expert`   | the plan's § Audit findings records a `performance-expert` audit          |

The performance seat is the one the script does not select: whether the change has a hot path is
decided once, at plan time (`phases/plan.md`), and read here. A gated seat is required **only when
its signal fires**; when it does not, it is `SKIPPED` — not dispatched, not counted in
`SEATS_EXPECTED`. A skipped seat is not a missing one.

### Dispatch

Dispatch every selected seat by its name — `Task(subagent_type: "<seat>")` on Claude Code,
`spawn_agent(agent_type="<seat>")` on Codex — in one message, with no model or effort override:
the agent's own definition sets both. Run at most 4 in flight, and never more than the harness's
configured limit; start the next seat as one returns.

### The turn budget

A seat has a turn limit, and a brief that makes it discover the diff spends that budget before
the first finding. So the brief carries the file list, the base and head SHAs and the Phase 0
output, and the seat starts reading. For `code-reviewer`, it also carries `TEST_COUNT`. A diff of
more than ~40 files is split: the seat is dispatched as several instances, each with its own slice
of the files, and the seat counts once per instance in `SEATS_EXPECTED`.

Each seat returns findings at severity CRITICAL / HIGH / MEDIUM / LOW with file:line references
and a suggested fix, then one `REVIEW SUMMARY` block. Aggregate them per `phases/review-seats.md`.

## Phase 2 — Quality gates (auto-detected)

Read `phases/review-gates.md`: which commands run, and when the test command does not.

## Phase 3 — Fix loop

For each finding the routing rule below says to fix — which is most of them, not only the CRITICAL
and HIGH ones — spawn the `developer` agent with the finding and the target file:line. After the
developer reports the fix, re-run the specific check that failed (or the full quality gate if the
fix is broad), after re-running the step 1 block: a fix may have touched `.specnaut/scripts/`, and
the last verdict no longer holds.

Batch the cheap ones into a single dispatch. Ten one-line fixes are one commit and one round trip,
not ten.

Repeat until only MEDIUM / LOW remain OR a fix has cycled twice without resolution — in the latter
case, stop and escalate to the user as a blocker. Choosing *between* technical fixes is never the
user's call: the seat that found the issue ranks the options and the developer applies the top one.

**Do not ask the user between cycles.** The fix loop runs before the merge; they asked for a working
branch, not for a vote on every round.

**Report harm, not labels.** Sort each finding into *"would hurt a user, a maintainer, or the data
if shipped"* versus *"should be better"*, and choose by the harm rather than the severity word. A
finding labelled HIGH that describes a lost log line is not worth a cycle; one labelled MEDIUM that
loses data is. **"Nothing here would hurt anyone" is a valid and valuable verdict**, not a failure
to find things.

## 🔒 Route by the cost of the FIX, never by the severity word

**The default is: fix it now, in this branch, in this turn.** A review that converts its own
findings into backlog items is not reviewing — it is redistributing work, and it does it faster than
anyone can absorb it. A run that lands one item and leaves four behind has made the backlog longer
than it found it, every time, forever.

Ask one question per finding, and it is not "how severe is this":

> **Can I fix it inside what this branch already touches, and can I write a
> test that fails without the fix?**

- **Yes → fix it now.** Same branch, same turn, its own commit. This applies to
  a LOW as much as to a HIGH. A one-line widening, a missing `|| true`, a stale
  comment, a wrong message, a guard with no witness — these are cheaper to fix
  than to describe, and describing them is what fills a backlog with work nobody
  will do.
- **No → and only then, file it.** Four reasons qualify, and nothing else does:
  it needs a **product decision** somebody has to make; it crosses a **boundary
  this branch does not touch**; it needs a **migration** or a coordinated
  release; or **the fix is larger than the original task**.

**"Out of scope" is not a reason — it is the label put on a finding nobody costed.** The scope is to
leave the code better than it was found. If a finding is filed, the report says **why it could not
be fixed here**, in one sentence, in the finding itself. A filed finding with no such sentence is a
defect in the review, not an item for the backlog.

**What gets filed gets filed loudly.** Anything that survives the four reasons is by definition
significant, so it is opened at **P0 or P1** — never P2, never P3. A backlog where the real problems
sit at the same priority as a naming nit is a backlog where the real problems are invisible. If a
finding does not deserve P1, it did not deserve a ticket; it deserved a fix.

**Re-reviewing because the last review found *something* is not a reason** — it is always true, and
a loop with no exit criterion does not terminate. The exit is "nothing left that would hurt a user,
a maintainer, or the data", not "nothing left at all".

## An epic's children, and a missing seat

On an epic branch only the last child's review is a stop (`phases/epic-loop.md` § The loop). A seat that did not report stops the run before the merge (`phases/review-seats.md`
§ A missing seat stops the run).

## Phase 4 — Final report

The human-facing wrapper around the report `phases/review-seats.md` § The report defines — its
`PER-SEAT ROLL-UP` with the findings, verbatim, and its aggregated `REVIEW SUMMARY` block, last:

```
📋 Review Summary — <feature name>

<the PER-SEAT ROLL-UP and its CRITICAL / HIGH findings, per phases/review-seats.md>

Quality gates
  format              : PASS | FAIL | SKIPPED
  lint                : PASS | FAIL | SKIPPED
  typecheck           : PASS | FAIL | SKIPPED
  test                : PASS | FAIL | SKIPPED | SKIPPED (epic child — runs at the last review)

Fixes applied
  - <file>:<line> — <one-line summary>

Remaining findings (MEDIUM/LOW, non-blocking)
  - …

Overall: PASS | FAIL

<the aggregated REVIEW SUMMARY block, per phases/review-seats.md>
```

If Overall = PASS, surface the verdict summary and follow `phases/auto-chain.md`
from there — it alone says whether `merge` follows in the same turn or is asked
for. If FAIL, stop and report to the user.
