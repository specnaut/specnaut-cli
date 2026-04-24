---
name: code-review
description: Run all quality checks (format, lint, typecheck, tests) in one go. Use this skill whenever the user asks to "check everything", "run checks", "pre-commit", or "pre-push".
---

# Code Review and quality checks for the Miximodel project. This skill bundles all essential

Run **all** project quality gates in sequence. Stop at the first failure and fix
it before moving on.

## Quick Run (one command)

Run the bundled script to execute all checks in one shot:

```bash
.claude/skills/code-review/scripts/quality-checks.sh
```

This runs format → lint → typecheck → tests and stops at the first failure with
a clear error message.

## Steps

Run every step below **in order**. Each step MUST pass (exit code 0) before
proceeding to the next. If a step fails, fix the issue(s) and re-run that step
until it passes, then continue.

// turbo-all

### 1. Format (Prettier)

```bash
npm run format
```

Verify that no files were changed. If Prettier modified files, the code was not
formatted — note which files changed.

### 2. Lint (ESLint)

```bash
npm run lint
```

If there are errors, fix them. Use `npm run lint -- --fix` for auto-fixable
issues, then manually fix the rest.

### 3. TypeScript Type Check

```bash
npm run typecheck
```

If there are type errors, fix them. Pay attention to:

- Missing imports
- Incorrect types on Inertia page props (use inline types for `ExtractProps`
  compatibility)
- Unused variables/imports

### 4. Tests (Japa)

```bash
node ace test
```

If tests fail, investigate and fix. Run individual suites if needed:

- `node ace test --suite unit` — unit tests only
- `node ace test --suite functional` — functional tests only

## Summary Table

| Step | Command             | What it checks                           |
| ---- | ------------------- | ---------------------------------------- |
| 1    | `npm run format`    | Code formatting (Prettier)               |
| 2    | `npm run lint`      | Linting rules (ESLint + Prettier plugin) |
| 3    | `npm run typecheck` | TypeScript compilation (tsc --noEmit)    |
| 4    | `node ace test`     | Unit + functional tests (Japa)           |

## When to Use

- Before committing (`pre-commit`)
- Before pushing (`pre-push`)
- After finishing a feature or fixing a bug
- When the user says: "check", "checks", "vérifie", "pre-commit", "pre-push",
  "run checks", "lance les checks", "quality"
