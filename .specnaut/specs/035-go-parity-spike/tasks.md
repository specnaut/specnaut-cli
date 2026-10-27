# Tasks: Go parity harness and Go CLI spike

**Plan**: `plan.md` (same directory). One commit per child, in this order: **#661**
(`test(parity): …`, Phases 1–4), then **#662** (`build(go): …`, Phases 5–9). Every task that touches
a rule names its 🔒 home from plan §5; a decision may not land anywhere else.

## Phase 1 — Setup (#661)

- [ ] T001 Create the Go module: `go.mod` (`module github.com/specnaut/specnaut-cli`, `go 1.26`),
      add `github.com/rogpeppe/go-internal` to `go.sum`; append `/specnaut`, `/keychain-probe`,
      `*.test` to `.gitignore`
- [ ] T002 Confirm the Deno side ignores the module: `deno task fmt:check`, `deno task lint`,
      `deno task test` and `bash scripts/smoke/audit.sh` give the same verdicts as on `main`

## Phase 2 — Foundational (#661)

- [ ] T003 [P] `parity/binaries.go`: read `SPECNAUT_BIN` / `SPECNAUT_BIN_B` once; unset → SKIP with
      the reason, never PASS (home: binaries row)
- [ ] T004 [P] `parity/normalise.go`: the `Rules` table (`$WORK` paths, lock timestamps, the version
      rule applied only when the two `--version` outputs differ), each rule with its reason (home:
      normalise row)
- [ ] T005 [P] `parity/excluded.go`: the exclusion list with reasons (TTY pickers, `self-update`,
      uncaught-trace scenarios for Go-vs-TS, credential scenarios wherever a keyring is reachable —
      always on darwin) (home: excluded row)
- [ ] T006 `parity/env.go`: the `Setup` hook — `HOME=$WORK/home`, `TZ=UTC`, `LANG=C`, fixed
      colour/`TERM`, proxies to `127.0.0.1:9` with `NO_PROXY` for loopback, canary
      `SPECNAUT_CLOUD_TOKEN`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL`, `GIT_TERMINAL_PROMPT=0`,
      `GH_CONFIG_DIR`/`GLAB_CONFIG_DIR` under `$WORK`, `DBUS_SESSION_BUS_ADDRESS` unset, stubs first
      on `PATH`, the Cloud stub URL injected (home: env row)
- [ ] T007 `parity/record.go`: capture stdout, stderr, exit, and the tree under `$WORK` (path, mode,
      content), normalised once through `Rules` (home: record row)
- [ ] T008 `parity/diff.go`: compare two records; a Difference names scenario + artefact + detail
      (home: diff row)
- [ ] T009 [P] Unit tests for T004, T007, T008 on synthetic records (`parity/*_unit_test.go`)

## Phase 3 — US1: a behaviour change in the TypeScript CLI shows up (P1, #661)

- [ ] T010 [P] [US1] `parity/stubs/gh.go`, `glab.go`, `cloud.go`: loopback `httptest` servers and
      `PATH` shims answering only what the CLI parses, each naming the TS file it mirrors, each with
      a hit counter (home: stubs row); git uses local bare `file://` remotes
- [ ] T011 [US1] `parity/matrix.go`: harnesses (read from `--help`, fail on disagreement with the
      declared list) × backends × `init`/`upgrade`/`check --project`, plus every FR-003 extra (home:
      matrix row)
- [ ] T012 [US1] `parity/testdata/*.txtar`: one scenario family per file — init/upgrade/check, diff,
      reconcile (status cases incl. three files over two dirs, `&`, every refusal), gate, spec,
      login/cloud, help/version/unknown, legacy `specflow` name, parser edge cases
- [ ] T013 [US1] `parity/parity_test.go`: run mode (one binary, record each scenario, enforce
      declared stub hits) and diff mode (`SPECNAUT_BIN_B`)
- [ ] T014 [US1] One scenario must fail to reach a non-stubbed host, proving the network deny

## Phase 4 — US2: a change is caught by name (P1, #661)

- [ ] T015 [US2] `parity/mutant.go`: a `testscript` command registered in `TestMain` that wraps the
      binary and applies one of four mutations (stdout line, exit code, missing file, altered file)
      (home: mutant row)
- [ ] T016 [US2] `parity/mutation_test.go`: for each kind, diff(real, mutant) is red and names the
      scenario and artefact
- [ ] T017 [US2] Build the TS binary (`deno task build`), run the whole harness against it: run
      mode, then TS against itself (0 differences, FR-009), then HEAD against the latest release
      (US1); record runtime against SC-001
- [ ] T018 [US2] Observe each new assertion red at least once (mutate the comparator, the normaliser
      and the exclusion check, then restore) and note the mutants in the commit body
- [ ] T019 `.github/workflows/ci.yml`: a `go` job (`go vet`, `go test ./...`, build one linux-x64 TS
      binary, run the harness and the mutation tests with it); no existing job touched
- [ ] T020 Commit #661: `test(parity): a black-box parity harness for the CLI binary` (Closes #661)

## Phase 5 — Foundational (#662)

- [ ] T021 `templates.go` + `templates_test.go`: `//go:embed all:templates`; every read through the
      manifest; manifest ⊂ embedded set, extras equal a named list of 4 (home: shipped-set row)
- [ ] T022 [P] `internal/lockfile/{lockfile,contain}.go` + tests: parse `installed.lock` over an
      `fs.FS`; lock keys stay inside the project via `os.Root` (home: containment row)
- [ ] T023 `cmd/specnaut/main.go`: entry point; every Go build writes under `dist/`

## Phase 6 — US3: the Go binary answers the whole surface (P1, #662)

- [ ] T024 [US3] `internal/cli/surface.go`: the command and flag table from `src/cli/parser.ts`
      (home: surface row)
- [ ] T025 [US3] `internal/cli/argv.go` + tests: the `parseArgs`-compatible tokeniser, split per
      token kind so no function passes 50 lines (home: argv row)
- [ ] T026 [US3] `internal/cli/parse.go` + tests: every parse-time refusal, `Unknown command` + help
      exit 2, removed harness exit 1 (home: parse row)
- [ ] T027 [P] [US3] `internal/cli/help.go` (byte-identical copy) and `notported.go` (exit 3)
- [ ] T028 [US3] `internal/cli/dispatch.go`: `--help`, `--version` (from the manifest), not-ported
- [ ] T029 [US3] `internal/reconcile/{preflight,status}.go` + tests: shared refusal preflight, the
      pending list (unsorted pre-order walk, HTML escaping off, empty slice not `null`) (home:
      preflight row)
- [ ] T030 [US3] Harness Go against TS on the ported subset: 0 differences outside the declared
      uncaught-trace exclusions (SC-003)

## Phase 7 — US4: the release shape survives (P1, #662)

- [ ] T031 [US4] `scripts/build.ts`: `goos`/`goarch` per `TARGETS` entry, one `outName` each, `--go`
      builds with `CGO_ENABLED=0` into `dist/` (home: targets row); extend its tests
- [ ] T032 [US4] `scripts/verify-release.ts`: `--dry-run-ref <ref>` derives the
      `go-dry-run.yml@<ref>` identity, exact match, exclusive with `--tag` (exit 2) (home: identity
      row); `tests/scripts/verify_release_test.ts` covers derivation, exclusivity, and that
      postflight/release never pass it
- [ ] T033 [US4] `tests/scripts/release_actions_pinned_test.ts`: `release.yml` triggers are exactly
      `push: tags`; every workflow requesting `id-token: write` is fully SHA-pinned
- [ ] T034 [US4] `.github/workflows/go-dry-run.yml`: `workflow_dispatch`, `permissions: {}`, jobs
      guarded to `refs/heads/main`; build (contents: read) → measure (verify the latest release with
      `verify-release.ts --tag` before running it; size + startup per target) → attest (input
      `attest`, default false; same `shasum` loop and attest SHA as `release.yml`; executes nothing)
      → verify with `--dry-run-ref`; artefact retention 3 days
- [ ] T035 [US4] `tests/scripts/release_assets_gate_test.ts`: the dry run's attest SHA and checksum
      loop equal `release.yml`'s
- [ ] T036 [US4] `.github/workflows/codeql.yml`: add `go` (autobuild)

## Phase 8 — US5: the keychain question per OS (P2, #662)

- [ ] T037 [P] [US5] `cmd/keychain-probe/` (Go, `go-keyring`, cgo off): driver owning the probe
      service name, refusing both real names (held equal to `keychain_backend.ts` by a Go test),
      canary on stdin, match/mismatch + length only, deferred cleanup (home: probe row)
- [ ] T038 [P] [US5] `scripts/keychain-probe.ts`: the shipped `KeychainBackend` port directly,
      service name passed in, same refusals and cleanup; `deno check` it
- [ ] T039 [US5] Probe matrix job in `go-dry-run.yml` (Linux with gnome-keyring under
      `dbus-run-session`, Windows wincred): both directions, reachability probe; macOS run locally
- [ ] T040 [US5] Prepare the guided macOS session: the exact commands for the maintainer (the
      "Always Allow" grant on a Go- and a TS-written item, then binary replacement; the
      `sudo eslogger exec` capture with positive marker and canary). Agents never perform either
      step

## Phase 9 — Report and land (#662)

- [ ] T041 Dispatch the dry run from `main` after #662 lands locally and is pushed; collect sizes,
      startup times, keychain verdicts
- [ ] T042 `spike-report.md`: parser decision, command choice, keychain verdicts per OS (no verdict
      on an empty observation), macOS observations, size/startup, layering rule, where `TARGETS`
      moves at cutover, proposed decomposition of the remaining ports
- [ ] T043 Commit #662: `build(go): spike a Go CLI skeleton and its release dry run` (Closes #662);
      report commit after the dry run

## Dependencies

Phase 1 → 2 → 3 → 4 (commit #661) → 5 → 6 → 7 → 8 → 9. Within a phase, [P] tasks touch different
files and may run in parallel. US3's harness check (T030) needs #661 landed; US4/US5's dispatch
(T041) needs #662 pushed.

## Strategy

MVP is #661 alone: it pins today's TypeScript behaviour before any Go CLI code exists. #662 then
adds the spike in the order of its riskiest unknown first (parser surface), ending with the report.
