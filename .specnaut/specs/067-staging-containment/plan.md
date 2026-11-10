# Staging deletes stay in the staging folder, and an unreadable one does not abort the upgrade

**Branch**: `067-staging-containment` | **Base**: `origin/main` at `e42e4910` | **Date**: 2026-11-10

Items:

- specnaut-cli#751 `FsStagingStore.delete` judges one file and acts on another under a linked
  staging subfolder — https://github.com/specnaut/specnaut-cli/issues/751
- specnaut-cli#753 `pruneStaging` aborts the upgrade on an unreadable staged subfolder —
  https://github.com/specnaut/specnaut-cli/issues/753

**Shape: full plan.** Step 4b fires on one line: **files deleted in someone else's project** (#751
decides which paths `FsStagingStore.delete` may unlink and which folders the cleanup after it may
remove). #753 alone would be a brief, and it is planned here because it touches the same prune.

**One commit per item**: `fix(staging): …` for #751, then `fix(upgrade): …` for #753. They share no
file, so the order does not matter. Both are `fix`, so no `## Agent adoption` section is needed.

The worktree has no `docs/constitution.md`. This repository's binding rules are in `AGENTS.md`, and
the workspace constitution applies on top of it. Code is cited by symbol. Line numbers are hints.

## 1. Task and out of scope

### What the user gets

- **#751.** `specnaut reconcile <path>` deletes the staged copy, and nothing else. Suppose a folder
  inside `.specnaut/upgrade-staging/` is a link that leads somewhere else. Then the delete refuses,
  says why, and leaves everything in place, in the project and outside it. The empty-folder cleanup
  that follows never removes a folder whose real location is outside the staging folder.
- **#753.** Suppose `upgrade` cannot read a staged subfolder. It reports that as one line, then
  finishes: the managed sections, the deletes and the lock write all still happen. The stale copies
  stay in place until the next run. A staging folder reached through a link still aborts, as it does
  today.

### Verified on this base (`e42e4910`, 2026-11-10)

I ran a scratch script against the worktree's own sources, in a temp directory outside the repo.

- **#751 still exists.** The layout:
  - `upgrade-staging/a`, a link to `<tmp>/outside/dir`;
  - `<tmp>/outside/dir/b/tool`, a link to a file in the project.

  `FsStagingStore.delete(proj, "a/b/tool")` returned `[]` and raised no refusal. Afterwards
  `outside/dir/b/tool` and `outside/dir/b` were gone. The project file survived, and so did the link
  `upgrade-staging/a`.
  - The cause is in `FsStagingStore.delete` (`src/infrastructure/fs_staging_store.ts`). It judges
    `full` with `assertInsideProject`, which follows every link through `locate(…, "target")` and
    ends at the project file. Then `Deno.remove(full)` unlinks the entry the path names, which lies
    outside the project.
  - #719 has landed. The cleanup is now `pruneEmptyParents(dirname(full), <staging>, notes)` in
    `src/infrastructure/fs_prune.ts`. Its containment test is `isInside`, which compares path text,
    so it removed `outside/dir/b`. Its symlink stop (cli#665) is why the link `a` survived, which
    the issue reported as removed before #719. **The defect survived the move**, as the issue
    predicted.
- **#753 still exists.** Take a staging tree that holds a `chmod 000` subfolder `locked/` next to a
  readable `stale.md`. `pruneStaging(new FsStagingStore(), …)` throws `PermissionDenied`, and the
  message names `readdir '<abs>/.specnaut/upgrade-staging/locked'`. The cause:
  `await stagingStore.list(projectDir)` sits in the `for … of` header of `pruneStaging`
  (`src/application/upgrade_staging.ts`), outside its `try`. `FsStagingStore.list` runs
  `assertStagingNotLinked` and then the `walk`, and the walk is what throws. Both callers,
  `applyUpgrade` (`upgrade_apply.ts`) and `finishUpToDate` (`upgrade_up_to_date.ts`), await it with
  no handling. In `applyUpgrade` the prune runs before `applyManagedSections`, `deletePlanned` and
  `lockStore.write`.

### Out of scope

- **Links at the top two levels** (`.specnaut`, `.specnaut/upgrade-staging`).
  `assertStagingNotLinked` already refuses them, unchanged.
- **`FsStagingStore.read`.** I reviewed it (finding R3 in § 9) and left it unchanged: it removes
  nothing, and the issue asks for its own reason.
- **`FsStagingStore.list` and `ListPendingReconciliationsUseCase`.** The settled fix for #753
  handles the error at the caller, and `list` is untouched.
- **Changing the deliberate abort on a linked staging root.**
- **`DenoFsWriter.deletePaths`'s own checks.** The prune bound in FR-004 applies to it too, because
  the walk is shared, but its admission checks are not changed.
- **The containment sweep charging `deletePaths`'s `Deno.remove` to `writeEntry`** (observation O1,
  § 9). It goes to the backlog, and this change does not fix it.

## 2. User scenarios

### US1: a linked staging subfolder is refused, not followed (P1)

**Given** `.specnaut/upgrade-staging/a` is a link to a folder outside the project, and a lock key
names `a/b/tool` **When** `specnaut reconcile a/b/tool` reaches `FsStagingStore.delete` **Then** the
delete throws a `PathRefusal` that names the path. Nothing outside the staging folder is unlinked or
removed, and the refusal reaches the caller.

### US2: a link that leads elsewhere inside the project is refused too (P1)

**Given** `upgrade-staging/a` is a link to the project's own `src/` **When**
`delete(proj, "a/b/tool")` runs **Then** it refuses, and `src/b/tool` survives. Without the staging
bound this case deletes a user file inside the project. Only a check against the project would let
that through.

### US3: an ordinary staged copy still goes (P1)

**Given** a staged copy at `upgrade-staging/.claude/agents/x.md` in plain folders **When** it is
deleted **Then** the copy and its emptied parents go, the staging root stays, and a second delete
returns `[]`.

### US4: an unreadable staged subfolder does not abort the upgrade (P1)

**Given** `upgrade-staging/locked/` cannot be read **When** `specnaut upgrade` runs, both on a
project that is already current and on one with file work **Then** the result carries one line that
names the staging folder and the folder it could not read. Nothing in the staging tree is deleted,
and the lock is written.

### US5: a linked staging root still aborts (P1)

**Given** `.specnaut/upgrade-staging` or `.specnaut` is a link **When** the prune runs **Then**
`pruneStaging` rejects with the "reached through a symlink" refusal, as it does today.

### Edge cases

- **A staged leaf that is itself a link** (`upgrade-staging/x.md`, a link to a file outside).
  Specnaut never stages a link. `planStaging` stages only `preserve`/`customized` actions, and a
  link dest is planned by `linkAction` (`src/domain/link_plan.ts`), which has no `preserve` arm. A
  declared preserve comes earlier and carries `reason: "declared"`, so it is not staged either. A
  link there is therefore not a staged copy. It stays as #687 left it: left in place, its target
  untouched, the case reported. It is now judged by `lstat` of the entry, not by where the target
  lands.
- **A delete of a path that is already gone** returns `[]`, as before (`NotFound`).
- **A link inside staging that leads to another folder inside staging.** The real parent is inside
  the real staging folder, so the delete is admitted. The prune removes only real folders inside it,
  then stops at the link.
- **A listing that fails for a reason other than permission** (an I/O fault, `NotADirectory`). Every
  error that is not a `PathRefusal` becomes the same refusal line. See D-6.

## 3. Requirements

| Id     | Requirement                                                                                                                                                                                                                                                   | Item |
| :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--- |
| FR-001 | `FsStagingStore.delete` judges the entry it removes: ancestors resolved, the last path component left as is (`assertRemovableInProject`). It no longer calls `assertInsideProject` on that path.                                                              | #751 |
| FR-002 | `delete` refuses, with a `PathRefusal`, unless the entry's resolved location is **strictly inside** the real staging folder. Nothing is unlinked or removed when it refuses.                                                                                  | #751 |
| FR-003 | `delete` refuses a leaf that is itself a link (`lstat`), with the same refusal. That keeps #687's observable behaviour without following the link.                                                                                                            | #751 |
| FR-004 | `pruneEmptyParents` never removes a folder whose real path is not strictly inside the real `stopAt`. This holds for **every** caller: `FsStagingStore.delete` and `DenoFsWriter.deletePaths`, enumerated by `grep -rn "pruneEmptyParents(" src`.              | #751 |
| FR-005 | A staged copy in ordinary subfolders is still deleted, its emptied parents still go, and a repeat delete returns `[]`.                                                                                                                                        | #751 |
| FR-006 | The containment sweep counts `assertRemovableInProject` as a guard, so `FsStagingStore.delete` is still seen as guarded with no exclusion line and no comment written only to satisfy it.                                                                     | #751 |
| FR-007 | A listing error that is not a `PathRefusal` comes back from `pruneStaging` as one refusal line. The line names `.specnaut/upgrade-staging/` and the error, whose text names the folder it could not read. No `delete` is attempted, and the function returns. | #753 |
| FR-008 | A `PathRefusal` from `list` (`linkedStagingRefusal`) still propagates out of `pruneStaging`.                                                                                                                                                                  | #753 |
| FR-009 | `pruneStaging`'s doc comment states both: listing is best-effort, and the linked-root refusal is the one deliberate abort.                                                                                                                                    | #753 |
| FR-010 | FR-007 holds on both callers, `applyUpgrade` and `finishUpToDate`. Both reach it through `pruneStaging` itself, with no handling at either call site.                                                                                                         | #753 |

## 4. Success criteria

- **SC-001**: the issue's layout ends with the outside link, the outside folder, the staging link
  and the project file all still present, and the caller gets a refusal.
- **SC-002**: an upgrade over an unreadable staged subfolder finishes on both paths, reports the
  folder, and records the new version in the lock.
- **SC-003**: every staging and containment test that passes on `e42e4910` still passes. The one
  exception is the assertion named in § 5, row "Leaf link", whose wording changes.
- **SC-004**: every new assertion was seen red, either on the base or under the mutant named for it.

### Requirement → test

The existing fixtures are reused: `withTempDir`/`seed`
(`tests/infrastructure/fs_staging_store_test.ts`), `symlinkTest`, `makeLink`, `CAN_LINK` and
`WINDOWS` (`tests/helpers/link_text.ts`), `RUNS_AS_ROOT` (`tests/helpers/posix_modes.ts`),
`fakeStagingStore` (`tests/application/upgrade_fakes.ts`), and the `InitProjectUseCase` plus
`UpgradeProjectUseCase` harness from `tests/application/upgrade_context_link_test.ts`.

| Req                                    | Test                                                                                                                                                                                                                                                                                                                                                                                | File                                                                                                                                                 | Red on                                                                                                 |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| FR-001, FR-002, SC-001                 | The issue's layout. `delete` rejects with a `PathRefusal`. `outside/dir/b/tool` (lstat), `outside/dir/b`, `upgrade-staging/a` and the project file all survive.                                                                                                                                                                                                                     | new `tests/infrastructure/staging_linked_subfolder_test.ts` (`symlinkTest`)                                                                          | base                                                                                                   |
| FR-002                                 | `upgrade-staging/a`, a link to the project's `src/`. `delete(…, "a/b/tool")` rejects, and `src/b/tool` survives.                                                                                                                                                                                                                                                                    | same file                                                                                                                                            | the mutant that drops the staging bound (FR-001 alone stays green here)                                |
| FR-002, the refusal reaches the caller | The issue's layout run through `ReconcilePathUseCase.execute` (fake reader, writer and lock, real `FsStagingStore`). It rejects with the store's refusal.                                                                                                                                                                                                                           | same file                                                                                                                                            | base                                                                                                   |
| FR-003                                 | The existing "a staged link leaving the project is left alone, its target untouched, and said" test. Its `"leaves the project"` assertion becomes the new refusal's wording, and every other assertion stays.                                                                                                                                                                       | `tests/application/upgrade_staging_refusal_test.ts`                                                                                                  | the mutant that drops the leaf-link check                                                              |
| FR-004                                 | `pruneEmptyParents(<staging>/a/b, <staging>, notes)` with `a` a link to an outside folder that holds an empty `b`. The outside `b` survives, and `notes` is empty.                                                                                                                                                                                                                  | new `tests/infrastructure/fs_prune_real_bound_test.ts` (`symlinkTest`). Not added to `deno_fs_writer_prune_test.ts`, which is over its target (201). | base                                                                                                   |
| FR-004, no regression                  | "the walk still prunes when the project is reached through a symlink" stays green.                                                                                                                                                                                                                                                                                                  | `tests/infrastructure/deno_fs_writer_prune_test.ts` (unchanged)                                                                                      | n/a                                                                                                    |
| FR-005                                 | A nested copy: the copy and its emptied parents are gone, the staging root remains, and a second delete returns `[]`.                                                                                                                                                                                                                                                               | `tests/infrastructure/fs_staging_store_test.ts` (one test added)                                                                                     | positive control. Under the mutant that judges the parent and not the real parent, it must stay green. |
| FR-006                                 | The sweep stays green with `delete` guarded only by `assertRemovableInProject`.                                                                                                                                                                                                                                                                                                     | `tests/infrastructure/containment_sweep_test.ts`                                                                                                     | removing `assertRemovableInProject` from `delete` makes the sweep list `delete`                        |
| FR-007                                 | Fake `list` rejects with `Deno.errors.PermissionDenied("… 'locked'")`. The result is exactly one line containing `.specnaut/upgrade-staging/` and `locked`, and `delete` is never called.                                                                                                                                                                                           | `tests/application/upgrade_staging_refusal_test.ts` (runs on every OS)                                                                               | base                                                                                                   |
| FR-008                                 | Fake `list` rejects with a `PathRefusal`, and `pruneStaging` rejects with that same error.                                                                                                                                                                                                                                                                                          | same file (runs on every OS)                                                                                                                         | the mutant that catches every error                                                                    |
| FR-008                                 | Tightened. It currently uses `.catch((err) => [String(err)])`, so a refusal returned as a line would still pass, and the test cannot tell an abort from a line. It becomes `assertRejects(…)` plus the existing "reached through a symlink" text.                                                                                                                                   | `tests/infrastructure/staging_linked_root_test.ts` (`ignore: !CAN_LINK`, so it runs on windows-latest)                                               | the mutant that catches every error                                                                    |
| FR-007, FR-010, SC-002                 | A real project with `upgrade-staging/locked/` set to `0o000` and a readable `upgrade-staging/stale.md`. It is run twice through `UpgradeProjectUseCase`: once on the same bundle (`up-to-date`) and once on a changed bundle (`applied`). Each run asserts the status, one refusal naming `locked`, the lock's `templatesVersion` equal to the run's, and `stale.md` still present. | new `tests/application/upgrade_staging_unreadable_test.ts` (`ignore: WINDOWS \|\| RUNS_AS_ROOT`)                                                     | base                                                                                                   |
| FR-009                                 | Read at review. A doc comment has no test.                                                                                                                                                                                                                                                                                                                                          | `src/application/upgrade_staging.ts`                                                                                                                 | n/a                                                                                                    |

**Windows.** The permission-bit tests (US4 end to end) register `ignore: WINDOWS || RUNS_AS_ROOT`,
the pattern `staging_tidy_failure_test.ts` already uses, and say why in their header. Windows has no
POSIX mode that makes a folder unreadable, since `Deno.chmod` does not apply there, and root reads
through any mode. The skip is a registered `ignore`, never an early return. The FR-007 and FR-008
classification is still exercised on windows-latest, through the fake-store tests and the tightened
linked-root test (`!CAN_LINK`). The #751 link layouts use `symlinkTest`, which is ignored on
Windows. That is the gap `tests/helpers/link_text.ts` already states ("Containment is not covered on
Windows"). This change does not widen it.

## 5. 🔒 Decision table

| #   | The decision                                                                                                                                                   | Its single home                                                                                                                                                                                                                                                                                                                                                                                                                                   | What would duplicate it                                                                                                                                                                                |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | A staging delete removes only the entry itself (ancestors resolved, last path component as is), only strictly inside the real staging folder, and never a link | `src/infrastructure/fs_staging_store.ts`. `delete` calls `assertRemovableInProject` inline, then one private helper (for example `assertPlainStagedEntry(root, full)`) for the staging bound and the leaf-link check. The real staging folder is `join(root, STAGING_REL)`, which is sound because `assertStagingNotLinked` has already refused a link at either level.                                                                           | `assertInsideProject` on the deleted path; a `startsWith(stagingDir)` on `full`; a second staging check in `pruneStaging` or `ReconcilePathUseCase`; a new `Deno.realPath(dirname(full))` in the store |
| D-2 | How "the entry, not its target" is resolved                                                                                                                    | `src/infrastructure/fs_containment.ts`, reused as is: `assertRemovableInProject` and `resolvedRelative`, the pair `DenoFsWriter.deletePaths` already uses for its `within` bound (cli#665). **The file does not change**: at 228 lines it is over its target.                                                                                                                                                                                     | a second `"entry"` landing; a local `resolveDeepestExisting` call in the store                                                                                                                         |
| D-3 | The words for a staged path that is not a plain staged copy                                                                                                    | `src/infrastructure/fs_refusals.ts`: one new factory (for example `stagedEntryRefusal(root, abs, resolved)`), a `ContainmentRefusal`. Being a `PathRefusal`, it makes `pruneStaging` use `leftAlone`'s wording, which says to remove the link itself, never its target.                                                                                                                                                                           | an inline `new PathRefusal(…)` in the store; reusing `linkedStagingRefusal`, whose words describe the root                                                                                             |
| D-4 | The empty-folder walk never removes a folder whose real path is outside the real `stopAt`                                                                      | `src/infrastructure/fs_prune.ts` `pruneEmptyParents`. It resolves `stopAt` once and each candidate before its `readDir`. If a candidate is outside, or equal to `stopAt`, the walk returns without a note, as the symlink stop does. The bound sits in a small helper, so the function stays under its 20-line target.                                                                                                                            | a bound computed by each caller; a second walk in the store; a flag that makes the bound optional                                                                                                      |
| D-5 | What the containment sweep counts as a guard                                                                                                                   | `tests/infrastructure/containment_sweep_test.ts` `unguardedSinks`. It accepts `assertInsideProject` **or** `assertRemovableInProject` (one alternation).                                                                                                                                                                                                                                                                                          | an exclusion line for `FsStagingStore::delete`; a comment that names `assertInsideProject` only so the sweep finds the text                                                                            |
| D-6 | A listing failure is a refusal line, and a `PathRefusal` from listing aborts                                                                                   | `src/application/upgrade_staging.ts` `pruneStaging`. It wraps the `list` call: it rethrows `PathRefusal`, and returns `[line]` for anything else, skipping both the deletes and `tidyStagingRoot`. The type is the test, as `refusalLine` and `tidyStagingRoot` already use it.                                                                                                                                                                   | a `try` at `applyUpgrade` or `finishUpToDate`; `FsStagingStore.list` swallowing walk errors; matching on the message (`"symlink"`, `PermissionDenied`)                                                 |
| D-7 | The wording of the listing-failure line                                                                                                                        | `src/application/upgrade_staging.ts`, beside `refusalLine` and `tidyStagingRoot`. For example: `could not list .specnaut/upgrade-staging/ (<error>); its stale copies stay until the next run`. Not "safe to delete by hand": a listing that failed cannot say what is there.                                                                                                                                                                     | a second phrasing in a handler or a caller                                                                                                                                                             |
| D-8 | No new script or helper                                                                                                                                        | **(a)** Inventoried: `assertRemovableInProject`, `resolvedRelative`, `locate`, `admitRemoval`, `pruneEmptyParents`, `refusalFor`, `leftAlone` and `refusalLine`. **(b)** `pruneEmptyParents` is extended for the third time (cli#665 added the symlink stop, cli#719 moved staging onto it), so its owner is the home. **(c)** The outcome: _reuse directly_ the containment pair, and _extend the existing helper at its owner_ (`fs_prune.ts`). | a staging-only copy of the prune walk; a new containment function in `fs_containment.ts`                                                                                                               |

**Why D-1 and D-4 are not two deciders.** They answer two different questions. D-1 asks whether this
entry may be unlinked. D-4 asks whether this folder may be removed.

With D-1 alone the walk would already stay inside staging, and the reason is this. The walk starts
from an admitted parent and stops at the first link. Below that link, every folder it reaches is a
real ancestor of the admitted parent. The real staging root is never empty while a link is under it.

That argument is subtle, and `deletePaths` reaches the same walk with only a project-level
admission. So D-4 makes the bound a property of the walk, and it is tested on its own (FR-004).

**Leaf link (FR-003).** I decided this here; see § 12. `assertRemovableInProject` alone would admit
`upgrade-staging/x.md -> /outside/file` and remove the link, which is harmless and consistent with
#669. It would also change #687's observable "left in place and reported" behaviour, which
`upgrade_staging_refusal_test.ts` pins. Specnaut never stages a link, so refusing one costs nothing.
Only the wording assertion changes: the refusal now describes the entry, not its target's escape.

## 6. Technical context

**Language/Version**: TypeScript on Deno (`deno.json`). **Testing**: `deno test` with the task's
flags. **Target Platform**: macOS, Linux and Windows. CI runs all three. **Project Type**: CLI.
**Performance**: no hot path. FR-004 adds one `realPath` per pruned level, and the walk is a few
levels deep, once per deleted copy. **Storage**: the consumer project's `.specnaut/upgrade-staging/`
only.

The Go port (`internal/reconcile`) only reads the staging tree for `reconcile --status`. It neither
deletes nor prunes, so it does not change. `parity/` drives the TS binary on `reconcile-path.txtar`,
whose ordinary staged delete must stay green.

### Domain model

No new entities. **Vocabulary:** a _staged copy_ is a regular file Specnaut wrote under
`.specnaut/upgrade-staging/`. The _real staging folder_ is
`join(resolveProjectRoot(dir), STAGING_REL)`. The _entry_ is a path with its folders resolved and
its last component left as is. **Invariant:** no staging operation unlinks or removes anything whose
real location is outside the real staging folder.

## 7. Constitution check

| Principle                                                                                         | Verdict | Note                                                                                                                                                                                      |
| :------------------------------------------------------------------------------------------------ | :------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size limits (`.specnaut/size-limits.yml` plus the bundled defaults: file 200/500, function 20/50) | pass    | See the table below. `fs_containment.ts` (228), `deno_fs_writer_prune_test.ts` (201) and `sink_containment_test.ts` (230) are over target and are not touched. New tests go to new files. |
| `AGENTS.md`: consumer agnosticism (workspace § XI)                                                | pass    | Fixtures use invented names only (`a/b/tool`, `outside/dir`, `locked/`, `stale.md`).                                                                                                      |
| `AGENTS.md`: layering                                                                             | pass    | The error classification stays in `application/` (it reads the port's `PathRefusal` type), and containment stays in `infrastructure/`. No adapter is imported by a use case.              |
| `AGENTS.md`: a new assertion is shown red by mutating the code                                    | pass    | Every row in § 4 names its red state: the base or a named mutant.                                                                                                                         |
| `AGENTS.md`: run tests with the task's permissions                                                | pass    | `--allow-read --allow-write --allow-run --allow-env`, never `-A` (`link_text.ts` refuses to load under `-A`).                                                                             |
| Workspace § I: public repo                                                                        | pass    | No private-half names.                                                                                                                                                                    |
| Workspace § IV: cross-cutting change                                                              | pass    | One half, then the pointer commit at the root.                                                                                                                                            |
| Workspace § IX: dogfooding                                                                        | pass    | Observation O1 and finding R3 go to the backlog through the `product-owner`, and are not worked around.                                                                                   |

### Files touched

`wc -l` measured on `e42e4910`.

| File                                                    | Lines now | Lines after (est.) | Over target? | Responsibility                                             |
| :------------------------------------------------------ | --------: | -----------------: | :----------- | :--------------------------------------------------------- |
| `src/infrastructure/fs_staging_store.ts`                |       106 |               ~125 | no           | the private staged-entry helper (D-1)                      |
| `src/infrastructure/fs_prune.ts`                        |        51 |                ~62 | no           | the real-bound helper (D-4)                                |
| `src/infrastructure/fs_refusals.ts`                     |       116 |               ~130 | no           | `stagedEntryRefusal` (D-3)                                 |
| `src/application/upgrade_staging.ts`                    |       145 |               ~162 | no           | the listing catch, the doc comment and the line (D-6, D-7) |
| `tests/infrastructure/containment_sweep_test.ts`        |       197 |              ≤ 199 | no           | one alternation (D-5)                                      |
| `tests/infrastructure/containment-exclusions.txt`       |        28 |                 28 | no           | the `pruneEmptyParents` reason now names the real bound    |
| `tests/infrastructure/fs_staging_store_test.ts`         |        74 |                ~90 | no           | —                                                          |
| `tests/infrastructure/staging_linked_root_test.ts`      |        44 |                ~46 | no           | —                                                          |
| `tests/application/upgrade_staging_refusal_test.ts`     |        64 |                ~95 | no           | —                                                          |
| `tests/infrastructure/staging_linked_subfolder_test.ts` |       new |               ~110 | no           | the #751 layouts                                           |
| `tests/infrastructure/fs_prune_real_bound_test.ts`      |       new |                ~45 | no           | the prune bound in isolation                               |
| `tests/application/upgrade_staging_unreadable_test.ts`  |       new |               ~120 | no           | #753 end to end on both paths                              |

### Complexity tracking

None.

## 8. Surface impact

| Surface                                | Touched?                                | What changes                                                                                                                                                                                                              |
| :------------------------------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `specnaut reconcile <path>`            | yes                                     | It may now fail with a staged-entry refusal where it used to delete through a link. The project file and the lock are already committed by then (`ReconcilePathUseCase`). See R2.                                         |
| `specnaut upgrade`                     | yes                                     | One new refusal line, in place of an abort on an unreadable staged subfolder, and refusals from a delete under a linked subfolder. The JSON and text result shapes are unchanged: refusals are already a list of strings. |
| `specnaut init` and the other commands | yes, through `DenoFsWriter.deletePaths` | `pruneEmptyParents` gains the real bound. Its behaviour is unchanged on any tree with no link leading out.                                                                                                                |
| Templates, bundle, plugin mirror       | no                                      | No file under `templates/` or `plugin/` changes, so there is no bundle regeneration to commit.                                                                                                                            |
| Go port and parity                     | no                                      | See § 6.                                                                                                                                                                                                                  |

**Surfaces added or widened: none.** I checked each kind of trust boundary:

- no new command, flag, argument or file input;
- no new path a consumer can name (lock keys reach `delete` as before, and `assertSafeDestination`
  is kept);
- no dependency, network call or agent surface;
- deletions in the consumer's project are **narrowed**: fewer paths can be unlinked, and fewer
  folders pruned;
- #753 replaces an abort with a reported line, and deletes nothing it did not delete before.

## 9. Risks

| #  | Risk                                                                                                                                                                                                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                        |
| :- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 | The real bound in `pruneEmptyParents` changes the shared walk under `deletePaths` and can stop a legitimate prune. One example: a project reached through a link, and `realPath(stopAt)` against `realPath(current)` compared on two spellings.                                                                                                 | Both sides go through `Deno.realPath`, as `resolveProjectRoot` does. `deno_fs_writer_prune_test.ts` "…reached through a symlink" and the whole prune suite stay green. A `NotFound` from `realPath` is the walk's existing "already gone" return. |
| R2 | `ReconcilePathUseCase` reads the staged copy (`read`, judged by its target), writes the project file and the lock, and only then calls `delete`. Under a linked subfolder the new refusal arrives after those writes.                                                                                                                           | This is what the issue asks for ("the refusal reaches the caller"). Nothing outside staging is touched. **R3** is the follow-up that would refuse at `read` and make the failure arrive before any write.                                         |
| R3 | `FsStagingStore.read` follows the whole path (`assertInsideProject`), so a linked subfolder lets `reconcile` read a project file as if it were the upstream copy.                                                                                                                                                                               | Out of scope by the issue's rule. It is recorded as a reason for a follow-up item: `read` should share D-1's staging bound, so `read` and `delete` agree. The item is filed through the `product-owner` at landing.                               |
| R4 | The listing catch hides a real defect behind a line.                                                                                                                                                                                                                                                                                            | Only errors that are not a `PathRefusal` become a line. The line carries the error text. Nothing is deleted on that path, and the next run retries.                                                                                               |
| R5 | A fix that catches every error would quietly turn the linked-root abort into a line, and today's `staging_linked_root_test.ts` would stay green.                                                                                                                                                                                                | That test is tightened to `assertRejects`, with a red-probe (the catch-all mutant).                                                                                                                                                               |
| R6 | The leaf-link refusal changes one assertion's wording. A reviewer could read that as a regression.                                                                                                                                                                                                                                              | Stated in § 5 and in the commit body: the assertion was keyed to the target-based message, and the behaviour it pins (left in place, target untouched, reported) is kept.                                                                         |
| O1 | Observation, outside this scope. `unguardedSinks` does not recognise `deletePaths`'s multi-line signature (a `=` in the `within` callback type), so its `Deno.remove` is charged to `writeEntry`, which is excused. The sweep passes `deletePaths` for the wrong reason. I reproduced the attribution with the sweep's own regex on `e42e4910`. | Filed through the `product-owner` as a sweep defect, not fixed here. D-5 does not depend on it.                                                                                                                                                   |

## 10. Architecture audit

Ran 2026-11-10 on `e42e4910`. Every finding accepted; the "What was done" column is **binding on the
implementer** and overrides § 3–§ 7 where they differ.

| #  | Finding                                                                                           | What was done                                                                                                                                                                                                                                                          |
| :- | :------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 | HIGH — `pruneEmptyParents` is already 22/20 lines; D-4 as written grows it                        | D-4 becomes a zero-growth edit: line 37's lexical `isInside` is replaced by one call to the real-bound check, which resolves `stopAt` itself; function size row added to § 7 and reported before → after                                                               |
| A2 | MEDIUM — a blanket sweep alternation admits a link-following write guarded only by an entry check | The sweep's accepted guard depends on the sink: `remove` / `rename` accept `assert(Inside\|Removable)InProject`; every other sink still requires `assertInsideProject`. Self-test case: a `writeTextFile` guarded only by `assertRemovableInProject` is still reported |
| A3 | MEDIUM — D-4 would add a second real-path containment check outside `fs_containment.ts`           | D-4 reuses the exported `locate(realStopAt, current, "entry")`, continuing only on `"inside"` and a path different from `realStopAt`; `fs_containment.ts` does not change                                                                                              |
| A4 | MEDIUM — the listing catch pushes `pruneStaging` past 20 lines                                    | A module-level `listStaged(store, dir): Promise<string[] \| string>` beside `tidyStagingRoot` holds D-6 (rethrows a `PathRefusal`, returns the D-7 line otherwise); `pruneStaging` grows ≈ 1 line                                                                      |
| A5 | MEDIUM — D-1's staging-bound comparison unspecified; a sibling prefix would pass                  | The comparison is `rel.startsWith(STAGING_REL + "/")` (or `isInside` on absolute paths plus not-equal). FR-002 test: a link to `.specnaut/upgrade-staging-old/`, red under the mutant without the trailing `/`                                                         |
| A6 | LOW — US1 surfaces `leavesRefusal`'s words, not the new refusal's                                 | D-3 names which refusal each case produces; the US1 test asserts that wording; the stale header of `fs_refusals.ts` is corrected                                                                                                                                       |
| A7 | LOW — make the staged-entry check reusable by `read` (R3)                                         | `assertPlainStagedEntry` is a module-level function beside `assertStagingNotLinked`                                                                                                                                                                                    |

**Verdict**: fail on A1 (a predicted size violation), fixed by the zero-growth edit; A2–A7 folded.
Coverage: D-1–D-8, FR-001–FR-010, § 7 sizes, layering of the 5 touched modules, the sweep's guard
logic.

## 11. Security audit

Ran 2026-11-10 on `e42e4910`, separately from § 10. Every finding accepted.

| #  | Finding                                                                                 | What was done                                                                                                                                                                                                                                   |
| :- | :-------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 | LOW — check and remove are separate path calls (TOCTOU); § 6's invariant overstates     | The invariant and D-1's doc comment say "for the layout on disk at check time; a concurrent writer inside staging is out of scope (Deno has no dirfd-relative unlink)"; the check stays the last await before `Deno.remove`; no faked-race test |
| S2 | LOW, undetermined — no Windows / junction coverage of the new bound                     | One Windows-only test (`ignore: !WINDOWS`): `cmd /c mklink /J` at `upgrade-staging/a` pointing outside; `delete` rejects with a `PathRefusal` and the outside file survives                                                                     |
| S3 | LOW — the D-4 bound must fail closed on every `realPath` error, inside the walk's catch | D-4 and R1: any resolution failure ends the walk with no removal (a note for anything but `NotFound`), never a lexical fallback; order lstat stop → resolve current → bound → readDir → remove on the same `current`                            |
| S4 | INFO — never `realPath` the staging folder for the bound                                | D-1's "what would duplicate it" lists `realPath(join(projectDir, STAGING_REL))`                                                                                                                                                                 |

**Verdict**: needs_followup, nothing CRITICAL/HIGH. Closes #751 for every on-disk layout at any
depth; D-6 cannot swallow the linked-root abort. Coverage: `delete`, both `pruneEmptyParents`
callers, `pruneStaging`'s two callers, the refusal classes.

## 12. Open questions

No business question is open. Both items carry decisions the PO settled. #753's arm ("a permission
error while listing becomes a refusal line, and the upgrade finishes; a linked staging root still
aborts") was settled on 2026-11-06. #751's acceptance criteria fix the behaviour.

| Question | Answer | Date |
| :------- | :----- | :--- |
| —        | —      | —    |

### Decided here

- **The staging bound is decided in the store (D-1), reusing `assertRemovableInProject` and
  `resolvedRelative`.** That is the pair `deletePaths` uses for cli#665. I rejected a new
  containment function in `fs_containment.ts`, which is over its size target.
- **The leaf-link refusal is kept (FR-003).** Specnaut never stages a link, and keeping #687's
  observable behaviour costs one wording assertion. I rejected "remove the link, as #669 allows": it
  changes a pinned behaviour for no user gain.
- **The prune bound applies to every caller (D-4).** I rejected an opt-in flag: it is two behaviours
  of one walk, and `deletePaths` has the same lexical exposure.
- **The sweep accepts `assertRemovableInProject` (D-5).** I rejected an exclusion line and a comment
  written only to be found: both would hide a real guard behind a text match.
- **Every listing error that is not a `PathRefusal` becomes the line, not only `PermissionDenied`
  (D-6).** The doc comment's best-effort reason covers every failure, which is how the delete branch
  already behaves. I rejected matching the error class, which would make the abort depend on which
  errno the OS picks.
- **On a listing failure, `tidyStagingRoot` is skipped.** The folder is known not to be readable, so
  a second line would only repeat it.
- **`read` stays unchanged (R3), and O1 goes to the backlog.** Both are reported, not folded in, per
  the issue's out-of-scope rule.

## 13. Done, as runnable checks

All of these run from `/Users/kevin/Sites/specnaut-wt-cli-067`.

1. One test file at a time, with the task's flags:
   `deno test --allow-read --allow-write --allow-run --allow-env <file>`, for each file in § 4.
2. Red-probes. Each mutant in § 4 is applied, shown to parse (`deno check src/main.ts`), seen red,
   and reverted:
   - `delete` back on `assertInsideProject`;
   - the staging bound dropped;
   - the leaf-link check dropped;
   - the prune bound dropped;
   - `assertRemovableInProject` removed from `delete` (the sweep);
   - a catch-all in `pruneStaging`.

   The #753 tests are also seen red on `e42e4910` before the fix.
3. `deno task test`. This is `bundle` plus the full suite with the task's flags. Its result is read
   in its own call, never chained with `land.sh`. Then `git status --porcelain` must be empty: no
   template changes, so the regenerated `src/templates_bundle.ts` must be byte-identical.
4. `deno fmt --check`, `deno lint` and `deno check src/main.ts` (the pre-commit hook, run on every
   commit).
5. `go build ./cmd/specnaut && go test ./parity/...`. The parity harness is CI-only, and
   `reconcile-path.txtar` exercises `delete`.
6. Size: `wc -l` on every row of § 7. No file exceeds its estimate past its target, and none of the
   three over-target files changes.
7. Both commits land through `scripts/land.sh cli 067-staging-containment` from the monorepo root,
   with output logged to a file. Then the root pointer commit.
