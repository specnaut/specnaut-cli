# Contracts — Preserve & Diff

Phase 1 contracts for issue #367. Each contract is paired with the test(s) that prove it and the
acceptance criteria (SC-/FR-) it satisfies. The C-id ⇄ test ⇄ SC/FR map is the analyze gate's
checklist.

## 1. Manifest contract — `.specnaut/preserve.yml`

- The file is a YAML document with a single `preserved:` key holding a list of project-relative,
  forward-slash destination paths.
- Absent file ⇒ `EMPTY_PRESERVE_CONFIG`. Unparseable / malformed ⇒ `EMPTY_PRESERVE_CONFIG` plus a
  handler `warn:` line. Neither ever aborts a refresh.
- `parsePreserveConfig` is pure: it trims, de-dupes, drops blanks, strips a leading `./`, and
  normalises backslashes. It does NOT judge bundle membership.
- `serializePreserveConfig(parsePreserveConfig(x))` is idempotent on canonical input (round-trip).

## 2. Preserve-plan contract — init filter + upgrade predicate

- **init**: `InitProjectUseCase.execute` MUST write `bundle` minus `input.preservedPaths` and report
  the removed set as `InitResult.preserved`. With `preservedPaths` absent/empty, the written set is
  exactly today's `bundle` (no behaviour change).
- **upgrade**: `computeUpgradePlan` MUST emit `preserve / reason:"declared"` for any `dest` where
  `isDeclaredPreserved(dest)` is true, regardless of the disk/lock/bundle SHA relationship, and MUST
  evaluate that check BEFORE the plugin-migration and unchanged/auto-update branches.
- Neither use case reads any CLI flag; both consume only the predicate / set built by the handler.

## 3. Notice contract — no silent skip, no silent override (FR-004 / FR-005)

- Every file preserved during a refresh MUST produce exactly one notice line naming the path and
  identifying it as maintainer-declared.
- Every file overwritten because `--reset-preserved` was passed MUST produce exactly one warning
  line naming the path and identifying the override.
- A declared path that is NOT in the bundle MUST produce exactly one `warn:` line (ineffective
  declaration, FR-008) and MUST NOT appear in either of the above.

## 4. Diff command contract — `specflow diff` (read-only)

- `DiffProjectUseCase` MUST depend on no `FsWriter` and MUST mutate zero files (read-only
  invariant).
- It returns `DivergenceResult[]`: `differs` (with both contents), `matches`, or `missing`
  (declared/ tracked on disk, absent from the new bundle).
- The handler renders each `differs` via `renderUnifiedDiff`, prints "no divergence" + exit 0 when
  the result set is empty, and returns non-zero ONLY on error (a present diff is exit 0).
- `--only-customised` restricts results to paths whose disk SHA ≠ lock SHA; default shows all
  managed paths.

## 5. Reset contract — `--reset-preserved`

- Off by default. When absent, declared files are preserved on `init --force` and `upgrade`.
- When present, `init_handler` passes an empty preserved set and `upgrade_handler` passes
  `isDeclaredPreserved: () => false`; previously-preserved files are overwritten with the bundle and
  each override is reported (contract §3).

## 6. Backward-compatibility contract (FR-011)

- A project with no `preserve.yml` MUST observe byte-identical init/upgrade behaviour and output to
  today. The existing init/upgrade test suites pass unchanged.
- The `installed.lock` format is unchanged (preserve intent lives in its own file).

## 7. Interaction contract — parent-managed & plugin (D8)

- A declared agentic path in a parent-managed sub-repo is a no-op: agentic paths are filtered from
  the bundle before the preserve check, so the predicate is never consulted for them.
- A declared path that the plugin would otherwise own is preserved, not migrated (declared check
  precedes the plugin-migration branch).

## C-id ⇄ test ⇄ acceptance map

| C  | Contract                                                                                           | Test(s)                                                                        | Satisfies                                              |
| -- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| C1 | Manifest parse/serialize, normalise, degrade-to-empty                                              | `tests/domain/preserve_config_test.ts`                                         | FR-001, FR-007                                         |
| C2 | `FsPreserveStore` read/write/absent round-trip                                                     | `tests/infrastructure/fs_preserve_store_test.ts`                               | FR-001, FR-009                                         |
| C3 | upgrade emits `preserve/"declared"` even when SHA matches; ordering before plugin-migration        | `tests/domain/upgrade_plan_test.ts`                                            | FR-003, FR-007, C7                                     |
| C4 | init filters preserved paths from the write set; reports them; empty set ⇒ unchanged               | `tests/application/init_project_test.ts`                                       | FR-002, FR-010, FR-011                                 |
| C5 | `DiffProjectUseCase` read-only; differs/matches/missing                                            | `tests/application/diff_project_test.ts`                                       | FR-006, FR-009                                         |
| C6 | end-to-end: `init --force` keeps declared file; `--reset-preserved` overwrites it; notices emitted | `tests/integration/init_preserve_test.ts`                                      | FR-002, FR-004, FR-005, SC-001, SC-002, SC-005, SC-006 |
| C7 | declared path absent from bundle ⇒ warn no-op; declared agentic path in parent-managed ⇒ no-op     | `tests/application/init_project_test.ts` + `tests/domain/upgrade_plan_test.ts` | FR-008, D8                                             |

## SC coverage

- **SC-001** (force keeps preserved, byte-identical) → C6
- **SC-002** (N skips → N notices) → C6, C3 (notice path)
- **SC-003** (read-only divergence view) → C5
- **SC-004** (no-preserve project unchanged) → C4, C6 (control case)
- **SC-005** (reset only when invoked) → C6
- **SC-006** (2026-06-08 `product-owner.md` regression closed) → C6 (the fixture file)
