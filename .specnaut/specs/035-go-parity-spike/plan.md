# Plan: Go parity harness and Go CLI spike

**Branch**: `feat/035-go-parity-spike` | **Date**: 2026-10-27 | **Backlog items**:
[#661 — Build a black-box parity harness for the CLI binary](https://github.com/specnaut/specnaut-cli/issues/661)
and
[#662 — Spike: Go CLI skeleton and release pipeline](https://github.com/specnaut/specnaut-cli/issues/662),
children of
[#660 — Rewrite the CLI in Go before Deno runtime support ends](https://github.com/specnaut/specnaut-cli/issues/660).

One plan for both children (the epic loop): one decision table, one stop, one commit per child, #661
first. Commit types: `test(parity): …` for #661 and `build(go): …` for #662. Neither is a `feat`:
nothing a user runs changes, so neither may move the version.

---

## 1. Why this exists

The Deno runtime that every release embeds gets roughly one more year of fixes (#660). The port to
Go is safe only if "behaves identically" is checked by a machine, and only worth starting if its
riskiest unknowns hold on real code. Today neither is known:

- 41.6k lines of `*_test.ts` pin behaviour from **inside** the TypeScript implementation; none of
  them can judge a Go binary.
- The bash smoke suite (`scripts/smoke/`) drives the real binary, but asserts by `grep`, compares no
  two binaries, and records neither exit codes nor file modes systematically.
- Nobody has measured whether a pure-Go keychain reads what the FFI backends wrote, whether the
  release shape survives a Go build, or what a Go binary weighs (the Deno ones are ~113 MB).

## 2. User scenarios

### US1 — A behaviour change in the TypeScript CLI shows up (P1, #661)

**Given** the binary built from `HEAD` and the latest released binary. **When** the harness diffs
them. **Then** every user-visible difference is listed by scenario and artefact, and an unchanged
CLI shows zero. (A binary against **itself** proves determinism only — FR-009 — not the pin.)

### US2 — A behaviour change is caught, by name (P1, #661)

**Given** two binaries that differ in one stdout line, one exit code, or one scaffolded file.
**When** the harness diffs them. **Then** it exits non-zero, naming the scenario and the artefact
(`stdout`, `stderr`, `exit`, or a tree path with `mode`/`content`).

### US3 — The Go binary answers the surface it does not implement yet (P1, #662)

**Given** the Go spike binary. **When** any current command or flag is invoked. **Then** argument
parsing, `--help`, `--version`, every parse-time refusal and `reconcile --status` behave as the
TypeScript binary does (the harness proves it), and every other command says it is not ported yet.

### US4 — The release shape survives the language change (P1, #662)

**Given** the spike on `main`. **When** the dry-run workflow is dispatched from `main`. **Then** it
produces the eleven current asset names (five binaries, five `.sha256`, one attestation bundle) as
short-lived workflow artefacts, publishes no release, and the repository still holds no secret.

### US5 — The keychain question is answered per OS (P2, #662)

**Given** a probe built with cgo off. **When** it runs on macOS, Linux and Windows. **Then** the
spike report states, per OS: get/set/remove, a non-throwing reachability probe, the secret kept off
argv (or "n/a: no child process"), and readability in both directions (TypeScript-written items read
by Go, Go-written items read by TypeScript).

### Edge cases

- A scenario that needs a TTY (the interactive pickers): excluded, "testscript has no PTY";
  `smoke-picker.sh` keeps covering it.
- A host where an OS keyring is reachable: credential scenarios are excluded there, so the harness
  never writes a developer's keychain. On macOS that is always.
- A scenario that forgets a stub: it reaches nothing — the environment denies the network by default
  and the Cloud URL is injected by the harness, not per scenario.
- Two runs of one binary differ by temp path or timestamp only: the declared rules absorb it;
  anything else is a difference.
- An error path where TypeScript lets Deno print an uncaught-exception trace (a malformed lock): not
  portable byte for byte; excluded from Go-vs-TypeScript, still compared TypeScript-vs-release.
- The binary invoked under its legacy name `specflow`: a scenario (it prints a warning on stderr).

## 3. Requirements

**Harness (#661)**

- **FR-001**: The harness is a Go package (`parity/`) using `testscript`; it builds nothing from
  source, imports no CLI code, and runs no Deno. Its mutant is a `testscript` command registered in
  `TestMain`, not a separately built binary.
- **FR-002**: The binary under test is `SPECNAUT_BIN`; `SPECNAUT_BIN_B` switches to diff mode. Unset
  → every parity test reports SKIP with that reason, never PASS.
- **FR-003**: The matrix is **every** harness the binary's `--help` lists × **every** backlog
  backend (`local`, `github`, `gitlab`, `cloud`) × `init` / `upgrade` / `check --project`, plus
  `diff`, `reconcile --status` (empty, three files across two directories, a path containing `&`,
  and each refusal: path not in the lock, missing project file, no lock, removed harness),
  `reconcile <path>`, `gate`, `spec`, `login`, `cloud <sub>`, `self-update`, `--help`, `--version`,
  the legacy name, and the parser edge cases: an unknown command, an unknown flag, an unknown flag
  swallowing the next word, a flag after a positional, `--version` after a command, `-vh`, a
  number-like positional. A test fails when the declared harness list and the binary's `--help`
  disagree.
- **FR-004**: Each scenario records stdout, stderr, exit code and the resulting tree (path, mode,
  content) under `$WORK`, including `$WORK/home`.
- **FR-005**: Diff mode compares two records per scenario and fails on any difference, naming the
  scenario and the artefact.
- **FR-006**: Normalisation is a declared table of rules (name, pattern, replacement, why); no other
  code rewrites a record. The version rule applies only when the two binaries' `--version` outputs
  differ.
- **FR-007**: Every scenario runs in one declared environment: network denied by default (proxy to a
  closed loopback port), the Cloud URL injected, a random canary as `SPECNAUT_CLOUD_TOKEN`, git
  isolated from system and global config with `file://` remotes only, `gh`/`glab` stubs first on
  `PATH`, stubs bound to `127.0.0.1`. Each stub counts its hits, and a scenario declared as using a
  service fails with zero. Every scenario that cannot be stubbed is in one declared exclusion list.
- **FR-008**: For each of the four mutation kinds (stdout line, exit code, missing file, altered
  file) a test runs the harness against a mutant and requires red naming that scenario and artefact.
- **FR-009**: Any binary against itself: zero differences.
- **FR-010**: CI builds one `linux-x64` TypeScript binary and runs the harness and the mutation
  tests with it, so the job cannot go green while every parity test skips. Not a release gate.

**Spike (#662)**

- **FR-011**: A Go module at the repository root, beside the TypeScript tree; `deno task test`,
  `deno task build`, CI and `release.yml` behave as before. Every Go build writes under `dist/`.
- **FR-012**: The Go parser tokenises the command line with the semantics of today's
  `@std/cli parseArgs` call in `src/cli/parser.ts` (one global flag table, unknown flags accepted,
  flags anywhere, aliases, combined short flags, number coercion of positionals) and ports **every**
  parse-time refusal. Only dispatch of a recognised but unported command prints the not-ported
  notice (exit 3).
- **FR-013**: `templates/` is embedded with `embed`; every read goes through the embedded
  `templates/manifest.json`, which is also where the version comes from.
- **FR-014**: `reconcile --status` is ported end to end, including its shared refusal preflight and
  the lock-key containment checks, and matches the TypeScript binary under the harness on every
  scenario except the declared uncaught-trace ones.
- **FR-015**: `CGO_ENABLED=0` builds for the five targets of `scripts/build.ts`.
- **FR-016**: Two probes — `cmd/keychain-probe` (Go, `go-keyring`) and `scripts/keychain-probe.ts`
  (compiled, calling the shipped `KeychainBackend` port directly) — check the US5 list per OS, under
  a probe-only service name, with a per-run canary secret passed on stdin, printing only
  match/mismatch and length, and removing their items on exit. Both refuse the real service names.
- **FR-017**: On macOS the argv check captures every exec for the probe's lifetime, requires an exec
  of `/usr/bin/security` from the probe (no observation = fail), and requires the canary in no
  captured argv; the report also pins the `go-keyring` version and the source line that hands the
  secret to the child.
- **FR-018**: macOS: whether an "Always Allow" grant survives replacing the binary, for a Go-written
  and a TypeScript-written item — recorded, nothing fixed (feeds
  [#428 — Sign + notarize the macOS release binary to stop repeated Keychain prompts](https://github.com/specnaut/specnaut-cli/issues/428)).
- **FR-019**: A dispatch-only dry run, from `main` only, builds the Go artefacts under the current
  asset names, checksums and attests them (see §12), uploads them with a 3-day retention, adds no
  secret, and measures size and startup per target against the latest release — verified with
  `verify-release.ts` before it is executed.
- **FR-020**: `spike-report.md` records the parser decision, the command choice, the keychain
  verdicts, the macOS observations, size and startup, the Go layering rule, where the target table
  moves at cutover, and a proposed decomposition of the remaining ports.

## 4. Success criteria

- **SC-001**: One command runs the whole matrix against a binary in under 10 minutes on a laptop.
- **SC-002**: Each of the four mutation kinds turns the harness red and names its scenario.
- **SC-003**: Any binary against itself: 0 differences. Go against TypeScript, on the ported subset
  minus the declared uncaught-trace scenarios: 0.
- **SC-004**: One report says, per OS, whether the port's keychain, release and size promises hold,
  with every gap named and no verdict resting on an empty observation.
- **SC-005**: No existing check changes its verdict on `main` because of this branch.

## 5. 🔒 Decision table

| The decision                                                                                                                                                                                                                                                                                                                                             | Its single home                                                                                                                                                                   | What would duplicate it                                                                     |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| Two records differ, and how a difference is named                                                                                                                                                                                                                                                                                                        | `parity/diff.go`                                                                                                                                                                  | a `cmp` golden in a `.txtar`; string compares in a test; a second walker                    |
| What a scenario records (stdout, stderr, exit, tree with mode + content)                                                                                                                                                                                                                                                                                 | `parity/record.go`                                                                                                                                                                | per-script `exec … > out` captures; a test re-reading the tree                              |
| What gets normalised, and why (version rule only when versions differ)                                                                                                                                                                                                                                                                                   | `parity/normalise.go` (`Rules`)                                                                                                                                                   | `strings.ReplaceAll` in diff/record; `sed` in a script; a regex in a stub                   |
| The environment every scenario runs in (network deny, injected Cloud URL, canary token, isolated git/gh/glab config, `HOME=$WORK/home`, `TZ`, locale, colour)                                                                                                                                                                                            | `parity/env.go` (`Setup`)                                                                                                                                                         | `env` lines in a `.txtar`; `--api-url` written per scenario; a stub setting its own env     |
| Which scenarios are excluded, and why — including "a keyring is reachable on this host" and "uncaught Deno trace, not portable"                                                                                                                                                                                                                          | `parity/excluded.go`                                                                                                                                                              | `skip` lines in `.txtar`; `t.Skip` scattered in tests; `[!darwin]` guards                   |
| Which binary is under test; unset means SKIP, never PASS                                                                                                                                                                                                                                                                                                 | `parity/binaries.go`                                                                                                                                                              | `os.Getenv` elsewhere; a hard-coded path; a `go build` in the harness                       |
| The scenario matrix, and the harness list read from `--help`                                                                                                                                                                                                                                                                                             | `parity/matrix.go`                                                                                                                                                                | a harness list copied into a script; one `.txtar` per combination                           |
| What a stubbed service answers, and its hit count                                                                                                                                                                                                                                                                                                        | `parity/stubs/` (`gh.go`, `glab.go`, `cloud.go`; git uses local bare `file://` remotes, no stub)                                                                                  | canned JSON inside `.txtar`; a second fake on `PATH`; a listener on `:0`                    |
| How a mutant mutates (four kinds)                                                                                                                                                                                                                                                                                                                        | `parity/mutant.go` (a `testscript` command)                                                                                                                                       | a shell wrapper per test; mutation logic in `parity_test.go`                                |
| The Go command and flag table                                                                                                                                                                                                                                                                                                                            | `internal/cli/surface.go`                                                                                                                                                         | `flag.FlagSet`s per handler; flags redefined in `dispatch.go`                               |
| How the command line is split into flags and arguments (the `parseArgs` semantics)                                                                                                                                                                                                                                                                       | `internal/cli/argv.go`                                                                                                                                                            | the standard `flag` package; per-command splitting; a second tokeniser for subcommands      |
| Every parse-time refusal (`Unknown command: "<received>"` + help, exit 2; removed harness, exit 1)                                                                                                                                                                                                                                                       | `internal/cli/parse.go`                                                                                                                                                           | refusals inside handlers; the not-ported path answering a malformed call                    |
| Help text (byte-identical)                                                                                                                                                                                                                                                                                                                               | `internal/cli/help.go`                                                                                                                                                            | a copy in `notported.go`; text rebuilt from `surface.go`                                    |
| The not-ported answer (message, exit 3)                                                                                                                                                                                                                                                                                                                  | `internal/cli/notported.go`                                                                                                                                                       | an inline `fmt.Fprintln(os.Stderr, …)` per command                                          |
| Why `reconcile` refuses a path (one preflight, shared by `--status` and `<path>`, as in cli#613)                                                                                                                                                                                                                                                         | `internal/reconcile/preflight.go`                                                                                                                                                 | a check inside `status.go`; a second list when `<path>` is ported                           |
| Lock keys stay inside the project (cli#574)                                                                                                                                                                                                                                                                                                              | `internal/lockfile/contain.go` (via `os.Root`)                                                                                                                                    | a `strings.HasPrefix` path check in a caller; a check only in the staging reader            |
| The shipped file set and the binary's version (two TypeScript values, deliberately merged: `bump-version.ts` keeps them equal)                                                                                                                                                                                                                           | `templates/manifest.json`, read through `templates.go`; `//go:embed all:templates` is a superset that nothing lists directly                                                      | a `version.go` constant; a seventh file in `bump-version.ts`; code walking the `embed.FS`   |
| Release targets and asset names. Inventory: `scripts/build.ts` `TARGETS` (imported by `verify-release.ts`, scraped by `release_assets_gate_test.ts`). Evidence: the list drifted once (cli#595). Outcome: **extend the existing helper at its owner** — each entry gains `goos`/`goarch` and keeps exactly one `outName`; `build.ts --go` builds from it | `scripts/build.ts`                                                                                                                                                                | a target list in the dry-run workflow; a `Makefile`; a Go build script                      |
| Checksum and attestation shape. Inventory: `release.yml`, `verify-release.ts`. Outcome: **copy, guarded** — reuse would need a callable `release.yml`, which is forbidden below. The dry run copies the `shasum` loop and the pinned `actions/attest` SHA; a test requires both to equal `release.yml`'s                                                 | `release.yml` (shape); `tests/scripts/release_assets_gate_test.ts` (agreement)                                                                                                    | a third copy; a different attest SHA; a hand-written Sigstore check                         |
| `release.yml` is never callable: its triggers are exactly `push: tags`                                                                                                                                                                                                                                                                                   | `tests/scripts/release_actions_pinned_test.ts`                                                                                                                                    | a `workflow_call` or `workflow_dispatch` added "for the dry run"; a job-level `uses:` of it |
| Every workflow that requests `id-token: write` is fully SHA-pinned                                                                                                                                                                                                                                                                                       | `tests/scripts/release_actions_pinned_test.ts` (keyed on the permission, not a file name)                                                                                         | a per-file pin list; a second pinning test for the dry run                                  |
| A dry run's signer identity is derived, never passed in                                                                                                                                                                                                                                                                                                  | `scripts/verify-release.ts` (`--dry-run-ref <ref>` builds the `go-dry-run.yml@<ref>` identity; exclusive with `--tag`)                                                            | a free-form `--identity`; a glob or prefix match; a change under `src/domain/sigstore/`     |
| The probe service name, and the refusal of the real ones                                                                                                                                                                                                                                                                                                 | name: `cmd/keychain-probe/main.go`, passed to the TS probe; refusal list: `src/infrastructure/keychain/keychain_backend.ts` constants, mirrored in Go and held equal by a Go test | the name typed in the TS probe; `specnaut-cloud` in either probe                            |

## 6. Technical context

**Language/Version**: Go 1.26 (installed: 1.26.3), beside Deno 2.x. **Primary Dependencies**:
`github.com/rogpeppe/go-internal/testscript`; `github.com/zalando/go-keyring` in the probe only. No
parser library: `flag` cannot express `parseArgs`'s semantics (§10 H1), and the surface is a small
table, so a dedicated tokeniser is cheaper than adapting a library to it. **Storage**: none new; the
harness writes only under `$WORK`. **Testing**: `go test ./...`; the harness is
`go test ./parity/...` with `SPECNAUT_BIN` set. **Target Platform**: the five targets in
`scripts/build.ts`. The harness runs on macOS and Linux; Windows gets the build and the keychain
probe. **Project Type**: cli. **Constraints**: cgo off; no Actions secret; no published release; no
CLI behaviour change; Go module fetches stay checksum-verified (`go.sum` committed, no
`GOFLAGS=-mod=mod`, `GONOSUMDB`, `GOINSECURE`).

### Layout

```
go.mod  go.sum  templates.go          module github.com/specnaut/specnaut-cli
cmd/specnaut/                         spike entry point
cmd/keychain-probe/                   Go probe + driver, one file per OS
scripts/keychain-probe.ts             TypeScript probe (backend port, compiled with --allow-ffi)
internal/cli/                         surface, argv, parse, help, dispatch, not-ported
internal/lockfile/  internal/reconcile/  what `reconcile --status` reads, behind an fs.FS
parity/                               harness, env, stubs, mutant, testdata/*.txtar
.github/workflows/go-dry-run.yml      dispatch-only, from main
```

A root `go.mod` over a `go/` subdirectory: `//go:embed` cannot reach a parent directory, and the
module path survives the cutover. **Layering**: `internal/` packages take an `fs.FS` (or an
`os.Root`), never `os` directly, so each has unit tests with an in-memory tree; this is the
precedent for every later port.

### Domain model

- **Bounded context**: the CLI's observable behaviour.
- **Vocabulary**: _scenario_, _record_, _artefact_ (`stdout`, `stderr`, `exit`, `tree`), _rule_,
  _exclusion_, _mutant_, _stub hit_.
- **Value objects**: Record, Rule (pattern, replacement, reason), Difference (scenario, artefact,
  detail), Exclusion (scenario, reason).
- **Invariants**: a record is normalised once, by `Rules`; a scenario is run or excluded with a
  reason, never silently absent; no scenario reaches a non-loopback host.

## 7. Constitution check

| Principle                                            | Verdict | Note                                                                                           |
| :--------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------- |
| Size limits (defaults: file 300/500, function 30/50) | pass    | every file below under 300; `argv.go` split per token kind so no function exceeds 50           |
| I. OSS / proprietary boundary                        | pass    | the Cloud stub answers the shapes the public CLI parses; no private name, type or error string |
| II. HTTP contract is the bridge                      | pass    | the stub is a test double of that contract, not a second definition                            |
| IV. Cross-cutting discipline                         | pass    | CLI only, plus a pointer bump at the root                                                      |
| V. Merge defaults                                    | pass    | local `--ff-only` through `land.sh`, one commit per child                                      |
| VIII. Documentation conventions                      | pass    | the report dates its measurements; no long-lived doc pins a version                            |
| XI. Consumer agnosticism                             | pass    | every fixture is invented (`acme/widgets`)                                                     |
| XII. Escalate business, decide engineering           | pass    | §12 asks only the irreversible ones; commit types keep the version unmoved                     |

### Files touched

| File                                                                                  | Lines now |                         Lines after (est.) | Over target? | Responsibility of each new module                                                          |
| :------------------------------------------------------------------------------------ | --------: | -----------------------------------------: | :----------- | :----------------------------------------------------------------------------------------- |
| `scripts/build.ts`                                                                    |        84 |                                        125 | no           | — (`--go`, `goos`/`goarch` per target)                                                     |
| `scripts/verify-release.ts`                                                           |       148 |                                        170 | no           | — (`--dry-run-ref`)                                                                        |
| `tests/scripts/verify_release_test.ts`                                                |       248 |                                        280 | no           | — (`--dry-run-ref` derivation, exclusive with `--tag`, never passed by postflight/release) |
| `tests/scripts/release_actions_pinned_test.ts`                                        |        85 |                                        140 | no           | — (trigger set of `release.yml`; pinning keyed on `id-token: write`)                       |
| `tests/scripts/release_assets_gate_test.ts`                                           |       164 |                                        195 | no           | — (dry-run attest SHA and checksum loop equal `release.yml`'s)                             |
| `.github/workflows/ci.yml`                                                            |        92 |                                        125 | no           | — (`go` job: vet, test, cross-build, harness against one TS binary)                        |
| `.github/workflows/codeql.yml`                                                        |        61 |                                         64 | no           | — (`go` in the matrix, autobuild)                                                          |
| `.gitignore`                                                                          |        25 |                                         28 | no           | — (`/specnaut`, `/keychain-probe`, `*.test`)                                               |
| `.github/workflows/go-dry-run.yml`                                                    |       new |                                        190 | no           | build · measure · attest jobs, `permissions: {}` at top                                    |
| `go.mod`, `go.sum`                                                                    |       new |                             10 / generated | no           | module and pinned sums                                                                     |
| `templates.go` + `templates_test.go`                                                  |       new |                                    40 / 60 | no           | embedded tree read through the manifest · manifest ⊂ embed, extras = a named list of 4     |
| `cmd/specnaut/main.go`                                                                |       new |                                         25 | no           | entry point                                                                                |
| `internal/cli/{surface,argv,parse,help,dispatch,notported}.go`                        |       new |            150 / 200 / 140 / 130 / 70 / 30 | no           | one decision each, per §5                                                                  |
| `internal/lockfile/{lockfile,contain}.go`, `internal/reconcile/{preflight,status}.go` |       new |                         200 / 60 / 90 / 90 | no           | parse the lock · containment · refusal reasons · pending list                              |
| their `*_test.go`                                                                     |       new |                                  4 × ≤ 200 | no           | unit tests over an in-memory `fs.FS`                                                       |
| `cmd/keychain-probe/*.go`                                                             |       new |                                  4 × ≤ 120 | no           | driver · one backend check per OS                                                          |
| `scripts/keychain-probe.ts`                                                           |       new |                                         90 | no           | TS-side get/set/remove through the backend port                                            |
| `parity/{binaries,env,matrix,record,normalise,diff,excluded,mutant}.go`               |       new | 40 / 110 / 140 / 140 / 90 / 130 / 80 / 100 | no           | one decision each, per §5                                                                  |
| `parity/stubs/{gh,glab,cloud}.go`                                                     |       new |                            150 / 120 / 220 | no           | one service each, with hit counts                                                          |
| `parity/{parity,mutation}_test.go`                                                    |       new |                                  160 / 130 | no           | run and diff drivers · the FR-008 red probes                                               |
| `parity/testdata/*.txtar`                                                             |       new |                                  ≤ 60 each | no           | one scenario family each                                                                   |
| `.specnaut/specs/035-go-parity-spike/{tasks,spike-report}.md`                         |       new |                                  150 / 180 | no           | breakdown · findings                                                                       |

`release.yml` (522, over its 500 ceiling) is **not touched**.

### Complexity tracking

None.

## 8. Surface impact

- **Users**: none. No shipped binary, template or install path changes.
- **Repository**: a Go module beside the Deno tree; a `go` CI job; a dispatch-only workflow; CodeQL
  scans Go.
- **Contracts**: `TARGETS` grows two fields; `verify-release.ts` gains `--dry-run-ref`, which a
  release never passes. The shipped verifier (`src/domain/sigstore/`, `self_update.ts`) is
  untouched.

## 9. Risks

| Risk                                                                                                          | Mitigation                                                                                                            |
| :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| `go-keyring` on Linux searches by `service` + `username`; the TypeScript backend stores `service` + `account` | the probe measures both directions; a gap is a named finding with a proposed fix (a direct Secret Service client)     |
| `go-keyring` on macOS may encode its own writes (base64 behind a prefix)                                      | both directions are tested; a mismatch reads as "not logged in", and is reported as such                              |
| `@std/fmt/colors` writes ANSI codes even when piped                                                           | the harness compares raw bytes; help text is copied, not rebuilt                                                      |
| Go `encoding/json` escapes `<`, `>`, `&` and marshals a nil slice to `null`                                   | HTML escaping off, slices initialised; scenarios with `&` and with an empty queue                                     |
| `@std/fs walk` yields raw directory order; `filepath.WalkDir` sorts                                           | Go walks with unsorted `ReadDir` in the same pre-order; the three-files-two-dirs scenario catches a mismatch          |
| `//go:embed all:templates` embeds 4 files the manifest does not ship, and any local junk                      | every read goes through the manifest; the embed test names the 4; release builds from a clean checkout                |
| The harness is green while it never ran                                                                       | FR-010: CI runs it against a real TS binary; FR-002: unset is SKIP, never PASS                                        |
| A stub drifts from the real service                                                                           | stubs answer only what the CLI's code parses, and each names the file it mirrors                                      |
| The single target table lives in the language being retired                                                   | the report records where it moves at cutover; not moved now                                                           |
| `argv.go` re-implements a library's semantics                                                                 | the parser edge cases are harness scenarios, so Go is judged against the TS binary, not against a reading of minimist |

## 10. Architecture audit

`architect-expert`, 2026-10-27, on the plan: 4 HIGH, 10 MEDIUM, 6 LOW. All accepted and folded in.

| Finding                                                                                                                                                      | What was done                                                                                                                          |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| H1 Argument parsing had no row; `flag` cannot express `parseArgs` (global table, unknown flags take the next word, flags after positionals, number coercion) | rows `argv.go` + `parse.go`; FR-012; parser edge cases in FR-003; `flag` ruled out                                                     |
| H2 `reconcile --status` error paths end in an uncaught Deno trace; containment unguarded                                                                     | uncaught-trace scenarios excluded from Go-vs-TS with a reason (compared TS-vs-release); rows `preflight.go` + `contain.go`; unit tests |
| H3 The TypeScript probe had no home; the service name would have two                                                                                         | `scripts/keychain-probe.ts` placed; name owned by the Go driver and passed in                                                          |
| H4 "Reuse directly" for attestation could not be built and contradicted its own row                                                                          | outcome changed to "copy, guarded" with an agreement test                                                                              |
| M Scenario environment had no row                                                                                                                            | `parity/env.go`                                                                                                                        |
| M "Pins today's behaviour" undefined under two-record diff; version rule hid the pin                                                                         | US1 = HEAD vs latest release; version rule only when versions differ                                                                   |
| M Commit types unstated (`feat` would trip the adoption lint and bump minor)                                                                                 | `test(parity)` and `build(go)`                                                                                                         |
| M Go builds dirty the tree and fail release preflight                                                                                                        | `-o dist/…`; `.gitignore` backstop                                                                                                     |
| M The harness would never run in CI                                                                                                                          | FR-010; the mutant becomes a `testscript` command                                                                                      |
| M `embed` gave the shipped set a second home                                                                                                                 | manifest stays the home; superset test                                                                                                 |
| M `--identity` was a free-form override                                                                                                                      | `--dry-run-ref`, derived                                                                                                               |
| M Attestation is permanent and public                                                                                                                        | moved to §12                                                                                                                           |
| M Refusal reasons had no home (cli#613)                                                                                                                      | `preflight.go`                                                                                                                         |
| M Walk order missing as a risk                                                                                                                               | §9 row and scenario                                                                                                                    |
| L legacy name, FR-002/FR-003/FR-007 rows, merged version values, omitted files, layering, command-choice justification                                       | all written into §3, §5, §6, §7 and below                                                                                              |

## 11. Security audit

`security-expert`, 2026-10-27, on the plan: 0 HIGH, 4 MEDIUM, 4 LOW. Confirmed first: the shipped
self-update identity cannot be widened by this plan — `verify.ts` requires the exact SAN, and
`self_update.ts` sets it after any injected anchor, so a `go-dry-run.yml` certificate is refused.

| Finding                                                                                                                                      | What was done                                                                                                                                                                    |
| :------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 A callable `release.yml` would mint the pinned release identity, irreversibly per tag                                                      | row + test: its triggers stay exactly `push: tags`; the dry run has no job-level `uses:` and runs from `main` only                                                               |
| 2 Nothing structural kept the binary off production Cloud and real credentials (a missing `--api-url`; Apple git's system credential helper) | `parity/env.go`: network deny, injected Cloud URL, canary token, isolated git/gh/glab config, loopback stubs with hit counts; credential scenarios classified by what they reach |
| 3 The argv check sampled the wrong process and passed on an empty sample                                                                     | FR-017: exec capture for the probe's lifetime, positive marker, canary, pinned source line; Linux/Windows "n/a"                                                                  |
| 4 SHA pinning was scoped to `release.yml` by name                                                                                            | pinning keyed on `id-token: write`; attest SHA equality                                                                                                                          |
| 5 `--identity`                                                                                                                               | replaced by derived `--dry-run-ref`, exact match, exclusive with `--tag`, never passed by postflight or release                                                                  |
| 6 Downloaded binary executed in the job that can mint a token                                                                                | three jobs: build and measure hold `contents: read`; the baseline is verified before it runs; attest executes nothing                                                            |
| 7 The TS probe could touch the real Cloud credential (legacy migration in `load()`)                                                          | backend port only, probe service, refusal of both real names, canary, cleanup                                                                                                    |
| 8 Dry-run attestations are public and permanent; `gh attestation verify --repo` would accept them                                            | from `main` only; `attest` input defaults to false; 3-day retention; residual accepted below, pending §12                                                                        |

**Accepted residual**: a dispatched attestation is a permanent public record naming `go-dry-run.yml`
on `main`, accepted by an unscoped `gh attestation verify`, refused by every installed CLI.

## 12. Open questions

_Asked at the plan stop, 2026-10-27; answers recorded here._

### Decided without asking

- One Go module at the repository root, not under `go/`.
- `reconcile --status` is the ported command: read-only, no network, no keychain, JSON out, and it
  exercises the lock parser, the staging walk and the refusal preflight (~600 lines of TypeScript
  across five files behind a 68-line handler).
- `self-update` is excluded from the harness: it calls `api.github.com` with no override, and adding
  one to a signature-verified update path would be a behaviour change.
- Credential scenarios run only on Linux with no session bus; macOS excludes them always.
- The harness covers macOS and Linux hosts; Windows gets the build and the keychain probe.
- CodeQL gains `go`; `ci.yml` gains a `go` job. Neither touches an existing job.
- After the spike lands, the per-command port tickets are filed from its decomposition, through the
  product owner.
