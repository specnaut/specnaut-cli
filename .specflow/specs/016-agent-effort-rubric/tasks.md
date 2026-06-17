# Tasks: Per-agent `effort` tuning rubric

**Feature**: `016-agent-effort-rubric` | **Branch**: `016-agent-effort-rubric` | **Issue**:
mkrlabs/specflow#382 (epic mkrlabs/specflow-monorepo#12) **Inputs**: [plan.md](./plan.md) ·
[spec.md](./spec.md) · contracts/effort-map.md (authoritative) · [research.md](./research.md) ·
[data-model.md](./data-model.md)

Mechanical: add one `effort:` line per agent + a README. Asserted under `deno task test`.

## Phase 1: Frontmatter

- [ ] T001 Add `effort:` to each of the 15 `templates/core/agents/*.md` EXACTLY per
      contracts/effort-map.md (low: review-coordinator, workflow-manager; medium:
      a11y/architecture/dependency/performance/ security-auditor, code-reviewer, test-reviewer,
      specflow-expert, product-owner; high: ui-ux-designer; xhigh: developer, qa-tester,
      devops-sre). Insert adjacent to `model:`; change nothing else (FR-005).

## Phase 2: README

- [ ] T002 Author `templates/core/agents/README.md` (→ `.claude/agents/README.md`): the four-tier
      table with member lists (matching effort-map.md), the compound cost/quality rationale, and the
      `xhigh`-is-Opus-only caveat. (FR-004)

## Phase 3: Distribution

- [ ] T003 Register the README in `templates/manifest.json` (agent-file shape); `deno task bundle`;
      confirm the 15 effort fields + the README are in `src/templates_bundle.ts`.
- [ ] T004 Mirror the 15 agents + README to `plugin/agents/` byte-identical; extend
      `tests/plugin/plugin_sync_test.ts`. Bump init `*_test.ts` counts ONLY if a new file lands in a
      counted dir (the README under `.claude/agents/` — verify whether codex/copilot/windsurf count
      it; adjust if so).

## Phase 4: Tests

- [ ] T005 `tests/templates/agent_effort_test.ts`: loop `templates/core/agents/*.md` — assert each
      has exactly one `effort:` ∈ {low,medium,high,xhigh} (SC-001); assert no agent with
      `model: sonnet` has `effort: xhigh` (SC-002); assert the per-agent value matches
      effort-map.md.
- [ ] T006 Run `deno task test` GREEN; `deno fmt` + `deno lint` on touched TS.

## Phase 5: Polish

- [ ] T007 Sanity-check `upgrade` (spec 011): the 15 agents are CHANGED managed files (delivered
      unless a user customised one → preserved); the README is net-new (added cleanly).

## Dependencies

- T001 → T003/T005. T002 → T003. T003 → T004. All quick.
