# Tasks: Bootstrap a project-owned constitution at docs/constitution.md

**Input**: `.specnaut/specs/038-project-constitution/plan.md`, the only design document.

**Tests**: required. Mutate the decision each new assertion guards and watch it go red. Run with
`deno test --allow-read --allow-write --allow-run --allow-env`, never `-A`. Hook tests also run on
Windows CI.

**Decision homes** (plan § 5) are binding. Finding tags (A-_, S_) point at plan § 10 and § 11.

## Phase 1: Foundational. Extract first, then add

- [x] T001 Extract the pre-plan block of `UpgradeProjectUseCase.execute`
      (`src/application/upgrade_project.ts`) into the new module
      `src/application/upgrade_plan_inputs.ts`. The block covers merge refusals, context-link
      refusals, the `diskShas` loop, `refusedDests` and `lockForPlan`. Behaviour must not change,
      and `upgrade_project.ts` must end under 555 lines (A-H1).
- [x] T002 Extract from `src/application/init_project.ts` (306 lines) the bundle-filter loop
      (`bundleToWrite`, `mergeRefusal`) into `src/application/init_bundle_filter.ts`, with no
      behaviour change. `init_project.ts` must end at or under 300 lines.
- [x] T003 [P] Create `src/domain/exact_move.ts` with the pure function
      `judgeExactMove(source: DiskEntry|null, target: DiskEntry|null)`. It decides: target occupied,
      source is a link, source is lossy, or ok. Rewire `carryOne` (`upgrade_addenda_moves.ts`) and
      `movableContent` (`upgrade_renames.ts`) to call it, and unify their wording (A-M2).
- [x] T004 Create `src/application/upgrade_exact_move.ts` holding `moveExact` (write, then a bounded
      delete) and `NOT_EXACT`, extracted from `carryOne`. Both existing movers use it.
- [x] T005 [P] Extract `norm`, `names` and the patch-path parsing from
      `templates/harness-specific/shared/hooks/protect-generated.sh` into a new `_paths.sh`, with no
      behaviour change. The existing `protect_generated_test.ts` must stay green.
- [x] T006 [P] Create `src/domain/constitution_paths.ts`, holding `CONSTITUTION_PATH`,
      `LEGACY_CONSTITUTION_PATH` and `GATE_CONFIG_PATHS` (size-limits, boundaries, ui). Add the same
      list to `_paths.sh`, and a test asserting the two lists are equal (A-M3).
- [x] T007 Tests for T001–T006: `tests/domain/exact_move_test.ts`; the existing upgrade, renames and
      addenda suites stay green; red-probe `judgeExactMove`.

## Phase 2: US1 (P1). A new project gets real principles

- [x] T008 [US1] Write `templates/core/root/docs/constitution.md` in ≤ 60 lines. It has four `##`
      principles: domain isolation, dependencies inward, bounded contexts, SOLID. Each carries
      `Check:` lines and a one-line override note, plus a `Version: 1.0.0` footer. It names no
      Specnaut skill, agent or command, and has no HTML comment.
- [x] T009 [US1] `src/domain/template.ts`: add `projectOwned?: true`. Add `ownershipFields(entry)`
      to `src/infrastructure/harness/harness_managed.ts`: `projectOwned` implies `skipIfExists`.
      Rewire all 7 adapter sites (antigravity, claude, codex×2, copilot, cursor, opencode) to call
      it (A-M6).
- [x] T010 [US1] `src/infrastructure/deno_fs_writer.ts`: `keepsProjectFile` keeps any existing
      `projectOwned` dest even under `overwrite`. Fix the stale docstring; the file stays at ≤ 300
      lines.
- [x] T011 [US1] `templates/manifest.json`: replace the `spec-root` `memory/constitution.md` entry
      with the `project-root` `docs/constitution.md` entry (`projectOwned: true`). Delete
      `templates/core/specnaut/memory/constitution.md`. Check the Go port's manifest decoder accepts
      the new field (`go test ./...`).
- [x] T012 [US1] `templates/core/root/AGENTS.md`: add the `constitution` managed section (a pointer
      to `docs/constitution.md`, never self-amended, a conflict is a stop with a question). Add it
      to the manifest's managed-section list.
- [x] T013 [US1] Tests: `tests/templates/constitution_single_source_test.ts` checks: - exactly one
      constitution source; - each `Check:` line appears in one bundle entry; - no Specnaut name or
      marker in the bootstrap (FR-002); - no dest matching `constitution(-template)?\.md` apart from
      the two allowed ones; - no copy under `.claude/` or `.codex/`; - ≤ 60 lines.

      `tests/integration/init_constitution_test.ts` checks:
      - `init` writes `docs/constitution.md` and no legacy file;
      - `init --force` keeps an existing `docs/constitution.md` byte-identical.

## Phase 3: US2 (P1). An existing project is moved, not rewritten

- [x] T014 [US2] Create `src/domain/constitution_move.ts` with `planConstitutionMove(old, cur)`. It
      returns `none | move | dedupe | refuse-conflict | refuse-link | refuse-lossy` plus
      `bootstrap`, builds on `judgeExactMove`, and treats a CRLF or trailing-newline difference as
      identical.
- [x] T015 [US2] Create `src/application/upgrade_constitution_move.ts` with
      `executeConstitutionMove(ctx) → { verdict, notes, exclude }`. It runs `moveExact` only when
      not in dry-run, and on dry-run its note says "would move".
- [x] T016 [US2] Wire it in `upgrade_plan_inputs.ts`, before `diskShas`: `exclude` feeds
      `refusedDests`/`lockForPlan` (A-M1, A-H3). Wire it in `init_bundle_filter.ts` whenever the
      legacy path exists (A-H2).
- [x] T017 [US2] `src/application/upgrade_preserve.ts`: when the legacy path is in `preserve.yml`,
      print the specific note to remove the line instead of the generic "not a managed file" note.
- [x] T018 [US2] Tests: `tests/domain/constitution_move_test.ts` covers every verdict.
      `tests/integration/upgrade_constitution_move_test.ts` on claude and codex covers: -
      placeholder, customised, conflict, CRLF-identical, link and lossy; - preserved; - a lock that
      tracks the placeholder (no orphan delete); - dry-run (SC-008); - a second upgrade and
      `--force` leave the file byte-identical (SC-003); - `init --force` on a locked legacy project
      (A-H2).

## Phase 4: US3 (P1). Upgrade never touches it; the principle notice

- [x] T019 [US3] Create `src/domain/constitution_principles.ts`. A bootstrap principle counts as
      adopted when its `Check:` line or its heading is present, ignoring case and whitespace (A-L2).
      Upgrade prints the missing names once per run.
- [x] T020 [US3] Tests for T019 and the upgrade notice. Red-probe the matcher.

## Phase 5: US4 (P1). An agent cannot amend it on its own

- [x] T021 [US4] `templates/harness-specific/shared/hooks/_approval.sh`: add
      `approval_require <kind>`. No stamp → deny. With a stamp, Claude's ask-capable modes → ask;
      Codex and bypass mode → allow.
- [x] T022 [US4] `approve-on-prompt.sh` `approval_kind_of`: add the `constitution` and `gate-config`
      kinds, each minted by its own whole-prompt phrase. At UserPromptSubmit, hash the 4 guarded
      files into the stamp directory (S1, S2).
- [x] T023 [US4] Create
      `templates/harness-specific/shared/hooks/protect-constitution.sh
      <claude|codex>`. It
      covers: - the Edit/Write/NotebookEdit arm and the Codex patch arm (via `_paths.sh`); - the
      Bash arm: a bare-word read-only allowlist, a per-command option denylist, globs and `$`
      counted as naming the file, redirects, and opaque forms only (S1, A-L5); - the kinds:
      `constitution` for the constitution, `gate-config` for the configs, and `merge`+`constitution`
      for its own script and `_paths.sh` (S2).
- [x] T024 [US4] The Stop backstop: compare the hashes, and when a guarded file changed with no
      matching stamp, block with a question and keep a copy (never restore). Put it in the existing
      Stop-hook script, or in a new `check-constitution-stop.sh` when none fits.
- [x] T025 [US4] Registrations: `templates/harness-specific/claude/settings.json`
      (Edit|Write|NotebookEdit, Bash, Stop). Codex: rows in `scripts/gen-hooks.ts`
      `CODEX_REGISTRATIONS`, then regenerate `hooks.json` and `SHA256SUMS`.
- [x] T026 [US4] Rewrite `templates/core/skills/task/phases/constitution.md`: - ask the reason,
      draft, bump `Version:`, put the reason in the commit body; - print the confirmation phrase and
      write only after the user types it; - a config branch uses the `gate-config` phrase, with no
      version bump; - no template, no in-file Sync Impact Report, no "propagate to templates" step.
- [x] T027 [US4] Tests: `tests/templates/hooks/protect_constitution_test.ts` covers: - all 4 input
      shapes × stamp none/constitution/gate-config/merge; - each S1 bypass (`git --output`, `-c`,
      `GIT_EXTERNAL_DIFF`, `/x/cat`, a function, a glob); - reads allowed; - commit message and
      branch name allowed; - the phrases pinned to `phases/constitution.md`; - the Stop backstop; -
      a Windows path form in `windows_test.ts`; - an upgrade-from-7.2 hooks test.

## Phase 6: US5 (P2). Size and UI settings leave the constitution

- [x] T028 [US5] `templates/harness-specific/shared/hooks/_config.sh` (or under
      `templates/core/specnaut/scripts/bash/` if the ratchet cannot source hooks): one narrow-YAML
      block reader that validates values (S4).
- [x] T029 [US5] Rewrite `templates/core/specnaut/scripts/bash/size-ratchet.sh` to read
      `.specnaut/size-limits.yml` through `_config.sh`, with the constitution special case on
      `docs/constitution.md` and constants for the defaults. It must not grow beyond 247 lines.
- [x] T030 [US5] `templates/core/specnaut/memory/size-limits.md`: the config file is now the
      override, and the constitution row is 60/100. `src/domain/size_limits.ts` gets the TS reader
      (constitution unit; on an unreadable file it warns) and `constitutionOverCeiling()`.
- [x] T031 [US5] `tests/fixtures/size_limits/*.yml` plus the expected output, with the reject cases:
      flow map, tab, CRLF, comment, `none`, duplicate key, bad value. Run the bash reader and the TS
      reader on the same corpus. Update `size_thresholds_single_arbiter_test.ts` to pin 60/100.
- [x] T032 [US5] Create `src/domain/constitution_legacy_settings.ts` to extract a non-default
      `## Size limits` table and an exact-form `### Target surface` heading. Values are validated
      (S4).
- [x] T033 [US5] Write the extracted config in upgrade through
      `FsWriter.writeBundle(...,
      {overwrite:false})`, only if absent (lstat), and note that
      the stale section can be deleted (S5).
- [x] T034 [US5] `mobile-first-contract` `SKILL.md` and the ui-defaults line in
      `templates/core/root/AGENTS.md`: the exception is read from `.specnaut/ui.yml`, and no
      constitution section is named.
- [x] T035 [US5] Tests: the legacy extraction (default table → no file; custom → file; invalid →
      refused); a dangling symlink at each config path (S5); the ratchet on `docs/constitution.md`.

## Phase 7: US6 (P2). The domain boundary gate

- [x] T036 [US6] Create `templates/core/specnaut/scripts/bash/boundary-check.sh`, reading
      `.specnaut/boundaries.yml` through `_config.sh` with exit codes 0, 1, 2 and 4. It calls
      `grep -E -n -e "$pat" -- "$f"` and gets files from
      `git -c core.quotePath=false --literal-pathspecs ls-files -z -s`, keeping modes 100644/100755
      only. Any grep exit ≥ 2 exits 2 (S3). Add it to the manifest.
- [x] T037 [US6] `templates/core/skills/task/phases/quality-gates.md`: add the section "The import
      boundary — with every tier". Exit 4 is reported as skipped, never as a pass.
- [x] T038 [US6] Tests: `tests/scripts/boundary_check_test.ts` covers pass, fail, skip × 3 reasons,
      unreadable config, a non-ASCII name, a `-` pattern, an outbound symlink, and a domain path
      outside the repo.

## Phase 8: US7 (P3) and cross-cutting. The ceiling and the readers

- [x] T039 [US7] `src/infrastructure/fs_project_inspector.ts` `checkConstitution`: read
      `docs/constitution.md` and warn through `constitutionOverCeiling()`. The file ends at ≤ 440
      lines. The upgrade warning goes through the same function.
- [x] T040 Retire `templates/core/specnaut/templates/constitution-template.md`: remove its manifest
      entry and its source. Add an orphan-removal test (vanilla removed, customised warns).
- [x] T041 Reader sweep (FR-015). Enumerate it with `git grep -l 'memory/constitution.md'` and
      `git grep -il 'size limits'`, excluding `.specnaut/specs/`, the `UPGRADING.md` history and the
      migration modules. Update: - `phases/plan.md`, `review.md`, `plan-template.md`,
      `tasks-template.md`, `review-coordinator`, `god-file.md`; - the agents (code-reviewer,
      developer, performance-expert, product-owner, devops-sre) and their seeds; - cursor
      `specify-rules.mdc`, `core_bundle.ts`, `upgrade_plan.ts`, `init_next_steps.ts`, and
      `init_handler.ts` (a net-shrinking message fix, A-L1); - `smoke-features.sh` and the tests.
- [x] T042 Guard test `tests/templates/legacy_constitution_path_test.ts`: no shipped file names
      `memory/constitution.md`, and `## Size limits` appears only in `size-limits.md`, apart from
      the allowlisted migration modules.
- [x] T043 `src/cli/handlers/init_next_steps.ts` and the hook-trust note (`hook_trust_note.ts`) for
      init and upgrade on Codex.
- [x] T044 Run `deno task bundle`, re-sync `plugin/` from templates, and regenerate the golden
      fixtures. `UPGRADING.md`: add a new section that mentions publishing a `docs/` site. Update
      the README.
- [x] T045 Measure the always-read byte delta (the new `AGENTS.md` section) for the commit body
      (SC-007). Run `size-ratchet.sh --since main --report`, `deno task test`, `go test ./...` and
      the smoke suite.

## Dependencies

Phase 1 comes first. US1 (Phase 2) and the hooks (Phase 5) can start once Phase 1 is done. US2 needs
US1 (T011) and T001–T004. US3 needs US2. US5 needs T006 and US2 (the moved file). US6 needs T028.
Phase 8 comes last.

## Parallel

T003, T005 and T006 can run together. Once Phase 1 is done, Phase 5 (hooks, bash) and Phases 2–3
(TypeScript) can run together. Inside Phase 8, T040 and T041 are independent.

## Strategy

MVP: Phases 1–4 (the file exists, moves safely, and is never rewritten). Then the hooks, then the
configs and the gate. All of it ships in one branch.
