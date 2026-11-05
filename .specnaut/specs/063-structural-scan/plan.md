# Plan: a token-free structural scan of the whole repository

**Branch**: `063-structural-scan` | **Date**: 2026-11-05 | **Backlog item**:
[#747 — audit: a token-free structural scan of the whole repository, run by the binary](https://github.com/specnaut/specnaut-cli/issues/747)

**Full plan, not a brief.** Threshold lines crossed: a new place that accepts untrusted input
(`--path`, tracked file names and file content reach a path and a parser); a change to a public
interface other projects consume (a new command and its JSON output); and, in substance, an agent
instruction surface (repository-controlled text enters a seat brief, though no grant changes).

## 1. Why this exists

`/task audit` answers an architecture question by sending agents over the code. It has no measuring
step: `collect-audit-scope.sh` lists files, then seats are dispatched. `size-ratchet.sh` judges only
changed files, so a 1,000-line file nobody touches is never reported. The function limit of
`.specnaut/memory/size-limits.md` is measured by nothing: it is agents' judgement.

The maintainer's framing (2026-11-05): the scan **orients the agents**. It tells them where to go
and so makes their work cheaper. It does not judge clean code or DDD and does not replace them.

## 2. User scenarios

### US1 — See where the structure is unhealthy, for no tokens (P1)

**Given** any git repository **When** the user runs `specnaut scan` **Then** they see, with no
network or agent, the worst files, functions and classes against their limits, the most crowded
folders and a bounded tree.

### US2 — An audit that starts from the map (P1)

**Given** a project with the scan available **When** `/task audit --archi` runs **Then** the scan
runs first, its result heads the report, and the architecture seat starts from the hot spots that
fall inside its scope.

### US3 — The map alone (P2)

**When** `/task audit --scan` runs **Then** the map is reported, no agent is dispatched, and there
is no verdict.

### US4 — Machine and diagram output (P2)

**When** `specnaut scan --format json` or `--format mermaid` runs **Then** the same bounded data
comes out for an agent, or as a folder diagram.

### Edge cases

- Run from a subdirectory: same limits and paths as from the root.
- Not a git work tree, or an unreadable config or lock: non-zero, no partial report.
- A tracked file deleted from the working tree: counted as missing, never as zero lines.
- A symlink, a submodule, or a path that is a link on disk whatever the index says: never opened,
  counted as skipped with its reason.
- A file name that is not valid UTF-8: skipped with its reason, never reported as missing.
- A name holding terminal escapes, bidi controls, or text aimed at an agent: escaped per format, and
  labelled repository-controlled.
- A language the estimator does not read: file measures still reported; counted as "code not read"
  (`.sh`) or "no units expected" (`.md`). Silence never reads as clean.
- A `--path` matching nothing: exit 2, never "0 files". An empty repository: 0 files, exit 0.
- A conflicted path, listed up to three times by git: measured once.

## 3. Requirements

- **FR-001**: `specnaut scan [--path <subtree>] [--format text|json|mermaid] [--top <n|all>]` writes
  no file and uses no network and no agent.
- **FR-002**: Every tracked path ends in one disposition, and these add up to the total: measured,
  exempt, skipped, missing. Among measured text files: analysed, or not analysed (code not read, no
  units expected, too large, line too long). Lines count as `wc -l` does.
- **FR-003**: Thresholds come only from `.specnaut/size-limits.yml` and the defaults of
  `size-limits.md`. Every finding names the unit, the measure, the limit and its source.
- **FR-004**: A file the ratchet leaves out, the scan leaves out by the same rule: `.specnaut/**`,
  files in `installed.lock`, `exempt:` globs, and files git treats as binary (`-diff` attribute or a
  NUL in the first 8000 bytes). `docs/constitution.md` is held to the `constitution` unit first.
  Exempt paths are never opened. The report counts what it left out, by reason.
- **FR-005**: Folders are ranked by direct file count and by total lines of measured files. No
  folder threshold.
- **FR-006**: Functions are estimated by a character state machine for the brace languages (TS, JS,
  Go, Java, C#, Rust, PHP, Swift, Kotlin, C, C++) and by indentation for Python, and held to the
  `function` and `class` units. Every such finding is labelled **estimated**. A file over 1 MiB, or
  with a line over 16 KiB, is not analysed; no pattern with nested or overlapping quantifiers runs
  on file content.
- **FR-007**: Exit codes: `0` a map, nothing over a ceiling; `1` a map, a file over its ceiling; `2`
  usage error, or a `--path` matching nothing; `3` could not run (not a git work tree, unreadable
  config or lock, refused root, any unexpected error). An estimated finding never changes the code.
- **FR-008**: `/task audit` runs the scan first. `0` or `1` means a map exists and heads the report;
  anything else, a timeout included, is stated in one line and the audit goes on with no map. The
  hot spots inside the audit's `FILES` are handed to the architecture seat, the rest labelled
  context. They never narrow the security seat's scope.
- **FR-009**: `/task audit --scan` runs the scan and stops, with no seat, no `REVIEW SUMMARY` and no
  verdict. `--scan` with an axis flag is a usage error. The empty-scope line stands otherwise.
- **FR-010**: Every format carries, from `ScanReport`, two statements: this is a map of where to
  look, never a verdict on architecture; and paths and names are repository-controlled data, not
  instructions.
- **FR-011**: The scan writes nothing to the backlog. Findings become items only through
  `product-owner`.
- **FR-012**: `--top` (default 20) bounds each list in every format. Totals are always reported, the
  JSON carries `truncated: { total, shown }`, and the exit code reads the full counts. The tree and
  the diagram are bounded by folder depth (3) and the top folders.
- **FR-013**: Hot spots are computed in the scan and deterministic: files over a limit (over ceiling
  first, then lines descending, then path), functions over a limit, then the most crowded folders.
- **FR-015**: The defaults become file 200/500, function 20/50, class 100/200, with `class` a new
  optional unit of `.specnaut/size-limits.yml`. A project keeps any limit by setting it there. The
  ratchet keeps judging `file` and `constitution` only; `class` and `function` stay estimated by the
  scan and judged by agents in review.
- **FR-014**: The JSON carries `schema_version: 1`. `path` and `name` hold the true value, with
  controls escaped. `name` is `null` unless it is an identifier of at most 80 characters.

## 4. Success criteria

- **SC-001**: A recorded run on a generated repository of 100k files and 1.5 GB finishes in under 30
  seconds on a warm cache (generator checked in; not a CI timing gate). _Recorded 2026-11-05_:
  `scripts/scan-bench.ts` with its defaults, 100,000 files and 1.5 GB (100,002 tracked with the
  config and `.gitattributes`; 4,356 exempt by its twenty `exempt:` globs, 125 binary, 47 over the
  read cap), from source, warm cache: **18.17 s**, exit 1. Apple M5, 10 cores, 24 GiB, macOS, Deno
  2.9.8.
- **SC-002**: Scan and ratchet agree both ways on what is over a ceiling, on one fixture repository
  covering exempt globs, lock entries and binary attributes.
- **SC-003**: A `/task audit --archi` report opens with the map and its seat brief names hot spots.
- **SC-004**: A default `--format json` on this repository stays small enough to read in one tool
  result: under 20 KB.

## 5. 🔒 Decision table

| The decision                                                        | Its single home                                                       | What would duplicate it                                                                                     |
| :------------------------------------------------------------------ | :-------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| Which limits apply, and their source                                | `src/domain/size_limits.ts`                                           | Any number in the scan, a seat or a phase                                                                   |
| The legacy migration's own unit list and defaults, frozen           | `src/domain/constitution_legacy_settings.ts`                          | Reading the live `SIZE_UNITS` there, which would resurrect a `class` row it must drop                       |
| What a line count is                                                | `src/domain/size_limits.ts` (`countLines`, byte-fold added beside it) | `split("\n")`, a second counter in the use case or the extracted constitution module                        |
| Which files are exempt, and which unit a path is held to            | `src/domain/size_exempt.ts`                                           | A second matcher; `is_exempt` in `size-ratchet.sh` stays the bash asker, pinned by the differential fixture |
| What counts as binary                                               | `src/domain/size_exempt.ts`                                           | A sniff in the adapter                                                                                      |
| What counts as a finding, what a hot spot is, tree and top bounds   | `src/domain/structural_scan.ts`                                       | Ranking in a renderer; a cut chosen by an agent in `audit.md`                                               |
| How a report maps to an exit code                                   | `src/cli/handlers/scan_handler.ts`                                    | Numbers in domain or application                                                                            |
| Where a function or class starts and ends                           | `src/domain/code_units/`                                              | A second scanner; a per-language branch outside its language table                                          |
| How git runs against an unvetted repository                         | `src/infrastructure/git_tracked_files.ts`                             | Any other `git` spawn in the scan; `DenoSubprocessRunner` for this path                                     |
| Whether a path may be opened                                        | `src/infrastructure/git_tracked_files.ts`                             | A plain `open` elsewhere; trusting the index mode                                                           |
| The repository root                                                 | `src/infrastructure/git_tracked_files.ts`                             | `Deno.cwd()` as project dir; `--path` as `cwd`                                                              |
| What `--path` may be                                                | `src/cli/scan_parser.ts`                                              | Validation in the handler or adapter                                                                        |
| How text is made safe, per grammar                                  | `src/domain/terminal_text.ts`, called by `src/cli/scan_render.ts`     | Raw interpolation; a second `terminalJson`                                                                  |
| The JSON contract                                                   | `src/cli/scan_render.ts`, held by a golden test                       | A field shaped by the text format                                                                           |
| When the audit runs the scan, what a map is, how a scope narrows it | `templates/core/skills/task/phases/audit.md`                          | The same step in `architect-expert.md`                                                                      |

**Reuse before you build.** Inventoried: `size-ratchet.sh` (changed files only, bash, no JSON),
`collect-audit-scope.sh` (lists, measures nothing), `boundary-check.sh` (imports),
`sizeConfigFromEntry`, `LockStore`, `FsReader`, `fs_containment.ts`, `terminalJson`, `hasControl`.
Reused: the config reader, the lock store, `FsReader` for the config only (3× to 13× the plain read,
and it cannot stream), `fs_containment.ts`'s guard, and `terminalJson`, moved out of `domain/cloud`.
Extending the ratchet was rejected: no whole-repo mode fits its base-of-change design. The new
command is the feature, not a helper; it takes data only: no executable path, no shell string.

**How git runs.**
`git --no-pager --literal-pathspecs -c core.fsmonitor=false -c core.quotePath=false
<rev-parse|ls-files|check-attr> …`
with `GIT_OPTIONAL_LOCKS=0`, from the resolved root. Only those three subcommands. `safe.directory`
is never passed; a refusal is exit 3. `.git` must exist directly under the top level. `--path` is
relative, has no `..` segment and no leading `-`, and follows `--`.

**How a file is read.** One `lstat`, then: not a regular file, or under a link at any ancestor →
skipped. Up to 1 MiB → `readFile` once; decode only for a language the estimator reads. Over →
stream into a fixed buffer, count on bytes, never decode. A NUL in the first chunk stops the read. A
fixed pool of 16. Each file folds straight away into counters, the folder map and a bounded top
list.

**Exempt globs.** An iterative two-pointer matcher over `*`, `?` and `[…]`, never `RegExp`, with a
glob length cap. It keeps bash `case` semantics: `*` crosses `/`, and each glob is tried against
both `path` and `/path`.

## 6. Technical context

**Language/Version**: TypeScript on Deno. The Go port is out of scope by the maintainer's decision;
its parser, help and golden list follow mechanically because the parity harness compares them. There
the command answers "not ported" after the same parse-time refusals. **Primary Dependencies**: none
new. An AST parser or tree-sitter was rejected: weight in the binary and one grammar per language,
for a result that only needs to orient. **Storage**: N/A **Testing**: `deno task test`,
`go test ./...`, parity harness, smoke audit **Target Platform**: macOS, Linux, Windows **Project
Type**: cli **Performance Goals**: SC-001. Memory bounded by the pool times the 1 MiB cap, the
folder map and the top lists. **Constraints**: read-only, offline **Scale/Scope**: any repository

### Domain model

- **Bounded context**: structural measurement of a repository.
- **Vocabulary**: scan, map, hot spot, measure, unit, limit, estimated, disposition.
- **Value objects**: `FileMeasure`, `CodeUnit` (path, kind, name, start line, lines),
  `FolderMeasure`, `Finding` (unit, measure, limit, source, level, estimated), `ScanReport`.
- **Invariants**: dispositions add up to the total. An estimated finding never decides the exit
  code. A folder total counts measured files only.

## 7. Constitution check

| Principle                                                                                     | Verdict | Note                                                                                                                                                   |
| :-------------------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size limits (`.specnaut/memory/size-limits.md`, or the project's `.specnaut/size-limits.yml`) | pass    | The repo's config sets no units, so the new 200/500 applies to this repo too: nothing below over 200 grows, and every new module stays at or under 200 |
| § I private/public boundary                                                                   | pass    | Nothing from a private half                                                                                                                            |
| § XI consumer agnosticism                                                                     | pass    | Fixtures are synthetic                                                                                                                                 |
| CLI layering (`AGENTS.md`)                                                                    | pass    | Domain pure, port in application, adapter in infrastructure, render and exit code in cli                                                               |

### Files touched

| File                                                          | Lines now | Lines after (est.) | Over target?               | Responsibility of each new module (one line)                     |
| :------------------------------------------------------------ | --------: | -----------------: | :------------------------- | :--------------------------------------------------------------- |
| `src/cli/parser.ts`                                           |       429 |                295 | shrinks under              | `Intent` union moved out; `scan` branch added                    |
| `src/cli/intent.ts`                                           |         0 |                150 | no                         | The command-line intent types                                    |
| `src/cli/scan_parser.ts`                                      |         0 |                 50 | no                         | Validates `scan`'s arguments into its intent                     |
| `src/main.ts`                                                 |        88 |                 92 | no                         | Dispatch                                                         |
| `src/cli/help.ts`                                             |       117 |                118 | no                         | Help line                                                        |
| `src/domain/size_limits.ts`                                   |       300 |                285 | no                         | Constitution ceiling moved out, byte-fold counter added          |
| `src/domain/constitution_ceiling.ts`                          |         0 |                 30 | no                         | Whether the constitution is over its ceiling                     |
| `src/domain/size_exempt.ts`                                   |         0 |                 90 | no                         | Decides which rule holds a path                                  |
| `src/domain/terminal_text.ts`                                 |         0 |                 90 | no                         | Encodes untrusted text for one output grammar                    |
| `src/domain/cloud/cloud_wire.ts`                              |        89 |                 75 | no                         | Helpers moved out                                                |
| `src/cli/handlers/cloud_token.ts`                             |        55 |                 55 | no                         | Import only                                                      |
| `src/cli/handlers/gate_handler.ts`                            |       223 |                223 | no                         | Import only                                                      |
| `src/domain/structural_scan.ts`                               |         0 |                200 | no                         | Folds measures into a bounded report                             |
| `src/domain/code_units/estimate_units.ts`                     |         0 |                 73 | no                         | Entry point: estimates one file or says why not                  |
| `src/domain/code_units/language_table.ts`                     |         0 |                 65 | no                         | Maps an extension to its family                                  |
| `src/domain/code_units/language_families.ts`                  |         0 |                186 | no                         | Declares each family's unit heads                                |
| `src/domain/code_units/lexical_state.ts`                      |         0 |                165 | no                         | Tracks strings and comments per language family                  |
| `src/domain/code_units/lexical_rules.ts`                      |         0 |                 89 | no                         | Declares each family's string and comment rules                  |
| `src/domain/code_units/lexical_regex.ts`                      |         0 |                 41 | no                         | Tells a regex literal from a division                            |
| `src/domain/code_units/brace_extents.ts`                      |         0 |                140 | no                         | Finds unit extents by brace depth                                |
| `src/domain/code_units/brace_heads.ts`                        |         0 |                171 | no                         | Recognises a unit head before a brace                            |
| `src/domain/code_units/brace_head_state.ts`                   |         0 |                 77 | no                         | Holds the head being read                                        |
| `src/domain/code_units/brace_head_words.ts`                   |         0 |                 79 | no                         | Lists the words that open or never name a head                   |
| `src/domain/code_units/indent_extents.ts`                     |         0 |                140 | no                         | Finds unit extents by indentation                                |
| `src/domain/code_units/code_unit.ts`                          |         0 |                 38 | no                         | The unit value object and result type                            |
| `src/domain/code_units/char_codes.ts`                         |         0 |                 51 | no                         | Names the character codes the scanners compare                   |
| `src/application/structural_scan_ports.ts`                    |         0 |                 25 | no                         | Declares what the scan needs from a repository                   |
| `src/application/run_structural_scan.ts`                      |         0 |                100 | no                         | Orchestrates the fold                                            |
| `src/infrastructure/git_tracked_files.ts`                     |         0 |                150 | no                         | Reads an unvetted repository safely                              |
| `src/cli/handlers/scan_handler.ts`                            |         0 |                 70 | no                         | Wires the use case and maps its outcome to a code                |
| `src/cli/scan_render.ts`                                      |         0 |                180 | no                         | Renders a report in one format                                   |
| `src/cli/scan_render_text.ts`                                 |         0 |                108 | no                         | Renders a report as text for a person or an agent                |
| `src/domain/bounded_top.ts`                                   |         0 |                 48 | no                         | Keeps the best items of a stream, bounded, with the full count   |
| `src/domain/structural_scan_types.ts`                         |         0 |                119 | no                         | Declares the scan's value objects and vocabularies               |
| `src/infrastructure/bounded_file_read.ts`                     |         0 |                 59 | no                         | Counts an admitted file's bytes, whole or streamed               |
| `src/infrastructure/git_stage_listing.ts`                     |         0 |                 50 | no                         | Parses `ls-files --stage` into tracked entries                   |
| `templates/core/skills/task/phases/audit.md`                  |       133 |                165 | no                         | Scan step, `--scan`, map section, data label on the Step 4 lists |
| `templates/core/skills/task/SKILL.md`                         |       140 |                140 | no                         | `--scan` in the usage row                                        |
| `templates/core/skills/task/scripts/collect-audit-scope.sh`   |       243 |                243 | no                         | fsmonitor off and literal pathspecs on its git calls             |
| `templates/core/skills/specnaut-facts/SKILL.md`               |        64 |                 65 | no                         | Names the command                                                |
| `templates/core/skills/specnaut/SKILL.md`                     |        89 |                 89 | no                         | Flag list                                                        |
| `templates/core/agents/README.md`                             |        88 |                 88 | no                         | Flag list                                                        |
| `templates/harness-specific/cursor/specify-rules.mdc`         |        61 |                 61 | no                         | Flag list                                                        |
| `tests/templates/per_axis_audit_skills_test.ts`               |       130 |                140 | no                         | Pins the phase                                                   |
| `scripts/smoke/smoke-task.sh`                                 |        87 |                 90 | no                         | Pins the flag                                                    |
| `scripts/smoke/smoke-features.sh`                             |       410 |                410 | yes, unchanged             | Line edited in place, no growth                                  |
| `templates/core/specnaut/memory/size-limits.md`               |       153 |                158 | no                         | What measures what                                               |
| `internal/cli/surface.go`                                     |        51 |                 53 | no                         | Mirrors the tables                                               |
| `internal/cli/parse.go`                                       |       160 |                175 | no                         | Same parse-time refusals                                         |
| `internal/cli/help.go`                                        |       102 |                103 | no                         | Mirrors the help line                                            |
| `internal/testdata/golden.ts`                                 |       337 |                337 | yes, unchanged             | New cases go to a new `internal/testdata/golden_scan.ts`         |
| `parity/testdata/parser.txtar`                                |        35 |                 40 | no                         | Parser scenario                                                  |
| `README.md`                                                   |       236 |                236 | yes, unchanged             | Names the command in place, no growth                            |
| `templates/core/specnaut/scripts/bash/_config.sh`             |       165 |                170 | no                         | Accepts the `class` unit, new defaults                           |
| `src/domain/constitution_legacy_settings.ts`                  | see below |                 +2 | measured at implementation | Freezes its own unit list                                        |
| `templates/core/agents/code-reviewer.md`                      | see below |                 +1 | no                         | Judges classes too                                               |
| Arbiter, corpus and integration tests, 6 `.expected` fixtures |       n/a |                    |                            | Follow the `class` unit and new defaults                         |

The `plugin/` mirror and `src/templates_bundle.ts` follow by `deno task bundle` and the sync test.

### Complexity tracking

None. Files between 200 and 300 lines that this change must edit are edited in place, without
growth.

## 8. Surface impact

| Surface                             | Touched?   | What changes                                                                                                                                                                                                                                         |
| :---------------------------------- | :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI command                         | yes        | New `scan` command, new `--format`, `--path`, `--top` flags                                                                                                                                                                                          |
| JSON output                         | yes        | New public contract, `schema_version: 1`, golden-tested                                                                                                                                                                                              |
| `/task audit` phase                 | yes        | Scan step, `--scan`, map section; seat lists labelled as data                                                                                                                                                                                        |
| `.specnaut/size-limits.yml` grammar | yes        | New optional `class` unit; a file without it keeps working                                                                                                                                                                                           |
| Default limits, in every project    | yes        | File 200/500, function 20/50, class 100/200, rewritten by `specnaut upgrade`. A file over 200 cannot grow without extraction; any project can restore a limit in its config. No hand action is required to upgrade, so this ships as a minor (§ XII) |
| Web docs (`apps/specnaut-web`)      | yes        | Command reference, in its own commit                                                                                                                                                                                                                 |
| Go port                             | mechanical | Parser, help, tables; answers "not ported"                                                                                                                                                                                                           |
| Cloud API                           | no         |                                                                                                                                                                                                                                                      |

### Documentation (this feature)

```text
.specnaut/specs/063-structural-scan/
└── plan.md
```

**Surfaces added or widened**: a `--path` argument, tracked file names, tracked file content and
repository git config. All read, none executed, under the "How git runs" rule above, which is what
makes that true: a probe on 2026-11-05 showed a plain `git ls-files` spawning a program named by
`core.fsmonitor`, and `-c core.fsmonitor=false` stopping it.

## 9. Risks

| Risk                                                    | Mitigation                                                                                                                                                                              |
| :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The estimator misreads a function                       | Labelled estimated, never decides the exit code, its own commit after the file scan                                                                                                     |
| A clean scan is read as "architecture is fine"          | FR-010 in every format; `--scan` emits no verdict                                                                                                                                       |
| Scan and ratchet disagree                               | SC-002, two-way, on one fixture                                                                                                                                                         |
| A repository steers an agent through a name             | Labelled data, delimited JSON in the seat brief, identifier allowlist. A mitigation, not a boundary: what remains is the seat's own grant                                               |
| One hostile file hangs or crashes the run               | Linear scanner, line and size caps, hostile corpus under a time limit                                                                                                                   |
| Windows runs a `git` planted in the working directory   | A Windows CI test plants markers; if red, a CLI-wide item                                                                                                                               |
| An older binary meets the new phase doc                 | FR-008: stated, and the audit goes on                                                                                                                                                   |
| Stricter defaults block work in existing projects       | Rule 3 blocks growth only, never an existing file. The release notes name the change and the config override. 27 files of this CLI sit between 200 and 300 lines and take the same rule |
| A customised stale `_config.sh` refuses the `class` key | Stops the ratchet at exit 2, stated by the reader. Upgrade reports customised files already                                                                                             |

## 10. Architecture audit

_`architect-expert` on the first draft: fail, 7 HIGH, 9 MEDIUM, 2 LOW. Central claims checked
against the tree: `judgeRow` reads the live unit list, the reader refuses unknown keys, `Intent`
spans lines 49-192._

| #   | Finding                                                            | What was done                                                                                                                                                  |
| :-- | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `class` in `SIZE_UNITS` changes the legacy migration               | Plan changed: `LEGACY_SIZE_UNITS` frozen in the migration, its test kept pinned                                                                                |
| A2  | `class` unit creates a review policy and a one-way door            | Recommendation not taken: put to the maintainer, who chose the unit and the numbers (§ 12). `code-reviewer` gets the unit, the existing severity table applies |
| A3  | Reuse claims cannot carry the measuring path                       | Plan changed: narrow port, adapter reads bytes itself, names decoded fatally                                                                                   |
| A4  | Exit 1 means both "over a ceiling" and "crashed"                   | Plan changed: handler catches everything to 3; FR-007, FR-008                                                                                                  |
| A5  | Hot spot and tree undefined and unbounded                          | Plan changed: FR-012, FR-013                                                                                                                                   |
| A6  | Audit integration collides with the phase and the summary contract | Plan changed: FR-008, FR-009                                                                                                                                   |
| A7  | A run from a subdirectory silently uses the wrong limits           | Plan changed: root row, edge case                                                                                                                              |
| A8  | Line count has three homes                                         | Plan changed: one home in `size_limits.ts`                                                                                                                     |
| A9  | Exit code cannot live in domain                                    | Plan changed: row split                                                                                                                                        |
| A10 | Scan and ratchet disagree on binaries                              | Plan changed: `check-attr`, two-way differential                                                                                                               |
| A11 | `terminalJson` missed by the inventory                             | Plan changed: moved to `terminal_text.ts`                                                                                                                      |
| A12 | 180 lines not credible for the estimator                           | Plan changed: `src/domain/code_units/`, table-driven                                                                                                           |
| A13 | Invariant's counts cannot add up                                   | Plan changed: two axes, FR-002                                                                                                                                 |
| A14 | Go mirror omits the parse step                                     | Plan changed: `parse.go`, golden list, parser scenario                                                                                                         |
| A15 | Files touched incomplete                                           | Plan changed: table rebuilt and measured                                                                                                                       |
| A16 | #747 says the opposite of the scope                                | Plan changed: `product-owner` records it before implementation                                                                                                 |
| A17 | Parser extraction takes the smaller gain                           | Plan changed: `Intent` moved out instead of the flag table                                                                                                     |
| A18 | JSON contract and wording have no row                              | Plan changed: rows, golden test, statements on `ScanReport`                                                                                                    |

**Verdict**: fail on the draft, every finding folded in above. Covered: decision table, homes, blast
radius, sizes, layering. It did not judge the Go port beyond the mirror.

## 11. Security audit

_`security-expert` on the first draft: fail, 2 HIGH, 5 MEDIUM, 2 LOW. S1 was reproduced by a probe.
`performance-expert` findings are in P1-P6 below, kept apart._

| #  | Finding                                                      | What was done                                                                                                                                                       |
| :- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1 | "Read-only" git runs a program the repository names          | Plan changed: "How git runs" and its row; red test through the real entry point. `collect-audit-scope.sh` gets the same guard                                       |
| S2 | Escaping does not stop text aimed at an agent                | Plan changed: FR-010, FR-014, delimited JSON, data label, security seat never narrowed                                                                              |
| S3 | The read trusts the index mode, not the disk                 | Plan changed: `lstat` and ancestor check, skipped never thrown                                                                                                      |
| S4 | One escaper for many inputs and grammars                     | Plan changed: one home, one encoder per grammar, generated Mermaid ids, config values and git stderr included                                                       |
| S5 | No bound on hostile files                                    | Plan changed: caps, top lists. Whole-run deadline **rejected**: with caps and non-regular files never opened nothing unbounded remains, and FR-008 covers a timeout |
| S6 | Exempt matcher takes pattern and subject from the repository | Plan changed: iterative matcher, no `RegExp`, pathological glob in the tests                                                                                        |
| S7 | Windows may run a `git` planted in the working directory     | Plan changed: Windows CI test; a red result becomes a CLI-wide item                                                                                                 |
| S8 | `--path` has no validator, pathspec magic reaches git        | Plan changed: row, literal pathspecs, exit 2 on no match                                                                                                            |
| S9 | `__proto__` in a path-keyed tree                             | Plan changed: `Map` only, fixture                                                                                                                                   |

**Verdict**: fail on the draft, every finding folded in above. Not assessed: whether a model obeys
injected text, and how a Mermaid renderer is configured. Pre-existing, left for the backlog:
`deno_git.ts` has no fsmonitor guard, though it is not the unvetted-repository path.

### Performance audit

_`performance-expert` on the first draft: fail, 2 HIGH, 4 MEDIUM, 2 LOW, from measurements on a
synthetic 20k-file repository._

| #  | Finding                                                           | What was done                                                                                 |
| :- | :---------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| P1 | No output bound; JSON up to 182.7 MB against 7.3 KB for a top 20  | Plan changed: FR-012, SC-004                                                                  |
| P2 | Estimator input unbounded; a stand-in regex hung on 67 characters | Plan changed: FR-006                                                                          |
| P3 | "Streamed" contradicts whole-text estimation                      | Plan changed: three-way read, pool of 16                                                      |
| P4 | `FsReader` is 3× to 13× the plain read                            | Plan changed: config only                                                                     |
| P5 | Report would keep every `CodeUnit`                                | Plan changed: a fold, applied synchronously after each `await`                                |
| P6 | The goal has no measurement; SC-001 could not fail                | Plan changed: SC-001 restated. Exempt paths never opened; audit treats a timeout as a failure |

**Verdict**: fail on the draft, folded in. Not measured: cold cache, Windows, network filesystems.

## 12. Open questions

| Question                                                                            | Answer                                                                            | Date       |
| :---------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- | :--------- |
| Must the plan care about the Go port?                                               | No. It comes later, if at all. Only the mechanical parity mirror                  | 2026-11-05 |
| What is the scan for, given it cannot detect DDD?                                   | Orienting the agents, not judging                                                 | 2026-11-05 |
| Must functions and classes be measured, given 200 lines is far too much for either? | Yes. Maintainer's position                                                        | 2026-11-05 |
| The default limits for file, function and class                                     | Strict Clean Code: file 200/500, function 20/50, class 100/200, for every project | 2026-11-05 |

### Decided without asking

- Command named `specnaut scan`: `audit` already names the agent verb.
- `--format` rather than `--json` plus `--mermaid`: one flag cannot conflict with itself.
- No folder threshold: a ranking orients without inventing a limit.
- A function over its limit is reported but does not fail the exit code, because it is an estimate.
- Line cap 16 KiB and size cap 1 MiB, where the seats suggested up to 64 KiB and 2 MiB: both only
  stop an estimate.
- `--top` default 20, where security suggested 50: the measured cost of 20 is 7.3 KB.
- The lock is read with `DenoFsReader.readEntry` and `parseLock`, not through `FsLockStore` as § 5
  "Reuse before you build" says: `FsLockStore` follows a link, and the scan must see a lock that is
  a link as unreadable, never read what it points at (plan S3).
