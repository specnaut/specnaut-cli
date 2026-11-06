# Plan — show what is new in each crossed release after an upgrade (cli#759)

Full plan. The first draft added an outbound call and runtime text from outside the binary (step 4b
threshold). The audits (§ 4) moved the design to **embedding the highlights in the binary**, which
removes both. The plan stays full because it still changes a public interface (`specnaut upgrade`
stdout) and an agent instruction surface (`/specnaut upgrade` step 8).

## 1. Task and out of scope

**Outcome.** After `specnaut upgrade` moves a project from templates vA to vB, the user reads, for
every release in (vA, vB] in version order, that release's highlights and a link to its full notes.
With no version change, it says so and shows nothing. `/specnaut upgrade` reports the block
verbatim, fenced, as release text.

**Out of scope.** How `HIGHLIGHTS.md` is authored (unchanged: the release step only _copies_ it);
the `specnaut-guide` `review-upgrade` walk; releases outside (vA, vB]; downgrades; `--dry-run`
(prints nothing new); the Go port (it has no `upgrade` command: `internal/cli/dispatch.go` answers
"not ported" — its port, under epic cli#660, inherits the data file and this rule).

### Scenarios

- **S1** 9.0.0 → 9.2.0: a block for 9.1.0, then 9.2.0; each holds that release's highlights and
  `https://github.com/specnaut/specnaut-cli/releases/tag/v<X>`.
- **S2** vA = vB: "No version change — no release notes to show."
- **S3** A crossed release with no recorded highlights (before v3.0.0, or an empty `HIGHLIGHTS.md`):
  its block says "no highlights for this release" and still gives the link.
- **S4** A crossing with no file work (every file `unchanged`, only the version moved — v4.0.0 →
  v4.0.1 was one): the up-to-date branch shows the notes too. Today it drops vA.

### Requirements

- **FR-001** The crossed range is (vA, vB], vA the version the lock recorded _before_ this run, vB
  the binary's templates version. Decided once in the use case for both the applied and the
  up-to-date result; never keyed on `status`.
- **FR-002** The binary carries the history of release highlights as committed data: one file per
  release, `.specnaut/release/history/v<X>.md`, equal to that release's `HIGHLIGHTS.md`. The bundler
  embeds them; vB's own file is in it, because the release commit writes it.
- **FR-003** Crossed releases = history entries in (vA, vB], SemVer order (`domain/release.ts`),
  plus a release that has no entry (S3) is not invented: the list is the history's, and a gap is
  said once ("releases before v3.0.0 published no highlights").
- **FR-004** The link is built from `RELEASE_REPO` and the parsed version, never stored.
- **FR-005** The history is first-party text, checked at bundle time: the bundler refuses a history
  file holding a C0 (except `\n`), C1, bidi or zero-width character, or CRLF. Printed as is.
- **FR-006** The release step writes `history/v<X>.md` from `HIGHLIGHTS.md` in the release commit;
  `scripts/check-release-commit.ts` refuses a release commit whose history file is missing or
  differs from `HIGHLIGHTS.md` (whitespace-insensitive, its existing `flat`).
- **FR-007** One-time backfill: `history/v<X>.md` from
  `git show v<X>:.specnaut/release/HIGHLIGHTS.md` for every tag v3.0.0..v9.2.0 that has a non-empty
  one.
- **FR-008** The upgrade's exit code and written files do not depend on the notes.
- **FR-009** Phase step 8 (both copies) reports the block inside a fence longer than any it
  contains, says it is the release text quoted, and runs nothing it names.
- **FR-010** Docs: `UPGRADING.md` and the web upgrade page (specnaut-web, separate commit) say what
  is shown.

### Success criteria

- **SC-001** Integration: the real `runUpgrade` in a temp project whose lock records an older
  version prints, for each crossed release, a sentence that exists only in that release's published
  highlights (fixture: the recorded `### Highlights` section of the published v9.1.0 and v9.2.0
  bodies). A second test asserts each backfilled `history/v<X>.md` equals the `### Highlights`
  section of that tag's published body for the two recorded fixtures.
- **SC-002** S2 and S4 each have a test through the real handler.
- **SC-003** Red-probes: each FR-005 class makes the bundler fail; FR-006's missing and differing
  cases make `check-release-commit.ts` fail.

## 2. Guardrails

### Decision — where the highlights live: **embedded in the binary (D)**

Ranked by the architecture seat, confirmed by the security seat's findings (§ 4):

1. **D — embed** (chosen). vB is always the binary's own version (`application/upgrade_project.ts`
   `toVersion` = `TEMPLATES_VERSION`), so every crossed release is ≤ the one being built. No
   network, no rate limit, no timeout, no failure mode, no runtime untrusted text, no URL override,
   works offline and in CI. Verified: every tag since v3.0.0 holds
   `.specnaut/release/HIGHLIGHTS.md`; release CI checks out with `fetch-depth: 0`. Cost: the release
   step copies one file (FR-006), a one-time backfill, and a body edited on GitHub after publishing
   is not reflected (the link covers it).
2. **A — the binary fetches.** Brought five security findings (a URL-override seam that would also
   redirect self-update; a first sanitiser in Go that parity cannot test on benign bodies; timeout
   and size caps; failure semantics; agent-facing remote text). All vanish under D.
3. **B — the phase fetches.** Only one entry point shows it; SC-001 cannot hold on a model's output.
4. **C — both.** Two homes for one rule.

**Ticket AC adjusted** (via the product owner): the "fetch failure prints a notice" criterion has no
object under D; it is replaced by "the notes need no network".

### Decision table

| The decision                                                     | Its single home                                                                          | What would duplicate it                                                                 |
| :--------------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| the crossed range (vA before this run, vB; both result branches) | `src/application/upgrade_release_notes.ts`                                               | a range computed in the handler or keyed on `status`; `mergeMarker`'s `from` used as vA |
| which releases are listed, in what order, the pre-v3 gap line    | `src/domain/release_notes.ts`                                                            | a sort or filter in the renderer                                                        |
| the release link                                                 | `src/domain/release_notes.ts` (from `RELEASE_REPO`)                                      | a URL literal anywhere else; a stored link                                              |
| what a history file may contain                                  | `scripts/bundle-templates.ts` (refusal at bundle time)                                   | a runtime sanitiser                                                                     |
| history file = `HIGHLIGHTS.md` at release                        | `scripts/check-release-commit.ts`                                                        | a second check in a shell step                                                          |
| the printed block and the no-change line                         | `src/cli/handlers/upgrade_notes.ts`                                                      | strings in `upgrade_handler.ts` or the phase doc                                        |
| how the phase reports it                                         | `templates/core/skills/specnaut/phases/upgrade.md` step 8 (+ `plugin/` copy, byte-equal) | a second wording in UPGRADING.md beyond a pointer                                       |

**Reuse before build.** Inventory: `SemVer.parse/compare` (`domain/release.ts`), `RELEASE_REPO`, the
bundler's existing generated constants (`TEMPLATES_VERSION`), `check-release-commit.ts`'s `flat`.
Outcome: **extend at the owner** (bundler emits one more constant; the release check gains one
clause). The backfill is a one-off, not a kept helper.

### Size

`upgrade_handler.ts` is 473 lines, over its 300 target (`size-limits.md` rule 2: must not grow).
**First task, its own commit:** move `switchBacklogBackend` and `SwitchResult` (≈175 lines, a
separate routine) to `src/cli/handlers/upgrade_backlog_switch.ts`; then the handler gains only the
notes call. `ports.ts` is untouched (no port: the history is a bundle constant passed in).

### Constitution

§ I — public data, the CLI's own. § VIII — docs pin no version. § XI — fixtures are the CLI's own
published release text.

### Surfaces

`specnaut upgrade` stdout (both result branches); `UpgradeResult` / `UpToDateResult` gain
`fromVersion`; the bundle gains the history constant; `check-release-commit.ts`; phase step 8 (two
copies); `.specnaut/release/README.md` (the release step); `UPGRADING.md`; web docs.

**Surfaces added or widened:** none at runtime — checked: no outbound call, no env read, no file
read outside the bundle, no path built from data. The agent instruction surface (step 8) carries
first-party, bundle-checked text, fenced.

## 3. Done, as runnable checks

- `deno task test` with the task's permissions; `scripts/smoke/audit.sh --since main`; the upgrade
  smokes; `.specnaut/release/smoke-upgrade.sh` if it runs locally.
- Go unchanged except the goldens/parity gates still green (bundle changes feed goldens).
- Tests: `tests/domain/release_notes_test.ts`, `tests/application/upgrade_release_notes_test.ts`,
  the SC-001/SC-002 integration tests, bundler and release-check red-probes (SC-003).
- Size ratchet: handler shrinks; no file grows past its target.
- `check-adoption.ts`: the `feat` commit carries `## Agent adoption`.

## 4. Audit findings

### Architecture (architect-expert, 2026-11-06) — fail, 3 HIGH / 4 MEDIUM / 2 LOW — all folded

- HIGH up-to-date branch drops vA → FR-001, S4, SC-002. Verified (`upgrade_up_to_date.ts`, handler
  returns before the marker write).
- HIGH Go has no `upgrade` → Go out of scope; verified (`internal/cli/dispatch.go`).
- HIGH handler over target → extraction first (§ 2 Size).
- MEDIUM ISP on `ReleaseChecker` → moot: no port under D.
- MEDIUM orchestration in the CLI layer → `application/upgrade_release_notes.ts`.
- MEDIUM D dismissed on false premises → re-ranked; D chosen. Premises checked and false.
- MEDIUM no SC-001 seam → moot: no network; the test drives the real handler.
- LOW CRLF / backslashes → FR-005 refuses CRLF at bundle time; text printed as is.
- LOW tags and links → FR-004; non-SemVer history file names refused by the bundler.

### Security (security-expert, 2026-11-06) — needs_followup, 0 HIGH / 2 MEDIUM / 3 LOW

Written against option A. Under D: F1 (URL override), F4 (timeout, size, token) and F5 (notice text,
partial list) have no object. F2 (sanitiser parity) becomes FR-005's bundle-time refusal, red-probed
per class (SC-003). F3 (agent reads release text) kept as FR-009.

## 5. Open questions

None. Nothing here changes what the product does beyond the ticket; the AC adjustment follows from
the chosen mechanism, which the ticket left to the plan.
