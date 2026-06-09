---
description: "Task list for reliable Adoption guide in CI-generated release notes (#363)"
---

# Tasks: Reliable Adoption guide in CI-generated release notes

**Input**: Design documents from `.specflow/specs/010-release-adoption-parity/` **Prerequisites**:
plan.md, spec.md, research.md, data-model.md, contracts/adoption-parity.md **Linked issue**:
mkrlabs/specflow#363

**Tests**: INCLUDED — the behavioural contract C1–C5 and the outcome matrix are themselves
acceptance criteria (SC-001…SC-006). TDD: write the test, watch it fail, implement, watch it pass.
All tests use an injected fake `PrBodyFetcher` (`Map<number, PrBodyOutcome>`) — no live `gh`, no
network.

**Organization**: grouped by user story. US1 (parity restored) + US2 (automated guard) are P1; US3
(failure-vs-absence) is P2 and mostly verified by tests since its mechanism lands in Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files / independent, no incomplete-task dep)
- Paths are relative to `apps/specflow/`

## Path Conventions

Release tooling, not binary runtime: changes live in `scripts/gen-changelog.ts`,
`.github/workflows/release.yml`, and `tests/scripts/gen_changelog_test.ts`. No `src/` (hexagonal)
impact.

---

## Phase 1: Setup

- [x] T001 Confirm branch `010-release-adoption-parity` is checked out in `apps/specflow/` and
      `deno task test` is green on a clean tree (baseline for the SC-002 parity assertion).

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**The outcome type + injectable fetcher seam every story builds on. Complete before Phase 3.**

- [x] T002 [P] Write failing unit tests in `tests/scripts/gen_changelog_test.ts` for the assembly
      seam using a fake `PrBodyFetcher` (`Map<number, PrBodyOutcome>`): a feat commit whose PR
      returns `retrieved` with a valid block ⇒ one `AdoptionEntry`; `retrieved` without a block ⇒ no
      entry, no failure; `absent` ⇒ no entry, no failure; `failed` ⇒ recorded in `failures`, no
      entry; a feat subject with no `(#NNN)` ⇒ no entry, no failure. Assert `entries`/`failures`
      shape from `assembleAdoptionEntries`.
- [x] T003 In `scripts/gen-changelog.ts`, add and export the `PrBodyOutcome` discriminated union
      (`retrieved | absent | failed`) and the `PrBodyFetcher` type alias per data-model.md.
- [x] T004 Refactor `fetchPrBody` to return `Promise<PrBodyOutcome>`: spawn error / non-zero ⇒
      `{kind:"failed",reason}`; empty or literal-`null` stdout ⇒ `{kind:"absent"}`; non-empty body ⇒
      `{kind:"retrieved",body}`. Change the per-process cache to store `PrBodyOutcome`. Keep the
      existing `console.warn` on failure (now alongside the typed outcome).
- [x] T005 Extract `assembleAdoptionEntries(classified, fetch, opts?)` returning
      `{entries, failures}` from the inline loop in `main()`, per contracts §2 — branch on the
      outcome kind; never call `Deno.exit`. Rewire `main()` to call it with the real `fetchPrBody`
      and pass the result to `formatChangelog`. Make T002 pass.

**Checkpoint**: the failure-vs-absence distinction now exists and is unit-tested.

---

## Phase 3: US1 — CI release body carries the Adoption guide (Priority: P1) 🎯 MVP

**Goal**: the pipeline provides auth so retrieval succeeds in CI, and the guide that the local path
produces is byte-identical to what ships.

**Independent test**: feed N `retrieved` bodies through the assembly + format; assert the
`### Adoption guide` section is present with N entries and matches a golden string.

- [x] T006 [P] [US1] Write failing tests in `tests/scripts/gen_changelog_test.ts`: (C1/SC-001) N
      feat PRs all `retrieved` with valid blocks ⇒ formatted body contains `### Adoption guide` with
      N entries; (C2/SC-002) the adoption section is byte-identical to a golden fixture and
      identical whether assembled in strict or non-strict — the body _content_ must not depend on
      the mode.
- [x] T007 [US1] In `.github/workflows/release.yml`, add `env: GH_TOKEN: ${{ github.token }}` and
      `--allow-env` to the `Generate
      release notes` step so `gh pr view` is authenticated in
      CI (FR-003, root-cause fix). Make T006's parity guarantee reproducible in CI.
- [x] T008 [US1] Update the stale comment block above that step in `release.yml` (currently claims
      the adoption fix was completed via `pull-requests: read`) to state the fix is now complete:
      permission scope **plus** the token env passthrough.
- [x] T009 [US1] Write the v1.13.0 regression test (C4/SC-004) in
      `tests/scripts/gen_changelog_test.ts`: a fixture map of the v1.13.0-range feat PR bodies
      (inlined minimal `## Agent adoption` sections) fed through the fake fetcher ⇒ the produced
      guide has the expected entry count. Hermetic; proves the range that shipped empty would now
      ship complete.

**Checkpoint**: US1 done — parity restored and proven for a real range. SC-001, SC-002, SC-004
green.

---

## Phase 4: US2 — Parity protected by an automated guard (Priority: P1)

**Goal**: a CI-only `--strict` mode fails the build on any retrieval failure, before the body is
written or published.

**Independent test**: assembly with ≥1 `failed` outcome under strict ⇒ non-zero exit and no output
file.

- [x] T010 [US2] Write failing test (C3/SC-003, SC-005) in `tests/scripts/gen_changelog_test.ts`:
      assert the strict decision predicate (`failures.length > 0 && strict`) and exercise the exit
      path by subprocess-running `gen-changelog.ts --strict` against a forced failure (e.g. a
      range/env that yields a `failed` outcome) — expect non-zero exit and that the `--out` file was
      NOT written.
- [x] T011 [US2] In `scripts/gen-changelog.ts` `main()`, parse `--strict` from `Deno.args`; after
      `assembleAdoptionEntries`, if `strict &&
      failures.length > 0`, print each
      `#<prNum>: <reason>` to stderr and `Deno.exit(1)` **before** `Deno.writeTextFile`. Make T010
      pass.
- [x] T012 [US2] In `.github/workflows/release.yml`, add `--strict` to the `Generate release notes`
      step's script args so a retrieval failure fails the `build` job before the `Create release`
      step publishes (FR-005/FR-006).

**Checkpoint**: US1+US2 = shippable. The pipeline can no longer publish a silently-incomplete body.
SC-003, SC-005 green.

---

## Phase 5: US3 — Genuine omissions quiet, infra failures loud (Priority: P2)

**Goal**: confirm end-to-end that legitimate absence never trips the guard and never produces a
`failed` outcome.

**Independent test**: a fake returning `absent` (and `retrieved`-but-no-block) under strict ⇒ run
succeeds, no `failures`, no entry.

- [x] T013 [US3] Write tests (C5/SC-006, FR-004/FR-007) in `tests/scripts/gen_changelog_test.ts`:
      under `strict`, a mix of `absent`, `retrieved`-without-block, and PR-number-less feat commits
      ⇒ zero `failures`, run does not exit non-zero, and an informational skip is the only signal. A
      `failed` outcome in the same set is the ONLY thing that trips strict (no false positives from
      legitimate absences).
- [x] T014 [US3] Verify (adjust only if T013 fails) that `assembleAdoptionEntries` and `fetchPrBody`
      keep `absent` and `failed` strictly separate end-to-end — no path collapses a `failed` into
      `absent` (the original bug). No code change expected beyond Phase 2 if the seam is correct.

**Checkpoint**: the guard is trustworthy — fires on real failures only.

---

## Phase 6: Polish & Cross-Cutting

- [x] T015 [P] Run `deno task fmt` and `deno task lint` across the new/edited files; fix any
      findings.
- [x] T016 [P] Run the full `deno task test` suite; confirm green and that the pre-existing
      `classifyCommit`/`formatChangelog` tests still pass unchanged.
- [x] T017 Self-review against `contracts/adoption-parity.md` §5 — confirm every C1–C5 row maps to a
      passing test and every FR/SC is covered; note any deviation in the PR description. Confirm the
      `release/SKILL.md` preview invocation was deliberately left non-strict (D6) and call it out.

---

## Dependencies & order

- **Setup (T001)** → **Foundational (T002–T005)** → stories.
- Foundational blocks everything: the `PrBodyOutcome` union (T003), refactored `fetchPrBody` (T004),
  and `assembleAdoptionEntries` (T005) are prerequisites for all story tests.
- **US1 (T006–T009)** depends only on Foundational. T007/T008 (workflow) are independent of the test
  tasks and of US2/US3.
- **US2 (T010–T012)** depends on Foundational (needs `failures`); independent of US1's workflow env
  change source-wise (both edit `release.yml` — T007/T008 and T012 touch the same step, so serialise
  those three within `release.yml`).
- **US3 (T013–T014)** depends on Foundational; verification-heavy.
- **Polish (T015–T017)** last.

## Parallel opportunities

- Within Foundational: T002 (tests) is `[P]` and can be drafted alongside T003's type additions;
  T004/T005 implementations follow.
- T006 (US1 tests) and T010 (US2 tests) and T013 (US3 tests) are different test cases in the same
  file — draft together, but run the suite once after each implementation lands.
- `release.yml` edits T007, T008, T012 all touch the one `Generate release
  notes` step — apply
  them as a single coherent edit, do not parallelise.
- Polish T015/T016 are `[P]`.

## Implementation strategy

1. **Foundize** (T001–T005): the outcome union + injectable assembly seam — the load-bearing change;
   closes the silent-failure root and makes everything testable.
2. **US1** (T006–T009): the root-cause workflow env fix + parity proof — closes the headline
   regression. MVP.
3. **US2** (T010–T012): the `--strict` guard — makes the fix durable.
4. **US3** (T013–T014): verify failure-vs-absence is trustworthy.
5. **Polish** (T015–T017): fmt/lint/test/self-review.

**Total: 17 tasks** — Setup 1 · Foundational 4 · US1 4 · US2 3 · US3 2 · Polish 3.
