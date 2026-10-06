
## User Input

```text
$ARGUMENTS
```

## Outline

1. Identify files modified in the current feature branch:
   `git diff --name-only $(git merge-base HEAD main)`
2. Delegate structural review to parallel sub-agents via the `review-coordinator`.
3. Detect the project's toolchain and run its quality gates.
4. If CRITICAL or HIGH findings exist, route fixes to the implementer and re-run. A HIGH size
   finding (`.specnaut/memory/size-limits.md`) is routed the same way — no special case.
5. Produce a final pass/fail report.

## Phase 1 — Structural review

Spawn the `review-coordinator` agent with the list of changed files. It in turn
spawns:

- `code-reviewer` (always) — architecture, DRY, YAGNI, readability, alignment
  with `.specnaut/memory/constitution.md`.
- `security-expert` (always) — input validation, auth/authz, secret handling,
  SQL/command injection, path traversal, silent catches that swallow errors.
- `test-reviewer` (if test files are in the diff) — adequacy of coverage, test
  quality, mocking boundaries.

Each sub-agent returns findings at severity CRITICAL / HIGH / MEDIUM / LOW with
file:line references and a suggested fix. The coordinator aggregates them into
a single report.

## Phase 2 — Quality gates (auto-detected)

Detect the project's toolchain by looking for marker files and run the
corresponding commands. Stop at the first failure.

| Marker file       | Format command        | Lint command       | Type-check command | Test command        |
|-------------------|-----------------------|--------------------|--------------------|---------------------|
| `deno.json(c)`    | `deno fmt --check`    | `deno lint`        | `deno check **/*.ts` | `deno test`      |
| `package.json`    | `npm run format:check` if defined, else `npx prettier --check .` | `npm run lint` if defined, else `npx eslint .` | `npm run typecheck` if defined, else skip | `npm test` if defined, else skip |
| `Cargo.toml`      | `cargo fmt -- --check`| `cargo clippy -- -D warnings` | `cargo check` | `cargo test`          |
| `go.mod`          | `gofmt -l .`          | `go vet ./...`     | (built into compile) | `go test ./...`   |
| `pyproject.toml`  | `ruff format --check .` or `black --check .` if declared | `ruff check .` if declared | `mypy .` if declared | `pytest` if declared |

If none of the markers match, skip Phase 2 and note it in the report.

## Phase 3 — Fix loop

For each finding the routing rule below says to fix — which is most of them, not
only the CRITICAL and HIGH ones — spawn the `developer` agent with the finding
and the target file:line. After the developer reports the fix, re-run the
specific check that failed (or the full quality gate if the fix is broad).

Batch the cheap ones into a single dispatch. Ten one-line fixes are one commit
and one round trip, not ten.

Repeat until only MEDIUM / LOW remain OR a fix has cycled twice without
resolution — in the latter case, stop and escalate to the user as a blocker.
Choosing *between* technical fixes is never the user's call: the seat that
found the issue ranks the options and the developer applies the top one.

**Do not ask the user between cycles.** The fix loop runs before the merge; they
asked for a working branch, not for a vote on every round.

**Report harm, not labels.** Sort each finding into *"would hurt a user, a
maintainer, or the data if shipped"* versus *"should be better"*, and choose by
the harm rather than the severity word. A finding labelled HIGH that describes a
lost log line is not worth a cycle; one labelled MEDIUM that loses data is.
**"Nothing here would hurt anyone" is a valid and valuable verdict**, not a
failure to find things.

## 🔒 Route by the cost of the FIX, never by the severity word

**The default is: fix it now, in this branch, in this turn.** A review that
converts its own findings into backlog items is not reviewing — it is
redistributing work, and it does it faster than anyone can absorb it. A run that
lands one item and leaves four behind has made the backlog longer than it found
it, every time, forever.

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

**"Out of scope" is not a reason — it is the label put on a finding nobody
costed.** The scope is to leave the code better than it was found. If a finding
is filed, the report says **why it could not be fixed here**, in one sentence, in
the finding itself. A filed finding with no such sentence is a defect in the
review, not an item for the backlog.

**What gets filed gets filed loudly.** Anything that survives the four reasons is
by definition significant, so it is opened at **P0 or P1** — never P2, never P3.
A backlog where the real problems sit at the same priority as a naming nit is a
backlog where the real problems are invisible. If a finding does not deserve P1,
it did not deserve a ticket; it deserved a fix.

**Re-reviewing because the last review found *something* is not a reason** — it
is always true, and a loop with no exit criterion does not terminate. The exit is
"nothing left that would hurt a user, a maintainer, or the data", not "nothing
left at all".

## An epic's children — only the last review is a stop

On an epic branch this phase runs once per child, inside the loop
(`phases/epic-loop.md`). **A child's review does not stop the run.** Findings
go to the lead, who triages, fixes, commits against that child and moves on in
the same turn.

**The last child's review is the stop** — the single user-facing checkpoint
before the merge. Everything below applies to it exactly as written; the
earlier children's reviews are reported and carried, not held.

## Phase 3b — A missing seat stops the run

Before the report: if the aggregated block has `SEATS_REPORTED <
SEATS_EXPECTED`, the run **does not reach the merge prompt**. Say which seat
did not report and stop. Findings-based routing cannot catch this — a seat
that never ran produces no findings to route and no cell to fill, so without
this check a lost seat reads as a quiet pass all the way to merge.

A seat can be short here for two reasons now: it returned no block, or it
returned a **clean** one naming no evidence from the diff, which the
coordinator counts as zero. This check needs no change to catch the second —
that is the point of the state being a number rather than a prose note.

Re-dispatching the missing seat with a **narrower** brief is the normal remedy
and does not need permission. Repeating the same brief is not.

## Phase 4 — Final report

Emit a single report in this exact structure:

```
📋 Review Summary — <feature name>

Structural
  code-reviewer       : PASS | FAIL (N CRITICAL, M HIGH, …)
  security-expert    : …
  test-reviewer       : … (or SKIPPED)

Quality gates
  format              : PASS | FAIL | SKIPPED
  lint                : PASS | FAIL | SKIPPED
  typecheck           : PASS | FAIL | SKIPPED
  test                : PASS | FAIL | SKIPPED

Fixes applied
  - <file>:<line> — <one-line summary>

Remaining findings (MEDIUM/LOW, non-blocking)
  - …

Overall: PASS | FAIL
```

If Overall = PASS, surface the verdict summary defined in
`phases/auto-chain.md`, then follow the project's merge mode from that file:
under `auto` (the default) invoke `/specnaut merge` in the same turn; under
`manual` ask for merge confirmation and invoke it on "yes". If FAIL, stop and
report to the user.
