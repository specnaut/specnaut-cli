# Feature Specification: collect-audit-scope.sh hardening (orphan signals · input validation · perf)

**Feature Branch**: `018-scope-script-hardening` **Created**: 2026-06-13 **Status**: Draft
**Input**: User description: "Batch the three small hardening follow-ups from the epic monorepo#12
dogfood, all on collect-audit-scope.sh: #389 (clarify the orphan INFRA_COUNT/TEST_COUNT signals),
#390 (validate --path/--range input), #391 (perf micro-opts: dedupe git rev-list, single-pass
category counting)."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Clear which signals gate seats (#389) (Priority: P2)

A maintainer reading the scope block or the `/code-audit` skill understands that `FRONTEND_COUNT`
and `DEP_COUNT` gate seats (accessibility, dependency) while `TEST_COUNT` and `INFRA_COUNT` are
**informational context only** — not orphaned bugs. The four signals stay in the output (the #379
scope-signals contract requires all four), but the docs label which gate and which inform.

**Why this priority**: The dogfood flagged the two non-gating signals as confusing "orphans". The
contract requires emitting all four, so the fix is to document intent, not remove them.

**Acceptance Scenarios**:

1. **Given** the `/code-audit` SKILL.md seat table, **When** read, **Then** it notes
   `TEST_COUNT`/`INFRA_COUNT` are informational (no seat consumes them; FRONTEND/DEP gate
   a11y/dependency).
2. **Given** `scope-signals.md`, **When** read, **Then** it labels each signal
   gating-vs-informational.
3. **Given** the script output, **When** run, **Then** all four signals are still emitted (no
   contract break).

---

### User Story 2 - Reject malformed/unsafe scope arguments (#390) (Priority: P2)

`--path` rejects absolute paths and `..` traversal before touching git; `--range` accepts only
git-ref-name-shaped values (not arbitrary strings with shell metacharacters). Both fail fast with a
clear `error:` and exit non-zero rather than silently producing an empty or misleading scope.

**Why this priority**: Defensive hardening of the only external inputs the script takes; prevents
confusing empty scopes and tightens an input boundary.

**Acceptance Scenarios**:

1. **Given** `--path /etc` or `--path ../../x`, **When** parsed, **Then** the script errors
   (`--path must be a relative path inside the repo`) and exits non-zero, no block emitted.
2. **Given** `--range 'a b;rm'` (metacharacters), **When** parsed, **Then** the script errors (range
   must be ref-name-shaped) and exits non-zero.
3. **Given** a valid `--path src/x` or `--range v1.0..HEAD`, **When** parsed, **Then** it resolves
   normally.

---

### User Story 3 - Avoid redundant work (#391) (Priority: P3)

The script computes the unpushed-commit count once (not twice) and classifies files in a single pass
over the file list (not four passes). Behaviour is identical; only the redundant work is removed.

**Why this priority**: Pure micro-optimization; lowest priority. Bounded impact, but free
correctness-preserving cleanup.

**Acceptance Scenarios**:

1. **Given** the unpushed-scope branch, **When** resolved, **Then**
   `git rev-list --count origin/main..HEAD` runs once.
2. **Given** any scope, **When** category signals are computed, **Then** the file list is walked
   once and all four counters incremented together; the emitted counts are unchanged from the
   previous implementation.

---

### Edge Cases

- `--path .` or a valid nested relative path → allowed (only absolute + `..` rejected).
- `--range` with three dots (`a...b`) → rejected (only two-dot ranges, as before).
- Empty/zero-file scope after a valid `--path` → still emits `TOTAL_FILES: 0` (unchanged).
- The single-pass classifier must produce byte-identical counts to the four-pass version on the same
  input (regression-guarded by the existing scope tests).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** (#389): Keep emitting all four CATEGORY SIGNALS (contract-required). Document — in the
  `/code-audit` SKILL.md seat table and in `contracts/scope-signals.md` — that `FRONTEND_COUNT`
  gates accessibility and `DEP_COUNT` gates dependency, while `TEST_COUNT`/`INFRA_COUNT` are
  informational context (no seat). Add a one-line in-script comment to the same effect.
- **FR-002** (#390): Validate `--path` before use — reject a value that is absolute (leading `/`) or
  contains a `..` segment, with `error: --path must be a relative path inside the repo (got: <v>)`
  and a non-zero exit, before any git call.
- **FR-003** (#390): Tighten `--range` validation to a git-ref-name allowlist (reject shell
  metacharacters / spaces); keep the existing two-dot-only rule and the clear error + non-zero exit.
- **FR-004** (#391): Compute the unpushed-commit count once and reuse it (no duplicate
  `git rev-list --count`).
- **FR-005** (#391): Classify files into the four category counters in a single pass over the file
  list (replace the four serial `count_matches` calls), producing identical counts.
- **FR-006**: No behavioural regression — the scope block format, the resolution-priority order, the
  signal values, the git-repo guard, the `TOTAL_FILES: 0` distinct case, and `set -euo pipefail` +
  exit codes are all unchanged except where a new validation adds an explicit error path.
- **FR-007**: The change ships through the bundle (`init`/`upgrade`); existing
  `collect_audit_scope_test.ts` stays green and gains cases for the new `--path`/`--range`
  rejections.

## Key Entities

- **Scope argument**: `--path` / `--range` / `--last` (validation tightened on the first two).
- **Category signal**: gating (`FRONTEND_COUNT`, `DEP_COUNT`) vs informational (`TEST_COUNT`,
  `INFRA_COUNT`).

## Domain Model _(mandatory)_

**Bounded context:** Audit-scope resolution (the `collect-audit-scope.sh` script) — hardening pass,
no new behaviour.

**Vocabulary:** **Gating signal** (governs a seat) vs **Informational signal** (context only);
**Scope argument** (the validated inputs).

**Entities:** _Scope script_ — existing; this pass tightens input validation, dedups work, and
clarifies signal intent.

**Value objects:** _CategorySignals(frontend[gating], dep[gating], test[info], infra[info])_;
_ScopeArg(path|range|last)_ with validation rules.

**Invariants:**

- All four CATEGORY SIGNALS are always emitted (contract from #379).
- Single-pass classification yields identical counts to the prior four-pass version.
- `--path` is relative + no `..`; `--range` is ref-name-shaped + two-dot only.
- Resolution priority, scope-block format, git-repo guard, exit-0-on-empty-scope,
  `set -euo pipefail` unchanged.

**Out of scope:** adding an infra/coverage audit seat (no such agent exists; not warranted);
changing the scope-block schema; touching `/code-audit`'s dispatch/synthesis logic.

## Success Criteria _(mandatory)_

- **SC-001**: All four signals still emitted; SKILL.md + scope-signals.md + an in-script comment
  label gating vs informational. (#389)
- **SC-002**: `--path` absolute/`..` and `--range` metacharacter inputs are rejected with a clear
  error + non-zero exit; valid inputs resolve unchanged — test-verified. (#390)
- **SC-003**: Unpushed count computed once; file classification is a single pass; the scope tests
  confirm unchanged counts. (#391)
- **SC-004**: `deno task test` green (existing scope tests + new rejection cases); `shellcheck`
  clean.

## Assumptions

- All three issues touch `collect-audit-scope.sh`; batching them in one pass is lower-risk than
  three separate edits to the same file.
- `#389` resolves by documentation (the #379 contract mandates emitting all four signals, so removal
  is not an option); the confusion is "which gate?", answered by labeling.
- The single-pass classifier (#391) must be regression-guarded by asserting the same counts on a
  fixture the four-pass version produced — the existing `collect_audit_scope_test.ts` already
  asserts FRONTEND/TEST/DEP/INFRA counts.
