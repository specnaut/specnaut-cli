# Review — Phase 2, the quality gates

Loaded by `phases/review.md` at Phase 2. It is the single home of which commands the review
detects and runs, and of when the test command runs.

## Phase 2 — Quality gates (auto-detected)

Detect the project's toolchain by looking for marker files and run the
corresponding commands. Stop at the first failure.

**The test command runs once per item, not once per child.** On an epic child
that is not the last, run the format, lint and type-check commands and **do not
run the test command** — report it as `SKIPPED (epic child — runs at the last
review)`, never as PASS. On a standalone item's review and on the last child's
review, run it. That last run is the "work done" moment in
`phases/quality-gates.md`: the unit suite, once, on the frozen tree.

| Marker file       | Format command        | Lint command       | Type-check command | Test command        |
|-------------------|-----------------------|--------------------|--------------------|---------------------|
| `deno.json(c)`    | `deno fmt --check`    | `deno lint`        | `deno check **/*.ts` | `deno test`      |
| `package.json`    | `npm run format:check` if defined, else `npx prettier --check .` | `npm run lint` if defined, else `npx eslint .` | `npm run typecheck` if defined, else skip | `npm test` if defined, else skip |
| `Cargo.toml`      | `cargo fmt -- --check`| `cargo clippy -- -D warnings` | `cargo check` | `cargo test`          |
| `go.mod`          | `gofmt -l .`          | `go vet ./...`     | (built into compile) | `go test ./...`   |
| `pyproject.toml`  | `ruff format --check .` or `black --check .` if declared | `ruff check .` if declared | `mypy .` if declared | `pytest` if declared |

If none of the markers match, skip Phase 2 and note it in the report.
