# Research — Machine-readable agent output contracts

Two decisions the spec deferred as implementation detail. Both resolved; no open NEEDS CLARIFICATION.

## Decision 1 — How an agent "preloads" a contract

**Decision**: Add a `skills:` array field to the agent's YAML frontmatter listing the contract skill
names (e.g. `skills: [review-findings-contract, workflow-contract]`). The contract skills are
ordinary bundled skills marked `user-invocable: false`, so they never appear as user commands but are
loaded into the agent's context when it runs.

**Rationale**: This is exactly the mechanism proven in the source `miximodel` system
(`skills: workflow-contract, handoff-protocol, review-findings-contract` in agent frontmatter). The
contract lives in exactly one place (the SKILL.md) and every preloading agent references it by name —
zero duplication, single source of schema truth. `user-invocable: false` keeps the four contracts out
of the user-facing skill list while still loadable by agents and discoverable by the future
`/status-audit` parser.

**Alternatives considered**:
- *Inline the contract text into each agent body* — rejected: 8 copies of each block schema drift
  apart the first time one is edited; defeats the "single schema both sides agree on" goal (FR-002).
- *A new bespoke frontmatter field (e.g. `contracts:`)* — rejected: `skills:` is the established
  Claude Code preload field and what miximodel uses; inventing a parallel field adds surface for no gain.

## Decision 2 — Bundle inclusion and test strategy

**Decision**: Author the four contracts as standard `templates/core/skills/<name>/SKILL.md` files and
regenerate the embedded bundle with `deno task bundle`. Add assertions (under `tests/`) that (a)
`CORE_BUNDLE` contains the four contract paths and (b) each wired agent's bundled content carries the
expected `skills:` entries.

**T001 verification result (2026-06-12)**: the generator is **NOT glob-driven**. `scripts/
bundle-templates.ts` reads `templates/manifest.json` and only bundles the entries listed there
(`for (const e of m.core) …`). A throwaway `templates/core/skills/_probe/SKILL.md` was added, `deno
task bundle` run, and `grep -c _probe src/templates_bundle.ts` returned `0` — the probe was not picked
up. The four new skill dirs therefore MUST be registered in `templates/manifest.json` as
`{ "category": "skill", "name": "<name>", "source": "core/skills/<name>/SKILL.md" }` entries (done in
T002–T005 / T016). The `user-invocable: false` frontmatter is preserved through bundling because
`ensureSkillFrontmatter` only injects missing `name:`/`description:` and never strips other fields.

**Rationale**: The bundle pipeline is already directory-driven (`deno task test` runs `deno task
bundle` first, so a stale bundle can't pass CI). Asserting both the presence of the contracts and the
agent wiring locks the two halves of the feature together — an agent can't lose its preload line, and
a contract can't drop out of the bundle, without a red test. This directly backs SC-001 and SC-004.

**Alternatives considered**:
- *Manual bundle registration* — rejected unless Phase-0 verification shows the generator is not
  glob-based (it is; confirmed by the existing skills all living under `templates/core/skills/`).
- *Snapshot-test the whole bundle* — rejected: brittle; a targeted presence+wiring assertion is
  more legible and survives unrelated bundle changes.

**Verification step (implementation)**: after authoring, run `deno task bundle` and grep
`src/templates_bundle.ts` for the four contract paths before writing the assertion, to confirm the
generator is in fact glob-based for this tree.

## Wired-agent set (confirmed present in `templates/core/agents/`)

| Agent | Contracts to preload |
|---|---|
| architecture-auditor, performance-auditor, security-auditor, a11y-auditor, dependency-auditor | `review-findings-contract`, `workflow-contract` |
| code-reviewer, test-reviewer | `review-findings-contract`, `workflow-contract` |
| review-coordinator | `workflow-contract`, `handoff-protocol`, `review-findings-contract` |
| qa-tester | `qa-report-contract`, `workflow-contract` |
| developer | `workflow-contract`, `handoff-protocol` |
| workflow-manager | `workflow-contract`, `handoff-protocol` |

All five auditors and both reviewers are review-shaped → review-findings + workflow. The
review-coordinator is review-shaped AND an orchestrator → it also carries `review-findings-contract`
so its AGGREGATED `REVIEW SUMMARY` block conforms to the same schema as its seats. The developer and
workflow-manager are work/orchestration-shaped → workflow + handoff (workflow-manager is the primary
HANDOFF consumer/orchestrator). QA is its own shape → qa-report + workflow. No FinOps seat
(Cloud-specific, out of scope).
