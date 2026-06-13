# Research — `/code-audit`

## Decision 1 — Scope resolution & category detection (the script)

**Decision**: `collect-audit-scope.sh` (bash + git). Resolution priority: `--path`/`--range` →
`git log origin/main..HEAD` (unpushed) → `git describe --tags --abbrev=0` then `<tag>..HEAD`
(since-tag) → `HEAD~<N>..HEAD` (last-N, N default 20, `--last <n>` to override). It prints a fixed
block: a `SCOPE` label line (one of `path`/`range`/`unpushed`/`since-tag`/`last-N`), the commit
list, the changed/tracked file list, and `CATEGORY SIGNALS` integer counts. Aborts with a clear
message if `git rev-parse` fails (not a repo); prints `TOTAL_FILES: 0` distinctly for an empty
scope.

Category detection by path/extension glob over the scope's files:

- `FRONTEND_COUNT` — `*.tsx|*.jsx|*.vue|*.svelte|*.css|inertia/**|*frontend*` style globs.
- `TEST_COUNT` — `*_test.*|*.test.*|*.spec.*|tests/**`.
- `DEP_COUNT` — manifest files
  (`package.json|deno.json|*.lock|Cargo.toml|pyproject.toml|go.mod|composer.json|Gemfile`).
- `INFRA_COUNT` — `Dockerfile|*.tf|*.pulumi.*|k8s/**|.github/workflows/**|*.yaml|*.yml` under infra
  paths.

**Rationale**: Mirrors the proven miximodel `collect-audit-scope.sh` and the existing
`/specflow audit` `git ls-files` inventory approach. Pure bash+git keeps it dependency-free and
runnable in any scaffolded project. Heuristic globs are "good enough to pick seats" (Assumption in
spec).

**Alternatives considered**: a Deno/TS scope tool — rejected: adds a runtime dependency to a step
that is naturally shell+git, and the script must run in arbitrary user projects where the Specflow
binary isn't necessarily on PATH at audit time.

## Decision 2 — Seat selection from signals

**Decision**: Architecture + security + performance deploy on any non-empty scope (always-relevant
lenses; every rule decidable from existing signals — there is no `DOCS_COUNT` signal, so performance
has no docs-only carve-out). Accessibility deploys iff `FRONTEND_COUNT > 0`. Dependency deploys iff
`DEP_COUNT > 0`. Every skip is recorded in the report with its reason. Mapping table is
authoritative in data-model.md.

**Rationale**: Matches the issue's "skip a seat when its category signal is zero" and the miximodel
default-team behaviour (architecture mandatory; a11y/dep gated on signals). Keeps the audit
proportional.

**Alternatives considered**: deploy all five always — rejected: wastes an accessibility pass on a
pure-backend scope and dilutes the report (the issue explicitly wants signal-gated seats).

## Decision 3 — Skill shape, parallel dispatch, synthesis

**Decision**: A Claude-Code orchestrator skill (`SKILL.md`) whose steps instruct the lead to: (1)
run the script and read the block; (2) stop if `TOTAL_FILES: 0`; (3) select seats from the signals;
(4) dispatch ALL selected seats in a SINGLE message (one `Agent` call per seat) with an audit
framing (judge the shape of merged work, not per-line PR review) — the same auditor agents
`/specflow audit` uses; (5) wait, then merge → dedupe by file+line → severity-rank → emit one
report + the aggregated `REVIEW SUMMARY`. The parallel-in-one-message rule is stated explicitly (it
is the SC-003 contract).

**Rationale**: Directly ports the miximodel `/code-audit` orchestration. Reuses the existing auditor
agents (now emitting the canonical REVIEW SUMMARY from #378), so synthesis parses verdicts/counts
mechanically rather than from prose.

## Decision 4 — Bundle inclusion (confirmed manifest-driven from #378)

**Decision**: Register the `code-audit` skill in `templates/manifest.json` (the bundler is
manifest-driven, established in #378). The script asset under the skill's `scripts/` dir bundles
with the skill the way `backlog`'s scripts do — confirm the manifest entry/asset-walk covers the
`scripts/` subdir (check how `backlog` is registered) and follow that exact shape.

**Rationale**: #378 proved the generator only bundles manifest-listed entries. Following the
`backlog` skill's manifest shape ensures the `scripts/` asset ships.

## Seat → agent → governing signal (authoritative)

| Seat          | Agent                | Deployed when            |
| ------------- | -------------------- | ------------------------ |
| Architecture  | architecture-auditor | scope non-empty (always) |
| Security      | security-auditor     | scope non-empty (always) |
| Performance   | performance-auditor  | scope non-empty (always) |
| Accessibility | a11y-auditor         | `FRONTEND_COUNT > 0`     |
| Dependency    | dependency-auditor   | `DEP_COUNT > 0`          |
