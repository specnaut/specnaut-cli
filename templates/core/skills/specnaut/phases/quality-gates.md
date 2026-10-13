# Quality gates — two tiers, declared by the project

Loaded by `phases/implement.md` after each child commit on an epic branch, and
by `phases/merge.md` once before the merge to the default branch.

Looping over an epic's children is only affordable if the per-child check is
cheap. Running a project's whole suite once per child would cost more than the
N-merges problem the loop removes. So there are two tiers, and the difference
between them is **how often they run**, not how thorough they are.

## Three moments, and what runs at each

The workflow commits often — one commit per task, split by scope, and one per
child on an epic. What is checked has to follow how often it runs:

| Moment | What runs | How often |
|--------|-----------|-----------|
| **Every commit**, every epic child | Static checks only: format, lint, type check. The `fast` tier. **No unit suite.** | Once per commit |
| **Work done** — `implement` freezes the tree and invokes `review` | The unit suite, on the frozen tree — `review`'s test command | **Once** per item; on an epic, at the last child's review |
| **Merge** to the default branch | Unit plus functional / end-to-end. The `full` tier. | **Once** |

The middle row needs no declaration: `phases/review.md` detects the project's
test command and runs it there. On an epic it skips it for every child but the
last, and reports the skip as its own state — a skipped suite never reads as a
pass. If `full` is not declared, the merge runs nothing, and that last review's
run is the latest the suite ran.

**A commit hook is the first row.** Specnaut installs no git hook and edits
none, and nothing here asks an agent to get past one. But if the project has a
hook of its own, it runs at the first row's rate, so it should carry the
static checks only. A hook that runs the whole suite runs it once per agent
commit — the cost this table exists to remove.

## Where they are declared, and by whom

`.specnaut/gates.yml`, two keys:

```yaml
fast_gate:
  - <a command>
  - <another command>
full_gate:
  - <a command>
```

Each key is a flat list of shell command strings. **They are the project's
commands, run verbatim.** Specnaut does not know what a test is, what your
runner is called, or what any of these do, and the gate mechanism names no test
tool, runner or framework. That is a constitutional constraint, not a style
preference: this tool is stack-agnostic, and a tool name written into the
mechanism would end that.

The constraint holds **structurally** rather than by review. There is nowhere
in the mechanism for a tool name to be written: the declaration is yours, the
runner executes what it reads, and neither this document nor the script has a
default to fall back to. The one sanctioned place where runners are named is
`phases/review.md`'s auto-detect table, which recognises common toolchains by
their marker files; it is detection, not a default this mechanism falls back
to.

## Running one

```
.specnaut/scripts/bash/run-gate.sh <fast|full>
```

or its PowerShell twin. **That script is the only parser.** The loop and the
pre-merge step both call it; neither reads `gates.yml` itself. A second parser
is a second definition of what a gate is, and two definitions drift.

- Commands run in order, from the repository root, each in its own subshell —
  a command that changes directory does not relocate the next one.
- **A non-zero exit from any command fails the tier.**
- **A tier that is not declared is not a failure.** No `gates.yml`, or an empty
  list, and the run reports that the tier is not declared and continues. A
  project that declares neither keeps exactly today's behaviour.
- "No gate ran" and "the gate passed" are printed as different sentences,
  because they are different facts and a caller that cannot tell them apart
  will report the wrong one.

## `fast` — after every child commit

Its intended content is a **static pass**: format, lint, type check. Not the
unit suite — that runs once when the work is done, and again at the merge.
Short enough that running it N times over an epic's children is not what makes
the loop expensive. The content is yours to declare; the intent is what this
document is for.

**A child that fails its fast gate is fixed in place.** The lead fixes it, the
gate re-runs for that child, and the loop continues to the next. It is not an
escalation and it does not hand back to the user.

**The child's review never stops the loop either** (`phases/review.md`, which
skips the test command on every child but the last). Findings go to the lead,
who triages, fixes, commits the child and moves on in the same turn. Only the
last child's review is a stop.

## `full` — once, before the merge

Its intended content is the **unit suite plus whatever long-running functional
or end-to-end suite** the project has: the kind that drives a real browser,
boots real services, or takes tens of minutes.

**It runs once, before the merge to the default branch, and never per child.**
That is the whole reason the tiers exist, and it is stated here plainly rather
than left to be inferred from the word "full".

A failing full gate is fixed on the branch and retried — a fixup commit
attributed to the child at fault, then the gate again. It does not abandon the
merge and does not hand the epic back.

## The size ratchet — with every tier

When `.specnaut/scripts/bash/size-ratchet.sh` is present, run it after each tier,
on what the branch has committed:

```
bash .specnaut/scripts/bash/size-ratchet.sh --since "$(git merge-base HEAD <default branch>)"
```

It holds every changed file to the constitution's file limits
(`.specnaut/memory/size-limits.md`): exit 1 is a failure of the tier it follows,
fixed the same way; exit 2 means the constitution's Size limits table cannot be
read — fix the table, never skip the check. Any other exit (126, 127: a lost
executable bit, no bash) means the check did not run, which is a failure of the
tier, never a pass. Without `--since` it checks the
staged changes against the branch's merge base, which is the form a pre-commit
runner calls: an extraction commit followed by an addition passes, as long as
the file ends no larger than where the branch began. Every review runs it too,
through the review coordinator, so a standalone item is held as well. Specnaut installs
no git hook: wiring it into one is the project's choice.

## A standalone item

None of this applies. A standalone task has one commit and one merge; there is
no per-child tier to run, and a project that has declared gates may still run
them by hand. The tiers are an epic mechanism.
