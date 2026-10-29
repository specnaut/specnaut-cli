# Tasks — Every task entry point reads docs/constitution.md first

Plan: `.specnaut/specs/039-constitution-first/plan.md` (specnaut-cli#685). Homes are those of the
plan's § 5 decision table; no task moves a decision out of its home.

The reference, verbatim (home: `CONSTITUTION_REFERENCE`,
`tests/templates/constitution_reference.ts`):

> Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent
> edits it unasked.

## Phase 1 — Foundation: the guard's helpers

- [x] T001 Move `verbTable` and `docOf` out of `tests/templates/routable_phases_test.ts` into
      `tests/templates/verb_table.ts`, exported; `routable_phases_test.ts` imports them and stays
      green unchanged otherwise.
- [x] T002 Create `tests/templates/constitution_reference.ts`: `CONSTITUTION_REFERENCE` and
      `CONSTITUTION_IMPORT` built from `CONSTITUTION_PATH`; `firstInstruction(body, skip)`;
      `importTokens(text)` by Claude Code's rule (`(^|\s)@<path>`, skipping code spans, fenced
      blocks and HTML comments); `exemptionReason(content)` reading `constitution-exempt` through
      `splitFrontmatter` / `frontmatterField`, `null` for absent, empty or boolean-looking values.

## Phase 2 — US1/US3: the guard, written first and red

- [x] T003 [US3] Create `tests/templates/constitution_first_test.ts`, enumerating from
      `CORE_BUNDLE`: routers (`skill`, `backlog-skill`; title skipped), the documents behind
      `ROUTABLE_PHASES.task` (through `docOf`), agents (`agent`); the `AGENTS.md` constitution fence
      (heading + ownership line skipped; the import on the next line); emitted Claude agent `.md`
      and Codex `.codex/agents/*.toml` `developer_instructions` (first line), other harnesses'
      emitted agents and skills (presence only). Exemptions: non-empty reason, never on `agent` nor
      on `ADDENDUM_SKILLS`; every exemption printed with its reason. Import tokens in `AGENTS.md`
      and the constitution template == `{CONSTITUTION_IMPORT}` (FR-012); `CONSTITUTION_PATH` shape.
      Header of `AGENTS.md` no longer claims to be the source of truth for architecture or rules.
      Run it: red, naming every file (expected before Phase 3).

## Phase 3 — US1/US2: the files

- [x] T004 [US1] `templates/core/root/AGENTS.md`: reword the header blockquote; move the
      constitution fence directly after it; `## Architecture rules` becomes a pointer to
      `docs/constitution.md`; fence body = heading, ownership line, the reference,
      `@docs/constitution.md`, then the existing stop-and-ask paragraph minus its now-duplicated
      "read it" (FR-010) and one line that it loads every Claude Code session and imports nothing
      (FR-011).
- [x] T005 [US1] `templates/core/root/docs/constitution.md`: one line — it loads into every Claude
      Code session, imports nothing, and a change is reviewed like code. Stays ≤ 60 lines.
- [x] T006 [P] [US2] Routers `templates/core/skills/{task,ship,specnaut}/SKILL.md`: the reference as
      the first line after the title.
- [x] T007 [P] [US2] `/task` documents:
      `phases/{plan,tasks,implement,review,merge,audit,constitution}.md` and `groom.md`: the
      reference as the first non-blank line; FR-010 on `plan` step 3 and `constitution` step 2;
      `constitution.md` drafting step refuses an import token (FR-011).
- [x] T008 [P] [US2] 15 agents `templates/core/agents/*.md`: the reference as the first body line;
      FR-010 on the five that already say "read `docs/constitution.md`" (developer, devops-sre,
      code-reviewer, performance-expert, product-owner) — keep the parts that _use_ it.
- [x] T009 [P] [US3] `constitution-exempt: <reason>` in the frontmatter of the 11 exempt skills (9
      contracts, `specnaut-facts`, `status-audit`).
- [x] T010 Copy every edited skill, phase and agent to its `plugin/` mirror; `deno task bundle`.
- [x] T011 Update `tests/templates/constitution_single_source_test.ts` assertions on the fence
      wording to follow the new text (no assertion weakened).

## Phase 4 — Proof

- [x] T012 `deno task test` green (task permissions, never `-A`).
- [x] T013 Red-probes, each observed red then restored: the reference removed from one router, one
      phase, one agent, the fence; the import line removed; a second `@` token added to the
      constitution template; an empty `constitution-exempt`; an exemption on an agent.
- [x] T014 Measure always-loaded bytes after (Claude: `AGENTS.md` + `docs/constitution.md`; Codex:
      `AGENTS.md`), record in plan § 6.

## Dependencies

T001, T002 → T003 → T004–T009 (parallel) → T010 → T011 → T012 → T013 → T014. MVP: T001–T008 + T010
(the guarantee); T009 is required for the guard to pass.
