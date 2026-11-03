# Plan: Wire the smoke suite to CI

**Branch**: `022-smoke-suite-ci` | **Date**: 2026-08-25 | **Backlog item**:
[#544 — Wire the smoke suite to CI — three checks were red across two majors](https://github.com/specnaut/specnaut-cli/issues/544)

---

## 1. Why this exists

The smoke suite is the only gate that runs the **real binary against a real scaffolded tree**. The
1413 Deno tests assert bundle contents; the smokes assert what a user actually gets. Nothing
schedules them, so they rot, and the rot is invisible until someone runs them by hand.

Measured, not estimated. All nine scripts against `main` at `9d227e8`, warm caches:

| Script                 | wall-clock |      red checks |
| :--------------------- | ---------: | --------------: |
| `smoke-features`       |      0.9 s |               0 |
| `smoke-backlog-local`  |      3.1 s |               0 |
| `smoke-backlog-github` |      0.3 s |               0 |
| `smoke-backlog-gitlab` |      0.2 s |               0 |
| `smoke-hooks`          |      0.8 s |               0 |
| **`smoke-picker`**     | **25.3 s** | **4 — exits 1** |
| `smoke-all-harnesses`  |      1.2 s |               0 |
| `smoke-tag-release`    |      0.4 s |               0 |
| `smoke-audit`          |      0.2 s |               0 |

`smoke-picker.sh` is **red right now** and is not in #544's list — an eighth red check, found by
running the suite while writing this plan. Two independent drifts, diagnosed:

1. The PTY driver sends 8 keystrokes (`smoke-picker.sh:45-54`). A "where are your specs stored"
   picker was added **between** the versioning-scheme step and the URL prompt. The 8th keystroke is
   consumed by that new picker, `init` then waits on "Paste your github project URL", never
   completes, and 3 assertions fail on a `.specnaut/` that was never written. The 25.3 s is the
   deadline at `smoke-picker.sh:62`, not work.
2. `smoke-picker.sh:112` asserts the string `hosted online Kanban`. The note now reads
   `real-time API — browser login`.

Neither is a product defect. **Every red check found so far — eight now — has been an assertion
drifting behind a deliberate change.** That is the argument: a suite that runs only when someone
remembers accumulates failures that say nothing about the product, and its signal decays to zero.

The reason it is not automatic is **where the scripts live**: the monorepo-root
`.claude/skills/test-sandbox/scripts/`, reached from this repository by a relative `../../` that
resolves only inside that workspace. In CI this repo is cloned standalone, so
`.specnaut/release/preflight.sh:44-46` takes its documented skip and `audit.sh` — the coverage gate
a release depends on — **has never run in CI**. The monorepo root has no `.github/workflows/` at
all, so there is no second place to hang the job.

### What the audits changed about this plan

Both plan-time audits returned **fail**. Three of their findings changed the design rather than
adding a line to it, and one of them was verified by experiment because it contradicted a promise
this plan had already made:

- **The suite does not test the working tree.** `specnaut init` scaffolds from the _generated_
  `src/templates_bundle.ts` (`src/cli/handlers/init_handler.ts:39`), never from `templates/` on
  disk. Proven: a marker appended to `templates/core/skills/board/SKILL.md` without re-bundling did
  **not** appear in the scaffolded output. A smoke job that does not bundle first asserts
  yesterday's artefact and stays green. See A3 — it is the same failure class as everything else in
  this ticket.
- **A decision-table row that admitted two readings, one of which breaks the meta-test.** See A1.
- **The plan's own FR-010 forbade what its own Q3 left optional.** See S1.

## 2. User scenarios

### US1 — A change breaks a shipped-template assertion (P1)

**Given** a change to `templates/core/` that renames a scaffolded path **When** the commit carrying
it reaches a branch the gate watches **Then** a CI check goes red and its log names the failing
assertion and the script that made it — with no maintainer having run anything by hand, and **after
the suite has re-bundled**, so the assertion is made against the tree in that commit rather than
against the committed bundle.

_Settled 2026-08-25 (Q2): the gate fires on **every branch push** as well as on pull requests, so it
goes red **before** `scripts/land.sh` puts the commit on `main`. This is prevention, not detection.
`smoke.yml` is deliberately the only workflow in the repository with that trigger — the reason is
that features land here by local `--ff-only`, so a `main`-only gate can only ever report after the
fact._

### US2 — A maintainer runs the guard from a bare clone (P2)

**Given** a clone of `specnaut/specnaut-cli` alone, with no monorepo workspace around it **When**
the maintainer runs the suite's single entry point **Then** every script runs, the audit runs, and
nothing reports "skipped — not the monorepo".

### US3 — A new shipped file arrives with no assertion (P2)

**Given** a new file under `templates/core/skills/` **When** the suite runs **Then** the coverage
scan names the file and the script expected to assert it — and if the file falls under **no** mapped
surface, the run says so rather than passing silently.

### US4 — The maintainer drives one scenario interactively (P3)

**Given** a UX question about brownfield behaviour **When** the maintainer invokes the root
`test-sandbox` skill **Then** the skill still bootstraps, inits and inspects a sandbox as it does
today.

### Edge cases

- **Cold npm cache.** `bootstrap-vite.sh:17` runs `npm create vite@latest`. Verified: with the
  registry pointed at a dead port it still succeeded, because `create-vite` was already cached — the
  success was the cache, not offline capability. Four scripts depend on it. See Q3/S1.
- **No `python3`.** `smoke-picker.sh:22-25` exits 1 with a message. `ubuntu-latest` ships it.
- **`git init` with no committer identity.** Only `smoke-audit.sh` commits, and it sets its own
  (`:30-31`). No CI-side git config needed.
- **A coverage gap mid-feature.** A new shipped file legitimately has no assertion for the life of
  the branch adding it. A gate red on a correct state gets switched off. See Q4.
- **A changed file under no mapped surface.** `audit.sh:134-136` skips it and prints
  `✓ every surface change has a matching smoke assertion`. See A6.
- **First push of a branch / force-push.** The audit diffs against the newest `v*.*.*` tag, not a
  pushed range, so it is immune to the all-zero `before` SHA `adoption_lint.yml:52-57` defends
  against.

## 3. Requirements

- **FR-001**: **Every one of the 16 scripts** resolves its paths without reference to any directory
  outside this repository. Set enumerated by `ls scripts/smoke/*.sh`; proven by
  `grep -n '\.\./\.\./\.\./\.\.\|apps/specnaut-cli' scripts/smoke/*.sh` returning nothing — and that
  grep runs **inside the suite** (A6/S6), not once at plan time.
- **FR-002**: One command runs the whole suite and exits non-zero if any check in any script is red.
- **FR-003**: The suite regenerates `src/templates_bundle.ts` **before** the first script runs, so
  every assertion is made against the working tree. It restores the file's prior state on exit.
- **FR-004**: `audit.sh` decides its own verdict through its exit code. No caller re-derives pass or
  fail by parsing its output — and `preflight.sh` still prints a named message rather than dying
  silently under `set -e`.
- **FR-005**: `smoke-audit.sh` runs in the same job, and **asserts the exit code**, not only stdout.
  Its `|| true` at `:88` currently swallows the very property FR-004 introduces.
- **FR-006**: `audit.sh` takes its source tree as an **explicit parameter**, defaulted. No caller
  and no relocation of the file may change its answer.
- **FR-007**: The job runs on **every branch push** and on `pull_request`, against the checked-out
  commit, with `permissions: contents: read`, a `timeout-minutes` bound, and a `concurrency` group
  keyed on the ref with `cancel-in-progress: true` (so a branch pushed repeatedly does not stack).
- **FR-008**: The checkout supplies the `v*.*.*` tags and enough history for the audit's diff.
- **FR-009**: `preflight.sh` runs the audit from the same path in the workspace and in a bare clone.
  Its standalone-clone skip is deleted, not narrowed.
- **FR-010**: **Every reference** in the workspace to the old script path is updated. Set enumerated
  by `grep -rn "test-sandbox/scripts" .`; today **56 lines across 16 files**, of which 8 are
  `smoke-audit.sh`'s own synthetic-tree heredocs, which **move rather than vanish**.
- **FR-011**: Every check in the suite is green when the feature lands, including `smoke-picker.sh`.
- **FR-012**: No check depends on a floating `@latest` resolution, and **the suite runs offline**.
  `bootstrap-vite.sh` writes the brownfield tree itself by default; a `--real` opt-in retains a true
  Vite scaffold for fidelity QA and pins it to an exact version. No smoke script passes `--real`.
- **FR-013**: Breaking one assertion on purpose makes CI red and the log names that assertion.

## 4. Success criteria

- **SC-001**: A change that breaks a shipped-template assertion is reported by CI on the commit that
  introduces it, **while it is still on a feature branch**, without a human running anything. Today:
  reported at the next manual run — up to two major versions later.
- **SC-002**: Red checks discovered at release time by a manual run: zero, because they were
  discovered at push time.
- **SC-003**: A person holding only this repository runs the complete guard with one command and no
  step reports itself skipped.
- **SC-004**: The whole suite finishes inside the budget a gate can carry — target ≤ 90 s on a
  **cold** runner. **Met: 21 s for the whole job, 11 s for the suite itself** — measured on the
  first green CI run
  ([run 32800245392](https://github.com/specnaut/specnaut-cli/actions/runs/32800245392), cold
  `ubuntu-latest`; checkout 2 s, setup-deno 2 s). The 7 s figure in §1 is warm-cache and was never
  the baseline.
- **SC-005**: A shipped file added with no assertion is named in the same run, together with the
  script expected to assert it — and a file under no mapped surface is named as unmapped.
- **SC-006**: Deliberately breaking one assertion produces a red run naming it. **Met** — on a
  throwaway branch, since deleted
  ([run 32800324275](https://github.com/specnaut/specnaut-cli/actions/runs/32800324275), conclusion
  `failure`). The log named the assertion, the failing command, the script and the verdict:

  ```
  ❌ the board skill exists to be checked at all — command: [ -f .claude/skills/board/DELIBERATELY-BROKEN-FOR-T043.md ]
  ═══ FEATURES: 1 CHECK(S) FAILED ═══
  ❌ smoke-features.sh — exit 1
  red: smoke-features.sh
  ═══ SUITE: 1 CHECK(S) FAILED ═══
  ```

  Recorded alongside it, because it is the point of Q2 observed rather than argued: on that same
  branch push **`ci` did not run at all** — `ci.yml` fires only on `main` and pull requests. Without
  this workflow's trigger, nothing would have checked that commit before it landed.

## 5. 🔒 Decision table

| The decision                                                          | Its single home                                                                                                               | What would duplicate it                                                                                                                                                                      |
| :-------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** Where the source tree is, and how a script names its own paths | `scripts/smoke/_common.sh` (exports `CLI`, `SRC_ROOT`, `SMOKE_DIR`, `SUITE_FILES`)                                            | The `ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"` climb — 15 copies today; a `SRC_ROOT` environment override; a second derivation inside `audit.sh`                                    |
| **R2** What `audit.sh` treats as its source tree                      | `audit.sh --src-root <dir>`, **injected**, defaulting to `_common.sh`'s value                                                 | Deriving it from the caller's cwd (today's `audit.sh:52`, which answers differently depending on where you stand) or from the script's own inode location (breaks `smoke-audit.sh` — see A1) |
| **R3** Which scripts constitute "the suite"                           | `SUITE_FILES` in `scripts/smoke/_common.sh`, consumed by `run-all.sh` **and** by both of `audit.sh`'s scans                   | A list in `smoke.yml`; a list in the root `SKILL.md`; a list in `preflight.sh`; `audit.sh:230`'s `smoke-*.sh` glob; the script names hardcoded in `audit.sh:91-103`                          |
| **R4** How a check reports pass/fail                                  | `scripts/smoke/_common.sh` (`pass`/`fail`/counter/banner)                                                                     | The 9 private copies that exist today, and the 12 distinct banner strings they print                                                                                                         |
| **R5** What counts as an audit failure                                | `scripts/smoke/audit.sh` exit code — a stale assertion is **always** fatal, a coverage gap is fatal unless allow-listed (R13) | `preflight.sh:49-52`'s `grep -oE '[0-9]+ coverage gap'` parse; a `continue-on-error`; a branch-name test in the workflow; a maintainer's habit of ignoring a warning                         |
| **R13** Which coverage gaps are deliberately unasserted, and why      | one allow-list file beside `audit.sh`, each entry carrying a written reason                                                   | A `--allow-gaps` flag passed at the call site; a gap tolerated because the run was on a branch; a comment in a smoke script                                                                  |
| **R6** What the audit does with a surface it does not recognise       | `scripts/smoke/audit.sh` — it **reports** it under `## Unmapped surface` and counts it                                        | `audit.sh:134-136` and `:223-225` silently `continue`/`return 0`, which is a green gate covering a shrinking fraction of the surface                                                         |
| **R7** Which artefact the suite exercises                             | `scripts/smoke/run-all.sh` — it runs `deno task bundle` first and restores the file on exit                                   | A per-script bundle call; relying on the committed bundle being fresh; `deno.json`'s `test` task, which bundles for the Deno suite only                                                      |
| **R8** Which runtime paths the stale scan can resolve                 | `resolves()` in `scripts/smoke/audit.sh`                                                                                      | A second allow-list in a smoke script; a skip-list in the workflow                                                                                                                           |
| **R9** How a scenario is named, and whether the suite runs serially   | `scripts/smoke/run-all.sh`                                                                                                    | Each script inventing its own; a parallel run where `clean.sh:12-14` (no argument → wipes all of `sandbox/`) races another script's fixture                                                  |
| **R10** Whether the smoke job may hold a credential                   | `scripts/smoke/smoke.yml` — its `permissions:` block plus a header comment stating the invariant                              | A repo secret provisioned for an unrelated need; a later switch to `pull_request_target` to post a PR comment; a `GH_TOKEN` added "so `gh` works"                                            |
| **R11** What a valid scenario name is                                 | `scripts/smoke/_common.sh`, one allowlist                                                                                     | A check inside `clean.sh`; a caller trusting its own argument — `clean.sh:15` is `rm -rf "$CLI/sandbox/$1"`                                                                                  |
| **R12** That the smoke suite is a CLI-repository concern              | `apps/specnaut-cli/scripts/smoke/` — the location itself                                                                      | A copy kept at the monorepo root "for the skill"; a monorepo workflow running the same scripts against the submodule pointer                                                                 |

**R3, as built, is one authority plus a detector.** `audit.sh` enumerates the scripts on disk rather
than reading `SUITE_FILES`, then fails if the two disagree. That is not the second list the row
forbids: the enumeration has no authority of its own, and the reconcile is what turns "somebody
added a smoke and never wired it in" from a silent omission into a finding. Recorded here because a
future reader would otherwise be right to "fix" the glob back out.

**Binding on the implementer.** R1/R2 were two rows for one question in the audited draft, and R2's
wording admitted a reading that breaks the meta-test. They are now one home with one injected
override. The only thing that stays at the monorepo root is the `test-sandbox` **skill document**,
reduced to a facade naming **one** entry point. `specnaut/specnaut-monorepo#7` centralised skills
and agents and that stands — it never said the shell fixtures a skill drives must live beside it.

## 6. Technical context

**Language/Version**: Bash **3.2** — not ≥ 4. `smoke-all-harnesses.sh:19-21` deliberately avoids
`declare -A` for macOS's stock bash, and `_common.sh` must hold that floor or it breaks US2 and US4
on the maintainer's own machine while passing on `ubuntu-latest`. **Primary Dependencies**: `git`,
`deno` 2.x, `python3` (PTY test only), `npm` (brownfield bootstrap only — pending Q3). **Storage**:
none. Every scenario is a throwaway tree under `sandbox/`, gitignored here. One exception to note:
`smoke-hooks.sh:112,122` writes `/tmp/spec-lock-backup-$$`. **Testing**: the scripts are the tests.
`smoke-audit.sh` is the meta-test for `audit.sh`. **Target Platform**: `ubuntu-latest` in CI;
macOS + Linux locally. Not Windows — bash fixtures, and `ci.yml`'s `cross-smoke` matrix already
covers Windows through the Deno suite. **Performance Goals**: ≤ 90 s on a cold runner. ~15
`deno run` invocations (7 inside `smoke-all-harnesses.sh` alone), first one paying cold JSR
resolution for 9 imports. **Constraints**: no floating upstream version in the gate; a red run names
what broke; `preflight.sh` keeps working unchanged from a maintainer's workspace. **Scale/Scope**:
16 scripts + 2 new = 18 files, 2,334 lines today; 56 referencing lines across 16 files; 3 shipped
surfaces.

### Domain model

No new entities. Vocabulary the code must use consistently:

- **Bounded context**: the CLI repository's own quality gates.
- **Vocabulary**: _the suite_ (`SUITE_FILES`), _the audit_ (`audit.sh`), _the meta-test_
  (`smoke-audit.sh`), _a scenario_ (one `sandbox/<name>/` tree), _the toolbox_ (bootstrap, run-init,
  inspect, compare, clean).
- **Invariant**: every asserting script needs the toolbox — all nine reach `bootstrap-*.sh` and
  `clean.sh` through `$SCRIPT_DIR`. The 16 scripts are **one unit**; a partial move is not
  available.
- **Invariant**: the meta-test must be able to point the audit at an arbitrary tree without
  relocating it. R2 is what makes that true.

## 7. Constitution check

| Principle                                    | Verdict           | Note                                                                                                                                       |
| :------------------------------------------- | :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| I — OSS/proprietary boundary                 | pass              | Swept: the private half's names across all 16 scripts returns zero. But see Complexity tracking — S1 opens a § I _path_, not a § I _leak_. |
| II — HTTP contract is the only bridge        | pass              | Not touched.                                                                                                                               |
| III — the monorepo holds no product code     | improves          | Moves 16 fixtures out of the workspace root into the half that owns them.                                                                  |
| IV — cross-cutting change discipline         | pass, and binding | Two repos. Submodule pushed **first**, pointer second. See A13 for where the closing keyword goes.                                         |
| V — local merge by default                   | pass              | `scripts/land.sh cli 022-smoke-suite-ci`, then the root. No PR.                                                                            |
| VI — centralised backlog routing             | pass              | #544 closes through the landing; `land.sh` reconciles the board.                                                                           |
| VII — submodule autonomy                     | improves          | The CLI gains a guard it can run standalone. The skill stays centralised.                                                                  |
| VIII — no pinned versions in long-lived docs | pass, with care   | The rewritten `SKILL.md` must not restate a harness count or a script count.                                                               |
| IX — dogfooding                              | pass              | This is the dogfooding loop being repaired.                                                                                                |
| X — epic status mirrors children             | n/a               | #544 has no children.                                                                                                                      |
| XI — consumer agnosticism                    | pass              | No consuming project is named anywhere in the moving files.                                                                                |

### Complexity tracking

**No constitutional violation is introduced.** Two things the audited draft got wrong are corrected
here rather than carried:

1. **The shipped template is not a defect.** The draft claimed
   `templates/core/skills/verification-before-completion/SKILL.md:105` shipped a workspace-only path
   to every user. Re-read in context, lines 92-97 gate the whole section explicitly: _"Three extra
   gates, and they apply to exactly one kind of project: one that contains `templates/core/`.
   Everywhere else the conditions below are false by construction… it is here because Specnaut's own
   maintainers receive this skill the same way you did."_ That is a correct, self-scoping design.
   The only thing this feature owes it is a **path update**, in that file and its `plugin/` mirror,
   with the bundle regenerated. Q4 in the audited draft is therefore **withdrawn, not answered.**
2. **Class scan re-run 2026-08-25**, per the standing rule to size such a ticket against the grep
   rather than against the report. It returns 3 hits under `templates/core/`:
   `verification-before-completion/SKILL.md:105` (in scope, above); `agents/specnaut-guide.md:190`
   (prose about the product's own layout — legitimate); `skills/alias-example/SKILL.md:52` (ships
   `cp -r templates/core/…` to projects that have no `templates/` — a real papercut, **unaffected by
   this change**, and deliberately out of scope rather than unnoticed).

**One accepted objection, recorded (S1).** `bootstrap-vite.sh:17` fetching an unpinned upstream
package is not merely a CI-flakiness risk: the same script is what the `qa-tester` agent runs **on
the maintainer's workstation**, whose working tree contains `apps/specnaut-cloud`. A compromised
`create-vite` release reaches the private half. That is a § I exposure path no review of
`apps/specnaut-cli/` would ever surface, because the vulnerable byte is not in the repository. It is
what moves Q3 from a convenience question to a boundary question.

## 8. Surface impact

| Surface                                                                           | Touched?           | What changes                                                                                                                                                                                                                                                                                                                                |
| :-------------------------------------------------------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/specnaut-cli/scripts/smoke/`                                                | yes — new          | 16 scripts land here, plus `_common.sh` and `run-all.sh` = 18 files.                                                                                                                                                                                                                                                                        |
| `apps/specnaut-cli/.github/workflows/smoke.yml`                                   | yes — new          | The job. `permissions: contents: read`, `timeout-minutes`, `concurrency`, `fetch-depth: 0`, and a header comment owning R10's invariant.                                                                                                                                                                                                    |
| `apps/specnaut-cli/scripts/smoke/audit.sh`                                        | yes                | `--src-root` parameter (R2); exit code as verdict (R5); `## Unmapped surface` section (R6); scans read `SUITE_FILES` instead of the `smoke-*.sh` glob at `:230` and the hardcoded names at `:91-103` (R3).                                                                                                                                  |
| `apps/specnaut-cli/scripts/smoke/smoke-audit.sh`                                  | yes                | Stops copying `audit.sh` (`:58`) — invokes it in place with `--src-root "$SANDBOX"`; asserts the **exit code** as well as stdout (FR-005). Its 8 internal path references **move, they do not vanish**.                                                                                                                                     |
| `apps/specnaut-cli/scripts/smoke/smoke-picker.sh`                                 | yes                | One extra keystroke for the spec-backend picker; the `hosted online Kanban` assertion updated; a hard per-script timeout so a hang fails fast and named.                                                                                                                                                                                    |
| `apps/specnaut-cli/.specnaut/release/preflight.sh`                                | yes                | `audit_sh` → `scripts/smoke/audit.sh`; skip branch deleted; output parse at `:49-52` deleted but its named `❌` message kept (FR-004). Interaction with the clean-tree check at `:13` resolved by R7's restore-on-exit.                                                                                                                     |
| `apps/specnaut-cli/templates/core/skills/verification-before-completion/SKILL.md` | yes                | One path, inside an already-correctly-gated section.                                                                                                                                                                                                                                                                                        |
| `apps/specnaut-cli/plugin/skills/verification-before-completion/SKILL.md`         | yes                | Byte-identical mirror.                                                                                                                                                                                                                                                                                                                      |
| `apps/specnaut-cli/src/templates_bundle.ts`                                       | yes, generated     | `deno task bundle`; `ci.yml:22-35` already fails on a stale bundle.                                                                                                                                                                                                                                                                         |
| monorepo `.claude/skills/test-sandbox/scripts/`                                   | yes — deleted      | The whole directory.                                                                                                                                                                                                                                                                                                                        |
| monorepo `.claude/skills/test-sandbox/SKILL.md`                                   | yes                | 28 references → **one** entry point plus `run-all.sh --list`. A facade that narrows, not a middle-man that mirrors.                                                                                                                                                                                                                         |
| monorepo `.claude/agents/qa-tester.md`                                            | yes                | 2 invocation paths.                                                                                                                                                                                                                                                                                                                         |
| monorepo `.claude/skills/writing-plans/SKILL.md`                                  | yes                | 1 checklist reference.                                                                                                                                                                                                                                                                                                                      |
| monorepo `.claude/skills/verification-before-completion/SKILL.md`                 | yes                | 1 reference (root copy).                                                                                                                                                                                                                                                                                                                    |
| monorepo `.claude/agents/*/memory/*.md`                                           | **4 files, not 3** | `reference_submodule_has_no_dotclaude.md` is `type: reference` — read by agents as **current fact**, and `:17` hardcodes the absolute workspace path. It gets **rewritten**, not preserved. `pattern_a_guard_belongs_on_the_repo_it_guards.md` gets a closing line. The two `architect-advisor` notes are dated records and are left alone. |
| monorepo `docs/superpowers/**`                                                    | 2 files, no        | Dated design records.                                                                                                                                                                                                                                                                                                                       |
| GitHub branch protection / required checks                                        | **no**             | The job reports; whether it is _required_ is a repository setting, left at its default.                                                                                                                                                                                                                                                     |

### Documentation (this feature)

```text
.specnaut/specs/022-smoke-suite-ci/
├── plan.md    # This file
└── tasks.md   # derived from THIS file once approved
```

## 9. Risks

| Risk                                                                                                                                                                                         | Mitigation                                                                                                                                                                         |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The suite goes green against the committed bundle instead of the working tree — the exact defect this ticket exists to end, reintroduced one level up. **Proven, not hypothesised.**         | R7: `run-all.sh` bundles first and restores on exit. FR-013's deliberate break is the check that this actually holds.                                                              |
| `npm create vite@latest` puts an unpinned upstream fetch in the gate **and on the maintainer's workstation next to the private half**.                                                       | Q3. Recommended: `bootstrap-vite.sh` writes the tree itself; any surviving `--real` opt-in pins exactly. FR-012 is not subject to Q3.                                              |
| `audit.sh` fails open on unmapped surfaces (`:134-136`, `:223-225`). Made mandatory, that becomes a green gate covering a shrinking fraction.                                                | R6: report and count unmapped surfaces. Cheap — one output section.                                                                                                                |
| `smoke-picker.sh` drives a PTY with scripted keystrokes; it drifts every time the flow gains a step, and in CI a hang costs the job timeout, not 25 s.                                       | Fix it (FR-011), give it a hard per-script timeout, and bound the job (`timeout-minutes` + `concurrency`, S5). Keep it in the suite — a picker nobody exercises is how it drifted. |
| The coverage-gap signal fires on a correct mid-feature state, the gate gets marked "ignore it", and the guard is dead again for a new reason.                                                | R5 + R13: a deferred assertion is written down with its reason rather than tolerated. The escape exists, so the gate is never wrong; it costs one line, so it is never free.       |
| The allow-list itself becomes the new hiding place — entries added and never removed, exactly as the assertions rotted.                                                                      | Each entry carries a reason, and `audit.sh` reports an entry whose file no longer exists as a **stale allow-list entry**, in the same register as a stale assertion.               |
| A future edit adds a secret, switches to `pull_request_target`, or grants `contents: write` — each one line, each plausible, and today nothing in the repo records why they must not happen. | R10 + the header comment, in the register `adoption_lint.yml:61-66` already uses.                                                                                                  |
| `run-all.sh --only <name>` turns a typo into `rm -rf` outside the sandbox (`clean.sh:15`). Latent today because every caller passes a literal; this plan adds the first programmatic caller. | R11: one allowlist in `_common.sh`, written while the file is being created.                                                                                                       |
| The move breaks the `qa-tester` agent's documented commands, and that agent is dispatched by name from sessions that never read this plan.                                                   | In FR-010's enumerated set; lands in the same monorepo commit.                                                                                                                     |
| A reference is missed and rots exactly as the assertions did.                                                                                                                                | FR-010 names the search, not the files. FR-001's grep runs **inside the suite**, so a green run is the evidence.                                                                   |
| The pointer lands ahead of an unpushed submodule commit.                                                                                                                                     | § IV: submodule first. `land.sh` verifies the push.                                                                                                                                |
| The board says done while half the change is unlanded.                                                                                                                                       | A13: the closing keyword goes in the **monorepo** commit, not the CLI one.                                                                                                         |

## 10. Architecture audit

_`architect-expert`, run against this document before any code existed. Verdict: **fail** — 1
Critical, 5 High, 6 Medium, 2 Low, plus six requirements with no decision-table row._

| #   | Finding                                                                                                                                                                                                                                                | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | **Critical.** Row "SRC_ROOT derived from the script's own location" breaks `smoke-audit.sh`, which copies `audit.sh` alone into a synthetic tree (`:58`) and runs it there — 3 of its 4 assertions would fail on the first CI run.                     | **Plan changed, finding partly corrected.** Verified by experiment: a `dirname ../..` climb yields `$SANDBOX/.claude/skills` (breaks it); `git -C "$SMOKE_DIR" rev-parse --show-toplevel` yields `$SANDBOX` (does not). The row admitted **both readings without saying which** — that ambiguity is the real defect, and in a table whose entire purpose is to remove it. Adopted the recommendation, which beats both: R2 makes the source tree an **injected parameter**.                                                                                                                                               |
| A2  | **High.** R1 and R6 were two homes for one question, and `_common.sh` is incompatible with `smoke-audit.sh:58`'s single-file `cp`.                                                                                                                     | **Plan changed.** Collapsed into R1 + R2. `smoke-audit.sh` stops copying and invokes the real `audit.sh` with `--src-root`, which also deletes the "is the copy the same as the original" question.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A3  | **High.** No row for whether the suite exercises `templates/` or the committed bundle. `init` scaffolds from `CORE_BUNDLE` (`init_handler.ts:39`); no smoke bundles first; US1 fails by construction.                                                  | **Plan changed — and verified by experiment before accepting.** Appended a marker to `templates/core/skills/board/SKILL.md` without re-bundling; it did **not** reach the scaffolded output. New R7 + FR-003, and §1 records it as the same failure class as the ticket itself.                                                                                                                                                                                                                                                                                                                                           |
| A4  | **High.** FR-003 (now FR-004) inverts `audit.sh:10-11,17-21`'s documented "exit 0 regardless of findings" contract, and `smoke-audit.sh:88`'s `\|\| true` means nothing tests the new one. `preflight.sh` under `set -e` would lose its named message. | **Plan changed.** New FR-005 requires the meta-test to assert the exit code; FR-004 requires `preflight.sh` to keep a named `❌` line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A5  | **High.** The `_common.sh` extraction is invisible to `audit.sh`'s own scans: `:230` globs `smoke-*.sh`, and `:91-103` hardcodes script names, so a hoisted assertion silently stops covering its surface and reports a false gap.                     | **Plan changed.** R3 makes `SUITE_FILES` the one membership list, consumed by `run-all.sh` **and** both scans.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A6  | **High.** Three cycles out: `audit.sh:134-136` and `:223-225` fail open. Made a required gate without a complete or self-checking surface map, it reads "green across two majors" — #544's failure mode, one level up and harder to spot.              | **Plan changed.** New R6: report unmapped surfaces and count them. SC-005 extended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A7  | **Medium.** FR-005/US1/SC-001 assume a pre-merge gate this repo does not have: `ci.yml:3-7` and `adoption_lint.yml:12-15` fire on `main` pushes and PRs only, because features land by local `--ff-only`.                                              | **Plan changed, and escalated to a question.** US1 no longer promises a moment; SC-001 is qualified. But the audit's premise cuts both ways — under the house workflow, firing on _feature-branch_ pushes would give genuine pre-land coverage that no existing workflow provides. That is **Q2**, not an assumption.                                                                                                                                                                                                                                                                                                     |
| A8  | **Medium.** FR-011 (now FR-013) has no home; 9 scripts each define `pass`/`fail`/counter, 12 distinct banners.                                                                                                                                         | **Plan changed.** R1's scope widened and R4 added — the harness is one responsibility with one owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A9  | **Medium.** R2 forbade three membership lists while a fourth already existed (`audit.sh:91-103`) and §8 preserved a fifth at 28 sites.                                                                                                                 | **Plan changed.** R3 unifies them; §8 reduces `SKILL.md` from 28 references to one entry point.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A10 | **Medium.** §8 undercounts: 4 memory files, not 3 — and the fourth is `type: reference`, read as current fact, with an absolute workspace path at `:17`. `smoke-audit.sh`'s 8 references move rather than vanish.                                      | **Plan changed. Confirmed by re-running the grep** — 4 files, and the frontmatter reads `type: reference`. §8 corrected on both counts; the reference memory is rewritten, not preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A11 | **Medium.** §6 declared bash ≥ 4; `smoke-all-harnesses.sh:19-21` deliberately targets macOS bash 3.2. A `_common.sh` at the declared floor passes CI and breaks US2/US4.                                                                               | **Plan changed.** §6 now says bash 3.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A12 | **Medium.** SC-004's 90 s is measured warm; and no row owns scenario naming, so a parallelised `run-all.sh` races `clean.sh:12-14`.                                                                                                                    | **Plan changed.** SC-004 states the 7 s figure is warm-cache and not the baseline; R9 added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A13 | **Low.** `land.sh cli` fires the closing keyword and reconciles the board while the monorepo half is unlanded — the board says done while 56 lines still name a directory about to disappear.                                                          | **Plan changed.** The closing keyword goes in the **monorepo** commit; the CLI commit only references #544. **Right in principle, wrong in form — corrected after landing.** A bare `Closes #544` in a monorepo commit resolves against `specnaut/specnaut-monorepo#544`, which does not exist, so the keyword was a silent no-op and #544 had to be closed explicitly. Cross-repo closing needs the full `specnaut/specnaut-cli#544`. The project's own `close-keyword-needs-a-resolvable-ref` memory already said not to rely on the keyword for monorepo-root work; it was read at close time instead of at plan time. |
| A14 | **Low.** The class scan the project's own memory prescribes was not run; the plan sized Q4 against the report, not the grep.                                                                                                                           | **Plan changed, and the finding paid off beyond its own scope.** Running it surfaced that the shipped template is **already correctly gated** — so the draft's Complexity-tracking claim was wrong and Q4 is withdrawn rather than answered. Scan result recorded in §7.                                                                                                                                                                                                                                                                                                                                                  |

**Verdict**: fail, advisory. Coverage named by the expert: the decision table row-by-row against
every requirement; all 16 scripts read for path derivation, `deno run` counts, harness duplication
and bash assumptions; `audit.sh` (278 lines) and `smoke-audit.sh` in full, the latter traced
line-by-line against the SRC_ROOT row; `preflight.sh` in full; `ci.yml` and `adoption_lint.yml`
trigger blocks; the scaffolding path from `run-init.sh` through `init_handler.ts:39` to
`CORE_BUNDLE` — which is what produced A3. **Not covered**: the 2,334 lines of assertion content,
including `smoke-picker.sh`'s root cause (diagnosed separately in §1); CI security (the parallel
seat); and whether 90 s is achievable cold.

## 11. Security audit

_`security-expert`, run in parallel. Verdict: **fail** — 1 High, 4 Medium, 2 Low, against a measured
baseline._

**It corrected the brief it was given, and the correction was verified independently.** The dispatch
said `HOMEBREW_TAP_TOKEN` and `WIKI_SSH_KEY` exist on this repository. They do not. Confirmed by
direct API read (names and counts only): **0 Actions secrets, 0 org secrets, 0 Dependabot secrets, 0
environments**, `default_workflow_permissions: read`, `approval_policy: first_time_contributors`,
public, 0 forks. `release.yml:339-341` documents the deletion on 2026-08-22 as deliberate — the
packaging targets pull from the public Releases API instead. _(The stale line is in the monorepo's
`/release` skill prose, which this plan does not touch. Noted for separately.)_

| #  | Finding                                                                                                                                                                                                                                                                                                                                                                                                          | What was done                                                                                                                                                                                                                                                                                                                                         |
| :- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 | **High.** `bootstrap-vite.sh:17` executes an unpinned, lifecycle-script-executing upstream package inside the gate. In CI that is marginal — the runner already runs fork code. **Outside CI it is not**: the same script is what `qa-tester` runs on the workstation holding `apps/specnaut-cloud`. And the plan contradicted itself — FR-010 forbade a floating `@latest` while Q3 left the npm call optional. | **Plan changed, objection upheld in full.** FR-012 is now explicitly **not subject to Q3**; Q3 decides only the mechanism. §7 Complexity tracking records the § I exposure path, which is the argument that actually decides it — not CI flakiness. Cost of deferring is named: one file now, four scripts plus every calcified path assertion later. |
| S2 | **Medium.** No `permissions:` block — the grant is inherited from a GitHub-side toggle the plan explicitly declines to manage, so flipping it to `write` silently re-grants write to a job whose purpose is running untrusted code.                                                                                                                                                                              | **Plan changed.** FR-007 requires `permissions: contents: read`, as `adoption_lint.yml:22-23` already does.                                                                                                                                                                                                                                           |
| S3 | **Medium.** The design's safety rests on three facts (zero secrets, `pull_request` not `pull_request_target`, read-only token) recorded nowhere — and the decision table, whose whole premise is one-decision-one-home, had no row for the most consequential decision in the feature.                                                                                                                           | **Plan changed.** R10 added, plus a header comment in `smoke.yml` in the register `adoption_lint.yml:61-66` and `pr-link-comment.yml:36-42` already use.                                                                                                                                                                                              |
| S4 | **Medium.** Unvalidated scenario name reaches `rm -rf` (`clean.sh:15`, `bootstrap-*.sh`). Not reachable today — every caller passes a literal — but this plan adds the first programmatic caller, and `--only <name>` is the obvious next affordance.                                                                                                                                                            | **Plan changed.** R11 added: one allowlist in `_common.sh`, written while that file is being created anyway. One function now, 16 edits later.                                                                                                                                                                                                        |
| S5 | **Medium.** No `timeout-minutes` and no `concurrency` on a job a returning contributor can trigger, against GitHub's 360-minute default — and `smoke-picker.sh` is a demonstrated hang.                                                                                                                                                                                                                          | **Plan changed.** FR-007 requires both. The per-script timeout and the job bound are different guarantees and the plan keeps both.                                                                                                                                                                                                                    |
| S6 | **Low.** FR-001's grep is a one-time human check for a defect whose entire history is that it rots.                                                                                                                                                                                                                                                                                                              | **Plan changed.** FR-001 now runs its own grep inside the suite, so a green run is the evidence.                                                                                                                                                                                                                                                      |
| S7 | **Low.** `smoke-picker.sh:96-122` dumps the raw PTY buffer into a world-readable public log — log forgery and terminal-escape effects, no credential exposure.                                                                                                                                                                                                                                                   | **Plan changed.** The picker's failure detail is stripped of escapes and capped, following `smoke-hooks.sh:108`'s existing `head -1` instinct.                                                                                                                                                                                                        |

**Verdict**: fail, advisory. Coverage named by the expert: this document in full; all five workflows
(including `pr-link-comment.yml`, absent from the brief and the repo's best model for untrusted
input); all 16 scripts — read in full for the toolbox, `smoke-picker`, `smoke-hooks`, `smoke-audit`,
and grepped across all 16 for network calls, token usage, writes outside `sandbox/`, and
private-half identifiers (**zero hits**); `deno.json` permissions and `deno.lock`'s presence;
`preflight.sh:35-52`; the shipped hook `check-backlog-prereqs.sh`; and eight live `gh api` reads of
the repository's security posture. **Not covered**: `src/main.ts` runtime behaviour under
`--allow-all` (pre-existing in `ci.yml:41` — `deno.json:7` already grants `--allow-run` to fork code
on the same event, so the capability ceiling is unchanged and the expert declined to inflate it),
per-dependency CVE triage, and `smoke-features.sh`'s ~250 assertions, grepped rather than read.

**The two seats agreed on one thing from opposite directions**: the plan's most consequential
decisions were the ones with no row. A1 found it in the source-tree derivation; S3 found it in the
credential invariant. Both are now rows.

## 12. Open questions

_Asked at the stop that ends this phase — one at a time, ordered so the answer that invalidates the
most others comes first._

| Question                                              | Answer                                                                                                                                                                                                                                                                                                                                        | Date       |
| :---------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- |
| Q1 — Where do the scripts live?                       | **In this repository**, at `apps/specnaut-cli/scripts/smoke/`. The root `test-sandbox` skill stays where it is and becomes a facade. Rationale accepted: every regression that rotted a check landed as a commit here, and every assertion is about this repository's shipped templates — a guard belongs to the repo whose changes break it. | 2026-08-25 |
| Q2 — When does the gate fire?                         | **Every branch push, plus `pull_request`.** Deliberately unlike `ci.yml` and `adoption_lint.yml`, and the workflow header must say why: features land here by local `--ff-only`, so the branch push is the last moment a gate can still prevent rather than report.                                                                           | 2026-08-25 |
| Q3 — Does the brownfield bootstrap keep its npm call? | **No, not by default.** `bootstrap-vite.sh` writes the tree itself; `--real` is an opt-in, pinned exactly, for fidelity QA — the real `.gitignore` is what the brownfield-merge scenario was originally validated against, so the fidelity path is kept rather than deleted. No smoke passes `--real`, so the suite is offline.               | 2026-08-25 |
| Q4 — Is a coverage gap fatal?                         | **Yes, unless allow-listed with a written reason** (R13); a stale assertion is always fatal. Chosen over "gaps warn only" because with local `--ff-only` the branch push is the last gate — a warning would block nowhere.                                                                                                                    | 2026-08-25 |

_(The audited draft's Q4 — "how far does the shipped-template fix go" — is **withdrawn**. Re-reading
`verification-before-completion/SKILL.md:92-97` showed the section is already correctly self-gating;
it needs a path update, not a decision. See §7.)_

### Decided without asking

- **The 16 scripts move as one unit.** Not a judgement call: all nine asserting scripts reach
  `bootstrap-*.sh` and `clean.sh` through `$SCRIPT_DIR`.
- **`scripts/smoke/` rather than `tests/smoke/`.** `tests/` is what `deno task test` walks; a bash
  file there is noise to one runner and invisible to the other.
- **A shared `_common.sh` rather than 16 corrected path climbs.** The 15-way repetition is what made
  this a 15-file edit; correcting it 15 times reproduces the defect at a new depth.
- **`audit.sh` takes `--src-root` rather than deriving it.** Both ambient mechanisms (caller's cwd,
  script's own location) are invisible inputs; one of them breaks the meta-test. Injection removes
  the class.
- **`ubuntu-latest` only.** Bash fixtures. Windows product coverage already exists via `ci.yml`'s
  `cross-smoke`.
- **A separate `smoke.yml`, not a job inside `ci.yml`.** Its own named check, independently
  re-runnable.
- **Repository settings are not touched.** The job reports; whether it is _required_ is a
  GitHub-side default left alone.
- **`pull_request`, never `pull_request_target`** — and now written down (R10) rather than merely
  done.
- **`docs/superpowers/**` and the two `architect-advisor` memories keep the old path.** Dated
  records. The `product-owner` reference memory does not — it is current fact and gets rewritten.
- **`alias-example/SKILL.md:52` stays out of scope**, deliberately and on the record: the class scan
  found it, and this change does not make it worse.
