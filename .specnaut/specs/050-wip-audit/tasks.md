# Tasks — 050-wip-audit (cli#673)

Derived from the approved `plan.md`. Each task runs in order.

- [ ] T001 Write `tests/scripts/wip_audit_test.ts` first, using `git_sandbox.ts` and a bare
      `origin`. It covers every line in FR-001, the FR-002 near-misses, the FR-003 exits, the
      `@epoch` filter, `feature.json` linkage and `--limit`/`DEFERRED` (SC-001).
- [ ] T002 Add `templates/core/specnaut/scripts/bash/wip-audit.sh` (FR-001…FR-004) and its
      `templates/manifest.json` entry. The tests must go green, and every assertion must be
      red-probed.
- [ ] T003 groom.md: add check 2, "WIP audit — Ready and In progress" (FR-005 and the allowlist),
      renumber the later checks, change "four" to "five", fix the cross-references, and keep WIP
      items out of `groom-verify` scope. Update groom-report.md with the WIP section.
- [ ] T004 product-owner.md: the `next` bullet gets the WIP count, limit 5 and `--wip-limit`
      (FR-006); the `groom` bullet points at check 2. Update the `next` rows in SKILL.md and
      backlog.md (FR-009), and the cloud row in backlog.md (FR-008).
- [ ] T005 merge.md: make step 5 "Settle the card", a three-row gate, and point step 2, the exit-7
      row and Output at it (FR-007).
- [ ] T006 Mirror every edited Markdown file into `plugin/`, byte-identical. Update the pinned
      tests: the section count, the §2 keep-list. Add a guard test for FR-005's table and allowlist,
      FR-006 and FR-007.
- [ ] T007 Smoke: the script ships and groom names it (`smoke-features.sh`). Then run
      `deno task bundle`, `deno task test`, and `scripts/smoke/audit.sh --since main`.
