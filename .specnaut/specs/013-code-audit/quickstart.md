# Quickstart — `/code-audit`

## What ships

A bundled orchestrator skill `code-audit` + a `collect-audit-scope.sh` scope script. `/code-audit`
resolves a scope on `main`, deploys the relevant auditor seats in parallel, and returns one
synthesized, deduplicated, severity-ranked report with an aggregated REVIEW SUMMARY.

## Build & test

```bash
cd apps/specflow-cli
deno task bundle      # register + embed the code-audit skill (+ scripts/)
deno task test        # bundle + scope-script behaviour test + skill-content/inclusion assertions
```

## Manual verification

```bash
# script resolves scope + emits signals (run inside a git repo with commits)
bash templates/core/skills/code-audit/scripts/collect-audit-scope.sh --last 5
#   → CODE-AUDIT SCOPE / SCOPE: last-N / … / CATEGORY SIGNALS / FRONTEND_COUNT: … etc.

# not-a-repo guard
( cd "$(mktemp -d)" && bash <path>/collect-audit-scope.sh ; echo "exit=$?" )   # non-zero + clear error

# skill present + bundled + read-only framing
grep -q "in a SINGLE message" templates/core/skills/code-audit/SKILL.md   # parallel-dispatch rule
grep -c "code-audit" src/templates_bundle.ts                              # > 0
```

## End-to-end (behavioural)

In a repo with mixed recent commits, run `/code-audit`. Confirm: one report (not five); seats match
the signals (a backend-only scope skips accessibility, recorded); the closing REVIEW SUMMARY obeys
the dominance rule with summed counts; `git status` is unchanged after the run.

## Success signals

- `deno task test` green incl. the new scope-script + skill-content + bundle-inclusion tests.
- `/code-audit` and `--path`/`--range` resolve scope and deploy the right seats in parallel.
- Read-only: `git status` identical after a run (SC-005).
- `specflow init`/`upgrade` deliver the skill + script.
