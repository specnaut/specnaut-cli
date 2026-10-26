# Tasks: Retire the derived parallel workflow

Derived from `plan.md`, which was approved at the plan stop with no question left open. Each task
names the decision-table home it touches. Size gate: the plan's § 7 re-measured on 2026-10-26. No
touched file over its target grows, so no extraction task is needed.

## Phase 1 — Tests first (red)

- [ ] T001 [US2] `tests/integration/retired_workflow_upgrade_test.ts`: on Claude and Codex, check
      that:
  - a fresh init writes no retired file and no `.specnaut/harness-tools.md`;
  - on a project carrying the retired files plus lock entries (untouched, and one customised),
    `upgrade` removes the untouched ones, keeps and reports the customised one, and drops the lock
    entries;
  - a second upgrade is a no-op;
  - `check --project` reports zero warnings on retired paths (Claude, no plugin), whether the files
    were removed by upgrade or by hand;
  - a lock entry with `..` and one behind a symlinked ancestor are refused.

  Covers FR-007 and FR-008 (homes: `upgrade_plan.ts`, `plugin_coverage.ts`).
- [ ] T002 [US3] `tests/templates/phase_mentions_resolve_test.ts`: every `/specnaut <phase>` in a
      bundled document resolves to the router index or its "Removed phases" table. No bundled
      document contains `superpowers`. (FR-008b; home: router `SKILL.md`.)
- [ ] T003 [US4] `tests/plugin/plugin_no_bootstrap_test.ts`: checks that
  - no shipped plugin manifest declares a hook, and `plugin/hooks/` is absent;
  - the Claude, Cursor and Codex manifests still point at `skills/` (and `agents/` where they did);
  - the OpenCode module's only hook is `config`, it pushes the `plugin/skills` path, and it imports
    no `fs`.

  Covers FR-003 and FR-004 (home: `.opencode/plugins/specnaut.js`).

## Phase 2 — Remove the retired set (US1)

- [ ] T004 Delete the seven skills (with `using-specnaut/references/`) and the five
      `phases/audit-*.md`, in `templates/core/skills/` and `plugin/skills/`. Then remove their core
      entries and the five `HARNESS_STATIC` `.specnaut/harness-tools.md` entries from
      `templates/manifest.json` (FR-001; home: the bundle).
- [ ] T005 `src/domain/plugin_coverage.ts` and `src/domain/addendum_audit.ts`: drop the retired
      names from their lists and comments. These are askers of the bundle.
- [ ] T006 [US3] The router `templates/core/skills/specnaut/SKILL.md`, mirrored in `plugin/`:
  - remove the audit rows, the compound-`audit` rule and the audit trigger line;
  - add the retirement notice to "Removed phases" (FR-005).

## Phase 3 — Rewrite the callers in Specnaut's own terms

- [ ] T007 `templates/core/root/AGENTS.md`:
  - add a managed section that dispatches agents by name per harness (FR-004b; the decision home);
  - change the example phase to `review` (FR-008c), and the same in `README.md`.
- [ ] T008 The four `*-expert` agents, plus the five `<axis>-audit` skills and their `plugin/`
      mirrors: describe the dispatch shape, and drop the report-writing bullet (FR-006; home: the
      per-axis skill).
- [ ] T009 [US4] Delete `plugin/hooks/` in the same commit as the following:
  - drop `.cursor-plugin/plugin.json`'s `hooks` key;
  - rewrite the `.cursor-plugin` and `.codex-plugin` descriptions;
  - remove the hook lines from `tests/plugin/{mirror,source}-exclusions.txt`.

  (FR-003.)
- [ ] T010 [US4] Rewrite `.opencode/plugins/specnaut.js` from scratch as the registrar described in
      FR-004 (a)–(c).
- [ ] T011 Sweep the remaining hits with the FR-002 term search:
  - the CLI's `AGENTS.md` and `README.md`;
  - `.specnaut/release/README.md`;
  - `scripts/smoke/{smoke-features,smoke-all-harnesses,audit}.sh` and `coverage-allowlist.txt`;
  - every test the search names. Delete the tests that only pinned retired content; re-point the
    ones that pinned a still-live rule. The `agent_type` assertion moves to `AGENTS.md`.

## Phase 4 — Verify and land

- [ ] T012 `deno task test`, `fmt:check`, `lint` and `check`; `scripts/smoke/run-all.sh`. Then the
      FR-002 search returns only the named survivors, and SC-004 holds.
- [ ] T013 Commit with an `## Agent adoption` section covering FR-009, and fill
      `.specnaut/release/HIGHLIGHTS.md` for the release notes.

## Dependencies

T001–T003 come first. T004–T006 depend on them, and T007–T011 on T004. T012 comes after all of them,
then T013. T007, T008, T009 and T010 touch disjoint files and may run in any order.
