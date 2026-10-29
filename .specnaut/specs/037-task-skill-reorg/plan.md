# Plan — Reorganise the bundled skills into specnaut, task and ship

Backlog item: specnaut-cli#683 "Reorganise the bundled skills into specnaut, task and ship"
(https://github.com/specnaut/specnaut-cli/issues/683), child of epic specnaut-cli#674. Branch:
`037-task-skill-reorg`. Target release: 7.2.0 (minor — new address, no hand action beyond Codex
re-trusting a changed hook).

## 1. Why this exists

A unit of work is split across addresses that do not match what the user is doing: the item lives
under `/board`, its delivery (plan → merge) under `/specnaut` next to the framework's upgrade, and
audits under `code-audit` plus five `*-audit` skills, each with an always-loaded description.
Measured on the template frontmatter: 21 skills, ≈ 6.2 KB of always-loaded description on Claude, ≈
5.3 KB on Codex; the seven retiring skills alone carry ≈ 2.6 KB.

Ruled by Kevin on 2026-10-29: this ships now, before the eval (#675) and the slimming (#676). It
**moves** the phase files and changes only address text in them; #676 slims them at their new
address.

## 2. User scenarios

- **P1 — a project upgrades and gets `/task`.** Given a 7.1.0 project, when `specnaut upgrade` runs,
  then `/task` exists, `/board`, `/code-audit` and `/*-audit` are gone, and `/specnaut` offers only
  `doc`, `upgrade`, `list`.
- **P1 — customised work is not lost.** Given a customised `phases/plan.md` and an addendum
  `.specnaut/addenda/specnaut/plan.md`, when upgrading, then both are at their `task` address,
  byte-identical, and still read. Given a customised `board/SKILL.md` or `sec-audit/SKILL.md`, then
  upgrade keeps it and warns until `--force` (then backs it up).
- **P1 — the chain runs at the new address.** `/task plan <id>` → tasks → implement → review →
  merge, with the same stops; `merge: manual` approval still works (`/task merge`).
- **P2 — a retired verb answers.** `/specnaut plan …` prints one line naming `/task plan` and stops.
- **P2 — audits.** `/task audit --security` runs the security seat only; `/task audit` runs every
  applicable seat.
- Edge: an addendum exists at both the old and the new address → upgrade moves neither and warns;
  `addenda/specnaut/upgrade.md` stays (upgrade did not move); `--dry-run` reports, changes nothing.

## 3. Requirements

- **FR-001** `/task` carries: backlog `list`, `next`, `add`, `edit`, `close`, `groom`, `estimate`,
  `status`, `brief`, `<id>`; pipeline `plan`, `tasks`, `implement`, `review`, `merge`; `audit`
  (`--security|--archi|--perf|--a11y|--deps`, every applicable axis with no flag); `constitution`.
- **FR-002** `/specnaut` carries `doc`, `upgrade`, `list` only, and holds the **one** table of
  retired addresses (every former `/specnaut` verb, `/board`, `/code-audit`, the five `*-audit`).
- **FR-003** No `board`, `code-audit` or `*-audit` skill is installed by `init`; `upgrade` removes
  them (customised copies warn until `--force`).
- **FR-004** Every moved phase/contract doc travels through `SKILL_DOC_RENAMES`, so a customised
  copy lands at the new address in the `customized` bucket.
- **FR-005** `upgrade` moves every addendum whose phase moved, only when the target is absent;
  reports each move; does nothing under `--dry-run`.
- **FR-006** Every shipped file names no retired address outside the retired table; a test fails
  otherwise (`.specnaut/specs/` and `docs/upgrading/` excluded).
- **FR-007** Hooks and the cockpit mod recognise `/task merge` / `$specnaut-task merge` and the
  `task` router; the `$ship` spellings are corrected to `$specnaut-ship` while editing.
- **FR-008** The always-loaded description bytes are reported before and after for Claude Code and
  Codex.
- **FR-009** `product-owner` stays the only writer of backlog state; `edit` and `close` dispatch it.

## 4. Success criteria

- **SC-001** On a fresh `init` for every harness, no file names `/board`, `/code-audit`, `/*-audit`
  or a retired `/specnaut` verb outside the retired table (FR-006 test green).
- **SC-002** The upgrade test (claude, codex, copilot) shows zero lost customised docs and zero
  dropped addenda.
- **SC-003** Always-loaded description bytes drop on both harnesses (target: ≥ 2 KB on Claude).
  **Measured 2026-10-29** with `scripts/skill-description-bytes.ts` (name + `description`, plus
  `when_to_use` on Claude; skills with `disable-model-invocation` excluded): Claude Code 6,518 →
  4,231 B (−2,287, −35 %), Codex 5,546 → 3,114 B (−2,432, −44 %); 20 → 14 listed skills.
- **SC-004** Full suite, `go test ./...` and cross-smoke green on Linux, macOS, Windows.

## 5. 🔒 Decision table

| The decision                                                                                                                                                                                                                                                                                                                           | Its single home                                                                                                               | What would duplicate it                                                                                    |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| Old → new address of each moved doc                                                                                                                                                                                                                                                                                                    | `src/domain/skill_doc_renames.ts` (gains `kind: "phase" \| "backlog-doc"`)                                                    | path literals per harness; a second move list in upgrade or tests                                          |
| Which addenda move                                                                                                                                                                                                                                                                                                                     | derived from the rename table by `addendumRenames()` in `src/domain/addendum_audit.ts`                                        | a list inside `upgrade_addenda_moves.ts`; a list in the test                                               |
| Retired addresses and their one-line notice                                                                                                                                                                                                                                                                                            | `templates/core/skills/specnaut/SKILL.md`, section "Retired addresses"                                                        | a TS constant; a retired table in `/task`; a literal list in the FR-006 test (the test parses the section) |
| Routable verbs per router                                                                                                                                                                                                                                                                                                              | `ROUTABLE_PHASES` in `src/domain/addendum_audit.ts`, pinned to each router's table                                            | prose lists of verbs in phase docs                                                                         |
| What the user types per harness                                                                                                                                                                                                                                                                                                        | `SKILL_SURFACE` / `harnessCommands`                                                                                           | literals in `approve-on-prompt.sh` — kept, cross-checked by a test                                         |
| Audit axis → agent                                                                                                                                                                                                                                                                                                                     | the axis table in `templates/core/skills/task/phases/audit.md`                                                                | the experts' own descriptions                                                                              |
| Which verbs read an addendum                                                                                                                                                                                                                                                                                                           | `ROUTABLE_PHASES` (`task`: plan, tasks, implement, review, merge, audit, constitution, groom; `specnaut`: doc, upgrade, list) | a verb list in the router prose; `check --project` accepting what the router never reads                   |
| Retired-address scan exclusions                                                                                                                                                                                                                                                                                                        | beside the parser in `tests/templates/retired_addresses_test.ts`                                                              | ad-hoc skips sprinkled per test                                                                            |
| Paths the Claude plugin serves                                                                                                                                                                                                                                                                                                         | `src/domain/plugin_coverage.ts`                                                                                               | `SYNC_PAIRS` (a lock, acceptable)                                                                          |
| Closing an item (`/task close <id> [--not-planned]`)                                                                                                                                                                                                                                                                                   | `task/SKILL.md` dispatch row → PO close                                                                                       | a `delete` verb; a `delete.sh` per backend                                                                 |
| New helper `scripts/skill-description-bytes.ts` — (a) inventory: no existing byte counter; `CORE_BUNDLE` + harness adapters already compute install paths; (b) recurrence: #674 AC 7, #679 and #683 each ask for this measurement; (c) **add a new helper**, data-only (reads the bundle, takes no executable/argv)                    | `scripts/skill-description-bytes.ts`                                                                                          | an ad-hoc `awk` in the plan or commit body                                                                 |
| New `upgrade_addenda_moves.ts` — (a) inventory: `moveRenamedBytes` in `upgrade_renames.ts` does bytes-move for lock entries; addenda are not in the lock; (b) recurrence: spec 033 ship rename left addenda behind (caught by `check --project` only), now #683; (c) **extend at the owner**: reuse `FsReader`/`FsWriter`, no new port | `src/application/upgrade_addenda_moves.ts`                                                                                    | addenda handling inside `carryRenamedDocs`                                                                 |

## 6. Technical context

Deno/TypeScript CLI, hexagonal (`domain` / `application` / `infrastructure` / `cli`); templates
under `templates/core`, bundled by `deno task bundle`; Go port embeds the manifest (`templates.go`).

**Move map (source → manifest owner):**

- `skills/specnaut/phases/{plan,plan-audits,tasks,implement,epic-commits,epic-fixups,epic-loop,quality-gates,review,merge,merge-squash,merge-close,auto-chain,constitution}.md`
  → `skills/task/phases/` (14 rename rows, `kind: phase`).
- `skills/board/` → `skills/task/`: `SKILL.md` becomes the `/task` router (backlog table + the
  pipeline routing taken from the specnaut router); `groom.md`, `groom-report.md`, `spec-autogen.md`
  → `task/` (3 rows, `kind: backlog-doc`); `scripts/` moves in source only, still installs to
  `.specnaut/scripts/backlog/`.
- `skills/code-audit/SKILL.md` + five `*-audit/SKILL.md` → one `task/phases/audit.md` (routable, not
  chainable). Scope script source → `task/scripts/`, installs to `.specnaut/scripts/audit/`.
  Per-axis mode = one seat, same scope arguments.
- New `specnaut/phases/doc.md`, `list.md`; `upgrade.md` stays.
- `board/SKILL.md` and the six audit `SKILL.md` are **not** renamed: they orphan. Carrying a
  customised board router to `task/SKILL.md` would install a router with no pipeline.
- `plugin/skills/` mirrored byte for byte.

**Settled decisions (2026-10-29, Claude):** `edit` = `update` renamed; `estimate`, `status`,
`brief`, `<id>` keep their rows (dropping them is #679's cut); `tasks` stays routable as
`/task tasks` (auto-chain invokes it; #676 folds it); `/specnaut` stays model-invocable (switching
it off needs the eval).

## 7. Constitution check

- § I halves boundary — CLI only; web `docs/llms.md` is a separate commit on its own repo. ✅
- § XI no consumer trace — invented examples only. ✅
- § XII version — minor (7.2.0): new addresses, upgrade migrates; only manual step is Codex
  re-trusting the changed hook, already true of 7.2.0 via #679. ✅
- Hexagonal layering — rename/addenda rules in `domain`, the move in `application`, no new port. ✅
- Size gate — `audit.md` merges seven files and must stay under the doc ceiling;
  `upgrade_project.ts` (560 lines) gets one wiring call only; the new module stays small. ✅
  (checked at review)
- No deprecated aliases — the retired table answers, it does not run. ✅

## 8. Surface impact

- **Bundle:** skills `specnaut`, `task` (new), `ship` (refs only); removal of `board`, `code-audit`,
  `sec|arch|perf|a11y|dep-audit`.
- **Agents:** every agent naming an old address (`product-owner`, `specnaut-guide`, `developer`,
  `qa-tester`, `review-coordinator`, `code-reviewer`, the five experts) and `agents/README.md`.
- **Always-on text:** root `AGENTS.md` managed sections (phase-addenda, backlog, optional
  integrations), `specnaut-facts`, `harness-specific/claude/{loop.md,claude-security-guidance.md}`,
  `cursor/specify-rules.mdc`, `specnaut/templates/*`, `specnaut/scripts/bash/*`, backlog scripts.
- **Hooks:** `approve-on-prompt.sh`, `guard-merge.sh`, `protect-generated.sh` → regenerate
  `SHA256SUMS` and the Codex `hooks.json` pin.
- **Mods:** `mods/specnaut-cockpit/hooks/core/chain.ts` recognises `task`.
- **CLI strings:** `init_next_steps.ts`, `backlog_strategies/{github,gitlab}.ts`,
  `cloud_handler.ts`.
- **Docs:** `README.md`, `UPGRADING.md` 7.2 section, CLI `AGENTS.md`; web `docs/llms.md`.
- **Per harness:** Claude `/task`; Codex, Cursor, opencode, Antigravity `specnaut-task`; Copilot
  `specnaut-task-<doc>.instructions.md`. No adapter code change.

## 9. Risks

| Risk                                                                                          | Mitigation                                                                                   |
| :-------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| Cockpit quota hold silently stops matching (fails open)                                       | `chain.ts` + `core_test.ts` in the same change; test feeds `task` and `specnaut-plugin:task` |
| Approval hook refuses `/task merge` → `merge: manual` breaks                                  | hook edit + test per harness spelling; cross-check against `harnessCommands`                 |
| `renameEndpointEntry` resolves a `backlog-doc` under `phases/` → rename skipped, file orphans | `kind` field; upgrade test on a customised `groom.md`                                        |
| Customised `specnaut/SKILL.md` kept → routes to moved phases                                  | targeted upgrade note naming it; listed in `UPGRADING.md`                                    |
| Old plugin + new binary reads `addenda/specnaut/`                                             | `UPGRADING.md` says update the plugin with the binary                                        |
| A shipped doc still names a retired address                                                   | FR-006 test scans bundle, `HARNESS_STATIC`, `plugin/`, `README.md`, `mods/`, `src/` strings  |
| A deleted lock test = a lost guard                                                            | each pinned test rewritten at the new home (§ tasks), none deleted without its rule re-homed |

## 10. Architecture audit

`architect-expert`, 2026-10-29 — verdict needs_followup, 0 CRITICAL · 0 HIGH · 8 MEDIUM · 4 LOW.
Load-bearing claims re-checked against the tree before deciding.

| Finding                                                                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                 |
| :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M `upgrade_project.ts` is 560 lines (> 500 ceiling); any wiring grows it | **Accepted.** Net-zero wiring: the existing `carryRenamedDocs` call becomes one `carryRenames(ctx)` call (in `upgrade_renames.ts`) that runs docs then addenda. File must not grow; ratchet checks it.                                                                                                                                                                                                   |
| M merged `task/SKILL.md` would exceed 500 (board is 436)                 | **Accepted.** Budget: `task/SKILL.md` ≤ 200 lines — verb → doc table, addendum rule, PO-only-writer rule, one line to the retired table. Backend sections + verb bodies move to new `task/backlog.md` (`backlog-doc`, backend-filtered). Chain detail stays in `phases/auto-chain.md`.                                                                                                                   |
| M `audit.md` merges 528 raw lines                                        | **Accepted.** Budget ≤ 200 lines: scope resolution, axis table + applicability rule, output contract. Per-axis checklists are the experts' content — not copied.                                                                                                                                                                                                                                         |
| M which `/task` verbs read an addendum is undecided                      | **Accepted, decided:** `ROUTABLE_PHASES.task` = `plan, tasks, implement, review, merge, audit, constitution` + `groom`; other backlog verbs read none (same as `/board` today, except groom which is a full pass). `ROUTABLE_PHASES.specnaut` = `doc, upgrade, list`. `CONTRACT_DOCS` re-keyed to `task`. Test: `addendumRenames()` yields the 14 phase moves. New row in §5.                            |
| M `task/SKILL.md` category                                               | **Accepted:** `backlog-skill`, name `task`; verified no adapter hardcodes `"board"` (grep of `src/infrastructure/harness/*.ts`: no hit; only `init_next_steps.ts:63`).                                                                                                                                                                                                                                   |
| M FR-006 exclusions homeless; `scripts/code-audit/` collides             | **Accepted.** Exclusions declared once beside the retired-table parser (`tests/templates/retired_addresses_test.ts`): `.specnaut/specs/`, `docs/upgrading/`, `UPGRADING.md`, `skill_doc_renames.ts`, the retired section itself. The install path moves: scope script installs to `.specnaut/scripts/audit/` (an untouched copy orphans and is replaced; references updated). No whitelist entry for it. |
| M rename chains unprotected (#676, #684 will create them)                | **Accepted.** Two invariant tests: every `to` resolves to a bundle entry; no row's `from` equals another row's `to`.                                                                                                                                                                                                                                                                                     |
| M Go port absent from §8                                                 | **Rejected after verification:** `grep -rln "tag-version\|addenda\|Rename\|code-audit\|skills/board" internal/ templates.go parity/` → no hit; the Go port has no upgrade-rename or addenda logic. `go test ./...` stays a gate (it embeds the manifest).                                                                                                                                                |
| L `kind` restates `CoreCategory`                                         | **Accepted:** `Extract<CoreCategory, "phase" \| "backlog-doc">`.                                                                                                                                                                                                                                                                                                                                         |
| L derivation also moves ship-rename addenda (`tag-version` → `tag`)      | **Accepted:** stated in `UPGRADING.md`, covered by an upgrade-test case.                                                                                                                                                                                                                                                                                                                                 |
| L `/board`, `/*-audit` have no router to answer; `update`→`edit`         | **Accepted:** the retired table is reference text for those (the harness says "unknown skill"); only `/specnaut <old verb>` gets the one-line answer. Row `/board update` → `/task edit` added.                                                                                                                                                                                                          |
| L #684 target ambiguity                                                  | **Accepted:** `/task constitution` keeps editing `.specnaut/memory/constitution.md` until #684 moves it.                                                                                                                                                                                                                                                                                                 |

**Blast radius (counted, files with a hit, excl. bundle and specs):** `/board`: 81 · old `/specnaut`
verbs or `skills/specnaut/phases`: 96 · `*-audit`: 44 — about 120 distinct files, of which ~85 are
tests. Mechanical, guarded by the FR-006 test.

**Also owned:** the customised-`specnaut/SKILL.md` note is emitted by `carryRenames` when the lock
marks `specnaut/SKILL.md` customised (one `notes` line).

## 11. Security audit

`security-expert`, 2026-10-29 — verdict needs_followup, 0 CRITICAL · 0 HIGH · 3 MEDIUM · 2 LOW. No
must-hold bypass, no escape out of the project (`assertSafeDestination`, `assertInsideProject`,
`resolveProjectRoot` already bound every port call). Finding 2's central claim re-checked:
`FsReader.readText` (`src/infrastructure/fs_reader.ts`) reads through a leaf link that stays inside
the project, and `moveRenamedBytes` (`src/application/upgrade_renames.ts`) writes the bytes as a
regular file and deletes with no backup — confirmed.

| Finding                                                                                                                         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 moved guardrails can go silently inert (old plugin + new binary; customised `specnaut/SKILL.md`; addendum at both addresses) | **Accepted.** (a) The `phase-addenda` managed section of root `AGENTS.md` names addenda **by phase**: "`plan`, `tasks`, `implement`, `review`, `merge`, `audit`, `constitution`, `groom` → `.specnaut/addenda/task/<phase>.md`, however the phase was reached" — so an old router still finds the new home. (b) `check --project` flags durably: an addendum left at a renamed address (already does via `renameOf`; extended by the new rows) and a customised `specnaut/SKILL.md` whose lock baseline predates 7.2. (c) Upgrade test covers both. |
| M2 mover reads through in-project links and writes a regular file (ignored secret → tracked addendum)                           | **Accepted, must ship in this change.** Both the addenda mover and `moveRenamedBytes` (2 → 19 rows): `readEntry` (lstat) on source and target; move only `kind: "file"`; a link stays where it is with a warning; delete bounded with `within` to the old address; each refused move is caught and warned, never aborts the upgrade. Tests: a link at the old address pointing at an ignored file is not copied.                                                                                                                                    |
| M3 a renamed doc overwrites an untracked file at the new address; `.claude/skills/task/` is a common name                       | **Accepted.** Collision policy (one home: `applicableRenames`): if `readEntry(newDest)` is non-null and `newDest` is not in the lock → skip, keep the old copy, warn. Fresh installs of `task/` follow the existing untracked-file path (verified at implement; test with a pre-existing `.claude/skills/task/SKILL.md`). The address `/task` stays: Kevin's ruling, and the collision is now loss-free.                                                                                                                                            |
| L4 retired approval spellings stay on the allow list; guard messages name `/specnaut merge`                                     | **Accepted.** FR-007: `/specnaut merge`, `$specnaut merge`, `$ship …` are **removed**; added `/task merge`, `$specnaut-task merge`, `$specnaut-ship release\|tag`. Negative rows: `/task merge-x`, `/task mergeX`, `please /task merge`, `/tasks merge`. Hook files are in the FR-006 scan. Messages in `guard-merge.sh`, `protect-generated.sh`, `guard-release.sh` updated.                                                                                                                                                                       |
| L5 cockpit: plugin skew, message names `/specnaut <phase>`                                                                      | **Accepted.** `chain.ts` recognises `task`, `specnaut-plugin:task` **and** the old `specnaut` / `specnaut-plugin:specnaut` for pipeline phases (plugin skew is a fail-open risk; this is a hold, not an alias the user sees). Hold message → `/task <phase>`. `core_test.ts` asserts the `deny` itself.                                                                                                                                                                                                                                             |

Not assessed by the seat: SHA256SUMS/Codex pin (regenerated by `scripts/gen-hooks.ts`, Codex
re-trust is the intended fail-closed behaviour).

## 12. Open questions

1. **What does `/task delete <id>` do?** — **Settled 2026-10-29 (Kevin): no `delete` verb.** Closing
   already exists; `/task close <id>` (completed, or `--not-planned`) through the PO covers it. The
   #683 AC's `delete` is amended to `close`.
