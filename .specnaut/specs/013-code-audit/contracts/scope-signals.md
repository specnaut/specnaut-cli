# Contract: `collect-audit-scope.sh` output

The script prints one fixed block to stdout. The `/code-audit` skill parses it.

## Output format

```text
CODE-AUDIT SCOPE
SCOPE: path | range | unpushed | since-tag | last-N
SCOPE_LABEL: <human label, e.g. "origin/main..HEAD (7 commits)" or "app/domains/studio">
COMMITS:
<short-sha  subject>   (zero or more lines; empty for --path)
FILES:
<path>                 (one per line; the changed/tracked files in scope)
TOTAL_FILES: <integer>
CATEGORY SIGNALS
FRONTEND_COUNT: <integer>   # GATING — > 0 deploys the accessibility seat
TEST_COUNT: <integer>       # GATING (a checklist) — > 0 runs code-reviewer's test checklist
DEP_COUNT: <integer>        # GATING — > 0 deploys the dependency seat
INFRA_COUNT: <integer>      # INFORMATIONAL — context only, no seat consumes it
```

## Signal intent — gating vs informational

The four CATEGORY SIGNALS split into two roles. All four are **always emitted**; the distinction is
whether a seat reads them:

- **Gating signals** select an auditor seat:
  - `FRONTEND_COUNT > 0` → deploy the **accessibility** seat (`a11y-auditor`).
  - `DEP_COUNT > 0` → deploy the **dependency** seat (`dependency-auditor`).
  - `TEST_COUNT > 0` → during `/task review`, `code-reviewer` runs its **test checklist**. It gates
    a checklist inside a seat that always runs, not a seat of its own. Test files are matched by
    `*_test.*`, `*.test.*`, `*.spec.*`, `tests/`, `test/` (top level or nested) and `__tests__`.
- **Informational signals** describe the scope but gate nothing:
  - `INFRA_COUNT` is context only — there is no infra auditor seat, by design. It is not an orphaned
    bug; it rounds out the scope picture for the maintainer reading the block.

## Rules

- Resolution priority: `--path`/`--range` → unpushed (`origin/main..HEAD`) → since-tag → last-N
  (default 20; `--last <n>` overrides).
- Argument validation (exit 2 with a clear `error:` on stderr, no block, before any git call):
  - `--last <n>` MUST be a positive integer (`^[0-9]+$` and ≥ 1).
  - `--range <a>..<b>` MUST match `^[A-Za-z0-9._/@^~-]+\.\.[A-Za-z0-9._/@^~-]+$` (each endpoint
    restricted to a git-ref-name allowlist around a single two-dot `..`; three-dot ranges, shell
    metacharacters, and whitespace are rejected).
  - `--path` / `--range` present with an empty argument is an error (no silent fall-through to
    auto-scope).
- `--path` resolving to zero tracked files emits a `warning:` on stderr (the scope is still produced
  with `TOTAL_FILES: 0`, exit 0).
- Not a git repo → exit non-zero with `error: /code-audit requires a git repository` and no block.
- `TOTAL_FILES: 0` is emitted distinctly (exit 0) so the skill stops (no empty seat dispatch) —
  distinct from the argument-validation exit 2.
- All counts are explicit integers including 0.
- Category globs are heuristic (see research.md Decision 1); good enough to select seats.
