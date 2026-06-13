# Tasks: High-altitude multi-seat parallel audit (`/code-audit`)

**Feature**: `013-code-audit` | **Branch**: `013-code-audit` | **Issue**: mkrlabs/specflow#379 (epic
mkrlabs/specflow-monorepo#12) **Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) ·
[research.md](./research.md) · [data-model.md](./data-model.md) ·
contracts/{scope-signals,unified-report}.md

Bundled skill + bash/git script. The two contracts/*.md are canonical: the script's stdout matches
`scope-signals.md`; the skill's report + parallel-dispatch + verdict rules match
`unified-report.md`. Distribution + behaviour asserted under `deno task test` (runs
`deno task bundle` first). Script test is hermetic — a temp git repo with fixture commits; no
network.

---

## Phase 1: Setup — confirm the manifest/asset shape for a skill with scripts/

- [ ] T001 Inspect how the `backlog` skill (which has a `scripts/` subdir) is registered in
      `templates/manifest.json` and how `scripts/bundle-templates.ts` walks skill assets (does it
      bundle the whole skill dir incl. `scripts/`, or list each file?). Record the exact
      registration shape to reuse for `code-audit`. This governs T006.

## Phase 2: Foundational — the scope script (blocks the skill)

- [ ] T002 [P] [US3] Write a hermetic behaviour test `tests/templates/collect_audit_scope_test.ts`:
      create a temp git repo (`git init`, commit a frontend file + a backend file + a `deno.json`),
      run `collect-audit-scope.sh` with `--last 5`, `--path <subdir>`, and in a non-git temp dir;
      assert the `CODE-AUDIT SCOPE` block shape, the correct `SCOPE:` label per mode, the
      `CATEGORY SIGNALS` integer counts (FRONTEND/TEST/DEP/INFRA), `TOTAL_FILES: 0` on empty scope,
      and non-zero exit + error on non-repo. (Contract: scope-signals.md)
- [ ] T003 Implement `templates/core/skills/code-audit/scripts/collect-audit-scope.sh` to pass T002:
      resolution priority `--path`/`--range` → unpushed (`origin/main..HEAD`) → since-tag → last-N
      (default 20, `--last <n>`); emit the fixed block + CATEGORY SIGNALS via path/extension globs
      (research.md Decision 1); git-repo guard; distinct `TOTAL_FILES: 0`. POSIX bash,
      `set -euo
      pipefail`, no non-core deps.

## Phase 3: US1 + US2 — the orchestrator skill

- [ ] T004 Author `templates/core/skills/code-audit/SKILL.md` (frontmatter `name: code-audit`,
      `description:` with trigger phrases,
      `argument-hint: "[--path <subtree> | --range <a>..<b>] [--last <n>]"`). Body steps (mirroring
      research.md Decision 3): (1) run the scope script; (2) stop with the "nothing to audit" line
      if `TOTAL_FILES: 0`; (3) select seats from CATEGORY SIGNALS per the data-model table
      (architecture+security+performance always on non-empty; a11y iff FRONTEND>0; dependency iff
      DEP>0); (4) **dispatch all selected seats in a SINGLE message, one Agent call per seat**, with
      the audit framing + same scope context to each; (5) synthesize ONE report (merge → dedupe by
      file+line → severity-rank) per unified-report.md, closing with the aggregated REVIEW SUMMARY
      (dominance fail>needs_followup>pass; summed counts). State the read-only rule and the
      "complementary to /specflow audit <axis>" note explicitly. (FR-004..010)
- [ ] T005 [P] Add a skill-content test `tests/templates/code_audit_skill_test.ts` asserting the
      SKILL body contains: the single-message parallel-dispatch instruction (SC-003), the
      seat→signal selection rules, the dominance verdict rule, and the read-only statement. Guards
      against the orchestration contract silently drifting.

## Phase 4: Distribution

- [ ] T006 Register `code-audit` (skill + its `scripts/collect-audit-scope.sh` asset) in
      `templates/manifest.json` per the T001 shape; run `deno task bundle`; confirm
      `src/templates_bundle.ts` contains the skill and the script body.
- [ ] T007 Mirror to `plugin/skills/code-audit/` (SKILL.md + scripts/) byte-identical; extend
      `tests/plugin/plugin_sync_test.ts` SYNC pairs so it stays locked.
- [ ] T008 [P] Add a bundle-inclusion assertion (in the skill-content test or a small addition to
      the existing template bundle test): `code-audit/SKILL.md` and the script are in `CORE_BUNDLE`.
- [ ] T009 If the number of bundled skill FOLDERS changed, bump the codex/copilot/windsurf
      `init_*_test.ts` expected counts by exactly 1 (one new skill). Verify whether the harnesses
      scaffold script assets and adjust file counts accordingly.

## Phase 5: Validate

- [ ] T010 Run `deno task test` — GREEN, zero regressions. `deno fmt` + `deno lint` on touched
      files. Manually run `collect-audit-scope.sh --last 5` in this repo and eyeball the block +
      signals.

## Phase 6: Polish

- [ ] T011 Add a `/code-audit` row to the `using-specflow` skill registry, noting it is the
      multi-seat audit complementary to `/specflow audit <axis>`. T012 Sanity-check `upgrade` (spec
      011): the skill is net-new (added cleanly); no customised file clobbered.

---

## Dependencies / parallelism

- T001 → T006 (manifest shape). T002 → T003 (test-first script). T003 → T004 (skill calls the
  script).
- T004 → T006/T007 (bundle/mirror the authored skill). T006 → T008 (inclusion test reads the
  bundle).
- T002/T005/T008 are mutually parallel (distinct test files).

## MVP boundary

US1 (auto-scope → parallel seats → one report) is the shippable core: T001–T004, T006, T010. US2
(`--path`/`--range` + signal-gated seats) and US3 (auto-scope fallbacks) are covered by the same
script

- skill; the tests (T002/T005/T008) lock the contracts.
