# Tasks: Reorganise the bundled skills into specnaut, task and ship

**Input**: `.specnaut/specs/037-task-skill-reorg/plan.md` (the only design document).

**Tests**: required, each new assertion observed red by mutating the decision it guards. Run with
`deno test --allow-read --allow-write --allow-run --allow-env`, never `-A`. Content of a moved phase
file changes only where it names an address.

**Decision homes** (plan § 5) are binding.

## Phase 1: Foundational — the upgrade can move things safely

- [x] T001 `src/domain/skill_doc_renames.ts`: add
      `kind?: Extract<CoreCategory, "phase" | "backlog-doc">` (default `phase`); a `phaseMove(doc)`
      helper; rows for the 14 phase/contract docs (`specnaut` → `task`) and the 3 backlog docs
      (`board` → `task`, `kind: "backlog-doc"`).
- [x] T002 `src/application/upgrade_renames.ts`: pass `kind` to `renameEndpointEntry`; collision
      policy in `applicableRenames` (new address present on disk and not in the lock → skip, warn);
      `moveRenamedBytes` uses `readEntry`, moves only regular files, leaves a link with a warning,
      bounds the delete with `within`, catches a refused move and warns. Return notes.
- [x] T003 `src/domain/addendum_audit.ts`: `ADDENDUM_SKILLS = ["specnaut","task","ship"]`;
      `ROUTABLE_PHASES.task` = plan, tasks, implement, review, merge, audit, constitution, groom;
      `ROUTABLE_PHASES.specnaut` = doc, upgrade, list; `CONTRACT_DOCS` re-keyed to `task`;
      `addendumRenames()` derived from the rename table.
- [x] T004 New `src/application/upgrade_addenda_moves.ts`: move `.specnaut/addenda/<from>/<p>.md` →
      `<to>/<p>.md` when the target is absent (lstat), files only, links left with a warning,
      both-present → warn, `--dry-run` reports only, per-move refusal → warn.
- [x] T005 `carryRenames(ctx)` in `upgrade_renames.ts` runs docs then addenda and emits the
      customised-`specnaut/SKILL.md` note; `upgrade_project.ts` swaps its `carryRenamedDocs` call
      for it — **net-zero lines** (560 must not grow).
- [x] T006 Tests: `tests/domain/skill_doc_renames_invariants_test.ts` (every `to` in the bundle; no
      `from` equals another row's `to`; `addendumRenames()` yields the 14 phase moves);
      `tests/integration/upgrade_task_reorg_test.ts` on claude, codex, copilot (untouched docs move;
      customised `plan.md` and `groom.md` travel; customised `board/SKILL.md` and
      `sec-audit/SKILL.md` warn until `--force`; addendum move; both-present;
      `addenda/specnaut/upgrade.md` stays; ship-rename addendum moves; dry-run; a link at the old
      address pointing at an ignored file is not copied; a pre-existing untracked
      `.claude/skills/task/SKILL.md` is not overwritten).

## Phase 2: Move the templates

- [x] T007 `git mv` the 14 docs `templates/core/skills/specnaut/phases/*` →
      `templates/core/skills/task/phases/` and
      `templates/core/skills/board/{groom,groom-report,spec-autogen}.md` → `task/`; board `scripts/`
      → `task/scripts/` (install path `.specnaut/scripts/backlog/` unchanged).
- [x] T008 Write `templates/core/skills/task/SKILL.md` (`backlog-skill`, ≤ 200 lines): verb → doc
      table (backlog: list, next, add, edit, close, groom, estimate, status, brief, `<id>`;
      pipeline; audit; constitution), addendum rule, PO-only-writer rule, chain decision, one line
      to the retired table. Backend sections + verb bodies → new `task/backlog.md` (`backlog-doc`).
- [x] T009 Rewrite `templates/core/skills/specnaut/SKILL.md`: `doc`, `upgrade`, `list`; one "Retired
      addresses" table (every former `/specnaut` verb, `/board` incl. `update` → `/task edit`,
      `/code-audit`, the five `*-audit`, plus the older tag-version/release-version/audit rows). New
      `specnaut/phases/doc.md`, `list.md`.
- [x] T010 New `task/phases/audit.md` (≤ 200 lines) from `code-audit` + per-axis skills: scope
      resolver, axis flag → agent table, applicability, single-message dispatch, output contract.
      Scope script → `task/scripts/collect-audit-scope.sh`, installs to `.specnaut/scripts/audit/`.
      Delete `skills/{board,code-audit,sec-audit,arch-audit,perf-audit,a11y-audit,dep-audit}`.
- [x] T011 `templates/manifest.json`: owners, categories, paths for all of the above.

## Phase 3: Sweep references

- [x] T012 Agents (`templates/core/agents/*.md`, `agents/README.md`) and `ship/SKILL.md`,
      `specnaut-facts`, moved phase docs' cross-references.
- [x] T013 Root `AGENTS.md` managed sections (phase-addenda **by phase**, backlog, optional
      integrations); `specnaut/{backlog.md,workflow.yml,templates/*,scripts/bash/*}`; backlog
      scripts; `harness-specific/claude/{loop.md,claude-security-guidance.md}`,
      `cursor/specify-rules.mdc`.
- [x] T014 `src/` strings: `init_next_steps.ts`, `backlog_strategies/{github,gitlab}.ts`,
      `cloud_handler.ts`, `harness_commands.ts` doc comments.
- [x] T015 Hooks: `approve-on-prompt.sh` (drop `/specnaut merge`, `$specnaut merge`, `$ship …`; add
      `/task merge`, `$specnaut-task merge`, `$specnaut-ship release|tag`), messages in
      `guard-merge.sh`, `protect-generated.sh`, `guard-release.sh`; regenerate via `gen-hooks.ts`.
      Tests: positive + negative rows (`/task merge-x`, `/task mergeX`, `please /task merge`,
      `/tasks merge`), cross-checked against `harnessCommands`.
- [x] T016 Cockpit `mods/specnaut-cockpit/hooks/core/{chain.ts,hold.ts}`: recognise `task`,
      `specnaut-plugin:task` and the old router names; message `/task <phase>`; `core_test.ts`
      asserts the deny.
- [x] T017 `README.md`, CLI `AGENTS.md`, `UPGRADING.md` 7.2 section (moves, retired skills, plugin
      update with the binary, ship-rename addenda now move, Codex hook re-trust).

## Phase 4: Locks and mirrors

- [x] T018 New `tests/templates/retired_addresses_test.ts`: parses the retired table; fails on any
      retired address in bundle, `HARNESS_STATIC`, `plugin/`, `README.md`, `mods/`, `src/` strings,
      hooks; exclusions declared once there. Generalise `phase_mentions_resolve_test` to the three
      routers.
- [x] T019 Rewrite at their new home: `routable_phases_test`, `per_axis_audit_skills_test`,
      `code_audit_skill_test` (→ `audit.md` invariants), `removed_artefacts_test`, every test
      reading `skills/specnaut/phases` or `skills/board`; `src/domain/plugin_coverage.ts` +
      `plugin_coverage_parity_test`; `scripts/smoke/smoke-features.sh`; `init_test`,
      `init_codex_test`.
- [x] T020 `plugin/skills/` mirror regenerated; `deno task bundle`.

## Phase 5: Measure and verify

- [x] T021 `scripts/skill-description-bytes.ts` (data only): always-loaded description bytes per
      harness (Claude: `description` + `when_to_use`; Codex: `description`). Record main vs branch
      in plan § 4.
- [x] T022 Full suite with the task flags, `go test ./...`, size ratchet, `deno task check`.
