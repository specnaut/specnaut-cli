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
FRONTEND_COUNT: <integer>
TEST_COUNT: <integer>
DEP_COUNT: <integer>
INFRA_COUNT: <integer>
```

## Rules

- Resolution priority: `--path`/`--range` → unpushed (`origin/main..HEAD`) → since-tag → last-N
  (default 20; `--last <n>` overrides).
- Argument validation (exit 2 with a clear `error:` on stderr, no block, before any git call):
  - `--last <n>` MUST be a positive integer (`^[0-9]+$` and ≥ 1).
  - `--range <a>..<b>` MUST match `^[^.]+\.\.[^.]+$`.
  - `--path` / `--range` present with an empty argument is an error (no silent fall-through to
    auto-scope).
- `--path` resolving to zero tracked files emits a `warning:` on stderr (the scope is still produced
  with `TOTAL_FILES: 0`, exit 0).
- Not a git repo → exit non-zero with `error: /code-audit requires a git repository` and no block.
- `TOTAL_FILES: 0` is emitted distinctly (exit 0) so the skill stops (no empty seat dispatch) —
  distinct from the argument-validation exit 2.
- All counts are explicit integers including 0.
- Category globs are heuristic (see research.md Decision 1); good enough to select seats.
