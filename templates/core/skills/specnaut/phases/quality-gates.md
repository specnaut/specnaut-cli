# Quality gates — two tiers, declared by the project

Loaded by `phases/implement.md` after each child commit on an epic branch, and
by `phases/merge.md` once before the merge to the default branch.

Looping over an epic's children is only affordable if the per-child check is
cheap. Running a project's whole suite once per child would cost more than the
N-merges problem the loop removes. So there are two tiers, and the difference
between them is **how often they run**, not how thorough they are.

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
runner is called, or what any of these do — and no bundled Specnaut file names
a test tool, runner or framework. That is a constitutional constraint, not a
style preference: this tool is stack-agnostic, and a tool name written into a
shipped file would end that.

The constraint holds **structurally** rather than by review. There is nowhere
in the mechanism for a tool name to be written: the declaration is yours, the
runner executes what it reads, and neither this document nor the script has a
default to fall back to.

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

Its intended content is a **surface pass**: unit tests, an agent review, type
checking. Short enough that running it N times over an epic's children is not
what makes the loop expensive. The content is yours to declare; the intent is
what this document is for.

**A child that fails its fast gate is fixed in place.** The lead fixes it, the
gate re-runs for that child, and the loop continues to the next. It is not an
escalation and it does not hand back to the user.

**The agent review inside this tier never stops the loop either.** Findings go
to the lead, who triages, fixes, commits the child and moves on in the same
turn. Only the last child's review is a stop.

## `full` — once, before the merge

Its intended content includes whatever **long-running end-to-end suite** the
project has: the kind that drives a real browser, boots real services, or takes
tens of minutes.

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
.specnaut/scripts/bash/size-ratchet.sh --since "$(git merge-base HEAD <default branch>)"
```

It holds every changed file to the constitution's file limits
(`.specnaut/memory/size-limits.md`): exit 1 is a failure of the tier it follows,
fixed the same way; exit 2 means the constitution's Size limits table cannot be
read — fix the table, never skip the check. Without `--since` it checks the
staged changes, which is the form a pre-commit runner calls. Specnaut installs
no git hook: wiring it into one is the project's choice.

## A standalone item

None of this applies. A standalone task has one commit and one merge; there is
no per-child tier to run, and a project that has declared gates may still run
them by hand. The tiers are an epic mechanism.
