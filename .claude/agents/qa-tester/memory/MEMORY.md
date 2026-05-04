# qa-tester memory index

One-line pointer per memory file. The agent reads this index at the start
of every dispatch and pulls in the files it needs. Keep this index under
200 lines; prune entries when the underlying issue is fixed (re-runs will
re-flag a regression on their own).

## Suppressions (won't-fix or dev-only noise)

- [Dev-only Deno "exports" warning](dev-only-deno-warning.md) — benign
  stderr noise from `deno run` path; never appears in the compiled
  binary; do not flag.
- [WebFetch cache after recent docs deploy](webfetch-cache-after-recent-deploy.md)
  — `WebFetch` may return stale `llms.txt` content for minutes after
  a GitHub Pages deploy; cross-check with `curl ?cb=$(date +%s)` before
  recording a T1 docs finding.

## Tracked in backlog (re-flag once the ticket closes)

- [Tracked findings](tracked-findings.md) — currently empty (no open
  QA-finding tickets). All six original findings (#15, #17, #18, #19,
  #20, #16) have shipped: #18 → PR #22, #19 → PR #24, #17 → PR #25,
  #20 → PR #26, #15 → PR #27, #16 → PR for init-count-mergeable.
  Sections removed as fixes shipped; the next QA run re-verifies each
  from a fresh-eyes perspective.

## Patterns

_(empty — add entries here as recurring shapes of finding emerge)_
