# Tasks: collect-audit-scope.sh hardening (#389 · #390 · #391)

**Feature**: `018-scope-script-hardening` | **Branch**: `018-scope-script-hardening` | **Issues**: mkrlabs/specflow#389, #390, #391
**Inputs**: [spec.md](./spec.md). Target file: `templates/harness-specific/claude/...`? NO — `templates/core/skills/code-audit/scripts/collect-audit-scope.sh` (+ its SKILL.md + the spec-013 scope-signals contract doc).

All three issues touch the same scope script. TDD where a behaviour changes (the `--path`/`--range` rejections); the perf changes are regression-guarded by the existing count assertions.

## Phase 1: #390 input validation (TDD)
- [ ] T001 Add failing cases to `tests/templates/collect_audit_scope_test.ts`: `--path /etc` and `--path ../x` → non-zero exit + `error:` on stderr, no scope block; `--range 'a b;rm'` (and `--range a...b`) → non-zero exit + error; valid `--path src` and `--range <a>..<b>` still resolve. (Confirm RED first.)
- [ ] T002 In `collect-audit-scope.sh`, before any git call: reject `--path` that is absolute (`/*`) or contains a `..` path segment (`error: --path must be a relative path inside the repo (got: <v>)`, exit 2); tighten `--range` to a git-ref-name allowlist (e.g. only `[A-Za-z0-9._/@^~-]` around the single `..`), keeping the two-dot-only rule + clear error + exit 2. Make T001 GREEN.

## Phase 2: #391 perf micro-opts (regression-guarded)
- [ ] T003 Dedupe the unpushed-count: capture `local_count="$(git rev-list --count origin/main..HEAD …)"` once and test `$local_count` in the guard (no second `git rev-list`).
- [ ] T004 Replace the four serial `count_matches` calls with a SINGLE pass over the file list that increments all four category counters together. The emitted FRONTEND/TEST/DEP/INFRA counts MUST be byte-identical to before — the existing `collect_audit_scope_test.ts` count assertions (incl. the `INFRA_COUNT: 1` and exact `TOTAL_FILES` cases) are the regression guard; keep them green.

## Phase 3: #389 signal-intent docs
- [ ] T005 Keep emitting all four signals (contract). Document gating-vs-informational in three places: (a) `templates/core/skills/code-audit/SKILL.md` seat table — note FRONTEND_COUNT→accessibility, DEP_COUNT→dependency gate; TEST_COUNT/INFRA_COUNT informational (no seat); (b) `.specflow/specs/013-code-audit/contracts/scope-signals.md` — label each signal; (c) a one-line comment in the script above the CATEGORY SIGNALS emission.

## Phase 4: distribution + validate
- [ ] T006 `deno task bundle` (regenerate so the embedded skill carries the updated script + SKILL.md). Re-mirror to `plugin/skills/code-audit/` IF a mirrored file changed — NOTE: code-audit is script-backed and NOT in plugin/ (confirmed in #379), so only the SKILL.md mirror matters; verify whether code-audit/SKILL.md is in plugin/ (it is not) → no plugin change. No new skill folder → init counts unchanged.
- [ ] T007 `deno task test` GREEN (existing + new rejection cases); `shellcheck collect-audit-scope.sh` clean; `deno fmt`+`deno lint` on touched TS. Manually run the script with a valid `--path`, an invalid `--path /etc`, and `--last 3`; confirm behaviour.

## Dependencies
- T001→T002 (TDD). T003/T004 independent (same file — sequence to avoid conflict). T005 docs. T006 after T002/T004. All small.
