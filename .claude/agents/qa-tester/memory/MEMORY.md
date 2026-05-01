# qa-tester memory index

One-line pointer per memory file. The agent reads this index at the start
of every dispatch and pulls in the files it needs. Keep this index under
200 lines; prune entries when the underlying issue is fixed (re-runs will
re-flag a regression on their own).

## Suppressions (won't-fix or dev-only noise)

- [Dev-only Deno "exports" warning](dev-only-deno-warning.md) — benign
  stderr noise from `deno run` path; never appears in the compiled
  binary; do not flag.

## Tracked in backlog (re-flag once the ticket closes)

_(empty — add entries here as backlog tickets get opened for QA findings)_

## Patterns

_(empty — add entries here as recurring shapes of finding emerge)_
