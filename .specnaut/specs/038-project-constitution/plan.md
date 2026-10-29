# Plan — Bootstrap a project-owned constitution at docs/constitution.md

Backlog item: specnaut-cli#684 "Bootstrap a project-owned constitution at docs/constitution.md:
framework-independent domain, bounded contexts, SOLID"
(https://github.com/specnaut/specnaut-cli/issues/684), child of epic specnaut-cli#674. Branch:
`038-project-constitution`. Target release: next minor (users act by hand only to re-trust the Codex
hooks and to resolve a refused move). #685 (every entry point reads it, the guard) is out of scope.

## 1. Why this exists

A default project gets no principles. `init` writes `.specnaut/memory/constitution.md` as a 48-line
placeholder reading "(none defined yet)", and the architecture baseline sits in
`.specnaut/templates/constitution-template.md` (174 lines), which applies only if the user runs the
helper. So the architect-expert and review have nothing to hold a plan or a diff against, and
business code couples to whatever framework the project uses.

The file also lives inside the framework's tree and carries two framework contracts: the size-limits
table and the mobile-first target-surface heading. Kevin ruled on 2026-10-28: the constitution is
the team's document at `docs/constitution.md`. It defaults to an architecture-first baseline and
stays very short. Specnaut bootstraps it once and then only reads it. An amendment is exceptional,
made on the user's request, and backed by a hook.

## 2. User scenarios

**P1: a new project gets real principles.** Given an empty repository, when `specnaut init` runs,
then `docs/constitution.md` exists with the four default principles, each with a `Check:` line. Then
`AGENTS.md` points to it, and no `.specnaut/memory/constitution.md` exists.

**P1: an existing project is moved, not rewritten.** Given a project with
`.specnaut/memory/constitution.md` (customised or the untouched placeholder), when
`specnaut upgrade` runs, then `docs/constitution.md` holds the same bytes and the old file is gone.
Edge cases:

- `docs/constitution.md` already exists with different content: the move is refused with an
  explanation, both files stay, and no default is written over either.
- Same content up to CRLF or a trailing newline: the old file is removed (dedupe).
- The old path is a symlink, or is not UTF-8: it is refused and left in place.
- The old path is listed in `preserve.yml`: it is moved anyway, with a note to remove the line.

**P1: upgrade never touches it again.** Given `docs/constitution.md` exists, when `upgrade` runs,
including `upgrade --force` and `init --force`, then the file is byte-identical afterwards. A notice
lists the default principles the file does not carry.

**P1: an agent cannot amend it on its own.** Given an agent session, when the agent edits or writes
`docs/constitution.md` (through Edit/Write, a Codex patch, or a shell write that names the file),
then the hook denies it, unless the user's prompt in that turn carries the helper's confirmation
phrase.

**P2: size and UI settings no longer live in the constitution.** Given a project with a customised
`## Size limits` table or a declared `### Target surface`, when `upgrade` runs, then
`.specnaut/size-limits.yml` or `.specnaut/ui.yml` is written from them (only if absent), and the
ratchet and the mobile-first contract read those files.

**P2: the domain boundary is checked, and a skip is never a pass.** Given `.specnaut/boundaries.yml`
naming a domain path and forbidden import patterns, the gate passes on a clean tree, fails on a
violating import, and reports "skipped: <reason>" with no config, no patterns, or no files under the
path.

**P3: the ceiling holds.** A change that takes `docs/constitution.md` past 100 lines fails the
ratchet. `specnaut check` and `upgrade` warn on a file already over it.

## 3. Requirements

- **FR-001** `init` writes `docs/constitution.md` from the one bootstrap source. It never writes
  `.specnaut/memory/constitution.md`.
- **FR-002** The bootstrap names no Specnaut skill, agent, phase, command, or HTML comment. It reads
  as a plain team document.
- **FR-003** The bootstrap carries four principles: domain isolation (ports and adapters),
  dependencies point inward, bounded contexts, and SOLID. Each has at least one `Check:` line, plus
  a one-line note on how to override it per stack. It is ≤ 60 lines.
- **FR-004** `docs/constitution.md` is project-owned. No `upgrade` or `init`, with or without
  `--force`, ever rewrites it once it exists.
- **FR-005** A root `AGENTS.md` managed section `constitution` points to the file. It states that no
  agent edits it on its own initiative, and that a conflict is reported as a stop with a question.
- **FR-006** `upgrade`, and `init` whenever the legacy path exists (lock or not, `--force` or not),
  move `.specnaut/memory/constitution.md` byte-for-byte. They dedupe on identical content, and
  refuse on conflict, on a link, or on non-UTF-8 content. A refusal never lets the default shadow
  the old file, and never orphans it.
- **FR-007** The move runs before the upgrade plan reads disk state, so the defaults never overwrite
  the moved file. For any verdict other than `none`, both paths are excluded from the plan in every
  mode, so `--dry-run` reports "would move" and never `add-new` or an orphan removal.
- **FR-008** Size thresholds live in `.specnaut/size-limits.yml` (project-owned, not shipped). With
  no file, the defaults in `size-limits.md` apply. The `constitution` default is 60 / 100.
  `size-ratchet.sh` and `src/domain/size_limits.ts` read it, pinned by one fixture corpus. An
  unreadable file exits 2.
- **FR-009** The target-surface exception lives in `.specnaut/ui.yml` (`target_surface:`). The
  `mobile-first-contract` names no constitution section.
- **FR-010** Upgrade extracts a non-default legacy `## Size limits` table, or an exact-form
  `### Target surface`, from the moved constitution into the new configs, only if they are absent.
  It never edits the constitution, and it notes that the stale section can be deleted.
- **FR-011** `boundary-check.sh` reads `.specnaut/boundaries.yml` (`domain:`, `forbid:`, `exempt:`).
  Exit codes: 0 clean, 1 violations, 2 unreadable config, 4 skipped with a reason. It is wired into
  `quality-gates.md` with every tier, and ships no default patterns.
- **FR-012** `protect-constitution.sh <claude|codex>` denies writes to `docs/constitution.md` and to
  the three configs through Edit/Write/NotebookEdit, Codex patches, and shell segments that name the
  file. The only exception is a `constitution` approval stamp, minted from the helper's confirmation
  phrase in the user's prompt. With a stamp, Claude asks and Codex allows. It is registered on both
  harnesses.
- **FR-013** `/task constitution` asks for the reason, drafts the change, bumps `Version:`, records
  the reason in the commit body, and writes only after the user types the confirmation phrase. It is
  a prerequisite for no other verb.
- **FR-014** `constitution-template.md` is retired: the manifest entry and the source are removed,
  and the orphan logic deletes a vanilla copy.
- **FR-015** Every shipped reader of `memory/constitution.md` and every `## Size limits` consumer is
  updated, found by search: `git grep -l 'memory/constitution.md'` and `git grep -il 'size limits'`
  (case-insensitive, A-L1) across `templates/ src/ plugin/ scripts/ tests/ README.md
  AGENTS.md`.
  Exclude `.specnaut/specs/`, `UPGRADING.md` history, and the migration modules.
- **FR-016** `specnaut check` and `upgrade` warn when `docs/constitution.md` is over its ceiling.
  Init and upgrade output tell Codex users to re-trust the hooks.

## 4. Success criteria

- **SC-001** A fresh `init` produces a constitution with four principles and their checks, in ≤ 60
  lines.
- **SC-002** On the upgrade fixtures (placeholder, customised, conflict, CRLF-identical, link,
  lossy, preserved), the old file's bytes equal the new file's bytes in every move case, and every
  refusal leaves both files unchanged.
- **SC-003** A second `upgrade` and an `upgrade --force` leave `docs/constitution.md`
  byte-identical.
- **SC-004** No shipped file names `memory/constitution.md` outside the allowlisted migration
  modules (guard test).
- **SC-005** The hook denies on all 4 input shapes (Claude Edit, Claude Bash, Codex patch, Codex
  Bash) without a stamp, and follows the stamp rule with one.
- **SC-006** The boundary gate returns pass, fail, and skip on fixture trees, and no skip ever exits
  0.
- **SC-008** `upgrade --dry-run` on a legacy project prints the move and lists no `add-new` for
  `docs/constitution.md` and no removal of the old path, and it changes nothing on disk.
- **SC-007** The byte delta of always-read content is reported (the new `AGENTS.md` section).

## 5. 🔒 Decision table

| The decision                                                                                                                                                                                                            | Its single home                                                                                                                                                                                                                                                                                         | What would duplicate it                                                                       |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------- |
| Is an exact move safe: target occupied, source a link, bytes not UTF-8 (A-M2)                                                                                                                                           | `judgeExactMove` in `src/domain/exact_move.ts`, called by `carryOne`, `movableContent` and `planConstitutionMove`                                                                                                                                                                                       | the inline checks in `upgrade_addenda_moves.ts` and `upgrade_renames.ts` (removed)            |
| Move, dedupe, bootstrap, or refuse the old constitution                                                                                                                                                                 | `src/domain/constitution_move.ts` (`planConstitutionMove`, extends `judgeExactMove`)                                                                                                                                                                                                                    | inline `exists`/compare logic in `upgrade_project.ts` or `init_project.ts`                    |
| When the move runs: the legacy path exists, in init and in upgrade (A-H2)                                                                                                                                               | `executeConstitutionMove` in `src/application/upgrade_constitution_move.ts`, which returns `{ verdict, notes, exclude }` and writes nothing under dry-run                                                                                                                                               | a "no lock" or "not forced" condition in a caller                                             |
| The legacy path literal                                                                                                                                                                                                 | `LEGACY_CONSTITUTION_PATH` in `src/domain/constitution_paths.ts` (amended 2026-10-29)                                                                                                                                                                                                                   | `".specnaut/memory/constitution.md"` anywhere else in `src/` or tests                         |
| Byte move + bounded delete. (a) `carryOne` in `upgrade_addenda_moves.ts` and the doc mover in `upgrade_renames.ts`; (b) 2 prior uses (#683 docs, #683 addenda); (c) **extract `moveExact`** to its own module           | `moveExact` and `NOT_EXACT` in `src/application/upgrade_exact_move.ts`                                                                                                                                                                                                                                  | a third `write` + `deletePaths` pair                                                          |
| "Never rewritten, even forced" (A-M6)                                                                                                                                                                                   | `TemplateFile.projectOwned`, checked in `keepsProjectFile` (`deno_fs_writer.ts`, net-neutral edit, stale docstring fixed). The manifest carries only `projectOwned`, and `ownershipFields(entry)` in `harness_managed.ts` derives `skipIfExists` from it for all 7 adapter sites                        | an adapter spreading either flag by hand; a second guard in the upgrade plan                  |
| The move runs before the plan reads disk                                                                                                                                                                                | one call in `upgrade_project.ts`, before `diskShas`                                                                                                                                                                                                                                                     | a post-plan fix-up                                                                            |
| A move or refusal keeps both paths out of the plan and the lock (A-M1, A-H3)                                                                                                                                            | each caller's existing filter, fed by `exclude`: upgrade's `refusedDests`/`lockForPlan`; init's `bundleToWrite` loop                                                                                                                                                                                    | a second bundle-and-lock drop inside the executor; the orphan planner special-casing the path |
| The guarded path set and the new path literals (A-M3)                                                                                                                                                                   | `src/domain/constitution_paths.ts` (TS) and `templates/harness-specific/shared/hooks/_paths.sh` (bash); a test asserts the two lists are equal                                                                                                                                                          | literals in the hook, the ratchet, the extractor or `check`                                   |
| The config grammar: narrow block YAML, plus the reject cases (A-M3, A-L4)                                                                                                                                               | one bash reader in `templates/core/specnaut/scripts/bash/_config.sh` beside the ratchet (amended 2026-10-29: the hooks ship to two harnesses, the gates to all), used by the ratchet and `boundary-check.sh`, and one TS reader in `size_limits.ts`; both are asserted on `tests/fixtures/size_limits/` | a second awk reader; a TS fallback to defaults on an unreadable file (TS warns instead)       |
| Size defaults (60/100 for the constitution) (A-M4)                                                                                                                                                                      | `templates/core/specnaut/memory/size-limits.md`, mirrored as constants in `size-ratchet.sh` and `size_limits.ts` and pinned to it by the existing `size_thresholds_single_arbiter_test.ts` (reuse)                                                                                                      | a shipped `size-limits.yml`; numbers in the bootstrap; an unpinned constant                   |
| Reading the size config                                                                                                                                                                                                 | `size-ratchet.sh` (gate) and `src/domain/size_limits.ts` (warnings), pinned by `tests/fixtures/size_limits/`                                                                                                                                                                                            | a ratchet fallback that reads the constitution table                                          |
| Constitution over its ceiling                                                                                                                                                                                           | `constitutionOverCeiling()` in `src/domain/size_limits.ts`, asked by `checkConstitution` and the upgrade warning                                                                                                                                                                                        | a line count in a handler                                                                     |
| Legacy-settings extraction                                                                                                                                                                                              | `src/domain/constitution_legacy_settings.ts`                                                                                                                                                                                                                                                            | contracts or the ratchet still parsing old headings                                           |
| The target-surface exception                                                                                                                                                                                            | `.specnaut/ui.yml`, named by `mobile-first-contract`                                                                                                                                                                                                                                                    | a heading named in the constitution or in `AGENTS.md`                                         |
| Boundary settings and outcomes. (a) `size-ratchet.sh` for the exit-code shape, with no import gate existing; (b) asked by the ticket AC, no prior occurrence; (c) **add a new helper**, data-only config, exit 4 = skip | `templates/core/specnaut/scripts/bash/boundary-check.sh` + `.specnaut/boundaries.yml`                                                                                                                                                                                                                   | patterns in the constitution or in `quality-gates.md`                                         |
| File identity in hooks. (a) `norm`/`names`/patch parsing in `protect-generated.sh`; (b) `protect-generated`, `protect-lock`; (c) **extract** to `_paths.sh`                                                             | `templates/harness-specific/shared/hooks/_paths.sh`                                                                                                                                                                                                                                                     | a copy inside `protect-constitution.sh`                                                       |
| What may write the constitution                                                                                                                                                                                         | `protect-constitution.sh`                                                                                                                                                                                                                                                                               | per-agent prose restating the rule as the only defence                                        |
| The confirmation phrases that mint `constitution` and `gate-config` (S2)                                                                                                                                                | `approval_kind_of` in `approve-on-prompt.sh`, pinned to the helper text by a test                                                                                                                                                                                                                       | the phrase only in `phases/constitution.md`; one kind for all four files                      |
| Which command word and options count as read-only (S1)                                                                                                                                                                  | `protect-constitution.sh` (allowlist + per-command option denylist)                                                                                                                                                                                                                                     | a second allowlist in `_command.sh` or another guard                                          |
| A guarded file changed with no stamp (S1 backstop)                                                                                                                                                                      | the Stop check beside `approve-on-prompt.sh`, hashing at UserPromptSubmit                                                                                                                                                                                                                               | a silent restore; a per-tool re-check                                                         |
| Config value validity (S4)                                                                                                                                                                                              | `src/domain/size_limits.ts` and the ratchet, both pinned by `tests/fixtures/size_limits/`                                                                                                                                                                                                               | an unchecked value in an arithmetic context                                                   |
| A stamp means ask (Claude) or allow (Codex), no stamp means deny                                                                                                                                                        | `approval_require` in `_approval.sh`                                                                                                                                                                                                                                                                    | the deny/ask switch inside the hook script                                                    |
| "Never self-amend; a conflict is a stop"                                                                                                                                                                                | the `constitution` managed section in `templates/core/root/AGENTS.md`                                                                                                                                                                                                                                   | the same sentence in each agent                                                               |
| Which default principles a project lacks (A-L2)                                                                                                                                                                         | `src/domain/constitution_principles.ts`: a principle counts as adopted when its bootstrap `Check:` line, or its heading, is present ignoring case and whitespace                                                                                                                                        | a hard-coded list; matching on exact heading text alone                                       |
| The bootstrap names no Specnaut skill, agent, phase or marker (FR-002)                                                                                                                                                  | `tests/templates/constitution_single_source_test.ts`                                                                                                                                                                                                                                                    | a check in prose only                                                                         |
| One constitution source                                                                                                                                                                                                 | `templates/core/root/docs/constitution.md`, guarded by `tests/templates/constitution_single_source_test.ts`                                                                                                                                                                                             | `constitution-template.md` coming back; a copy under `.claude/` or `.codex/`                  |

## 6. Technical context

Deno/TypeScript CLI with hexagonal layering. Bash hooks run under Git Bash on Windows. The bundle is
generated into `src/templates_bundle.ts`, `plugin/` is re-synced from templates, and the Go port
reads `manifest.json`.

- **Manifest.** The `spec-root` `memory/constitution.md` entry becomes
  `{category:"project-root",
  name:"root", suffix:"docs/constitution.md", source:"core/root/docs/constitution.md",
  skipIfExists:true, projectOwned:true}`.
  Every adapter maps a `project-root` suffix verbatim. `project-root` `.md` files are rendered by
  `applyHarness`/`applyBackend`, so a test asserts the bootstrap carries no conditional marker.
- **Verified in the tree.** The ordering trap: `upgrade_plan.ts` returns `add-new` for a missing
  dest before the `isSkipIfExists` guard, and upgrade writes with `overwrite`. The `--force` gap:
  `keepsProjectFile` returns false whenever `overwrite` is set. Init locks the `skipIfExists` files
  it wrote (`init_project.ts`), which is why a refusal must filter the old path out of the lock.
- **Domain vocabulary.** `ConstitutionMove` (value):
  `none | move | dedupe | refuse-conflict |
  refuse-link | refuse-lossy`, plus
  `bootstrap: boolean`. "Identical" means equal bytes, or a difference only in CRLF or a trailing
  newline.
- **Config formats.** Narrow YAML block form that awk can read. `size-limits.yml`: `file:`,
  `function:` and `constitution:`, each with `target:`/`ceiling:` children, and `exempt:` as a flat
  list. `boundaries.yml`: flat lists `domain:`, `forbid:` (ERE), `exempt:`. `ui.yml`: one scalar.
  Flow maps are rejected (exit 2).
- **Hook Bash reach (amended by S1).** A segment is gated when it names a guarded file, matched
  ignoring case and counting unexpanded `$`, globs and braces as naming it, unless its command is a
  bare allowlisted word: `cat head tail grep wc diff`, or `git diff|log|show|blame|status|add`
  without `-c`, `--output*`, `--ext-diff`, `--textconv` or `add -e/-p/-i`. Also gated: any redirect
  onto a guarded file, and an opaque line (`eval`, `sh -c`, an interpreter's `-c`/`-e`) naming one
  (A-L5): `git commit` messages and branch names that mention the word are not gated, and tests pin
  both. A Stop-time hash check catches every other writer (interpreters, scripts, `git checkout`).

## 7. Constitution check

Against the workspace constitution (`.specnaut/memory/constitution.md` at the monorepo root, which
this ticket does not move; out of scope).

- § I halves: CLI only. ✅
- § XI no consumer trace: invented fixtures only. ✅
- § XII version: minor. The manual steps are re-trusting the Codex hooks and resolving a refused
  move, both printed by upgrade. ✅
- Hexagonal: the decisions are pure domain functions, the executor is in `application`, the writer
  flag is in `infrastructure`, and there is no new port. ✅
- Size gate (A-H1, re-measured 2026-10-29):
  - `upgrade_project.ts` is **555, over the ceiling**. The first task extracts its pre-plan block
    (merge and context-link refusals, `diskShas`) into `upgrade_plan_inputs.ts`. The file must end
    shorter than 555, and the constitution wiring lands in the new module.
  - `init_project.ts` (306) and `fs_project_inspector.ts` (440) are over the target and may not
    grow: an extraction lands before the init wiring, and the inspector ends at ≤ 440.
  - `init_handler.ts` (512, over the ceiling) gets only a net-shrinking message fix.
  - `deno_fs_writer.ts` (300) gets a net-neutral edit.
  - `size-ratchet.sh` (247) is rewritten without growing, and the new modules stay under 300.
  - ✅ with these extractions.
- No aliases: the old path is migrated, not read as a fallback. ✅

## 8. Surface impact

- **Bundle.** New: `root/docs/constitution.md`, `boundary-check.sh`, `protect-constitution.sh` and
  `_paths.sh`. Rewritten: `phases/constitution.md`, `size-limits.md`, `size-ratchet.sh`,
  `mobile-first-contract`, `quality-gates.md`, `root/AGENTS.md` (new section, ui-defaults line), and
  every reader from FR-015. Hook registrations: `claude/settings.json`, Codex `hooks.json` and
  `SHA256SUMS` via `gen-hooks.ts`. Removed: `constitution-template.md` and
  `specnaut/memory/constitution.md`.
- **CLI behaviour.** `init`, `upgrade`, `check` messages, and `init_next_steps`.
- **Source also touched** (A, §4): `init_project.ts`, `init_handler.ts`, `upgrade_renames.ts`,
  `src/domain/template.ts`, `harness_managed.ts`, `hook_trust_note.ts`, `plan-template.md`,
  `tasks-template.md`, and the Go port's manifest decoder.
- **Mirrors.** `plugin/`, `src/templates_bundle.ts`, the golden fixtures, and the Go port tests.
- **Docs.** `UPGRADING.md` gets a new section, including that a project publishing `docs/` as a site
  will publish its constitution. README. Web docs `llms.md` follow in a separate web commit if they
  name the old path.
- **Contracts exposed.** Three project-owned config files and their formats, plus the boundary
  gate's exit codes.
- No front-end surface.

## 9. Risks

| Risk                                                    | Mitigation                                                                                                                                   |
| :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| Defaults overwrite a moved file (ordering)              | Move before `diskShas`; integration test asserting moved bytes after a full upgrade                                                          |
| A refused move orphans and deletes the old file         | Lock filter + bundle drop; test with a lock that tracks the placeholder                                                                      |
| Windows: CRLF on compare, Git Bash hooks                | CRLF tolerance in "identical"; extend `tests/templates/hooks/windows_test.ts`; Windows CI is the gate                                        |
| Codex hook re-hash disarms every guard until re-trusted | Upgrade note already exists (`hook_trust_note.ts`); upgrade-from-7.2 hooks test                                                              |
| Hook false positive blocks a read                       | Read-only allowlist; tests for `cat`, `grep`, `git diff` on the file                                                                         |
| A loosened config disarms its own gate                  | The three configs sit behind the same `constitution` approval                                                                                |
| Existing long constitutions now face 60/100             | Same ratchet rules as every unit: over the ceiling it must shrink when touched. `check`/`upgrade` warn. This is Kevin's "very short" ruling. |
| A `docs/` site publishes the constitution               | `UPGRADING.md` says so                                                                                                                       |

## 10. Architecture audit

`architect-expert`, 2026-10-29. Verdict: fail, 3 HIGH, 6 MEDIUM, 5 LOW.

- **Coverage:** the smells and refactoring leaves in the knowledge base.
- **Counted:**
  - 60 files name `memory/constitution.md`;
  - 23 files name "size limits" (case-insensitive);
  - 7 `skipIfExists` sites across 6 adapters.
- **HIGHs checked against the tree (2026-10-29):**
  - `wc -l` gives 555, 306, 440, 300 and 512 for the files in H1;
  - `init_project.ts:155` skips conflict detection under `--force`;
  - `refusedDests` and `lockForPlan` exist at `upgrade_project.ts:194–252`;
  - `size-ratchet.sh:62–63` carries the defaults as constants.

Every finding is accepted, and each is folded into §3–§8 under its tag:

| ID | Finding                                                                          | Done                                                                                                                                                                                        |
| :- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1 | `upgrade_project.ts` is over its ceiling; init and the inspector are over target | Extract `upgrade_plan_inputs.ts` first; init is extracted before its wiring; the inspector stays at or under 440 (§7)                                                                       |
| H2 | "init with no lock" let `init --force` shadow the old file                       | The trigger is "the legacy path exists" (FR-006, §5)                                                                                                                                        |
| H3 | No dry-run story                                                                 | Exclude both paths in every mode; dry-run says "would move"; SC-008 (FR-007)                                                                                                                |
| M1 | Row 6 rebuilt `refusedDests`                                                     | The executor returns `exclude`, and each caller's existing filter consumes it (§5)                                                                                                          |
| M2 | The move-safety judgement would have a third copy                                | `judgeExactMove` in domain, shared by all three movers; `moveExact` gets its own module (§5)                                                                                                |
| M3 | Path set and grammar have no home                                                | TS and bash path modules with an equality test; one bash and one TS reader on one corpus (§5)                                                                                               |
| M4 | Defaults in Markdown read by two runtimes                                        | Keep the constants, pinned to `size-limits.md` by the existing single-arbiter test (reuse). A `defaults.yml` was rejected as a new shipped file the existing test already makes unnecessary |
| M5 | Configs gated by an amendment-shaped approval                                    | Its own `gate-config` kind and phrase (shared with S2). `ui.yml` stays gated, see §12                                                                                                       |
| M6 | `projectOwned` is a bare boolean at the writer's 300 target                      | The manifest carries `projectOwned` only; `ownershipFields` derives `skipIfExists`; the writer edit is net-neutral (§5)                                                                     |
| L1 | Incomplete search; stale init message                                            | Case-insensitive search (FR-015); net-shrinking fix in `init_handler.ts`; FR-002 guard row                                                                                                  |
| L2 | Notice keyed on exact headings                                                   | Match the `Check:` line or the heading, ignoring case and whitespace (§5)                                                                                                                   |
| L3 | No removal date for the migration modules                                        | Next major (§12)                                                                                                                                                                            |
| L4 | TS on an unreadable file was unspecified                                         | TS warns; reject cases are in the corpus (§5)                                                                                                                                               |
| L5 | The "mentions constitution" rule catches commits                                 | Narrowed to opaque forms, with tests (§6)                                                                                                                                                   |

Not findings, checked: the FR-015 reader sweep (a one-off migration, not shotgun surgery) and the
manifest flag (a value at a boundary, not primitive obsession). Layering was not audited in depth.

**Seat agreement.** On the config gate both seats agree in substance: `gate-config` is a kind of its
own.

## 11. Security audit

`security-expert`, 2026-10-29. Verdict: needs_followup, 0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW.
Coverage: the hooks (`approve-on-prompt`, `_approval`, `_command`, `_simple`, `_git`, `_guard`,
`protect-generated`), both registrations, `size-ratchet.sh`, `deno_fs_writer.ts`,
`fs_containment.ts`, `upgrade_addenda_moves.ts`, and the spec-036 threat model. Codex hook-trust
regeneration and Windows path forms were not assessed. Central claims verified in the tree:
`_simple.sh` reduces the first word to its basename (`v[k]##*/`); `protect-generated.sh` gates
`.specnaut/hooks/` under `merge` only; `size-ratchet.sh` validates values against `(none|[0-9]+)`.
All five findings are accepted.

- **S1 (MEDIUM): the Bash allowlist judges the command name only.** `git --output=`, `-c`,
  `GIT_EXTERNAL_DIFF`, `rg --pre`, a path-qualified `cat`, a function shadowing a command, and globs
  all write the file. **Accepted:**
  - Only a bare command word is allowlisted: no `/`, no `VAR=` prefix, and no function definition on
    the line.
  - Options are refused per command. For git: `-c`, `--output*`, `--ext-diff`, `--textconv`, and
    `add -e/-p/-i`. `rg` is dropped from the allowlist.
  - A non-allowlisted segment with unexpanded `$`, a glob or a brace counts as naming the file, and
    "constitution" is matched ignoring case.
  - The writer-agnostic backstop: `approve-on-prompt.sh` (UserPromptSubmit) hashes the four guarded
    files into the stamp directory, and a Stop check compares them. A change with no matching stamp
    blocks the stop with a question and keeps a copy. It never restores silently, so the user's own
    editor changes survive.
- **S2 (MEDIUM): one stamp unlocks four files, and the guard is editable under `merge`.**
  **Accepted:**
  - There are two kinds, each minted by its own whole-prompt phrase (never a bare yes) and pinned to
    the helper's text by a test: `constitution` for `docs/constitution.md`, and `gate-config` for
    `.specnaut/size-limits.yml`, `boundaries.yml` and `ui.yml`.
  - `protect-constitution.sh`, `_paths.sh` and their registrations require both `merge` and
    `constitution`.
- **S3 (LOW): `boundary-check.sh` input handling.** **Accepted:**
  - Patterns are passed as `grep -E -n -e "$pat" -- "$file"`, and `rg` is never used.
  - Files are listed with `git -c core.quotePath=false --literal-pathspecs ls-files -z -s`; only
    modes 100644 and 100755 are scanned.
  - Any grep exit ≥ 2, or a `domain:` outside the repo, gives exit 2, never 0 or 4.
  - Fixtures cover a non-ASCII name, a `-`-prefixed pattern, and a symlink pointing out of the repo.
- **S4 (LOW): no value checks on the configs or the legacy extraction.** **Accepted.** `target` and
  `ceiling` match `^(none|[0-9]+)$` and are compared only with `[ ]`, never in arithmetic. `exempt`
  and `domain` entries are single-line. `target_surface` is a single line of at most 120 printable
  characters with no newline. Any other value exits 2. The TS reader and the extractor apply the
  same checks, and extraction refuses a value that fails them. All of it is pinned by the shared
  fixture corpus.
- **S5 (LOW): the config writes are not routed through the writer.** **Accepted.** Every config
  write goes through `FsWriter.writeBundle(..., { overwrite: false })`, and existence is read with
  lstat. One test puts a dangling symlink at each config path and asserts that nothing outside the
  project is created.

**Implementation deviations, ruled 2026-10-29:**

- _Hook registrations_ (`.claude/settings.json`, `.codex/hooks.json`) stay under `merge` only. S2
  wanted the `constitution` kind as well. Requiring it would make any edit to the permission rules
  demand the amendment phrase. Both harnesses already put a human in that loop: Claude snapshots
  hooks at session start, and Codex re-asks for trust when `hooks.json` changes. The guard scripts
  themselves (all of `.specnaut/hooks/`) do require both kinds. **Accepted.**
- _Expansion-only words_ (`"$f"`) count as naming a guarded file only when the same line mentions a
  guarded basename. Reading S1 literally would deny every Bash call that uses a variable in auto and
  bypass modes. The Stop backstop catches a variable set in an earlier call. **Accepted.**
- The phrases are `approve the constitution amendment` and `approve the gate config change`.
- _Config grammar (Phase 6)_: a CRLF line end is taken (an autocrlf checkout), any other carriage
  return refused; full-line `#` comments are taken, a trailing one is not stripped and fails the
  value check; a link at a config path is unreadable (it would move the guarded file out of the
  hooks' sight); a limit is `none` or at most nine digits, so `[ -gt ]` cannot overflow.

Not findings, checked: stamp forging on Claude (a limit already accepted in spec 036), hook JSON
parsing (fails closed), subagent minting (blocked), ReDoS (project-owned pattern), and the move's
TOCTOU (needs a concurrent hostile process).

## 12. Open questions

None for the user: Kevin's 2026-10-28 rulings and the ticket settle the scope, the path, and the
size target. Decided here, one line each:

- `preserve.yml` on the old path → move anyway, with a specific note (every reader moves).
- The approval is minted on the helper's confirmation phrase, not on `/task constitution` (Codex
  cannot ask).
- The three configs are gated like the constitution (they were constitution content).
- A deleted `docs/constitution.md` is re-bootstrapped by upgrade (the `AGENTS.md` precedent).
- The vanilla 300/500 constitution row is dropped. 60/100 applies to existing files under the usual
  ratchet rules.
- The migration modules (`constitution_move.ts`, `constitution_legacy_settings.ts`, and the guard's
  legacy-path allowlist) are removed at the next major release (A-L3).
- The `gate-config` kind also covers `ui.yml`, even though the architect called it a product setting
  (A-M7). Security outranks maintainability here: an unchecked config is still a write the user did
  not ask for.
- The boundary gate ships no default patterns: a guessed default would be a fake pass.
- The ticket's Codex matcher `apply_patch` → keep the shipped `Edit|Write` registration, which is
  what Codex emits and what `protect_generated_test.ts` pins.
