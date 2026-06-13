# Tasks: Machine-readable agent output contracts

**Feature**: `012-agent-output-contracts` | **Branch**: `012-agent-output-contracts` | **Issue**: mkrlabs/specflow#378 (epic mkrlabs/specflow-monorepo#12)
**Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) · [data-model.md](./data-model.md) · [research.md](./research.md) · contracts/{workflow-status,handoff,review-summary,qa-summary}.md

Content-first feature: the four `contracts/*.md` files in this spec dir are the canonical block
schemas — each SKILL.md embeds its block format verbatim from there. Distribution is asserted by
tests run under `deno task test` (which runs `deno task bundle` first, so a stale bundle fails CI).
All assertions hermetic — read the in-repo `templates/core/` tree and `CORE_BUNDLE`; no network.

---

## Phase 1: Setup / verify the bundle is glob-driven

- [ ] T001 Confirm the bundle generator picks up net-new skill dirs automatically: add a throwaway
      `templates/core/skills/_probe/SKILL.md`, run `deno task bundle`, grep `src/templates_bundle.ts`
      for `_probe`, then delete the probe + re-bundle. Record the result in research.md Decision 2. If
      NOT glob-driven, note the manual-registration point in `scripts/bundle-templates.ts` for T010.

## Phase 2: Foundational — author the four contracts (blocking; everything else preloads these)

- [ ] T002 [P] Create `templates/core/skills/workflow-contract/SKILL.md` — frontmatter
      `name: workflow-contract`, `description:` (one line), `user-invocable: false`; body embeds the
      `WORKFLOW STATUS` format + rules from `contracts/workflow-status.md` (FR-003, FR-007, FR-010).
- [ ] T003 [P] Create `templates/core/skills/handoff-protocol/SKILL.md` — `user-invocable: false`;
      body embeds the `HANDOFF` format + rules from `contracts/handoff.md` (FR-004).
- [ ] T004 [P] Create `templates/core/skills/review-findings-contract/SKILL.md` —
      `user-invocable: false`; body embeds the `REVIEW SUMMARY` format + verdict rules from
      `contracts/review-summary.md` (FR-005, FR-007).
- [ ] T005 [P] Create `templates/core/skills/qa-report-contract/SKILL.md` — `user-invocable: false`;
      body embeds the `QA SUMMARY` format + rules from `contracts/qa-summary.md` (FR-006, FR-007).

## Phase 3: US1 + US2 + US3 — wire the agents (preload contracts via `skills:` frontmatter)

Each task adds a `skills:` array to the agent's existing YAML frontmatter; no other frontmatter or
body change. Additive only (FR-008, FR-009). All `[P]` — distinct files.

- [ ] T006 [P] [US1] `templates/core/agents/architecture-auditor.md` → `skills: [review-findings-contract, workflow-contract]`
- [ ] T007 [P] [US1] `templates/core/agents/performance-auditor.md` → same pair
- [ ] T008 [P] [US1] `templates/core/agents/security-auditor.md` → same pair
- [ ] T009 [P] [US1] `templates/core/agents/a11y-auditor.md` → same pair
- [ ] T010 [P] [US1] `templates/core/agents/dependency-auditor.md` → same pair
- [ ] T011 [P] [US1] `templates/core/agents/code-reviewer.md` → same pair
- [ ] T012 [P] [US1] `templates/core/agents/test-reviewer.md` → same pair
- [ ] T013 [P] [US2] `templates/core/agents/review-coordinator.md` → `skills: [workflow-contract, handoff-protocol]`
- [ ] T014 [P] [US2] `templates/core/agents/developer.md` → `skills: [workflow-contract, handoff-protocol]`
- [ ] T015 [P] [US3] `templates/core/agents/qa-tester.md` → `skills: [qa-report-contract, workflow-contract]`

## Phase 4: Distribution — regenerate the bundle

- [ ] T016 Run `deno task bundle`; confirm `src/templates_bundle.ts` now contains the four contract
      paths and the updated agent contents. (If T001 found the generator is not glob-driven, register
      the four skill dirs first.)

## Phase 5: Tests — lock the two halves together (US1–US4)

- [ ] T017 [P] Add `tests/templates/agent_output_contracts_test.ts`:
      (a) the four contracts are in `CORE_BUNDLE` and each carries `user-invocable: false`;
      (b) each wired agent's bundled content carries the expected `skills:` entries (table from
      research.md). Backs SC-001, SC-004.
- [ ] T018 [P] Add a schema-self-consistency assertion: each contract SKILL.md body contains its
      fenced block header (`WORKFLOW STATUS` / `HANDOFF` / `REVIEW SUMMARY` / `QA SUMMARY`) and the
      verdict-rule lines, so the schema text can't silently drift from the spec contracts (FR-002).
- [ ] T019 Run the full `deno task test` suite; confirm green with zero regressions to existing
      template/bundle tests (FR-009, SC-005).

## Phase 6: Polish

- [ ] T020 Update the bundled `using-specflow` skill registry (and any agent-fleet doc) to mention
      the four contracts as `user-invocable: false` preloaded skills, so the fleet listing stays
      accurate. No behavioural change.
- [ ] T021 Sanity-check `specflow upgrade` path mentally against spec 011: the four new skills are
      net-new files (added, not overwriting), and no wired agent that a team may have customised is
      clobbered (added `skills:` line only lands on the bundled version; customised copies are
      preserved). Document the conclusion in quickstart.md if any caveat surfaces.

---

## Dependencies / parallelism

- T002–T005 (contracts) block T006–T015 (wiring references them) and T016 (bundle).
- T006–T015 are mutually parallel (distinct agent files).
- T016 (bundle) blocks T017–T019 (tests read the bundle).
- T020–T021 are polish, after green tests.

## MVP / increment boundary

US1 (REVIEW SUMMARY on auditors/reviewers) alone is a shippable increment: T002+T004, T006–T012, T016,
T017, T019. US2/US3 layer on the workflow/handoff/QA shapes. US4 (distribution) is satisfied by the
bundle regen + tests covering init/upgrade inclusion.
