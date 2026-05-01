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

- [Tracked findings](tracked-findings.md) — symptoms covered by open
  tickets #15 (self-update --check), #16 (init file-count discrepancy),
  #17 (init next-steps vs docs), #19 (--help docs URL), #20 (check
  --project version phrasing). Suppress these in reports until the
  matching ticket closes. (#18 closed by PR #22 — section removed; the
  next QA run will re-verify the rename from a fresh-eyes perspective.)

## Patterns

_(empty — add entries here as recurring shapes of finding emerge)_
