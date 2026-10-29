# Plan: Must-hold rules become hooks on Claude Code and Codex

**Branch**: `036-must-hold-hooks` | **Date**: 2026-10-28 | **Backlog item**:
[specnaut-cli#679 — Slim the bundled skills and always-on text; enforce must-hold rules with hooks](https://github.com/specnaut/specnaut-cli/issues/679)

**Scope of this plan: the parts of #679 that are not cuts.** The issue's Notes forbid any cut before
the eval harness
[specnaut-cli#675 — Build the frontier-model eval harness for /specnaut (Claude Code + Codex)](https://github.com/specnaut/specnaut-cli/issues/675)
exists and has run, and #675 is open. Deferred to a second pass of #679, after #675:

| Deferred cut                                                                         | Why it is a cut                       |
| :----------------------------------------------------------------------------------- | :------------------------------------ |
| `board`, `groom`, `ship` trimmed to command tables                                   | removes instruction text              |
| `alias-example` removed                                                              | removes a file                        |
| `AGENTS.md` Claude-specific text → ~0.6 KB index; "Optional integrations" moved out  | removes always-on text                |
| `claude-security-guidance.md` / `security-patterns.yaml` removed (decision D4 below) | removes files                         |
| `status-audit` → `jq` script + short skill                                           | replaces the skill's derivation prose |
| Always-on bytes before/after and the eval run                                        | measures the cuts above               |

## 1. Why this exists

Rules that must always hold are prose today, and prose loses to a confident model:

- `merge: manual` is read in one place, `phases/auto-chain.md`. `phases/merge.md` step 7 runs
  `git merge --ff-only` and step 9 pushes without ever reading `workflow.yml`. Nothing stops a
  session that skipped the router.
- "Never pass a `model:` override to an expert seat" lives in seven skill files. Nothing enforces
  it.
- `protect-generated.sh` warns and exits 0 for `.specnaut/installed.lock`. The edit goes through.
- Grooming "complete" is a prose contract (`board/groom.md`); a groom that skips an item reports
  success.
- On Codex, nothing confirms a tag push or a release publish. Claude has `permissions.ask` (#682);
  Codex installs **no hooks at all** (`CodexHarness` emits none).

Two skills state wrong facts: `specnaut-facts` (close order, P0–P2, no `cloud` backend, the wrong
marketplace name, five agents missing, no `specnaut gate`), and `backlog-frontmatter`, which
documents a schema `local/add.sh` does not write.

## 2. User scenarios

### US1 — `merge: manual` stops the landing (P1)

- **Given** `.specnaut/workflow.yml` says `merge: manual`
- **When** the agent runs `git merge` onto the base branch, or pushes the base branch
- **Then** Claude Code shows its native permission prompt; Codex refuses the command until the
  user's own prompt in that turn approved it.

### US2 — an expert seat runs on its declared tier (P1)

- **Given** a Specnaut agent with a `model:` in its definition
- **When** the session dispatches it with a `model` override
- **Then** the dispatch is refused with a message naming the rule, on both harnesses.

### US3 — a generated file cannot be hand-edited (P2)

- **Given** `.specnaut/installed.lock`
- **When** the agent edits it (`Edit`/`Write` on Claude, `apply_patch` on Codex), in any spelling
  Codex accepts (indented header, CRLF, `//`, `./`, a path relative to a subdirectory)
- **Then** the edit is refused (exit 2) with the existing explanation.

### US4 — a groom proves it is complete (P2)

- **When** `/board groom` finishes
- **Then** `groom-verify.sh` lists every processed item missing a section, a size, a priority or an
  outcome, and exits 1 when any is missing.

### US5 — Codex confirms a release (P1)

- **Given** a Codex session
- **When** the agent runs `release/tag.sh` (without `--no-push`), `release-github.sh` or
  `release-gitlab.sh`
- **Then** the command is refused unless the user's own prompt in that turn approved it.

### US6 — the Codex user knows hooks are inert until trusted (P1)

- **When** `init` or `upgrade` writes or changes a Codex hook
- **Then** the output says to run `/hooks` and trust them, and what does not run until then.

### Edge cases

- `workflow.yml` absent or without `merge:` → `auto` → the merge guard allows.
- An unrecognised `merge:` value → `manual` (same reading as `auto-chain.md` today).
- Hooks run from a subdirectory (Codex runs them in the session's cwd).
- A user's `settings.json` already holds a hook group with our matcher → the merge appends.
- `jq` missing → each guard fails **closed** for deny rules and says why.
- Upgrade from 7.1.x: `.claude/hooks/protect-generated.sh` and `log-subagent.sh` move; the old
  `settings.json` commands are rewritten, the old files pruned.

## 3. Requirements

- **FR-001**: Under `merge: manual`, a Bash command that merges into or pushes the base branch is
  stopped on both harnesses: `ask` on Claude Code, deny-unless-approved on Codex.
- **FR-002**: The merge mode is decided by one script, `merge-mode.sh`; `auto-chain.md` and the
  guard both call it. No second parser exists anywhere (search: `grep -rn '\^merge:' templates/`).
- **FR-003**: A dispatch of a Specnaut agent carrying a non-empty `tool_input.model` is denied on
  both harnesses. A non-Specnaut agent is never touched.
- **FR-004**: `protect-generated.sh` denies (exit 2) edits to `.specnaut/installed.lock`, and gates
  (`ask` on Claude, deny-unless-approved on Codex) edits to the gate's own switches:
  `.specnaut/workflow.yml`, `.specnaut/hooks/**`, `.codex/hooks.json`. Paths are decided by identity
  (resolved against the payload `cwd`, `-ef` on existing ancestors), never by text, on Claude
  (`Edit|Write`) and Codex (`apply_patch`, paths read from `*** Add|Update|Delete File:` and
  `*** Move to:` lines).
- **FR-005**: `groom-verify.sh` exists for **every** backlog backend (`local`, `github`, `gitlab`,
  `cloud` — enumerated by `ls templates/core/skills/board/scripts/`) and `groom.md` calls it as the
  last step before the report.
- **FR-006**: On Codex, every command in `release-commands.txt` is denied unless the current turn
  carries a `release` approval: the three release scripts, `gh release create|edit|upload`,
  `glab release create`, `gh run rerun`, and any push of a tag ref. `--no-push` exempts only its own
  command segment. A test checks Claude's `permissions.ask` rules cover the same list.
- **FR-007**: A Codex approval exists only when minted by a `UserPromptSubmit` hook from the user's
  own top-level prompt, matched whole and anchored (`/specnaut merge`, `$specnaut merge`, `merge`,
  `merge it`, `land it`, `push it`; `/ship release|tag`, `release it`, `tag it`; never a bare
  `yes`/`ok`/`go`). It carries `{session_id, turn_id, kind}`, all compared non-empty, lives under
  `${XDG_STATE_HOME:-$HOME/.local/state}/specnaut/approvals/<sha256(toplevel)>/`, covers every gated
  command of its kind in that turn, and is deleted on `Stop` and on the next prompt.
- **FR-015**: Every guard sources `_guard.sh`: any error, unparsable payload or unknown shape for
  the matched tool exits 2 with the reason. No guard can allow by failing.
- **FR-016**: The merge guard tokenises the command (separators, env prefixes, wrappers, git global
  options, one level of `sh -c`); `git push` is allowed only when every refspec is explicit and none
  resolves to the base; `gh pr merge` and `glab mr merge` are always gated; an unknown base is
  gated.
- **FR-017**: On Claude, the gated arms read `permission_mode`: `ask` in `default`, `acceptEdits`,
  `plan`; deny-unless-approved in `bypassPermissions`, `auto` and any unknown mode.
- **FR-008**: One script per guard serves both harnesses, installed once at `.specnaut/hooks/`,
  registered twice (`.claude/settings.json`, `.codex/hooks.json`).
- **FR-009**: `.codex/hooks.json` is merged additively like `settings.json` (new `mergeJson` flavor
  `codex-hooks`).
- **FR-010**: Hook commands that move are rewritten in the user's `settings.json` by the merge
  (`isSpecnautHook`: the bundled entry replaces Specnaut's own), never duplicated.
- **FR-011**: The status ledger (`log-subagent.sh`) is registered on Codex `SubagentStart` /
  `SubagentStop`.
- **FR-012**: `init` and `upgrade` print the Codex trust note whenever a Codex hook file was written
  or changed.
- **FR-013**: `specnaut-facts` and `backlog-frontmatter` state what the code does (§ 1's list);
  `merge-close.md` lists the `cloud` backend; `groom.md` says `size:`, not `complexity:`.
- **FR-014**: `upgrade` prunes the retired `.claude/hooks/` copies; a customized one keeps warning
  until `--force`. An upgrade test pins it.

## 4. Success criteria

- **SC-001**: Each guard has a test feeding a real Claude payload and a real Codex payload, observed
  red by mutating the guard's decision.
- **SC-002**: A project under `merge: manual` cannot land on its base branch on Codex without a user
  prompt in the same turn — shown by the guard's test with a stamp from a previous turn.
- **SC-003**: After `upgrade` from a 7.1.0 project, `settings.json` holds each Specnaut hook once,
  at its new path, and no hook points at a missing file.
- **SC-004**: `deno task test` and the smokes are green; the size ratchet reports no file over its
  ceiling that did not shrink.

## 5. 🔒 Decision table

| The decision                                                       | Its single home                                                                                                                                                                                                                                             | What would duplicate it                                                                                                     |
| :----------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| The merge mode of this project                                     | `templates/core/specnaut/scripts/bash/merge-mode.sh`                                                                                                                                                                                                        | the inline `sed` in `auto-chain.md`; a parser inside the guard                                                              |
| Whether a command lands on the base branch, and is therefore gated | `templates/harness-specific/shared/hooks/guard-merge.sh`                                                                                                                                                                                                    | a check in `merge.md` prose                                                                                                 |
| Whether a dispatch overrides a Specnaut agent's model              | `templates/harness-specific/shared/hooks/guard-dispatch-model.sh`                                                                                                                                                                                           | the "no `model:` override" sentence in the seven skill files, which stays as the reason, not the rule                       |
| Which files are generated and may not be edited                    | `templates/harness-specific/shared/hooks/protect-generated.sh`                                                                                                                                                                                              | a second copy under `.claude/hooks/`                                                                                        |
| Whether a Codex release command is approved                        | `templates/harness-specific/shared/hooks/guard-release.sh` (Codex only)                                                                                                                                                                                     | Claude's `permissions.ask` rules — the Claude arm, a different harness, not a second decider                                |
| Whether the user approved this turn, and for what                  | `templates/harness-specific/shared/hooks/approve-on-prompt.sh` writes, `templates/harness-specific/shared/hooks/_approval.sh` reads; the stamp lives outside the workspace (§ 11 F3)                                                                        | each guard re-deriving it from the transcript                                                                               |
| What makes a groomed item complete                                 | `templates/core/specnaut/scripts/bash/groom-rules.sh` (the rules); `templates/core/skills/board/scripts/<backend>/groom-verify.sh` fetches and calls it                                                                                                     | the prose list in `groom.md` (becomes a pointer); four divergent copies of the rule set                                     |
| Which hook entries in a user's settings are Specnaut's             | `isSpecnautHook` in `src/domain/hook_settings_merge.ts`, matching the exact command shapes in `src/domain/hook_command.ts` (the Claude command, the retired 7.1 `.claude/hooks/` command, and the generator's Codex command); the bundled entry replaces it | a rename table; a mention-matching regex, which deleted user wrappers (review finding); a migration in `upgrade_project.ts` |
| Whether the Codex trust note is due                                | a `hookTrust` field on the `Harness` port (Codex sets it: hashed paths + note), checked against the run's changed destinations by a pure function                                                                                                           | a harness-name check in each handler; `harness_commands.ts`, which only spells commands                                     |

| Which merge mode a run uses | the chain: per-run instruction, then `merge-mode.sh`; the guard:
`merge-mode.sh --strict` only | a per-run override reaching the guard (D3: the guard enforces the
file) | | The base branch | `templates/core/specnaut/scripts/bash/base-branch.sh` (`origin/HEAD`,
else `init.defaultBranch`, else unknown → gated) | a lookup in `merge.md` prose or inside
`guard-merge.sh` | | Which agents are Specnaut's | a name list generated into
`templates/harness-specific/shared/hooks/_agents.txt` at bundle time from `manifest.json` | a
hand-kept list in the guard; a filename test alone | | The release commands that need a confirmation
| `templates/harness-specific/shared/hooks/release-commands.txt`, read by `guard-release.sh`; the
Claude `permissions.ask` rules are checked against it by a test | two hand-kept lists drifting apart
| | How a guard fails | `templates/harness-specific/shared/hooks/_guard.sh` (sourced prelude: ERR
trap → exit 2, `jq -e`, non-empty compares) | a fail-open `|| true` in any guard | | Which
`.specnaut/` folders upgrade may prune | `managedRoots` of `ClaudeHarness` and `CodexHarness` gain
`.specnaut/hooks/` | adding it to `SHARED_ROOTS`, which means "every harness writes it" | | Whether
a merged JSON file changed | the merge flavor's return value (`{ content, changed }`), reported by
the writer | the caller diffing the file itself |

Both askers of the merge mode (the chain and the guard) call the same script; neither decides.

## 6. Technical context

- **Language/Version**: Deno 2 / TypeScript (CLI); POSIX `bash` + `jq` (hooks)
- **Primary Dependencies**: `@std/*`; `jq` at hook run time (already required by `log-subagent.sh`)
- **Storage**: approval stamps under `$XDG_STATE_HOME/specnaut/approvals/` (outside the project);
  `.specnaut/logs/agents.jsonl` (existing)
- **Testing**: `deno test --allow-read --allow-write --allow-run --allow-env`; `scripts/smoke/*.sh`
- **Target Platform**: macOS, Linux; Windows unchanged (hooks are bash already)
- **Project Type**: cli
- **Performance Goals**: each guard under 100 ms; `timeout` on every registration (5 s Claude, 10 s
  Codex)
- **Threat model**: the guards stop a confident model taking the obvious path — skipping the router,
  editing the switch it just read, calling the publish command directly. A model deliberately
  circumventing them with an unsandboxed shell (wrapper scripts, interpreters, `eval`, `gh api`, MCP
  merge tools) is out of reach of any hook and is stated as the limit. On Codex's default
  `workspace-write` sandbox the approval is a real boundary; on Claude, which has no sandbox, it is
  a speed bump on top of the native prompt.
- **Constraints**: Codex `ask` fails open → every Codex arm denies. Codex hooks inert until trusted
  through `/hooks`, and again after any hash change. Codex hooks run in the session cwd → a command
  walks up to the nearest `.specnaut/hooks/` and a guard takes the folder its own script sits in,
  never the git toplevel (a project nested in another repository without its own `.git`).
- **Scale/Scope**: 6 hook scripts, 4 verify scripts, 1 new merge flavor, ~25 test files touched

### Domain model

- **Bounded context**: template bundling + harness registration (CLI); hook runtime (scaffolded
  project).
- **Vocabulary**: guard, approval (Codex turn approval), merge mode, base branch, Specnaut agent.
- **Value objects**: `MergeMode` (`auto` | `manual`); `Approval` (`session_id`, `turn_id`).
- **Invariants**: an approval never outlives its turn; a deny rule never fails open on missing `jq`;
  a Specnaut hook command appears once in a settings file.

## 7. Constitution check

| Principle       | Verdict                              | Note                                                                                                        |
| :-------------- | :----------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| Size limits     | pass (after the planned extractions) | `init_handler.ts` 576 and `upgrade_handler.ts` 527 are over the 500 ceiling: both shrink, see Files touched |
| § I two halves  | pass                                 | no Cloud identifier; the `cloud` backend is a public backend name                                           |
| § XI outside in | pass                                 | examples invented                                                                                           |
| § XII version   | minor                                | new capability; nothing a user does by hand beyond trusting Codex hooks, which init/upgrade print           |
| Agent adoption  | required                             | the `feat` commit carries `## Agent adoption`                                                               |

### Files touched

| File                                                                                                                         |        Lines now | Lines after (est.) | Over target?          | Responsibility of each new module                                                                                       |
| :--------------------------------------------------------------------------------------------------------------------------- | ---------------: | -----------------: | :-------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `src/domain/claude_settings_merge.ts`                                                                                        |              252 |                225 | no                    | — (splice moved out; permissions + plugins stay)                                                                        |
| `src/domain/hook_settings_merge.ts` (new)                                                                                    |                0 |                 70 | no                    | the hook splice (moved out of `claude_settings_merge.ts:109-147`) + renames; the `codex-hooks` flavor is parse + splice |
| `src/infrastructure/deno_fs_writer.ts`                                                                                       |              252 |                260 | no                    | — (flavor lookup table; reports changed merged destinations)                                                            |
| `src/domain/template.ts`                                                                                                     |              197 |                199 | no                    | — (`"codex-hooks"` literal)                                                                                             |
| `src/infrastructure/harness/codex_harness.ts`                                                                                |              162 |                170 | no                    | — (`.specnaut/hooks/` in `managedRoots`; `hookTrust`)                                                                   |
| `src/infrastructure/harness/claude_harness.ts`                                                                               |               96 |                 97 | no                    | — (`.specnaut/hooks/` in `managedRoots`)                                                                                |
| `src/application/ports.ts`                                                                                                   | measure in tasks |                 +3 | —                     | — (`mergedChanged` on the write report)                                                                                 |
| `src/application/upgrade_project.ts`                                                                                         |              580 |                545 | **yes, shrinks**      | —                                                                                                                       |
| `src/application/upgrade_json_merges.ts` (new)                                                                               |                0 |                 60 | no                    | re-merges the user-owned JSON files and reports which changed (moved from `upgrade_project.ts:191-202,491-503`)         |
| `src/application/init_project.ts`                                                                                            |              306 |              ≤ 306 | yes (target)          | — (carries `mergedChanged`; must not grow)                                                                              |
| `src/domain/hook_trust.ts` (new)                                                                                             |                0 |                 25 | no                    | decides whether the trust note is due from the changed destinations                                                     |
| `src/cli/handlers/init_handler.ts`                                                                                           |              576 |                515 | **yes, shrinks**      | —                                                                                                                       |
| `src/cli/handlers/init_next_steps.ts` (new)                                                                                  |                0 |                 85 | no                    | renders init's closing guidance (line count confirmed against the real block in tasks)                                  |
| `src/cli/handlers/upgrade_handler.ts`                                                                                        |              527 |                485 | **yes, shrinks**      | —                                                                                                                       |
| `src/cli/handlers/upgrade_summary.ts`                                                                                        |              225 |                295 | no                    | — (absorbs the post-write report from `upgrade_handler.ts`)                                                             |
| `templates/manifest.json`                                                                                                    |             data |                +40 | n/a                   | —                                                                                                                       |
| `templates/harness-specific/shared/hooks/*.sh` → `.specnaut/hooks/` (6 guards + `_guard.sh`, `_approval.sh`)                 |        181 moved |               ~520 | no (each < 150)       | one guard each; one prelude; one approval reader                                                                        |
| `templates/core/specnaut/scripts/bash/merge-mode.sh` (new)                                                                   |                0 |                 15 | no                    | reads `merge:`                                                                                                          |
| `templates/core/skills/board/scripts/*/groom-verify.sh` (4 new)                                                              |                0 |               ~200 | no                    | per-backend fetch                                                                                                       |
| `templates/core/specnaut/scripts/bash/groom-rules.sh`, `merge-mode.sh`, `base-branch.sh` (new)                               |                0 |               ~110 | no                    | one rule each                                                                                                           |
| `templates/core/specnaut/workflow.yml`, `templates/core/root/AGENTS.md`                                                      |          measure |                 ±3 | —                     | the guard enforces the file (D3)                                                                                        |
| `tests/templates/chain_stops_test.ts`, `agents_managed_section_test.ts`, `tests/integration/upgrade_managed_section_test.ts` |                — |                  — | —                     | pinned wording moves with M1                                                                                            |
| `templates/harness-specific/claude/settings.json`                                                                            |               73 |                110 | no                    | —                                                                                                                       |
| `templates/harness-specific/codex/hooks.json` (new)                                                                          |                0 |                 60 | no                    | —                                                                                                                       |
| `templates/core/skills/specnaut/phases/auto-chain.md`                                                                        |              215 |                210 | no                    | —                                                                                                                       |
| `templates/core/skills/specnaut/phases/merge.md`                                                                             |              165 |                168 | no                    | —                                                                                                                       |
| `templates/core/skills/specnaut/phases/merge-close.md`                                                                       |              188 |                188 | no                    | —                                                                                                                       |
| `templates/core/skills/ship/SKILL.md`                                                                                        |              128 |                130 | no                    | —                                                                                                                       |
| `templates/core/skills/board/groom.md`                                                                                       |              227 |                222 | no                    | —                                                                                                                       |
| `templates/core/skills/specnaut-facts/SKILL.md`                                                                              |               46 |                 55 | no                    | —                                                                                                                       |
| `templates/core/skills/backlog-frontmatter/SKILL.md`                                                                         |               33 |                 35 | no                    | —                                                                                                                       |
| `scripts/smoke/smoke-hooks.sh`                                                                                               |              189 |                230 | no                    | —                                                                                                                       |
| `scripts/smoke/smoke-features.sh`                                                                                            |             1006 |               1015 | **yes, over ceiling** | see Complexity tracking                                                                                                 |

### Complexity tracking

`smoke-features.sh` is 1006 lines and the change adds ~9 (the `.codex/hooks.json` checks). Rule: a
file over its ceiling that the plan grows is a finding. Remedy, planned here: the hook-related block
(`:555-566` and its new checks) moves into `smoke-hooks.sh`, which already owns hook assertions, so
`smoke-features.sh` shrinks by ~12 net.

## 8. Surface impact

- **Scaffolded files**: new `.specnaut/hooks/` (both harnesses), `.codex/hooks.json`,
  `.specnaut/scripts/bash/merge-mode.sh`, `groom-verify.sh` per backend; Removed:
  `.claude/hooks/protect-generated.sh`, `.claude/hooks/log-subagent.sh`.
- **User settings**: `.claude/settings.json` Specnaut's hook entries replaced in place
  (`isSpecnautHook`); new `PreToolUse` groups `Bash` and `Agent|Task`.
- **CLI output**: init's next steps and upgrade's outcome gain the Codex trust note.
- **Plugin mirror**: the edited skills under `templates/core/skills/` resync to the marketplace
  plugin (`plugin_sync_test`); hooks and `.specnaut/**` are binary-owned and not mirrored.
- **Behaviour change visible to Claude users**: an edit to `installed.lock` now fails; under
  `merge: manual` a base-branch landing prompts.
- **Docs**: `UPGRADING.md` gains a 7.1 → 7.2 note (trust Codex hooks; the hooks moved).

## 9. Risks

| Risk                                                                  | Mitigation                                                                                                                                                                                 |
| :-------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every Codex guard is off until trusted, and again after any change    | the trust note; `status-audit` reports "no ledger — hooks untrusted?" instead of "healthy" (in the deferred cut)                                                                           |
| Claude `ask` from a hook may not prompt under `bypassPermissions`     | measured in implement on a real session; if it does not prompt, the Claude arm becomes deny-unless-approved like Codex (`UserPromptSubmit` exists on Claude)                               |
| The `spawn_agent` payload shape is undocumented                       | the first implement task captures a real payload with codex 0.154 (installed here); if `spawn_agent` has no `model` parameter, the rule already holds on Codex and a test pins the absence |
| The shell-command match in the merge guard is a heuristic             | stated limits: it sees `git merge`/`git push` in the command text; a wrapper script is not seen                                                                                            |
| A model with an unsandboxed shell can still forge anything            | stated limit (§ 6 threat model)                                                                                                                                                            |
| Changing the `Edit\|Write` matcher string would create a second group | the matcher string stays as it is                                                                                                                                                          |

## 10. Architecture audit

`architect-expert`, 2026-10-28. **Verdict: fail. 3 HIGH, 6 MEDIUM, 6 LOW.** Coverage: the five
questions, 28 files measured with `wc -l`, `mergeJson` and `^merge:` readers counted. Not covered:
the `.claude/hooks` pin count, the board install filter, the Codex `hooks.json` schema; these are
checked in tasks. The three HIGH claims were checked against the tree before being accepted
(`upgrade_project.ts` is 580 lines; `SHARED_ROOTS` and both `managedRoots` omit `.specnaut/hooks/`;
the writer rewrites a merged file and reports only plugin notes).

| Finding                                                 | Decision                                                                                                                                                                                |
| :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 `upgrade_project.ts` (580) is touched and omitted    | **accepted** — `upgrade_json_merges.ts` extraction is the first code task; the file shrinks to ~545                                                                                     |
| H2 `.specnaut/hooks/` is outside every prunable root    | **accepted** — added to both harnesses' `managedRoots`, not to `SHARED_ROOTS`; an upgrade test retires a `.specnaut/hooks/` file                                                        |
| H3 nothing reports "a merged JSON file changed"         | **accepted** — flavors return `{ content, changed }`, the writer reports `mergedChanged`; the up-to-date path re-merges JSON                                                            |
| M1 per-run override vs the guard                        | **accepted** — row added; D3 stands; `workflow.yml`, `AGENTS.md` chain-stops section and the 3 pinned tests change with it                                                              |
| M2 second copy of the splice                            | **accepted** — the splice moves to `hook_settings_merge.ts`; the writer gets a flavor table                                                                                             |
| M3 agent list and base branch have no home              | **accepted** — `_agents.txt` generated at bundle time; `base-branch.sh`                                                                                                                 |
| M4 `upgrade_outcome.ts` duplicates `upgrade_summary.ts` | **accepted** — the report goes into `upgrade_summary.ts` (→ ~295)                                                                                                                       |
| M5 landing forms the guard misses                       | **accepted** — FR-016 (with the security seat's F6)                                                                                                                                     |
| M6 `hooksTrustNote` in the wrong file                   | **accepted** — `hookTrust` on the `Harness` port + `hook_trust.ts`                                                                                                                      |
| L1 shared sources under `harness-specific/<harness>/`   | **accepted** — `harness-specific/shared/hooks/`, plus a test the two declarations agree                                                                                                 |
| L2 `merge-mode.sh` output                               | **accepted** — stdout `auto`/`manual`, note on stderr; `chain_stops_test` points at it                                                                                                  |
| L3 `COMMAND_RENAMES` expiry + both-present              | **superseded** — the ownership rule (§ 11 Measured) replaces the rename table, so there is nothing to expire                                                                            |
| L4 stale figures                                        | **fixed** in § 7                                                                                                                                                                        |
| L5 `_groom_rules.sh` placement                          | **accepted** — the board scripts share nothing across backends today (`ls scripts/` shows only backend dirs), so the rules go to `.specnaut/scripts/bash/groom-rules.sh`, a shared root |
| L6 fail-closed repeated six times                       | **accepted** — `_guard.sh` (FR-015)                                                                                                                                                     |

## 11. Security audit

`security-expert`, 2026-10-28. **Verdict: fail. 4 HIGH, 3 MEDIUM, 3 LOW.** Coverage: the six
questions; local probes with codex 0.154 (the `workspace-write` sandbox refuses writes to `$HOME`;
`apply_patch` accepts indented, CRLF and `//`/`./` headers; execpolicy `prompt` matches
`git push origin HEAD:main` and misses `git -C` and `bash -lc`), the current `protect-generated.sh`
glob (four bypasses), `jq` shape behaviour. Not assessed: what Codex's trust hash covers, whether
hooks run sandboxed, whether `PreToolUse` carries `turn_id`, whether a spawned agent's first message
fires `UserPromptSubmit`, `write_stdin`, project-level execpolicy rules.

| Finding                                                            | Decision                                                                                                                                                                                                                                                                                                                                                                        |
| :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1 guards fail open on every non-2 exit and on empty == empty      | **accepted** — `_guard.sh` prelude (FR-015); SC-001 pins real Codex `Bash` and `apply_patch` payloads too                                                                                                                                                                                                                                                                       |
| F2 the switch, the guards and `hooks.json` are model-writable      | **accepted** — `merge-mode.sh --strict` returns `manual` if the working tree, `HEAD` or the base's committed copy says so, or any `merge:` line is non-`auto`; FR-004 gates the switch files; the remainder is the stated limit                                                                                                                                                 |
| F3 the stamp sits where the Codex sandbox lets the model write     | **accepted** — stamp moved to `$XDG_STATE_HOME/specnaut/approvals/`, `{session_id, turn_id, kind}`, atomic write, deleted on `Stop`. The "single-use" in the first draft is replaced by "the turn and the kind": `merge.md` merges and pushes in one turn                                                                                                                       |
| F4 the release arm gates the wrappers, not the publishing commands | **accepted** — `release-commands.txt` is the one list (FR-006); a test holds Claude's `ask` rules to it                                                                                                                                                                                                                                                                         |
| F5 `apply_patch` path matching is beaten by accepted spellings     | **accepted** — FR-004 decides by identity; a patch with zero extracted paths exits 2                                                                                                                                                                                                                                                                                            |
| F6 the merge guard is a deny list                                  | **accepted** — FR-016: push is an allow list; unknown base is gated                                                                                                                                                                                                                                                                                                             |
| F7 trust covers code a later pull can replace                      | **conditional** — the first implement task measures what Codex hashes. If it hashes only the command string, the registration pins the script's sha256 (a changed script then changes `hooks.json` and Codex asks again); if it hashes the script, nothing to add. Either way the trust note lists Specnaut's commands and flags any customized hook file and any foreign entry |
| F8 `ask` under bypass/auto                                         | **accepted** — FR-017                                                                                                                                                                                                                                                                                                                                                           |
| F9 agents recognised by filename                                   | **accepted** — `_agents.txt` names list (M3), names outside `^[A-Za-z0-9:_-]+$` with a model set are denied                                                                                                                                                                                                                                                                     |
| F10 hooks run git in a writable repo                               | **accepted** — plumbing commands only, `--no-pager`, `GIT_OPTIONAL_LOCKS=0`, every expansion quoted, no `eval`                                                                                                                                                                                                                                                                  |

**Measured (T001/T002, 2026-10-28)** — from the Codex source (`openai/codex`,
`codex-rs/hooks/schema/generated/*.schema.json`, `codex-rs/core/src/tools/hook_names.rs`,
`codex-rs/core/src/tools/handlers/multi_agents*/spawn.rs`, `codex-rs/hooks/src/engine/`). A live
`codex exec` probe was refused by this session's safety classifier because it needed
`--dangerously-bypass-hook-trust`; it was not retried another way.

- `PreToolUse` **requires** `turn_id` and `permission_mode` (`default`, `acceptEdits`, `plan`,
  `dontAsk`, `bypassPermissions`). `UserPromptSubmit` carries `turn_id`, `prompt`, and `agent_id` /
  `agent_type` when it fires inside a subagent → an approval is minted only when `agent_id` is
  absent.
- `tool_name` is `Bash`, `apply_patch` or `spawn_agent`. **`Edit|Write` matches `apply_patch` and
  `Agent` matches `spawn_agent`** (matcher aliases), so one matcher string serves both harnesses.
- `spawn_agent` `tool_input`: `agent_type`, `model`, `reasoning_effort` (both optional). The model
  guard denies a non-null `model` **or** `reasoning_effort` on a Specnaut agent: both move it off
  its declared tier.
- **The trust hash covers the hook definition only** (event, matcher, handler incl. the command
  string — `hook_hash` in `discovery.rs`), never the script it runs. F7 therefore applies: every
  registration pins the script's sha256 in its command, so a changed script changes the command and
  Codex asks again.
- Hooks are spawned as plain processes (`command_runner.rs`), with no sandbox → the hook can write
  the approval under `$XDG_STATE_HOME`; the model's sandboxed shell cannot.
- Claude: `ask` is used only where `permission_mode` is `default`, `acceptEdits` or `plan` (FR-017),
  so whether `ask` prompts under `auto` no longer matters. Claude's `UserPromptSubmit` has no
  `turn_id`: the stamp is scoped to `session_id` + kind and deleted by the `Stop` hook, which fires
  at the end of every turn.

**Consequence for the merge (amends § 5).** A sha-pinned command changes with every script change,
so "append if the command is absent" would pile up stale entries that each deny. The splice's rule
becomes: **an entry whose command runs `.specnaut/hooks/<file>.sh` (or a retired
`.claude/hooks/<file>.sh` Specnaut shipped) is Specnaut's, and the bundled entry for that file
replaces it**; every other entry is untouched. This one rule replaces `COMMAND_RENAMES`.

**First implement task — measure before building on it**, with codex 0.154 (installed): the
`spawn_agent` payload; whether `PreToolUse` carries `turn_id`; whether hooks can write under
`$XDG_STATE_HOME` (outside the sandbox); what the trust hash covers; whether a spawned agent's first
message fires `UserPromptSubmit` (if it does, minting is refused for it); whether an `apply_patch`
sent through the shell fires the `apply_patch` matcher. And with Claude Code: whether a hook `ask`
prompts under `auto`. Each answer is written into this section before the guard that depends on it
is built; an answer that removes a guard's premise changes the guard, not the test.

## 12. Open questions

None for the user. Settled here:

- **D1 — the approval is minted from the user's prompt, not a flag the model passes**, and lives
  outside the workspace, where the Codex sandbox refuses the model's writes (§ 11 F3). A flag the
  model passes is indistinguishable from no confirmation, because `merge.md` and `/ship` are its
  only callers. The issue's "unless an explicit flag is passed" is met by a stronger mechanism; the
  deviation is recorded here.
- **D2 — `dispatch-agent.sh`'s `MODEL` env stays.** A human sets it on a headless run; the rule
  targets a model choosing a tier in a `Task`/`Agent` call, which is what the guard sees. Its
  comment says so.
- **D3 — the merge guard gates every base-branch landing**, not only the `/specnaut merge` one:
  `merge: manual` means nothing lands on the base branch without the user.
- **D4 — the security-guidance files are removed (in the deferred cut).** Nothing in Specnaut reads
  them; their only reader is a third-party plugin `settings.json` does not enable, and enabling it
  would add a model-backed review to every turn, against the slim default. `security-expert` and
  `/sec-audit` already read `.specnaut/memory/security/`.
- **D5 — `status-audit` becomes Codex-capable.** The Codex `SubagentStart`/`SubagentStop` payloads
  carry the keys `log-subagent.sh` reads, so registering it is the whole change (FR-011). The
  skill's "Claude only" sentence changes with the deferred `jq` cut.
- Follow-up to the backlog: `local/add.sh` accepts a `labels` argument and never writes it.
