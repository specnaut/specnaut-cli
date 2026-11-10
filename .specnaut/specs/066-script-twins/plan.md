# The bash and PowerShell script twins agree, and say what failed on stderr in fixed text

Items, one epic-style brief, one commit each:

- specnaut-cli#755 `check_dir` in `bash/common.sh` looks unused —
  https://github.com/specnaut/specnaut-cli/issues/755
- specnaut-cli#756 Bash `clean_branch_name` keeps a newline from `--short-name` —
  https://github.com/specnaut/specnaut-cli/issues/756
- specnaut-cli#750 `Find-SpecifyRoot` searches for a `.specify` folder nothing creates —
  https://github.com/specnaut/specnaut-cli/issues/750
- specnaut-cli#757 `Resolve-Template` uses a disabled preset's template when the registry is empty
  or all disabled — https://github.com/specnaut/specnaut-cli/issues/757
- specnaut-cli#754 The Bash twin stays silent on a failed git probe and a malformed `.registry` —
  https://github.com/specnaut/specnaut-cli/issues/754
- specnaut-cli#749 PowerShell `Write-Warning` puts text ahead of `-Json` output in a directory with
  no git — https://github.com/specnaut/specnaut-cli/issues/749
- specnaut-cli#752 Existing PowerShell warnings interpolate `$_` —
  https://github.com/specnaut/specnaut-cli/issues/752

Base: `origin/main` at `e42e4910`; the prerequisite #719 is on it (`b2b7cf05`, "a PowerShell git or
registry probe that failed says so on stderr"). Brief, not full plan: see § 2, Surfaces, for the one
line the security seat is asked to rule on.

All scripts live under `templates/core/specnaut/scripts/{bash,powershell}/`; paths below are
relative to it unless they start with `tests/`, `src/` or `scripts/`.

## 0. Ground truth on this base (2026-11-10)

Every defect was re-run on `e42e4910`, `/bin/bash` 3.2 and pwsh 7.6.5, in throwaway directories.
**None is fixed by #719.** What #719 changed, and what the tree adds to the items:

| Item | Still on this base                                                                                                                                                                                                                                                            | What the tree adds or contradicts                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| :--- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #755 | yes: `git grep check_dir` outside the bundle finds only the definition, `common.sh` line 382, and one hit in `src/templates_bundle.ts`. `check_file` has its caller in `check-prerequisites.sh`                                                                               | `Test-DirHasFiles` is gone from `common.ps1` (removed by `b2b7cf05`)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| #756 | yes: `clean_branch_name $'foo\nbar'` prints `foo\nbar`; `create-new-feature.sh --dry-run --json --short-name $'foo\nbar'` answers `BRANCH_NAME "001-foo\nbar"`, pwsh `001-foo-bar`                                                                                            | the description path (no `--short-name`) already agrees on a newline (`001-export-invoices-daily` in both)                                                                                                                                                                                                                                                                                                                                                                                             |
| #750 | yes: a project at `<tmp>/sub` with `.specnaut/` inside a parent git repository at `<tmp>` resolves `get_repo_root` and `Get-RepoRoot` to `<tmp>`, and `create-new-feature.sh --dry-run` answers `SPEC_FILE <tmp>/.specnaut/specs/001-x/plan.md` (now observed, not only read) | no `.specify` reader or writer in `src/`; no `$HOME/.specnaut` reader or writer in `src/`; the only callers of root resolution are `create-new-feature.{sh,ps1}` and `get_feature_paths` / `Get-FeaturePathsEnv` (so `setup-plan`, `check-prerequisites`). See D-3 for the git consequence                                                                                                                                                                                                             |
| #757 | yes: `{"presets":{}}` and `{"presets":{"a":{"enabled":false}}}` → bash `rc=1`, nothing; pwsh returns `presets/a/templates/x.md`                                                                                                                                               | `Resolve-TemplateContent` / `resolve_template_content` no longer exist (removed by `fcbcdbff`): that AC is discharged by their absence. New: the twins also disagree on registries that parse as JSON but not as a registry, see FR-757-3                                                                                                                                                                                                                                                              |
| #754 | yes: a `.git` file reading `gitdir: /nonexistent` → bash quiet, pwsh `WARNING: git exited 128 reading this repository; continuing without git`. A malformed `.registry` → bash quiet, pwsh warns                                                                              | new: on an **unborn HEAD** `get_current_branch` prints git's own stderr (localised) and returns `HEAD` with status 128, where pwsh is quiet and returns the latest feature or `main` (`powershell_warning_rule_test.ts`, "an unborn HEAD")                                                                                                                                                                                                                                                             |
| #749 | yes: `create-new-feature.ps1 -Json` with no git starts stdout with `ESC[33;1mWARNING: [specify] Warning: Git repository not detected...`; `setup-plan.ps1 -Json` and `check-prerequisites.ps1 -Json` do the same through `Test-FeatureBranch`                                 | **contradicts the AC as written for `setup-plan`**: with or without git, `setup-plan.ps1 -Json` **and** `setup-plan.sh --json` print `Plan already exists at ... — left untouched` (or `Copied plan template to ...`) on stdout before the JSON. Moving the warning alone does not make that stdout parse. Nothing in the tree reads those lines (`git grep "left untouched"`). The `template-resolution.ps1` site the item names no longer exists: #719 replaced it with `[Console]::Error.WriteLine` |
| #752 | yes: a branch `001-demo/MARKERZX9` makes `create-new-feature.ps1 -Number 1 -ShortName demo` fail with git's `cannot lock ref ... 'refs/heads/001-demo/MARKERZX9' exists`, and that text, marker included, is printed                                                          | the sweep finds two sites the item does not name: `$switchBranchError` printed in `create-new-feature.ps1` (the epic-branch switch and the `-AllowExistingBranch` switch). The `feature.json` parse error quotes only the parser's position, not the file content: a marker there does not reach the output, so it cannot be the red test                                                                                                                                                              |

## 1. Task and out of scope

The outcome, in the user's terms: **the same input gives the same answer from both twins, a
`-Json`/`--json` stdout is JSON and nothing else, and a failure is said once, on stderr, in text the
script wrote — never in text a repository, a parser or a committer wrote.**

### #755 — remove `check_dir`

- Task: re-run the whole-tree search; with no caller, delete `check_dir` from `common.sh`.
- Out of scope: any other helper in `common.sh`; `check_file` stays.

### #756 — a newline in `--short-name` becomes `-`

- Task: `clean_branch_name` maps every character outside `[a-z0-9]`, newline included, to `-`, as
  `ConvertTo-CleanBranchName` does.
- Out of scope: the other branch-naming differences settled on #719.

### #750 — the root walk looks for `.specnaut`

- Task: in both twins the upward search looks for a `.specnaut` directory, nearest wins, and the
  function is renamed (`find_specnaut_root` / `Find-SpecnautRoot`). Fallbacks stay git, then the
  script's location, in that order. The comments on `get_repo_root` / `Get-RepoRoot`, and the two
  "prioritize .specify over git" comments in `create-new-feature.{sh,ps1}`, say what the code does.
- Out of scope: other `specify` / `spec-kit` wording, unless a changed line carries it (the
  `[specify]` prefix of notices stays).

### #757 — a registry that parses decides, even when it enables nothing

- Task: three registry states, the same in both twins: parsed (search exactly its enabled presets,
  possibly none), absent or blank (directory order), malformed (directory order). `Resolve-Template`
  stops treating "parsed, nothing enabled" as "absent".
- Out of scope: the warning on a malformed registry (#754 owns the bash one; #719 shipped the
  PowerShell one); the bash arm with `python3` absent (directory order, no PowerShell equivalent).

### #754 — the bash twin warns where the PowerShell twin warns

- Task: a bash git probe with `Invoke-GitProbe`'s rule, and a warning on a malformed `.registry`
  with `Get-RegistryPresetIds`' rule: fixed text, stderr, once per run; normal "no" stays quiet; no
  warning prints git's stderr.
- Out of scope: warnings beyond what the PowerShell twin warns on; the disabled-preset difference
  (#757).

### #749 — `-Json` stdout is JSON in a directory with no git

- Task: every PowerShell `Write-Warning` in these scripts becomes a `[Console]::Error.WriteLine` of
  the bash twin's exact line; `setup-plan` prints its status line on stderr in JSON mode, in both
  twins (D-7). The "Git repository not detected" notice still reaches the user, on stderr.
- Out of scope: what a notice says; the `$_` text (#752); `Write-Error` decoration.

### #752 — printed errors carry fixed text, at most an exception's type name

- Task: in `common.ps1`, `branch-naming.ps1` and `create-new-feature.ps1`, every printed warning or
  error is fixed text plus at most `$_.Exception.GetType().Name`, as `Invoke-GitProbe` does. The
  sweep of the whole PowerShell directory is recorded in the commit body, each hit fixed or kept
  with its reason.
- Out of scope: stdout vs stderr (#749); the bash twin. **Not covered by any item:**
  `create-new-feature.sh` prints `$branch_create_error` and `$switch_branch_error`, git's own
  stderr, the same defect class on the bash side. Reported at the stop as a follow-up candidate, not
  built here (§ 6).

## 2. Requirements → the test that proves it

Every new assertion is shown red on this base (or by mutating the line it guards) before it is
trusted. "Both twins" means one scenario list run against `bash` (`/bin/bash` on darwin, as
`branch_slug_twins_test.ts` pins) and `pwsh`, through the existing `tests/scripts/pwsh_arm.ts`
(`PWSH_AVAILABLE`, `guardPowerShellArm`, which fails CI if pwsh is missing) and the hermetic `run` /
`git` of `tests/scripts/git_sandbox.ts`. Expected values are written once per scenario, never per
twin, as `branch_slug_twins_test.ts` does. Paths are compared in `/` form (`slashes`) and with `//`
collapsed: bash's preset glob yields `presets/a//templates/x.md`.

| FR       | Requirement                                                                                                                                             | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-755-1 | No `check_dir` anywhere in the shipped tree; `check_file` still defined and called                                                                      | enumerated by `git grep -n check_dir` (zero hits, bundle included, after `deno task bundle`) and `git grep -n check_file` (definition + `check-prerequisites.sh`); no new test. `deno task test` green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| FR-756-1 | `--short-name $'foo\nbar'` gives `001-foo-bar` from both twins                                                                                          | a new row in `SCENARIOS` of `tests/scripts/branch_slug_twins_test.ts`: `{ label: "a newline in the short name becomes a hyphen", input: { description: "anything", shortName: "foo\nbar" }, slug: "foo-bar" }`. Red on bash today                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FR-750-1 | Nearest `.specnaut` wins, in both twins                                                                                                                 | new `tests/scripts/repo_root_twins_test.ts`: each scenario runs `get_repo_root` / `has_git` (bash, sourcing `common.sh`) and `Get-RepoRoot` / `Test-HasGit` (pwsh, dot-sourcing `common.ps1`) from the same cwd, with the scripts installed at `<project>/.specnaut/scripts/`, and prints `RESULT` lines as `powershell_warning_rule_test.ts` does. Rows: (a) project at a git root → root = project, `has_git` true; (b) project in a subfolder of a parent git repository → root = the subfolder, `has_git` false (D-3), **red on this base**; (c) no `.specnaut` above cwd, cwd in a git repo → the git top level; (d) cwd in a subdirectory of the project (`<project>/src/deep`) → the project |
| FR-750-2 | Both twins give the same root from the same start                                                                                                       | the same file: one expected value per row, asserted for each twin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FR-750-3 | `create-new-feature` writes the nested project's spec under the project                                                                                 | the same file: row (b) also runs `create-new-feature.{sh,ps1} --dry-run --json` and asserts `SPEC_FILE` starts with the subfolder. Red on this base                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| FR-750-4 | Comments describe the code                                                                                                                              | review: `git grep -n '\.specify\|spec-kit.s own marker'` over `scripts/` returns nothing on the changed functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FR-757-1 | A registry that parses and enables nothing searches no preset, in both twins                                                                            | new `tests/scripts/template_resolution_twins_test.ts`, `resolve_template` / `Resolve-Template` on one fixture (a preset `a` holding `templates/x.md`), rows: `{"presets":{}}` → none; `{"presets":{"a":{"enabled":false}}}` → none (**red on pwsh today**); `{}` → none (red on pwsh today)                                                                                                                                                                                                                                                                                                                                                                                                         |
| FR-757-2 | Malformed, absent and blank registries take directory order, in both twins                                                                              | the same file: `{not json` → `a`; no `.registry` → `a`; empty and blank (`"  \n"`) → `a`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FR-757-3 | JSON that is not a registry is malformed, in both twins (D-5)                                                                                           | the same file: `[]` and `{"presets":[]}` → `a` (directory order), plus a `{"presets":{"a":{}}}` row → `a` (default enabled) and a priority row (`zeta` priority 5 beats `alpha`) as a positive control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| FR-757-4 | The bash arm's `python3` is present where the scenarios run                                                                                             | the file asserts `python3` on PATH when `CI=true`, as `guardPowerShellArm` does for pwsh; elsewhere the bash arm is skipped with a printed note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| FR-754-1 | A malformed registry: one fixed-text warning per run on stderr, directory order still applies; blank stays quiet                                        | `template_resolution_twins_test.ts`: resolving twice in one process gives exactly one `WARNING:` line on each twin, the same line; a key `MARKER-\u001b[31m` reaches neither stderr. Red on bash today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| FR-754-2 | A `.git` git cannot read, or `.git` with git not on PATH: one fixed-text warning per run; the script carries on as today                                | new `tests/scripts/git_probe_twins_test.ts`, the rows of `powershell_warning_rule_test.ts` (`.git` absent with and without git; unborn HEAD; git that cannot start, POSIX only; `.git` with git not on PATH; `.git` git exits 128 on; a repository with a commit), each run against both twins with the same expected `RESULT` lines and warning count. The 128 and not-on-PATH rows are red on bash today                                                                                                                                                                                                                                                                                          |
| FR-754-3 | Once per **run**, not per function call                                                                                                                 | the same file, at entry-script level: `setup-plan.{sh,ps1} --json` and `create-new-feature.{sh,ps1} --json --dry-run` in a project whose `.git` reads `gitdir: /nowhere` print exactly one `WARNING:` line. This row is what catches the bash subshell trap (D-6)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FR-754-4 | A normal "no" stays quiet, including an unborn HEAD                                                                                                     | the same file: unborn HEAD → stderr empty on both twins, branch = the latest feature directory (or `main`), not `HEAD`. Red on bash today (git's stderr, `HEAD`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| FR-754-5 | No warning prints git's stderr                                                                                                                          | the same file: the `gitdir: /nowhere` row asserts `nowhere` is absent from stderr on both twins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| FR-749-1 | In a directory with no git, `-Json` stdout parses as JSON under `pwsh -File`, for `create-new-feature.ps1`, `setup-plan.ps1`, `check-prerequisites.ps1` | new `tests/scripts/json_stdout_twins_test.ts`: each script run through `pwsh -File` (and its bash twin with `--json`), `JSON.parse(stdout)` of the **whole** stdout, never its last line. Rows: no git; no git with `-Timestamp -Number 5`; no git with a short name long enough to truncate; `setup-plan` with and without an existing plan, in a git repository too (D-7). Red today for every pwsh row, and for the bash `setup-plan` rows                                                                                                                                                                                                                                                       |
| FR-749-2 | The "Git repository not detected" notice still reaches the user, on stderr                                                                              | the same file: stderr contains `[specify] Warning: Git repository not detected` for the no-git rows, on both twins, the same line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FR-752-1 | Warnings and errors in the three files print fixed text, plus at most the exception's type name                                                         | new `tests/scripts/powershell_fixed_text_test.ts`: a branch `001-demo/MARKERZX9` in a repository with a commit, then `create-new-feature.ps1 -Json -Number 1 -ShortName demo demo`: exit non-zero, stderr names the failure, and `MARKERZX9` appears in neither stream. Red on this base (observed)                                                                                                                                                                                                                                                                                                                                                                                                 |
| FR-752-2 | The epic and `-AllowExistingBranch` switches print no git text                                                                                          | the same file: an existing branch `001-demo` with an uncommitted change that blocks the checkout, carrying the marker in the conflicting file's **path**; `-AllowExistingBranch`: the marker reaches neither stream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| FR-752-3 | The sweep is complete                                                                                                                                   | the commit body carries the output of `grep -nE '\$_[^.A-Za-z]\|\$_$\|\$\(\$_\)\|\$[A-Za-z]+Error\.Trim' powershell/*.ps1` before and after, and the reason for each hit kept (pipeline `$_` in `ForEach-Object` / `Where-Object` is not printed text)                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Whole-run assertions:** after #749 the comment heading
`tests/scripts/powershell_warning_rule_test.ts` ("whole-script quiet is not asserted, because
`Write-Warning` elsewhere ... lands on stdout") is untrue; that commit rewrites it. `lastJson` in
`branch_slug_twins_test.ts` and the last-line parse in `create_new_feature_truncation_test.ts` keep
working and are left alone: the new test is the one that parses the whole stdout.

## 3. Guardrails

### Decision table

Twins mean two spellings by design. The rule each pair implements is decided in **one** place, named
below, and the twin scenario file is what holds the second spelling to it. A difference between the
twins outside that file's scenarios is the defect a reviewer greps for.

| The decision                                                         | Its single home                                                                                                                                                                       | What would duplicate it                                                                                                                                                                                    |
| :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which directory is the project root                                  | `find_specnaut_root` + `get_repo_root` in `bash/common.sh`, twinned by `Find-SpecnautRoot` + `Get-RepoRoot` in `powershell/common.ps1`; order pinned by `repo_root_twins_test.ts`     | a second upward walk in `create-new-feature.*` or `setup-plan.*`; a `cd`/`Set-Location` to anything but the resolved root; a `.specify` or `.git` walk anywhere else                                       |
| Whether the root has usable git                                      | `has_git` / `Test-HasGit`, both requiring `.git` **at the resolved root** (unchanged)                                                                                                 | a `git rev-parse --is-inside-work-tree` from cwd; a parent repository counted as the project's                                                                                                             |
| How a git probe fails: quiet, or one fixed-text warning              | `Invoke-GitProbe` in `powershell/common.ps1` (decided by #719); the bash twin, a new `_git_probe` in `bash/common.sh`, implements that rule, with no rule of its own                  | a `2>/dev/null` git call in `common.sh` that decides "no repository" by itself; a warning that prints `$out`, git's stderr or `$?` text other than the exit code                                           |
| Which registry state is which (parsed / absent-or-blank / malformed) | `Get-RegistryPresetIds` in `powershell/template-resolution.ps1`, twinned by `_preset_ids_by_priority` in `bash/template-resolution.sh`; pinned by `template_resolution_twins_test.ts` | a second parse of `.registry` in `Resolve-Template` / `resolve_template`; an emptiness test standing in for "did not parse" (`$sortedPresets.Count -gt 0`, `[ -n "$sorted_presets" ]` as the arm selector) |
| What a malformed registry says                                       | the one `[Console]::Error.WriteLine` in `Get-RegistryPresetIds` (#719); bash prints the same sentence from `_preset_ids_by_priority`'s caller in `resolve_template`                   | a second wording; python's traceback or message on stderr                                                                                                                                                  |
| The slug of a branch name                                            | `clean_branch_name` in `bash/branch-naming.sh`, twinned by `ConvertTo-CleanBranchName`; pinned by `branch_slug_twins_test.ts`                                                         | a second sanitiser in `create-new-feature.sh` for the short name                                                                                                                                           |
| A notice goes to stderr, never stdout, in these scripts              | the rule as stated in `Invoke-GitProbe`'s comment (#719) and in this plan; enforced by `json_stdout_twins_test.ts`                                                                    | any `Write-Warning`, `Write-Host` or `Write-Output` of a notice; an `echo` of a status line on stdout in JSON mode                                                                                         |
| Printed failure text is fixed, plus at most an exception type name   | the same comment on `Invoke-GitProbe`; enforced by `powershell_fixed_text_test.ts` and the sweep                                                                                      | `$_`, `$_.Exception.Message`, `$branchCreateError`, `$switchBranchError` or a parser's message interpolated into printed text                                                                              |

**No new script, helper or automation.** `_git_probe` is the bash twin of an existing function, not
a new procedure: (a) inventoried — `Invoke-GitProbe` (PowerShell), `_git_untrusted.sh` /
`git-read.sh` (hardened reads of untrusted repositories: a different purpose, fixed argv forms, not
a yes/no probe), the inline `git rev-parse` calls in `get_repo_root`, `has_git`,
`get_current_branch`; (b) recurrence: the probe replaces those three inline calls; (c) outcome:
_extend the existing helper at its owner_ — `bash/common.sh`, as `common.ps1` holds its twin. It
takes a work directory and fixed git arguments from its callers in the same file, never a caller's
argv from outside.

### Constitution principles at risk

The CLI repository has no `docs/constitution.md`; the workspace constitution and the CLI's
`AGENTS.md` bind.

- **§ I and § XI (public repo, consumer agnosticism):** fixtures use invented names only (`demo`,
  `export-invoices`, `MARKERZX9`, presets `a` / `alpha` / `zeta`). No path, project or vendor name
  from any real setup.
- **§ IV (cross-cutting discipline):** one half; seven commits in the CLI, then one pointer commit
  in the workspace, pushed in that order.
- **§ V (merge defaults):** every commit is a `fix`, `refactor` or `test`; no `feat`, so no
  `## Agent adoption` section. Release impact: patch (§ XII).
- **§ XII:** every fork below was decided here (§ 7); none is put to Kevin.
- **AGENTS.md, ASCII rule:** every printed line this plan changes is written ASCII. The `setup-plan`
  status line carries an em dash (`— left untouched`) and becomes `- left untouched`, in both twins.
  The notices #749 moves are already ASCII.
- **AGENTS.md, red before trusted:** each FR row above names its red run.

### Surfaces

One surface: the shipped bash and PowerShell scripts under `.specnaut/scripts/` of a consuming
project, and their observable contract — the JSON fields on stdout (unchanged), the root they
resolve (changed for nested projects, #750), the stderr lines (new or moved), exit codes
(unchanged). `src/templates_bundle.ts` regenerates; `plugin/` mirrors skills and agents only, and no
skill or agent text names any changed symbol (`grep -rln` over `templates/core/skills`,
`templates/core/agents` and `plugin/`: no hit), so the plugin mirror does not change;
`tests/plugin/plugin_sync_test.ts` stays green as the check. No new template path, so
`templates/manifest.json` does not change.

**Surfaces added or widened: none.** Checked: no new argument, route or file read reaches a shell, a
path or a parser (#756 narrows what a `--short-name` can put in a path; #752 and #754 narrow what
reaches an agent's context); no data migration, secret, dependency, network call, agent instruction
or public CLI interface changes. **One line for the security seat to rule on:** #750 makes a dormant
input live — the presence of a `.specnaut` directory above the working directory now picks the root
under which `create-new-feature` writes `.specnaut/specs/`. It replaces a `.specify` walk that
already had that power and never fired. Since the scripts themselves live in
`<project>/.specnaut/scripts/`, a project always has its own `.specnaut` and the nearest one wins
from any working directory inside it; only a run from outside the project can reach an ancestor's.
If the seat answers "crosses the threshold", the full plan is due.

### Sizes

`wc -l` on the base, against the defaults of `templates/core/specnaut/memory/size-limits.md` (file
200 / 500, function 20 / 50): `bash/common.sh` 387, `powershell/common.ps1` 319,
`bash/create-new-feature.sh` 457, `powershell/create-new-feature.ps1` 365,
`powershell/branch-naming.ps1` 206, `powershell/run-gate.ps1` 282 are over their target and **may
not end the branch larger**. `bash/branch-naming.sh` 199, `template-resolution.{sh,ps1}` 83 / 85,
`setup-plan.{sh,ps1}` 89 / 68 have room. Functions over the ceiling that this branch edits:
`get_current_branch` 54 and `get_feature_paths` 89 lines; neither may grow, and the #754 commit
brings `get_current_branch` to 50 or under (its git block becomes one probe call).

`common.sh` pays for `_git_probe` (about 20 lines) in the same file: #755 (-1), #750 (the rename
rewrites the walk and drops its four `.specify` comment lines), and #754 itself (the probe replaces
`get_repo_root`'s double `git rev-parse --show-toplevel` and `has_git`'s two inline checks). If
`size-ratchet.sh --since origin/main` still reports `common.sh` grown after #754, the decided
fallback is D-8.

## 4. Done, as runnable checks

Run from the worktree, each in its own call, and read before landing:

```bash
deno task test                                   # bundles first, then every test with the task's permissions
deno fmt --check && deno lint && deno task check
git diff --exit-code -- src/templates_bundle.ts  # after `deno task test`: the committed bundle is the regenerated one
git diff --exit-code -- plugin/                  # the mirror is unchanged; plugin_sync_test.ts is inside deno task test
go test ./...                                    # templates.go embeds the same tree
bash templates/core/specnaut/scripts/bash/size-ratchet.sh --since origin/main
bash scripts/smoke/audit.sh --since origin/main
deno run --allow-run scripts/check-adoption.ts --from origin/main --to HEAD
```

- **Every commit carries its regenerated `src/templates_bundle.ts`** (`deno task bundle`, which the
  pre-commit hook runs). Never hand-edited.
- New tests run with the task's flags:
  `deno test --allow-read --allow-write --allow-run --allow-env tests/scripts/<file>`, never `-A`.
- pwsh is `/opt/homebrew/bin/pwsh` here; CI's `guardPowerShellArm` fails a run where it is missing,
  so no pwsh arm is silently skipped there.
- Windows: the bash arms run under Git Bash on CI, as the existing twin tests do. Rows with a POSIX
  only fixture (an executable git stub with a bad interpreter) are ignored on Windows with the
  reason in the test name, as `powershell_warning_rule_test.ts` does. CI on windows-latest is the
  only Windows gate; its result is read before the pointer commit.
- Red-probes recorded in each commit body: the base run for every row marked red above, and for the
  green-on-base rows a mutation of the line they guard (for example: `_git_probe` without its once
  guard → FR-754-3 red; `Get-RegistryPresetIds` returning `@()` on a parse error again → FR-757-1
  red; `clean_branch_name` without the newline mapping → FR-756-1 red).

### Commits, in order

One commit per item, each green on its own (`deno task test` before each), ordered so no two touch
the same lines out of order:

1. **#755** `refactor(scripts): remove check_dir, which nothing calls` — `bash/common.sh`, bundle.
2. **#756** `fix(scripts): a newline in --short-name becomes a hyphen in the bash twin too` —
   `bash/branch-naming.sh`, one `SCENARIOS` row, bundle. Independent of every other commit.
3. **#750** `fix(scripts): the project root is the nearest directory holding .specnaut` —
   `bash/common.sh`, `powershell/common.ps1`, two comments in `create-new-feature.{sh,ps1}`,
   `repo_root_twins_test.ts`, bundle. Before #754 because both rewrite `get_repo_root`: #750 changes
   what is searched, #754 then swaps its git call for the probe.
4. **#757** `fix(scripts): a registry that enables no preset searches none, in both twins` —
   `template-resolution.{sh,ps1}`, `template_resolution_twins_test.ts`, bundle. Before #754 because
   it gives `_preset_ids_by_priority` the three states #754's warning hangs on.
5. **#754** `fix(scripts): the bash twin warns where the PowerShell twin warns` — `bash/common.sh`,
   `bash/template-resolution.sh`, `git_probe_twins_test.ts`, rows added to
   `template_resolution_twins_test.ts`, bundle.
6. **#749** `fix(scripts): -Json stdout is JSON alone, notices go to stderr` —
   `powershell/common.ps1` (`Test-FeatureBranch`), `powershell/create-new-feature.ps1` (the
   `-Number`/`-Timestamp` notice, the three truncation notices, the no-git notice),
   `powershell/setup-plan.ps1` and `bash/setup-plan.sh` (status lines, D-7),
   `json_stdout_twins_test.ts`, the stale comment in `powershell_warning_rule_test.ts`, bundle.
7. **#752** `fix(scripts): PowerShell failures print fixed text, never git's or a parser's` —
   `powershell/branch-naming.ps1` (four numbering warnings), `powershell/common.ps1` (the
   `feature.json` parse error), `powershell/create-new-feature.ps1` (the current-branch warning,
   `$branchCreateError`, both `$switchBranchError`), `powershell/run-gate.ps1`
   (`gate-impact
   stopped`), `powershell_fixed_text_test.ts`, bundle.

**How #749 and #752 compose.** They touch different lines of the same two files: #749 changes the
**channel** of the `Write-Warning` lines (`common.ps1` `Test-FeatureBranch`;
`create-new-feature.ps1` the five notices), #752 the **content** of lines already on stderr
(`[Console]::Error.WriteLine` with `$_`, and the `Write-Error` lines carrying git's text). #749
lands first, so #752's sweep runs over the final set of printed lines, the ones #749 just moved
included. Those carry `$branchName` and `$originalBranchName`, which come from the user's own
description, never from git or a parser: the sweep keeps them and says why. Neither commit rewrites
a line the other owns, so they rebase onto each other without a conflict.

## 5. Audit findings

Both seats ran 2026-11-10 on `e42e4910`, dispatched together, findings kept separate. Every finding
is accepted; what follows is **binding on the implementer** and overrides § 1–§ 4 and § 7 where they
differ.

### Architecture (`architect-expert`) — verdict fail: 2 HIGH, 1 MEDIUM, 3 LOW

- **A1 HIGH — D-3 rewritten: git membership is asked of git.** `has_git` =
  `[ "$(_git_probe "$root"
  rev-parse --is-inside-work-tree)" = true ]`; `Test-HasGit` =
  `(Invoke-GitProbe -WorkDir $root
  -GitArgs rev-parse,--is-inside-work-tree) -eq 'true'` — the
  printed value, not the exit code. The `.git`-at-root gates (`common.sh:112`, `common.ps1:138-142`)
  go. A nested project resolves its root to its subfolder **and keeps** its feature branch, branch
  validation and the `feature.json` contradiction guard — no user acts by hand after upgrading, so
  the release stays a patch. Decision row: home "git, asked at the resolved root"; duplicate "a
  `.git` existence test deciding membership". FR-750-1 (b): root = subfolder **and** `has_git` true;
  FR-750-3 asserts the branch. New row (e): a project with its own `.git` inside a parent repo
  resolves to the inner repo. The "(not parent)" comments (`common.sh:56`, `common.ps1:88`) join
  FR-750-4. gate-impact's "not-a-repository" for a nested project is a different question (it fails
  safe) and is named as such.
- **A2 HIGH — functions over the ceiling shrink.** `get_feature_paths` (89 lines) and
  `get_current_branch` (54) are cut by extract-method: the `feature.json` read or the contradiction
  guard out of the first, the latest-feature scan (`:63-99`) out of the second. D-6's priming is one
  named function, storing the root **and the git answer** in the entry shell, called at the head of
  `get_feature_paths` and in `create-new-feature.sh` before `:129` — exactly the 3 entry paths
  (`create-new-feature`, `setup-plan`, `check-prerequisites`), not on source. Before → after
  reported.
- **A3 MEDIUM — D-8 decided now:** `_git_probe` lives in `bash/_git_probe.sh` (and, for symmetry,
  `Invoke-GitProbe` moves to `powershell/_git_probe.ps1`). § 3's "no new template path" becomes
  false: a manifest entry, the smoke audit with `--since`, and `go test ./...` are added to § 4.
- **A4 LOW** — FR-754-3 adds a `check-prerequisites.{sh,ps1} --json` row (one `WARNING:` line).
- **A5 LOW** — the bash malformed-registry warning is printed from `_preset_ids_by_priority`'s
  failure path, mirroring PowerShell; FR-754-1 becomes an entry-level row (`setup-plan --json` with
  a `{not json` registry → one `WARNING:` line).
- **A6 LOW** — one path-normalising helper (`slashes` and the `//` collapse) is exported from
  `git_sandbox.ts`.
- Table additions: "once per run, across subshells" → the priming function; the bash git-stderr gap
  → closed in this branch (S3 below).

### Security (`security-expert`) — verdict needs_followup: 1 MEDIUM, 2 LOW, 1 INFO

#750 does not cross the step-4b threshold (a planted `.specify` captures the root today with the
same consequences), but § 3 Surfaces now says the root also decides which helper scripts run and
which templates are read.

- **S1 MEDIUM — an ancestor `.specnaut` chooses the root.** In the #750 commit, both twins: when the
  running script is installed (its `../..` is a directory named `.specnaut`), the root is that
  directory's parent, whatever the working directory; the upward walk runs only for uninstalled runs
  (the templates tree). The walk itself refuses a candidate `.specnaut` not owned by the current
  user (`[ -O ]`; PowerShell: the owner on Unix, `Get-Acl` on Windows) and never accepts a
  filesystem or drive root. New row in the repo-root twins test: a `.specnaut` planted above a
  working directory outside the project does not become the root — red on the base (which walks for
  `.specify`).
- **S2 LOW — the #752 sweep widens** to every printed line that interpolates a variable
  (`(WriteLine|Write-Warning|Write-Error|Write-Host).*\$[A-Za-z_(]` and the bash equivalent), each
  hit classified in the commit body. Helper failures print the exit code only; `$featureDir` is
  printed with control characters escaped or not at all. The stated reason for keeping `$branchName`
  becomes "git ref names cannot contain control characters or whitespace" (it comes from git on the
  epic path).
- **S3 LOW — the bash `create-new-feature.sh` git-stderr sites (`:316`, `:333`, `:347`)** print
  fixed text plus the exit code, folded into the #752 commit, so the twins agree on the rule this
  branch states. No separate follow-up.
- **INFO — D-5** (JSON that is not a registry → malformed) accepted.

## 6. Open questions

None. Every item carries its PO-settled decision; the forks below are engineering and are decided in
§ 7. Reported at the stop, not asked:

- **Follow-up candidate, outside every item:** the bash `create-new-feature.sh` prints git's own
  stderr (`$branch_create_error`, `$switch_branch_error`) on a failed branch create or switch, the
  defect #752 fixes on the PowerShell side. After this branch the twins differ there. To be filed
  through the product owner, not built here.

## 7. Decided here

- **D-1 (#757, `Resolve-TemplateContent`):** the AC to check `Resolve-TemplateContent` is discharged
  by absence: `fcbcdbff` removed it and `resolve_template_content`; `git grep` finds neither.
- **D-2 (#755):** `check_dir` goes; the item's search was re-run on this base with no caller.
- **D-3 (#750, nested project and git):** a project nested in a parent repository resolves to its
  own folder and, because `has_git` / `Test-HasGit` require `.git` at the resolved root ("at the
  spec-kit root (not parent)", unchanged), reports no git: no feature branch is created in the
  parent repository, branch validation is skipped with the existing notice. Today that project gets
  a branch in the parent repository and a stray `.specnaut/specs/` at the parent's root. Kept
  because it is the rule the code already states and the PO decision restores the root the comments
  meant; widening `has_git` to the parent would be a second rule. Pinned by FR-750-1 (b).
- **D-4 (#750, order):** `.specnaut` walk, then git, then the script's location, as settled.
  Rejected: the script's location first. It equals the walk whenever the working directory is inside
  the project, and the existing twin tests run the scripts in place from `templates/`, where the
  script's location is not a project.
- **D-5 (#757, what "parses" means):** a registry parses when it is a JSON object whose `presets` is
  absent or an object. `[]`, `{"presets":[]}` and any other shape are malformed (warn once,
  directory order) in both twins. Measured on this base: bash already falls back on `[]` and
  `{"presets":[]}` (python raises); PowerShell falls back silently, and on `{"presets":[1]}` would
  read the array's own properties (`Length`, `Count`...) as preset ids. An empty or blank file is
  "absent", quiet, directory order, as #719 settled for PowerShell
  (`powershell_warning_rule_test.ts`, "a empty / blank .registry is quiet"); bash, which fails
  `json.load` on it today, follows. `Get-RegistryPresetIds` returns the state explicitly (an object
  or a `[ref]` out-parameter), never an empty array standing for two states: PowerShell unrolls
  `@()` to `$null` on return, which is how the distinction was lost.
- **D-6 (#754, once per run in bash):** the warned flag lives in the shell that runs first and is
  inherited, never written back: `get_repo_root` and `get_current_branch` are called inside
  `$( … )`, and `get_feature_paths` itself inside `$( … )` in `setup-plan.sh`, so a flag set in a
  subshell is lost. The entry paths (`get_feature_paths`, and `create-new-feature.sh` before its
  first `$(get_repo_root)`) probe once in their own shell before forking. Rejected: a marker file (a
  write in the user's project or temp directory for a warning) and an exported variable (cannot
  travel up). FR-754-3 is the check.
- **D-7 (#749, `setup-plan` status lines):** in JSON mode, `setup-plan.{sh,ps1}` print
  `Plan already exists at ... - left untouched`, `Copied plan template to ...` and
  `Warning: Plan template not found` on stderr; in text mode they stay on stdout. Both twins, in the
  #749 commit, because the AC "for the scripts that reach `Test-FeatureBranch`" cannot hold for
  `setup-plan` otherwise, and the bash twin has the same lines. Nothing reads them (`git grep`).
- **D-8 (#754, size of `common.sh`):** `_git_probe` lives in `common.sh`, beside the functions that
  call it, as `Invoke-GitProbe` lives in `common.ps1`; the growth is paid in the file (§ 3 Sizes).
  If the ratchet still reports growth after #754, the probe and the once flag move to a sibling
  `bash/_git_probe.sh` sourced by `common.sh`, as `template-resolution.sh` was split out
  (`d574bd99`), with its manifest entry, `go test ./...` and `audit.sh --since` in that commit.
  Rejected: compressing the rationale comments of `get_feature_paths` to make room.
- **D-9 (#749, wording):** the moved notices print the bash twin's line byte for byte
  (`[specify] Warning: Git repository not detected; skipped branch validation`), without the
  `WARNING:` prefix and ANSI codes that `Write-Warning` added. The notice's text is unchanged; the
  host decoration goes, and the twins print the same line.
- **D-10 (#754, unborn HEAD in bash):** quiet, and `get_current_branch` falls through to the latest
  feature directory or `main`, as `Get-CurrentBranch` does since #719 (`symbolic-ref -q HEAD` as the
  normal-if test). Today bash returns `HEAD` with git's stderr; FR-754-4 pins the change.
- **D-11 (#752, `run-gate.ps1`):** the `gate-impact stopped: $_` line is fixed too (fixed text plus
  the exception type name): `gate-impact.ps1` has no `throw` of its own, so `$_` there is whatever
  the runtime raised, paths and git text included.
- **D-12 (#756, scope):** only `clean_branch_name`; the description path already agrees (measured).
- **Release impact:** patch. Every commit is `fix`, `refactor` or `test`; no user acts by hand after
  upgrading. The nested-project root (D-3) changes where a nested project's specs are written, from
  a directory that held no `.specnaut` to the one that does.
