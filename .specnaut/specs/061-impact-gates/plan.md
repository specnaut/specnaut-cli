# Plan: impact-aware quality gates

**Item:**
[#725 Add dependency-aware incremental quality gates with conservative full fallback](https://github.com/specnaut/specnaut-cli/issues/725)
**Shape:** full plan. Threshold line crossed: file content that reaches a shell (a declared adapter
command and scoped commands), and a change to a public interface other projects consume (new
`run-gate` flags, exit codes and an optional file).

## 1. Why this exists

`run-gate` runs every declared command on every change. In a repository holding several workspaces,
a one-line change validates unrelated applications. A project should be able to opt in to running
only what its own dependency graph says a candidate can affect, and it must get the full gate
whenever that cannot be shown. Nothing changes for a project that does not opt in.

**Out of scope:** a built-in graph for any language or tool, a mandatory orchestrator, changing a
project's CI, a graph cache, reusing evidence to skip a check, and making `merge.md` run the full
gate on a standalone item (a separate defect, filed as a follow-up).

## 2. User scenarios

### US1 — a maintainer opts in (P1)

They write `.specnaut/impact.json` and an adapter that reports owners and dependencies. A change
inside one owner runs that owner's scoped commands and those of its reverse dependents, and reports
what was omitted and why.

### US2 — uncertainty widens (P1)

An unowned path, a lockfile named in `full_on`, a failing adapter or a changed declaration runs the
full gate and names the cause.

### US3 — no opt-in (P1)

No flag, or a flag with no declaration: output and exit codes are byte-identical to today.

### US4 — the candidate is not what was tested (P2)

A dirty tree, an untracked file, a tree that changes during the run, or a push holding several
distinct trees refuses with exit 3 rather than presenting one pass as another tree's.

### Edge cases

Additions, deletions, renames (delete plus add), a dependency edge added or removed, an owner added
or removed, a gitlink or type change, a zero remote sha, a deleted ref, an unfetched base, paths
with spaces and newlines, jq absent, an empty diff, a tier emptied on the branch, a symlinked
protected path, a command that reads stdin, several bases with different edges.

## 3. Requirements

- **FR-000** Fixed first, in its own commit: every gate command runs with stdin from `/dev/null`.
  Today a command that reads stdin swallows the rest of the list, and the gate reports `N of N`,
  exit 0, with commands never run. Reproduced on a scratch copy.
- **FR-001** Bare `run-gate <tier>` never reads the declaration and stays byte-identical. It is the
  manual full override.
- **FR-002** `--base <rev>` or `--refs-stdin` activates resolution. With no `.specnaut/impact.json`
  the run is byte-identical to bare, unless the base holds one: a declaration deleted on the branch
  is a change (FR-006).
- **FR-003** Declaration (`schema`, `adapter.command`, `adapter.files`, `scoped_tiers`, `full_on`,
  `inert`, `checks[{gate, scoped, owners?}]`). A tier outside `scoped_tiers` runs full. A gate
  command with no `checks` entry always runs. `gate` matches a parsed gate command by exact string.
  A malformed declaration goes full with a cause. `inert` paths (FR-009 grammar) are changes that
  affect nothing, such as `.specnaut/specs/` and `.specnaut/feature.json`, which every branch
  commits; a `full_on` match or an FR-006 path always beats `inert`. `owners` names the owners a
  check covers: a check whose owners miss the affected set is omitted; no `owners` means any
  affected owner. An owner in `owners` absent from the snapshots is malformed.
- **FR-004** Candidate: tree OID plus commit. `git status --porcelain --untracked-files=all` empty
  and `HEAD^{tree}` equal to the candidate before anything runs, and re-checked after the adapter
  and after the commands. A failed check is exit 3; a post-run failure marks the evidence invalid.
  No git repository with a declaration is exit 3.
- **FR-005** `--refs-stdin` reads pre-push lines, validated as hex. One tree with several bases:
  changes are unioned and each distinct base gets its own snapshot. Several distinct trees, or a
  local sha whose tree is not the candidate: exit 3, naming them. Zero or unfetched remote sha:
  full. Deleted ref: contributes nothing.
- **FR-006** Before any adapter runs, the run goes full if the declaration, an `adapter.files` entry
  (non-empty, FR-009 grammar), `gates.yml` or `.specnaut/scripts/` differs between the candidate and
  any given base, or the merge-base with the default branch from `base-branch.sh` (unresolved:
  full), so a narrow base cannot launder an earlier change. Each protected path must be a tracked
  regular file with no symlink component on both sides, read through `git ls-tree`; otherwise full.
- **FR-007** Adapter: the base worktree's copy, with that worktree as its cwd, on every side, stdin
  from `/dev/null`, given `SPECNAUT_IMPACT_TREE` (absolute path of the tree to describe),
  `SPECNAUT_IMPACT_COMMIT`, `SPECNAUT_IMPACT_OUT`, `SPECNAUT_IMPACT_SCHEMA` and
  `SPECNAUT_IMPACT_REPO` (absolute candidate root, so an adapter may deliberately reach an installed
  toolchain; that reach is the project's claim). A missing dependency exits non-zero and goes full.
  Output `{schema, commit, complete: true, owners: [{id, roots[], depends_on[]}]}`. The base side is
  a temporary detached worktree outside the repository: hooks off, inherited `GIT_*` scrubbed,
  removed on every exit path. Before the first git call the resolver unsets
  `git rev-parse --local-env-vars`, uses `git -C "$REPO_ROOT"` and `-c core.fsmonitor=false`.
- **FR-008** Any non-zero exit, absent or invalid JSON, schema mismatch, `complete` not true, commit
  mismatch, dangling `depends_on`, invalid owner id, invalid root, or worktree failure goes full
  with a named cause.
- **FR-009** Owner id matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. A root is a repository-relative
  directory prefix ending in `/`, or an exact path; no `..`, no leading `/`, no backslash, no glob,
  no control character, no `./`, no `//`. `full_on` and `inert` use the same grammar. Regexes anchor
  with `\z`; PowerShell compares ordinally.
- **FR-010** Changes come from `git diff-tree -r -z --no-renames --ignore-submodules=none`; status
  uses the same submodule flag. A path under a root in either snapshot affects that owner. An owner
  whose record differs, or that exists on one side only, is affected. The reverse closure runs over
  the union of both edge sets. An unowned path, a `full_on` match, or a gitlink, type change or mode
  120000 goes full. An adapter narrows scope only by owning a path.
- **FR-011** A mapped gate runs its `scoped` command when an affected owner exists, with the owners
  in `SPECNAUT_AFFECTED_OWNERS` (space-separated, never spliced into a command string). Otherwise it
  is omitted, with the reason. A `scoped` string holding a newline or other control character is a
  malformed declaration.
- **FR-012** Every activated run prints ASCII lines `candidate:`, `scope:`, `ran:`, `omitted:`,
  `fallback:`, `removed:` (commands in the base's tier gone from the candidate's, read through
  `run-gate`'s own parser), `evidence:`, and writes evidence to
  `git rev-parse --git-path specnaut/gate-evidence/<tier>-<tree>.json`, atomically. Evidence is
  write-only: nothing reads it to decide anything. A failure to write it prints
  `evidence: unwritten (<cause>)` and does not change the gate's result.
- **FR-013** Exit codes: 0 passed, 1 a command failed, 2 usage, 3 candidate refused, 4 every command
  omitted or the tier emptied on the branch (a skip is never a pass). 3 and 4 exist only behind the
  flags. Precedence: a failed command stops at 1; a post-run drift after passing commands is 3.
- **FR-014** jq absent on Bash goes full with a cause. `--base ""`, or a base that does not resolve,
  goes full. A value starting with `-` is a usage error.
- **FR-015** PowerShell twin with the same flags, grammar, causes and exit codes.
- **FR-016** `merge.md`'s epic path passes `--base "$(git merge-base HEAD <base>)"` and says what
  exits 3 and 4 mean there: 3 stops, 4 runs bare, and a scoped pass is never reported as the full
  gate. `epic-loop.md` and the `code-reviewer` grant stay bare.

## 4. Success criteria

- **SC-001** Characterization tests pin bare and flag-without-declaration output on both twins
  before any behaviour changes.
- **SC-002** Coverage test: in synthetic repositories, scoped commands write markers; the markers
  must cover the ground-truth affected owners for each case in the Edge cases list, including a
  multi-base push whose bases hold different edges. Shown red by mutation.
- **SC-003** Every FR-008 cause has a test asserting full execution and the named cause.
- **SC-004** A differential test runs one fixture corpus through both twins and compares selection,
  causes and exit codes. Skipped with a stated reason where `pwsh` is absent; CI's Windows job runs
  it.
- **SC-005** New files stay under the size limits, with every function under the ceiling.
- **SC-006** `deno task test`, `scripts/smoke/audit.sh --since main`, the smoke suite and the Go
  parity harness are green, and `check-adoption.ts` passes.

## 5. 🔒 Decision table

| The decision                                                     | Its single home                        | What would duplicate it                                         |
| :--------------------------------------------------------------- | :------------------------------------- | :-------------------------------------------------------------- |
| How `gates.yml` is parsed, and the loop that executes commands   | `run-gate.sh`, `run-gate.ps1`          | an `awk` over `gates.yml` or an `eval` in a `gate-impact*` file |
| Candidate identity and the refusal                               | `_gate_candidate.sh`, `.ps1`           | `git status` or `^{tree}` anywhere else                         |
| Every fallback cause, and that uncertainty widens                | `gate-impact.sh`, `.ps1`               | a `full` decision in `run-gate` beyond calling the resolver     |
| Reading and validating `impact.json` and adapter output          | `_gate_impact_read.sh`, `.ps1`         | a second `jq` over either file                                  |
| The affected set and the reverse closure                         | `_gate_impact_graph.sh` (`jq`), `.ps1` | a second traversal                                              |
| Running the adapter and collecting its output                    | `_gate_impact_adapter.sh`, `.ps1`      | a second worktree or a second invocation                        |
| The change set                                                   | `_gate_impact_graph.sh`, `.ps1`        | a second `diff-tree`                                            |
| Selection records (`run`, `omit`) and the removed-command report | `gate-impact.sh`, `.ps1`               | a `run` or `omit` decision in `run-gate`                        |
| Evidence                                                         | `_gate_evidence.sh`, `.ps1`            | any other writer, or any reader that decides                    |
| Exit codes and precedence                                        | `run-gate.sh`, `.ps1`                  | an exit-code mapping in a caller                                |
| What the merge passes                                            | `phases/merge.md`                      | a flag in `quality-gates.md` or `epic-loop.md`                  |

**New helper.** (a) Inventoried: `run-gate`, `boundary-check.sh` (exit 4 convention), `common.sh`
`jq_lf`, `epic-branch.sh` (accepted jq stop). (b) Recurrence is not the evidence here: this is a
ticketed capability, not a repeated repair. (c) _Add a new helper._ `run-gate` hands the resolver
its parsed commands in a temporary file, one per line, and reads back tab-separated
`run <owners> <cmd>` and `omit <reason> <cmd>` records. It takes data only: the commands it selects
come from the project's own files, it accepts no caller-chosen executable or environment, and a
missing or refused result never reads as a pass.

## 6. Technical context

Twins in `templates/core/specnaut/scripts/{bash,powershell}/`. The bare path of `run-gate` is
untouched; behind a flag it asks the resolver for a selection (`run`/`omit` records) and executes it
with its own loop. Declaration in JSON because the mapping nests; `_config.sh` refuses nesting and
has no PowerShell reader. The file is not in the manifest, following `boundaries.yml`.

### Domain model

Bounded context: gate execution and impact resolution. Value objects: candidate (tree, commit),
change set, snapshot (owners and edges), selection, evidence. Invariants: uncertainty expands scope;
a required check is never silently omitted; policy stays with the project; nothing here names a
tool.

### Slices, in order, on one branch

(a) characterize the twins · (b) candidate and refs · (c) declaration and full-with-cause · (d)
adapter, snapshots and closure · (e) selection, evidence, coverage test · (f) PowerShell and the
differential test · (g) manifest, `merge.md`, `quality-gates.md`, smoke surfaces, plugin mirror,
guide facts. Callers come last so nothing passes a flag early.

## 7. Constitution check

- **Stack agnosticism:** no tool is named in any shipped file; the AC2 sweep in `smoke-merge.sh`
  covers the new files.
- **Consumer agnosticism (§ XI of the workspace):** synthetic repositories and an invented adapter
  only.
- **Twins:** Bash and PowerShell agree, enforced by SC-004.
- **Threat model:** FR-006 runs from the candidate's scripts, so it stops mistakes, not a hostile
  branch, which already controls `gates.yml`.

### Files touched

Current lines against the 300 target: `run-gate.sh` 101, `run-gate.ps1` 108, `smoke-merge.sh` 286,
`merge.md` and `quality-gates.md` under it. New, each under 300: `gate-impact`, `_gate_candidate`,
`_gate_impact_read`, `_gate_impact_adapter`, `_gate_impact_graph`, `_gate_evidence` (`.sh` and
`.ps1`), their tests and fixtures. Changed: `run-gate.sh`, `run-gate.ps1`, `gates.yml` stays
untouched (its bytes are the baseline), `merge.md`, `quality-gates.md`, `templates/manifest.json`,
`src/templates_bundle.ts`, plugin mirrors, `scripts/smoke/_surfaces.sh`,
`scripts/smoke/smoke-merge.sh` (widen the AC2 sweep to build tools, and split if it passes 300),
`specnaut-facts`. Web half: `docs/llms.md`.

### Complexity tracking

Six script pairs instead of one: the size ceiling and one decider per rule require it.

## 8. Surface impact

**Surfaces added or widened:** a repository file's strings reach a shell (`adapter.command`,
`scoped`), at the same trust level as `gates.yml`; a temporary worktree of the base; evidence under
the git directory; new flags and exit codes on a script agents and hooks call.

### Documentation (this feature)

`quality-gates.md` (contract, declaration, limitations), `docs/llms.md` in the web half,
`## Agent
adoption` in the commit. Limitations to state: a hung adapter hangs the run, as a gate
command does today; ignored files are not part of the candidate; each run costs a checkout; that
`scoped` truly narrows its gate is the project's claim, recorded in the evidence.

## 9. Risks

A wrong adapter under-selects: accepted and named, since only the project knows its graph; the
evidence records what was trusted. A hostile branch is out of the model (§ 7). A gate that leaves an
unignored file refuses with exit 3: strict by design. Windows is first exercised by CI.

## 10. Architecture audit

Verdict: fail on the first draft, all findings taken. The only shipped caller never narrowed, since
every branch commits its spec directory: `inert`. The reused loop drops commands, reproduced:
FR-000. One base snapshot for a multi-base push under-selects: one per base. The table missed
adapter, change set, selection, evidence and exit precedence: added. Gates mapped to no owner, so
nothing was ever omitted on a real diff: `owners`. `SPECNAUT_IMPACT_TREE` undefined and ignored
files hid a changed declaration: defined, tracked-regular-file check. Files table and the AC2 sweep:
added. A commit echo proves little: kept as a cheap sanity check only.

## 11. Security audit

No CRITICAL or HIGH; six MEDIUM and one LOW, all taken. Adapter from the base worktree (this
reverses the advisor's candidate copy: the seats' tie-break puts security first, and
`SPECNAUT_IMPACT_REPO` keeps a toolchain reachable). Stdin: FR-000. Full being the candidate's own
list: `removed:` and exit 4. Narrow base: merge-base comparison. `GIT_*` scrub. Symlinks: FR-006.
Matching gaps: FR-009, FR-010. Cleared by the seat: eval strings at `gates.yml` trust, filters,
evidence, the reviewer grant. Git plumbing claims rest on git's documentation until the tests
exercise them.

## 12. Open questions

None: the ticket records that no product question blocks it.

### Decided without asking

- No reference adapter ships. A shipped one names a tool; a directory-based one is what the ticket
  forbids.
- Rejected a binary subcommand (PATH and version skew, parity goldens), keys in `gates.yml` (its
  grammar forbids nesting), `git archive` (`export-ignore` drops paths), the candidate's adapter
  copy (security audit), and a union across distinct trees (would present one tree's pass as
  another's).
