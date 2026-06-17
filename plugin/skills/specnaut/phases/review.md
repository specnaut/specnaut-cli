
## User Input

```text
$ARGUMENTS
```

## Outline

1. Identify files modified in the current feature branch:
   `git diff --name-only $(git merge-base HEAD main)`
2. Delegate structural review to parallel sub-agents via the `review-coordinator`.
3. Detect the project's toolchain and run its quality gates.
4. If CRITICAL or HIGH findings exist, route fixes to the implementer and re-run.
5. Produce a final pass/fail report.

## Phase 1 — Structural review

Spawn the `review-coordinator` agent with the list of changed files. It in turn
spawns:

- `code-reviewer` (always) — architecture, DRY, YAGNI, readability, alignment
  with `.specflow/memory/constitution.md`.
- `security-auditor` (always) — input validation, auth/authz, secret handling,
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

For each CRITICAL or HIGH finding, spawn the `developer` agent with the finding
and the target file:line. After the developer reports the fix, re-run the
specific check that failed (or the full quality gate if the fix is broad).

Repeat until only MEDIUM / LOW remain OR a fix has cycled twice without
resolution — in the latter case, stop and escalate to the user.

## Phase 4 — Final report

Emit a single report in this exact structure:

```
📋 Review Summary — <feature name>

Structural
  code-reviewer       : PASS | FAIL (N CRITICAL, M HIGH, …)
  security-auditor    : …
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

If Overall = PASS, surface the STOP #2 summary block defined in
`phases/auto-chain.md` and ask for merge confirmation, then invoke
`/specnaut merge` on "yes". If FAIL, stop and report to the user.
