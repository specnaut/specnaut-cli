# Follow-ups from the epic #674 reviews

Item: #719. Brief, not a full plan: no line of the risk threshold fires (§ 2, Surfaces).

## 1. Task and out of scope

Close the live findings the #674 reviews left, each one a checkbox on #719, so that:

- a PowerShell script whose probe failed says so, without crying wolf on a normal answer;
- the branch-naming twins give the same slug for the same description;
- a refusal is typed wherever a caller has to tell it from a failure;
- the oversized functions and files meet their limits, and dead code goes rather than being split.

**Out of scope:** new findings met on the way (filed separately, list in § 4), reopening the source
issues, and renaming existing branches. The naming change applies to new branches only.

**Where the tree overrides the item** (its body says the tree wins):

- `Resolve-TemplateContent` has no caller, so it is deleted rather than split. That meets its
  ceiling and catch checkboxes; the checkbox walk records it.
- The `pruneStaging` sentence on the `admitRemoval` item does not match the tree: `FsStagingStore`
  never reaches `admitRemoval`. The typed refusal is tested where it is thrown.

## 2. Guardrails

### Decision table

| The decision                              | Its single home                                                                                                                                                                                                                                                                                                                                     | What would duplicate it                                                                                            |
| :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| What a path refusal is                    | `src/application/path_refusal.ts`, moved from `domain/`, because the error belongs with the port contract beside `read_fault.ts`; documented on `FsReader`, `FsWriter` and `StagingStore` in `ports.ts`                                                                                                                                             | a second base class; `instanceof ContainmentRefusal \|\| UnwalkableRefusal` in a caller                            |
| Refusing to remove the project directory  | a `projectDirectoryRefusal` factory in `src/infrastructure/fs_refusals.ts`, returning a plain `PathRefusal`                                                                                                                                                                                                                                         | a new subclass; a plain `Error`; a `ContainmentRefusal`, whose doc says a reader may report it instead of aborting |
| What removes an emptied staging folder    | `pruneEmptyParents` in `src/infrastructure/fs_prune.ts`                                                                                                                                                                                                                                                                                             | the `while` loop in `FsStagingStore.delete`                                                                        |
| What `hostRefusal` calls "cannot be read" | `src/application/init_bundle_filter.ts`: any `readText` throw that is not a `PathRefusal`. `ReadFault` belongs to `readEntry` alone; `read_fault.ts` and `ports.ts` are narrowed to say so                                                                                                                                                          | `instanceof ReadFault` around `readText`                                                                           |
| How a new branch is slugged               | `branch-naming.sh` and its twin `branch-naming.ps1`, held to one scenario list in a new sibling of `tests/scripts/create_new_feature_number_reuse_test.ts`                                                                                                                                                                                          | a third slug rule; expected values that differ per twin                                                            |
| The size-limit value parser               | `toLimit` in `src/domain/size_limits.ts`, exported                                                                                                                                                                                                                                                                                                  | the `limit` copy in `constitution_legacy_settings.ts`                                                              |
| Which skills are routers, in tests        | `routers()` in `tests/templates/verb_table.ts`; population from `grep` for the predicate's shape (6 hits at audit time, not all swaps: report which were swapped and why the others were not)                                                                                                                                                       | a hand-written predicate where populations are equal                                                               |
| The smoke scaffold preamble               | one helper in `scripts/smoke/_common.sh`; population from `grep` for the trap, bootstrap and init trio (7 scripts at audit time: agents, backlog-local, contracts, features, gates, hooks, task). Adopted where it matches verbatim; the count is reported. It sets `DIR` and the trap in the caller's shell, so it is never called inside `$(...)` | a copy in any matching script                                                                                      |
| How a PowerShell warning reaches stderr   | `[Console]::Error.WriteLine("WARNING: ...")`, the idiom `common.ps1` uses for `ERROR:`                                                                                                                                                                                                                                                              | `Write-Warning` in new code: measured, it lands on stdout with ANSI codes under `pwsh -File`                       |
| What a failed git probe is                | one probe function in `common.ps1`, warning once per process                                                                                                                                                                                                                                                                                        | a `try`/`catch` around `git` in `Get-RepoRoot`, `Get-CurrentBranch` or `Test-HasGit`                               |
| The registry reader, PowerShell           | one function in `template-resolution.ps1`, extracted from `Resolve-Template`                                                                                                                                                                                                                                                                        | the parse left inline                                                                                              |

The smoke helper extends the existing owner (`_common.sh`), and its recurrence is the seven copies.
The registry reader is an extraction inside one file, and the git probe replaces three catches, so
neither adds a helper in the sense of the reuse bar. Neither takes code, an executable path or argv.

### Deleted

`Resolve-TemplateContent` and `Get-Python3Command` (its only caller), bash
`resolve_template_content` (204 lines, also over the ceiling), and `Test-DirHasFiles` (no caller,
its lines pay for the git probe under `common.ps1`'s limit), plus the comments naming them
(`template-resolution.ps1:3`, `common.ps1:317`, `common.sh:385`, `template-resolution.sh:89`).
Checked by whole-tree grep: only definitions and comments remain. The PowerShell composition path
cannot work today either (`Get-Python3Command` returns a string, so `$pyCmd[0]` is `'p'`, measured
by the architecture seat). `Resolve-Template`, the live one, stays. A consuming project's own script
is the one thing a grep cannot see; the function is undocumented, and the commit body names the
removal.

### Settled, from the item's body

| Input                                          | Result                                                                                                  |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `Fix UI in cli`                                | `fix-ui-cli`, on bash 3.2, with nothing on stderr                                                       |
| `fix ui in cli`                                | `fix-cli`, on both twins (`-cmatch`)                                                                    |
| `foo -- bar baz`                               | cleans to `foo-bar-baz` under BSD sed                                                                   |
| `HAS_GIT` in `create-new-feature.ps1`'s output | absent, in JSON and in text. The field on `Get-FeaturePathsEnv` stays: `Test-FeatureBranch` gates on it |

### The warning rule

Return values never change. Only stderr does.

| Situation                          | Stderr                                                 |
| :--------------------------------- | :----------------------------------------------------- |
| `.git` absent, git present         | quiet                                                  |
| git not on PATH, `.git` absent     | quiet: guard with `Get-Command`, as `Test-HasGit` does |
| Unborn HEAD                        | quiet                                                  |
| git on PATH, cannot start          | warns                                                  |
| `.git` present, git not on PATH    | warns                                                  |
| `.git` present, git exits non-zero | warns, with no parsing of git's text                   |
| Malformed `.registry`              | warns, once, from the extracted reader                 |
| Empty `.registry`                  | quiet                                                  |

**A new warning's text is fixed.** A constant sentence naming the probe, plus at most a constant
project-relative path, an exit code, or `$_.Exception.GetType().Name`. It never interpolates `$_`,
`$_.Exception.Message`, captured native stderr, file content, a registry key or an environment
value. Remote-touching git calls keep `2>$null`.

### Staging cleanup

The walk in `FsStagingStore.delete` becomes `pruneEmptyParents(dirname(full), stagingDir, notes)`.
`NotFound` is a clean stop, anything else is a note naming the folder, a link stops the walk, and it
never throws. `delete` throws only when the staged copy is still there, and returns
`Promise<string[]>` notes. `pruneStaging` appends them; `reconcile` carries them on its `ok` result
and still returns ok, because the project file, backup and lock are already committed. A tidy
failure never says "safe to delete by hand". `stagingStore.list`'s abort on a linked staging root is
fail-closed and stays.

### `hostRefusal`

A `PathRefusal` is worded as a refusal, without "make it readable", because on a link out an agent
could act on that by copying the target in. Everything else keeps "cannot be read". Both still hold
the block back. `readText` stays raw, as `fs_reader_entry_test.ts` pins; the fakes that throw
`ReadFault` from it stop, and the two that fail `readText` and `readEntry` with one error split
(`failing` in `init_bundle_filter_test.ts`, the reader in `upgrade_plan_inputs_test.ts`).

### Sizes

`wc -l` at `61e905f5`; target 300, ceiling 500 by default. A function's target and ceiling are 30
and 50.

| File                                                    | Now | What must hold                                                          |
| :------------------------------------------------------ | --: | :---------------------------------------------------------------------- |
| `templates/core/specnaut/scripts/powershell/common.ps1` | 319 | ends at or below 319; `Get-CurrentBranch` (55) ends at or below 50      |
| `.../powershell/template-resolution.ps1`                | 296 | shrinks by the deletion; `Resolve-Template` (62) ends at or below 50    |
| `.../bash/template-resolution.sh`                       | 295 | shrinks by the deletion                                                 |
| `.../powershell/create-new-feature.ps1`                 | 367 | shrinks by the `HAS_GIT` lines                                          |
| `src/application/ports.ts`                              | 300 | docs edited in place or paid for                                        |
| `src/domain/size_limits.ts`                             | 300 | `export` on one line; no docstring line added                           |
| `scripts/smoke/smoke-audit.sh`                          | 432 | does not grow: the new part is sourced from inside `_audit_meta_564.sh` |
| `scripts/smoke/_audit_meta_564.sh`                      | 342 | ends at or below 300                                                    |
| `scripts/smoke/smoke-features.sh`                       | 410 | shrinks                                                                 |
| `tests/scripts/create_new_feature_number_reuse_test.ts` | 291 | not touched: scenarios go in a new sibling                              |
| `scripts/bundle-templates.ts`                           | 294 | the `FMT_LINE_WIDTH` check stays within 6 lines                         |

The rest have room: `_common.sh`, `_audit_smoke_scans.sh`, `smoke-contracts.sh`, `smoke-agents.sh`,
`branch-naming.{sh,ps1}`, `fs_containment.ts`, `constitution_legacy_settings.ts`,
`fs_phase_routing_checks.ts`, `fs_staging_store.ts`, `fs_refusals.ts`, `init_bundle_filter.ts`,
`reconcile_path.ts`, `fs_reader_entry_test.ts`.

### Constitution

- **§ I, § XI:** tests and fixtures use invented names; nothing here names a private half or a
  consuming project.
- **§ IV:** one half, plus the pointer commit at the root.

### Surfaces

PowerShell stderr text; `create-new-feature.ps1`'s output losing `HAS_GIT`; the slug of a new branch
for some descriptions; four unused functions removed from shipped scripts (three PowerShell, one
bash); `reconcile`'s result gaining notes; internal types and one message. Plugin mirrors and the
bundle regenerate.

**Surfaces added or widened: none.** Checked against every step 4b line: stored data and auth
(untouched); secrets (warnings are fixed text); untrusted input (`.registry` parsed at the same
site, slug still `[a-z0-9-]` on both twins); external service and dependency (none); files in a
consuming project (same files, `admitRemoval` refuses the same paths); agent instruction surface
(none); public interface (`HAS_GIT` leaves one PowerShell script's output, its bash twin never had
it, and no reader exists in the tree; a consumer's own wrapper is the residual risk, named in the
commit body).

## 3. Done, as runnable checks

Each group is a commit by scope; every commit carries `Refs #719`, the last `Closes #719`.

| Requirement                 | Check                                                                                                                                                                                                                                                                                                                                                                  |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every checkbox on #719      | walked one by one against the tree before landing                                                                                                                                                                                                                                                                                                                      |
| Warning rule                | a test per row of the table, dot-sourcing `common.ps1` and calling the functions. `.git` file holding `gitdir: /nowhere`; an unrunnable `git` stub is POSIX only, with the reason stated. Whole-script quiet is not asserted: the existing `Write-Warning` on stdout is out of scope                                                                                   |
| Warning text                | the registry fixture holds a malformed key carrying a marker and an ESC; stderr holds the sentence, and neither the marker nor the ESC                                                                                                                                                                                                                                 |
| Function ceiling            | every function in each touched `.ps1` at or under 50, by `Parser::ParseFile` and `FunctionDefinitionAst`; `resolves()` by an `awk` extent                                                                                                                                                                                                                              |
| `_audit_meta_564.sh` target | at or below 300, with no assertion lost: `audit.sh --since main` reports 0 gaps and 0 stale                                                                                                                                                                                                                                                                            |
| Slug scenarios              | three scenarios on both twins, with stderr asserted empty on bash; `/bin/bash` on darwin and `bash` elsewhere, with a guard asserting 3.2 on darwin                                                                                                                                                                                                                    |
| `HAS_GIT`                   | a test asserts its absence from JSON and text output                                                                                                                                                                                                                                                                                                                   |
| Typed refusal               | "a path that lands on the project directory itself is refused" asserts `PathRefusal`, and not `ContainmentRefusal`, for `up/proj` only (`.` and `a/..` stop at `assertSafeDestination`, a plain `Error`); same for `readEntry`. `FsStagingStore`'s judge does not change. Nothing in `src` catches this type on a reachable path today: the checkbox walk records that |
| Staging cleanup             | real store with a parent the walk cannot remove (mode 0o300, POSIX only, reason stated): the copy goes and the folder stays; `reconcile` returns ok with the note; `pruneStaging` names the folder, not the copy, and never says "safe to delete by hand"                                                                                                              |
| `checkAddenda`              | no `ContainmentRefusal` in `fs_phase_routing_checks.ts`; `addenda_symlink_test.ts` stays green                                                                                                                                                                                                                                                                         |
| Windows skips               | the two unexplained skips in `fs_reader_entry_test.ts` run on Windows, or each states why it has to stay; the Windows CI job is read after landing                                                                                                                                                                                                                     |
| #706 item 2                 | a stored test where a renamed emit path turns the emitted-agent check in `constitution_first_test.ts` red                                                                                                                                                                                                                                                              |
| Red-probes                  | each new test is observed red with a live mutant                                                                                                                                                                                                                                                                                                                       |
| Whole                       | `deno task test`, `deno fmt --check`, `deno lint`, shellcheck, smoke suite, Go parity; read in a separate call before landing                                                                                                                                                                                                                                          |

## 4. Audit findings

### Architecture (`architect-expert`, verdict fail, 7 HIGH, all fixed in this brief)

Claims I checked myself: no caller of `Resolve-TemplateContent`, by grep; `Write-Warning` on stdout
under `pwsh -File`, by running it; the three catches and `FsStagingStore`'s route, by reading.

- **Accepted:** delete the dead function and its twin; row and idiom for stderr; the warning rule
  table; move the typed-refusal test to where it is thrown; reuse `pruneEmptyParents`; the size
  table; the runnable ceiling check; the population greps; narrowing `ReadFault`'s docs; darwin's
  3.2 guard; the stored red-probe row.
- **Accepted in part:** a factory rather than a new subclass, because nothing would read one.
  Rejected returning `ContainmentRefusal`: see Security.

### Security (`security-expert`, verdict needs_followup, 2 MEDIUM, 1 LOW)

Does not cross the threshold, and no containment refusal is weakened.

- **Accepted:** `delete` throwing after success (same finding as architecture); fixed warning text;
  the typed-refusal test's seam; dropping "make it readable" from the refusal wording.
- **The seats disagreed** on the refusal's type: the architecture seat proposed a factory returning
  `ContainmentRefusal`, the security seat a subclass of `PathRefusal`, since `ContainmentRefusal`'s
  doc lets a reader report it instead of aborting. Security wins that point and maintainability wins
  the other: a factory returning a plain `PathRefusal` gives both, with no unread class and no
  inherited licence.

### File separately

- The existing `Write-Warning` on stdout at `common.ps1:162` and `create-new-feature.ps1`, which
  puts text ahead of `-Json` output in a non-git directory.
- `Find-SpecifyRoot` searches for `.specify`, which nothing creates.
- `FsStagingStore.delete` judges one file and acts on another under a linked staging subfolder
  (`assertStagingNotLinked` checks the top two levels). With `a -> /outside/dir` in the staging tree
  and `/outside/dir/b/tool` linking back into the project, deleting `a/b/tool` is judged inside and
  unlinks `/outside/dir/b/tool`, outside the project (measured).
- Existing `$_` interpolations in warnings, in `common.ps1`, `branch-naming.ps1` and
  `create-new-feature.ps1`.

## 5. Open questions

None. The branch-naming question is settled on the item, and nothing here changes what a user has to
do.
