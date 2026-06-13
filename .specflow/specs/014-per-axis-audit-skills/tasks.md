# Tasks: Per-axis scope-targeted audit-dispatch skills

**Feature**: `014-per-axis-audit-skills` | **Branch**: `014-per-axis-audit-skills` | **Issue**: mkrlabs/specflow#380 (epic mkrlabs/specflow-monorepo#12)
**Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · contracts/dispatch-contract.md

Markdown-only feature: five thin sibling skills, consistent body per contracts/dispatch-contract.md.
No shell script. Distribution + content asserted under `deno task test` (runs `deno task bundle`).

---

## Phase 1: Author the five skills (consistent body, one agent binding each)

Each `templates/core/skills/<axis>-audit/SKILL.md`: frontmatter (`name`, trigger-phrase `description`,
`argument-hint: "[--path <subtree> | --range <a>..<b> | --diff]"`); body per dispatch-contract.md
(arg parse + reject-unknown, scope resolution, single-agent dispatch with audit framing, inline
findings + REVIEW SUMMARY, read-only, 3-way disambiguation note). Use research.md's axis→agent table.

- [ ] T001 [P] `arch-audit` → architecture-auditor
- [ ] T002 [P] `sec-audit` → security-auditor
- [ ] T003 [P] `perf-audit` → performance-auditor
- [ ] T004 [P] `dep-audit` → dependency-auditor
- [ ] T005 [P] `a11y-audit` → a11y-auditor

## Phase 2: Distribution

- [ ] T006 Register the five skills in `templates/manifest.json` (same shape as other markdown skills);
      run `deno task bundle`; confirm the five appear in `src/templates_bundle.ts`.
- [ ] T007 Mirror to `plugin/skills/<axis>-audit/SKILL.md` (markdown-only → mirrored) and extend
      `tests/plugin/plugin_sync_test.ts` SYNC pairs for all five.
- [ ] T008 Bump codex/copilot/windsurf `init_*_test.ts` skill-folder/file counts by +5 (five new skill
      folders) — verify the exact counters each test uses and adjust.

## Phase 3: Tests

- [ ] T009 [P] `tests/templates/per_axis_audit_skills_test.ts`: loop the five skills and assert each
      (a) is in `CORE_BUNDLE`; (b) names its bound auditor agent (per the table); (c) documents the
      scope args; (d) contains the disambiguation note referencing both `/specflow audit` and
      `/code-audit`; (e) states it writes no report file / is read-only. Backs SC-001, SC-005, FR-008.
- [ ] T010 Run `deno task test` — GREEN, zero regressions. `deno fmt` + `deno lint` on touched files.

## Phase 4: Polish

- [ ] T011 Add the five skills to the `using-specflow` registry (grouped as the per-axis audit family,
      noting they complement `/specflow audit <axis>` and `/code-audit`). Sanity-check `upgrade` (spec
      011): five net-new skills delivered cleanly, no customised file clobbered.

---

## Dependencies / parallelism
- T001–T005 mutually parallel (distinct files). T006 after them (registers/bundles). T007/T009 after T006.
- T009 reads the bundle → after T006.

## MVP boundary
All five share one body template; T001 establishes it, T002–T005 replicate with the agent binding
swapped. The content test (T009) locks the family invariants.
