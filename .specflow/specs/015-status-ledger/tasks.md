# Tasks: Structured status ledger + `/status-audit` + `/loop` supervision

**Feature**: `015-status-ledger` | **Branch**: `015-status-ledger` | **Issue**: mkrlabs/specflow#381
(epic mkrlabs/specflow-monorepo#12) **Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) ·
[research.md](./research.md) · [data-model.md](./data-model.md) ·
contracts/{ledger-entry,status-report}.md

Testable core = the hook enrichment (hermetic bash test). `/status-audit` is a read+reason markdown
skill (content-tested). Distribution under `deno task test`.

---

## Phase 1: Hook enrichment (the data foundation)

- [ ] T001 [US2] Write a hermetic test `tests/templates/log_subagent_enrichment_test.ts`: pipe
      synthetic stop-event payloads into
      `templates/harness-specific/claude/hooks/log-subagent.sh stop` against a temp cwd; assert (a)
      payload with `WORKFLOW STATUS`+`REVIEW SUMMARY` in output → appended JSONL line carries
      `state`/`done_criteria_met`/`handoff_target`/`review_verdict`; (b) payload with no block →
      base four-field line, valid JSON, no empty contract keys; (c) `start` event → base line; (d)
      exit code always 0. Cover the candidate output-key (e.g. `.output`).
      (contracts/ledger-entry.md)
- [ ] T002 [US2] Enrich `log-subagent.sh` to pass T001: after session/agent extraction, probe the
      payload's agent-output field
      (`.output`/`.result`/`.response`/`.tool_response`/`.message`/raw), `grep -oE` the contract
      field values, compose the JSONL line with ONLY present optional keys (omit-if-absent), keep
      `set -euo pipefail` with `|| true` guards, always `exit 0`. Backward compatible + jq-absent
      degradation (FR-002/003).

## Phase 2: `/status-audit` skill (US1 + US3)

- [ ] T003 Author `templates/core/skills/status-audit/SKILL.md` (frontmatter `name: status-audit`,
      trigger-phrase `description`, `argument-hint: "[latest|<agent>|<session>]"`). Body per
      contracts/status-report.md: read `.specnaut/logs/agents.jsonl`, latest-by-ts per agent, report
      the seven views (health counts / per-agent / blocked / stale ≥15m / done-vs-criteria
      contradiction / missing handoffs / verdict summary); graceful degradation (absent ledger /
      malformed line / absent fields). Document `/loop 5m /status-audit`. Read-only. (FR-004..007)
- [ ] T004 [P] Skill-content test `tests/templates/status_audit_skill_test.ts`: assert the SKILL
      body in CORE_BUNDLE documents all seven report views, the `/loop 5m /status-audit` pattern,
      the read-only statement, and the graceful-degradation rules.

## Phase 3: Schema doc

- [ ] T005 [P] Author the ledger schema doc (a bundled file delivered to
      `.specnaut/logs/README.md`): field names, types, the optional/omit-if-absent contract fields,
      allowed values (data-model.md). Determine the template-tree source path + manifest entry shape
      from existing `.specnaut/`-target manifest entries. (FR-008)

## Phase 4: Distribution

- [ ] T006 Register the `status-audit` skill + the schema-doc file in `templates/manifest.json` (the
      hook entry already exists — edit-in-place, no new registration). Run `deno task bundle`;
      confirm the skill, the doc, and the enriched hook are in `src/templates_bundle.ts`.
- [ ] T007 Mirror `status-audit` to `plugin/skills/status-audit/` (markdown-only) + extend
      `tests/plugin/plugin_sync_test.ts`. Bump codex/copilot/windsurf `init_*_test.ts` counts for
      the new skill (+1 skill folder) and the new `.specnaut/logs/README.md` if those harness counts
      include `.specnaut/` files (verify per test).

## Phase 5: Validate

- [ ] T008 Run `deno task test` — GREEN, zero regressions. `deno fmt` + `deno lint` +
      `shellcheck
      log-subagent.sh`. Manually pipe the two sample payloads (block / no-block)
      through the hook and eyeball the JSONL lines.

## Phase 6: Polish

- [ ] T009 Add `/status-audit` to the `using-specflow` registry (noting the `/loop` supervision
      use). Sanity-check `upgrade` (spec 011): the enriched hook is a CHANGED managed file
      (delivered unless the user customised it → then preserved); the skill + doc are net-new (added
      cleanly).

---

## Dependencies / parallelism

- T001 → T002 (test-first hook). T003 → T004/T006. T002+T003+T005 feed T006 (bundle). T006 → T007.
- T004/T005 parallel (distinct files).

## MVP boundary

US2 (hook captures verdicts) is the foundation — T001/T002. US1 (`/status-audit` reports) —
T003/T004. US3 (supervision doc) folds into T003. Schema doc T005. The hook test is the
deterministic guarantee; the skill + doc are content-locked.
