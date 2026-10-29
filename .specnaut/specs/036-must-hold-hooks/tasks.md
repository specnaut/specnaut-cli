# Tasks: Must-hold rules become hooks on Claude Code and Codex

**Input**: `.specnaut/specs/036-must-hold-hooks/plan.md` (the only design document)

**Tests**: required. SC-001 asks for a Claude payload and a Codex payload per guard, each observed
red by mutating the guard's decision. Run them with the task's flags:
`deno test --allow-read --allow-write --allow-run --allow-env`, never `-A`.

**Decision homes** (plan § 5) are binding: a task that touches a rule names its home and adds no
second spelling.

## Phase 1: Setup — measure before building on it

- [x] T001 Probe Codex 0.154 in a scratch project with a hook that dumps stdin. Record in plan § 11:
  - the `spawn_agent` `tool_input` shape, including any `model` field;
  - whether `PreToolUse` carries `turn_id`;
  - whether a hook can write under `$XDG_STATE_HOME` while the session runs `workspace-write`;
  - what the trust hash covers: the command string, or the script it runs;
  - whether a spawned agent's first message fires `UserPromptSubmit`;
  - whether an `apply_patch` sent through the shell fires the `apply_patch` matcher;
  - the exact `.codex/hooks.json` schema it accepts.

  Save the captured payloads as fixtures in `tests/fixtures/hooks/codex/*.json`.
- [x] T002 Probe Claude Code with a scratch hook. Record in plan § 11 whether
      `permissionDecision: "ask"` prompts under `default`, `auto` and `bypassPermissions`, and what
      `permission_mode` reports in each. Save the payloads as fixtures in
      `tests/fixtures/hooks/claude/*.json`.

## Phase 2: Foundational

**Extractions first.** Re-measure each file with `wc -l` immediately before extracting from it.

- [x] T003 Extract the JSON re-merge (`src/application/upgrade_project.ts:191-202,491-503`, 580
      lines) into `src/application/upgrade_json_merges.ts`, which re-merges the user-owned JSON
      files and reports which ones changed. Re-merge on the up-to-date path too.
      `upgrade_project.ts` must end below 580.
- [x] T004 [P] Extract init's closing guidance (`src/cli/handlers/init_handler.ts`, 576 lines) into
      `src/cli/handlers/init_next_steps.ts`. `init_handler.ts` must end at 515 or fewer.
- [x] T005 [P] Move upgrade's post-write report (`src/cli/handlers/upgrade_handler.ts`, 527 lines)
      into `src/cli/handlers/upgrade_summary.ts`. `upgrade_handler.ts` must end at 485 or fewer,
      `upgrade_summary.ts` at 300 or fewer.
- [x] T006 Move the hook splice (`src/domain/claude_settings_merge.ts:109-147`) into
      `src/domain/hook_settings_merge.ts`, with `isSpecnautHook`: a bundled entry replaces any entry
      whose command runs the same `.specnaut/hooks/<file>.sh` or its retired `.claude/hooks/` path.
      Make each flavor return `{ content, changed }`. Add the `codex-hooks` flavor (parse plus
      splice) and the `"codex-hooks"` literal in `src/domain/template.ts`. Tests go in
      `tests/domain/hook_settings_merge_test.ts`; existing cases stay in
      `claude_settings_merge_test.ts`.
- [x] T007 Replace the single-flavor branch in `src/infrastructure/deno_fs_writer.ts` with a flavor
      table. Report `mergedChanged` on the write report (`src/application/ports.ts`), and carry it
      through `init_project.ts` (306 lines; it must not grow) and `upgrade_json_merges.ts`.
- [x] T008 Add `.specnaut/hooks/` to `managedRoots` in
      `src/infrastructure/harness/claude_harness.ts` and `codex_harness.ts`. Update
      `managed_roots_test.ts` if it pins the list.
- [x] T009 [P] Create the shared prelude `templates/harness-specific/shared/hooks/_guard.sh`:
      `set -Eeuo pipefail`, an ERR trap that exits 2, a `jq -e` parse, non-empty comparisons, and
      git plumbing only (`--no-pager`, `GIT_OPTIONAL_LOCKS=0`). Add
      `tests/templates/hooks/guard_prelude_test.ts` with these cases:
  - bad JSON → 2
  - unknown shape → 2
  - missing `jq` (PATH stripped) → 2
- [x] T010 [P] Create `templates/core/specnaut/scripts/bash/merge-mode.sh`, which prints `auto` or
      `manual` on stdout and its note on stderr. With `--strict` it prints manual if the working
      tree, `HEAD` or the base's committed copy says manual or an unrecognised value, or if any
      `merge:` line is not auto. Point `auto-chain.md:25` at it, and point
      `tests/templates/chain_stops_test.ts:155-188` at the script.
- [x] T011 [P] Create `templates/core/specnaut/scripts/bash/base-branch.sh`. It tries `origin/HEAD`,
      then `init.defaultBranch`, and otherwise exits 3 (unknown). `merge.md` names it as the base.
- [x] T012 Generate `templates/harness-specific/shared/hooks/_agents.txt` from `manifest.json` agent
      entries at bundle time, and add a test that it matches the manifest.

## Phase 3: US1 — `merge: manual` stops the landing (P1)

- [x] T013 [US1] Create `templates/harness-specific/shared/hooks/guard-merge.sh`. It tokenises the
      command (separators, env prefixes, wrappers, git global options, one level of `sh -c`) and
      resolves aliases with `git config --get`. Push is an allow list. `gh pr merge` and
      `glab mr merge` are always gated, and so is an unknown base. Claude: `ask` or deny depending
      on `permission_mode` (FR-017). Codex: deny unless approved.
- [x] T014 [US1] Create `templates/harness-specific/shared/hooks/approve-on-prompt.sh` and
      `_approval.sh` (FR-007): anchored phrase matching, a `{session_id, turn_id, kind}` stamp
      written atomically under `$XDG_STATE_HOME/specnaut/approvals/<sha256(toplevel)>/`, and cleanup
      on `Stop`. Adjust for the T001 results.
- [x] T015 [US1] Add `tests/templates/hooks/guard_merge_test.ts`, with one case per landing form in
      the guard's table and each case run on Claude and on Codex. The stamp cases cover:
  - a stamp from a previous turn → deny
  - a stamp of the wrong kind → deny
  - empty ids on both sides → deny
- [x] T016 [US1] Update the "merge mode" text in `templates/core/specnaut/workflow.yml`, the
      chain-stops section of `templates/core/root/AGENTS.md` and `phases/merge.md` (D3: the guard
      enforces the file). Update the pinned tests `agents_managed_section_test.ts:59`,
      `chain_stops_test.ts:53` and `tests/integration/upgrade_managed_section_test.ts:90`. STOP 2's
      question names the word to type.

## Phase 4: US2 — an expert seat runs on its declared tier (P1)

- [x] T017 [US2] Create `templates/harness-specific/shared/hooks/guard-dispatch-model.sh`. It denies
      any non-null `tool_input.model` when `${subagent_type##*:}` is in `_agents.txt` or has an
      agent file, denies any name outside `^[A-Za-z0-9:_-]+$` when a model is set, and never reads
      the top-level `.model`. The Codex arm follows the T001 shape; if `spawn_agent` has no model
      parameter, the test pins that.
- [x] T018 [US2] Add `tests/templates/hooks/guard_dispatch_model_test.ts`, with Claude
      `Agent`/`Task` and Codex `spawn_agent` payloads and a non-Specnaut agent that is allowed. Make
      the `templates/harness-specific/claude/scripts/dispatch-agent.sh` comment say that `MODEL` is
      a human override (D2).

## Phase 5: US5 — Codex confirms a release (P1)

- [x] T019 [US5] Create `templates/harness-specific/shared/hooks/release-commands.txt` and
      `guard-release.sh` (FR-006). The `--no-push` exemption applies per command segment, and a
      tag-ref push is detected.
- [x] T020 [US5] Add `tests/templates/hooks/guard_release_test.ts`, including
      `tag.sh --no-push && git push origin v1.2.3` (deny) and `gh release create` (deny). Add a test
      that the Claude `permissions.ask` rules in `templates/harness-specific/claude/settings.json`
      cover `release-commands.txt`.

## Phase 6: US3 — a generated file cannot be hand-edited (P2)

- [x] T021 [US3] Move `protect-generated.sh` to `templates/harness-specific/shared/hooks/`. Deny
      `installed.lock`. Gate `.specnaut/workflow.yml`, `.specnaut/hooks/**` and `.codex/hooks.json`
      (FR-004), deciding by file identity. Extract paths from `apply_patch` (indented headers, CRLF,
      `Move to:`); a patch from which no path is extracted exits 2.
- [x] T022 [US3] Add `tests/templates/hooks/protect_generated_test.ts`, covering the spellings the
      security seat reproduced (`//`, `./`, case on APFS, a path relative to a subdirectory,
      indented and CRLF headers). Flip `scripts/smoke/smoke-hooks.sh` from exit 0 to exit 2.

## Phase 7: Registration, both harnesses (blocks US1/2/3/5 shipping)

- [x] T023 Declare every `.specnaut/hooks/*` file in `templates/manifest.json` `harness_static` for
      claude and for codex, from `harness-specific/shared/hooks/`, both executable. Move
      `log-subagent.sh` there as well. Add a test that the two declarations agree.
- [x] T024 Register the hooks in `templates/harness-specific/claude/settings.json`:
      `"$CLAUDE_PROJECT_DIR"/.specnaut/hooks/<x>.sh claude`, with new `Bash` and `Agent|Task` groups
      and the `Edit|Write` matcher string unchanged. Each command pins the script's sha256 (plan §
      11 Measured).
- [x] T025 Create `templates/harness-specific/codex/hooks.json` (`PreToolUse` for `Bash`,
      `apply_patch`, `spawn_agent`; `UserPromptSubmit`; `Stop`; `SubagentStart`/`SubagentStop` →
      `log-subagent.sh`, FR-011), using the T001 schema. Add the `mergeJson: "codex-hooks"` manifest
      entry. Apply the F7 sha pin only if T001 shows that the command string is all Codex hashes.
- [x] T026 Add `hookTrust` to the `Harness` port (Codex sets it), create `src/domain/hook_trust.ts`,
      and print the note from `init_next_steps.ts` and `upgrade_summary.ts`. The note names
      Specnaut's commands, any customized hook file and any foreign `hooks.json` entry. Add tests:
      the note is printed on change and not on a no-op upgrade.
- [x] T027 Update `tests/infrastructure/harness/claude_harness_test.ts`,
      `log_subagent_enrichment_test.ts` (`HOOK` path), `init_codex_test.ts` (`hooks.json` written
      and merged) and the `.claude/hooks` checks in `scripts/smoke/smoke-features.sh`. Move the hook
      block (`:555-566`) into `smoke-hooks.sh`, so `smoke-features.sh` shrinks. First count every
      `.claude/hooks` pin with `grep -rn '.claude/hooks' src tests scripts templates`.
- [x] T028 Add an upgrade test from a 7.1.0 fixture (FR-014, SC-003): the old `.claude/hooks/`
      copies are pruned, a customized copy warns until `--force`, every Specnaut command appears
      once at its new path, and a retired `.specnaut/hooks/` file is pruned.

## Phase 8: US4 — a groom proves it is complete (P2)

- [x] T029 [US4] Create `templates/core/specnaut/scripts/bash/groom-rules.sh` (sections, one size
      XS–XL, one priority P0–P3, an outcome) and
      `templates/core/skills/board/scripts/{local,github,gitlab,cloud}/groom-verify.sh` (fetch, then
      call the rules). Add manifest entries.
- [x] T030 [US4] Make `templates/core/skills/board/groom.md` call `groom-verify.sh` last and turn
      its prose list into a pointer. Fix `groom.md:164` (`size:`). Add
      `tests/templates/groom_verify_test.ts` using the local backend fixtures.

## Phase 9: Stale facts (FR-013)

- [x] T031 [P] Fix `templates/core/skills/specnaut-facts/SKILL.md`: close order, P0–P3, the cloud
      backend, the `specnaut-marketplace`/`specnaut-cockpit` names, the five missing agents,
      `specnaut gate`.
- [x] T032 [P] Rewrite `templates/core/skills/backlog-frontmatter/SKILL.md` to match `local/add.sh`
      and `move.sh:16`. Add `cloud` in `phases/merge-close.md:34`.

## Phase 10: Polish

- [x] T033 Resync the plugin mirror for every edited skill (`plugin_sync_test`), then run
      `deno task test` and the smokes.
- [x] T034 Add a `UPGRADING.md` section "7.1 → 7.2": trust the Codex hooks, the hooks moved, and
      edits to `installed.lock` are refused.
- [x] T035 Run the size ratchet (`--since main --report`). No file may be over its ceiling without
      shrinking.
- [x] T036 Hand the backlog follow-up to the product-owner: `local/add.sh` accepts `labels` and
      never writes them.
- [x] T037 Write the `feat` commit with a `## Agent adoption` section, and run
      `scripts/check-adoption.ts --from main --to HEAD`.

## Dependencies

- T001 and T002 come before T013, T014, T017, T021 and T025.
- T003 to T008 come before T023 to T028.
- T009 comes before every guard.
- T010 and T011 come before T013.
- T012 comes before T017.
- Phases 3 to 6 can run in parallel once Phase 2 is done.
- Phase 7 comes after the guards exist.
- Phases 8 and 9 are independent of everything else.

## Implementation strategy

The MVP is Phase 2 plus US1 plus its registration (T023 to T025), which makes `merge: manual` hold
on both harnesses. The rest of the work stacks onto that registration.

## Implementation notes

- T001/T002 were answered from the Codex source rather than a live `codex exec` probe, which this
  session's safety classifier refused (it needed `--dangerously-bypass-hook-trust`). Plan § 11
  "Measured" records each answer and its source file.
- Found in testing and fixed: Codex commands and the guards located the project with
  `git rev-parse --show-toplevel`, so a project nested in another repository without its own `.git`
  was judged against the outer one. The project is now the folder the installed hooks sit in
  (`tests/templates/hooks/nested_project_test.ts`).
- Follow-ups filed: cli#697 (local `add.sh` drops labels), cli#698 (`UpgradeProjectUseCase.execute`
  over the function ceiling).
