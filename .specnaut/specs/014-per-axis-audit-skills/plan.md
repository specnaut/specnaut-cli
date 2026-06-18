# Implementation Plan: Per-axis scope-targeted audit-dispatch skills

**Branch**: `014-per-axis-audit-skills` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: issue mkrlabs/specflow#380, epic mkrlabs/specflow-monorepo#12

## Summary

Add five thin, read-only, markdown-only dispatch skills — `arch-audit`, `sec-audit`, `perf-audit`,
`dep-audit`, `a11y-audit` — each binding one axis to its existing auditor agent. Each resolves an
optional scope (`--path` / `--range` / `--diff` / whole-repo, uniform across all five), dispatches
its single auditor with the scope + audit framing, and returns findings inline (the agent emits the
canonical `REVIEW SUMMARY` from #378). No report file, no new agents, no shell script. Sibling of
`/code-audit` (multi-seat) and `/specflow audit <axis>` (report-writing).

Surfaces: five `templates/core/skills/<axis>-audit/SKILL.md` + manifest registration + bundle
regen + plugin mirror (markdown-only, so mirrored, unlike `code-audit`) + content/inclusion tests.

## Technical Context

**Language/Version**: TypeScript on Deno v2.x (bundle/tests); the skills themselves are markdown
**Primary Dependencies**: none new — existing bundle pipeline; dispatches the five existing auditor
agents (emit REVIEW SUMMARY since #378) **Storage**: bundled files only; no report artifacts
(FR-004) **Testing**: `deno task test`; skill-content tests (each skill names its agent, scope args,
the 3-way disambiguation; never writes a report) + bundle-inclusion + plugin-sync **Target
Platform**: the Specflow CLI; skills land in any project's `.claude/` **Project Type**: cli (no src/
code) **Performance Goals**: N/A **Constraints**: read-only; one-axis-per-skill; uniform scope
semantics; reject unknown args (no silent whole-repo) **Scale/Scope**: 5 markdown skills +
manifest/bundle/plugin wiring + ~1 test file

## Constitution Check

Placeholder constitution — no gate. De-facto: no domain/app code; read-only; reuse existing agents +
the #379 scope-resolution approach if convenient; ship through the one bundle path. **PASS.**

## Project Structure

```text
templates/core/skills/{arch,sec,perf,dep,a11y}-audit/SKILL.md   # NEW (5)
templates/manifest.json                                          # EDIT — register 5 skills
src/templates_bundle.ts                                          # REGENERATED
plugin/skills/{arch,sec,perf,dep,a11y}-audit/SKILL.md            # NEW mirror (markdown-only → mirrored)
tests/templates/per_axis_audit_skills_test.ts                    # NEW — content + inclusion + mapping
```

**Structure Decision**: Five sibling skill dirs, consistent body (axis → agent binding + scope
handling

- disambiguation). No `scripts/` (scope resolved via git commands described in the body, or by
  reusing `collect-audit-scope.sh` for `--path`/`--range`; only the file/commit list is needed).
  Markdown-only → mirrored to `plugin/` and added to `plugin_sync_test.ts` SYNC pairs.

## Complexity Tracking

> No violations — empty.
