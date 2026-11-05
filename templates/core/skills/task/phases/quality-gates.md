# Quality gates — two tiers, declared by the project

Loaded by `phases/implement.md` after each child commit on an epic branch, by
`phases/review.md` for the unit suite on the frozen tree, and by
`phases/merge.md` once before the merge to the default branch.

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
  a command that changes directory does not relocate the next one. Each runs with
  no stdin: a command that reads it finds it empty.
- **A non-zero exit from any command fails the tier.**
- **A tier that is not declared is not a failure.** No `gates.yml`, or an empty
  list, and the run reports that the tier is not declared and continues. A
  project that declares neither keeps exactly today's behaviour.
- "No gate ran" and "the gate passed" are printed as different sentences,
  because they are different facts and a caller that cannot tell them apart
  will report the wrong one.

## Running only what a change can affect

A repository holding several workspaces may not want a one-line change to validate
every one of them. It can opt in, and **nothing changes for a project that does
not**. Specnaut ships no graph and no adapter: only the project knows its own
graph, and a shipped one would name a tool.

```
.specnaut/scripts/bash/run-gate.sh <fast|full> --base <rev>
.specnaut/scripts/bash/run-gate.sh <fast|full> --refs-stdin
```

Bare `run-gate.sh <tier>` never reads any of this: it stays the manual full
override. Behind a flag with no `.specnaut/impact.json`, here or on a base, the run
is the bare run, to the byte. `--refs-stdin` reads a pre-push hook's lines.

`.specnaut/impact.json` is the project's own, and Specnaut ships no copy of it:

```json
{
  "schema": 1,
  "adapter": { "command": "<a command>", "files": ["tools/graph-adapter"] },
  "scoped_tiers": ["fast"],
  "full_on": ["<a lockfile>", "<a directory>/"],
  "inert": [".specnaut/specs/", ".specnaut/feature.json"],
  "checks": [
    { "gate": "<a command in gates.yml>", "scoped": "<its narrowed form>" },
    { "gate": "<another>", "scoped": "<its narrowed form>", "owners": ["<an owner id>"] }
  ]
}
```

- **`adapter.command`** reports the graph. **`adapter.files`** names what it is built
  from; a change to any of them widens the run.
- **`scoped_tiers`**: a tier outside the list runs full.
- **`full_on`**: a changed path here runs full. **`inert`**: a changed path here affects
  nothing, such as what every branch commits. `full_on` beats `inert`.
- **`checks`** maps a gate command, by its exact string, to the command that narrows
  it. The scoped command reads the owners from `SPECNAUT_AFFECTED_OWNERS`,
  space-separated; they are never spliced into the string. A check with **`owners`** is
  omitted when none of them is affected, and given only those that are. **A gate
  command with no check always runs.**
- A path in `adapter.files`, `full_on`, `inert` and an owner's `roots` is a directory prefix ending in `/`,
  or an exact path: relative, with no `..`, no `./`, no `//`, no backslash, no glob and
  no control character. An owner id matches `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.

**The adapter.** It is the base's copy, run from a temporary worktree of the base, once
for each base and once for the candidate. It gets no stdin and no `GIT_*` variable, runs
in the shell of the twin that started it, and is told `SPECNAUT_IMPACT_TREE` (the
absolute path of the tree to describe), `SPECNAUT_IMPACT_COMMIT`, `SPECNAUT_IMPACT_OUT`
(where to write), `SPECNAUT_IMPACT_SCHEMA` and `SPECNAUT_IMPACT_REPO` (the candidate
root, should it need an installed toolchain). It writes:

```json
{ "schema": 1, "commit": "<SPECNAUT_IMPACT_COMMIT>", "complete": true,
  "owners": [{ "id": "<id>", "roots": ["<path>"], "depends_on": ["<id>"] }] }
```

**What runs.** A changed path under a root in either snapshot affects that owner, and an
owner whose record differs, or that exists on one side only, is affected. So is every
owner that depends on an affected one, over the edges of every snapshot.

**Uncertainty widens.** Each of these runs the candidate's whole tier and names itself on
the `fallback:` line: an unowned path, a `full_on` match, a gitlink, a symlink or a type
change; a declaration, an `adapter.files` entry, `gates.yml` or `.specnaut/scripts/` that
differs from a given base, or from the merge-base with the default branch; any of those
that is not a tracked regular file; an adapter that fails or answers anything invalid; a
malformed declaration; a base that does not resolve or was never fetched; `jq` absent, older
than 1.6, or failing where its answer decides the run.

**Exit codes**, the last two only behind a flag:

| Exit | Meaning |
|------|---------|
| 0 | The selection passed |
| 1 | A command failed. It stops there, whatever else is true |
| 2 | Usage |
| 3 | **The candidate is refused**: a dirty tree, an untracked file, a tree that moved during the run, or a push of several trees. Nothing presents one tree's pass as another's. A gate that leaves an unignored file is refused too, by design |
| 4 | **Nothing was checked**: every command was omitted, or the tier was emptied on the branch. A skip is never a pass. With a `removed:` line other than `none`, stop and name what left the tier: a bare run of an empty tier passes. With `removed: none`, the bare run is the check |

**What it prints.** Every run behind a flag prints `candidate:`, `scope:`, `fallback:`,
`removed:`, `omitted:`, `ran:` and `evidence:` lines, in ASCII. `removed:` names what is in
a base's tier and gone from the candidate's, because "full" means the candidate's own list.
A pass whose `scope:` is not `full` **is not the full gate**, and its last line names the
scope. Nor is a pass with a `removed:` line other than `none`: it names those commands. Evidence
goes to `git rev-parse --git-path specnaut/gate-evidence/<tier>-<tree>.json`.
It is write-only: nothing reads it to decide anything, and failing to write it changes no
result.

**Limits to know.** A hung adapter hangs the run, as a gate command does today. Ignored
files are not part of the candidate. Each run costs a checkout of the base. A wrong adapter
under-selects, and only the project can know its graph; that `scoped` truly narrows its
gate is the project's claim too, and the evidence records what was trusted. It stops
mistakes, not a hostile branch, which already controls `gates.yml`. Behind a flag the PowerShell
twin needs pwsh 7.4 or later, and a SIGTERM during its adapter leaves the temporary worktree and
its registration behind: remove the directory and `git worktree prune` clears the entry.

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

It holds every changed file to the project's file limits
(`.specnaut/memory/size-limits.md`, overridden by `.specnaut/size-limits.yml`):
exit 1 is a failure of the tier it follows, fixed the same way; exit 2 means
`.specnaut/size-limits.yml` cannot be read — fix the file, never skip the
check. Any other exit (126, 127: a lost
executable bit, no bash) means the check did not run, which is a failure of the
tier, never a pass. Without `--since` it checks the
staged changes against the branch's merge base, which is the form a pre-commit
runner calls: an extraction commit followed by an addition passes, as long as
the file ends no larger than where the branch began. Every review runs it too,
through the review phase's Phase 0, so a standalone item is held as well. Specnaut installs
no git hook: wiring it into one is the project's choice.

## The import boundary — with every tier

When `.specnaut/scripts/bash/boundary-check.sh` is present, run it after each
tier, beside the size ratchet:

```
bash .specnaut/scripts/bash/boundary-check.sh
```

It holds the tracked files under the `domain:` paths of
`.specnaut/boundaries.yml` free of the `forbid:` patterns (extended regular
expressions), minus the `exempt:` globs. Which paths are the domain and which
imports break it are the project's to write: Specnaut ships no copy of that
file and no default pattern, because a guessed one would report a pass that
checked nothing.

- **Exit 0** — every file was checked and none matches. Report it as a pass.
- **Exit 1** — a forbidden import, printed as `path:line: pattern`. A failure
  of the tier it follows, fixed the same way.
- **Exit 2** — the check could not run: an unreadable config, a pattern that
  does not compile, a `domain:` path outside the repository, or a file it
  cannot read. Fix the cause; never skip the check.
- **Exit 4** — **skipped**, with the reason on stdout: no
  `.specnaut/boundaries.yml`, no `forbid:` patterns, no `domain:` paths, or no
  file left to check under them. Report it as *skipped: <reason>* — **never as
  a pass**. A project without the file has declared no boundary, and the gate
  says so instead of passing it.

Any other exit (126, 127) means the check did not run: a failure of the tier,
never a pass. Every review runs it too, in its Phase 0.

## A standalone item

Only the per-child `fast` loop is an epic mechanism. A standalone task has one
commit and one merge, so there is no per-child tier to run; the work-done row —
the unit suite, the size ratchet and the boundary check — still runs on it,
through `phases/review.md`.
