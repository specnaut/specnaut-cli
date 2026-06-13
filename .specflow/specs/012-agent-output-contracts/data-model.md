# Data Model — Machine-readable agent output contracts

There is no runtime data store. The "model" here is the schema of the four output blocks and the
wiring relation between agents and contracts. These are documentation entities, asserted by tests.

## Entity: Contract

A bundled `user-invocable: false` skill defining one output block's schema.

| Field | Value |
|---|---|
| name | `workflow-contract` \| `handoff-protocol` \| `review-findings-contract` \| `qa-report-contract` |
| user-invocable | always `false` |
| defines block | `WORKFLOW STATUS` \| `HANDOFF` \| `REVIEW SUMMARY` \| `QA SUMMARY` |
| location | `templates/core/skills/<name>/SKILL.md` |

Identity = `name`. Immutable schema once shipped (changing a block's fields is a new contract version,
out of scope here).

## Entity: Wired agent

An existing bundled agent that preloads ≥1 contract.

| Field | Value |
|---|---|
| name | agent file stem under `templates/core/agents/` |
| skills | YAML array of contract names in frontmatter |
| obligation | emit each preloaded contract's block at end of turn |

## Value object: WORKFLOW STATUS block

Emitted by `workflow-contract` preloaders. Fields (all present each emission):

- `STATE` ∈ {`in_progress`, `blocked`, `awaiting_review`, `awaiting_qa`, `awaiting_user`, `done`, `failed`}
- `DONE_CRITERIA_MET` ∈ {`yes`, `no`}
- `SUMMARY` — one sentence (outcome, not effort)
- `ARTIFACTS` — comma list or `none`
- `FILES_CHANGED` — comma list or `none` (`none` for read-only agents)
- `VALIDATION` — comma list of command(results) or `none`
- `BLOCKERS` — one sentence or `none`
- `NEXT_ACTION` — one sentence
- `HANDOFF_TARGET` ∈ {`developer`, `review-coordinator`, `qa-tester`, `product-owner`, `workflow-manager`, `user`, `none`}

Invariant: `STATE: done` ⇒ `DONE_CRITERIA_MET: yes`.

## Value object: HANDOFF block

Emitted by `handoff-protocol` preloaders **iff** `HANDOFF_TARGET ≠ none`.

- `TARGET` — must equal the workflow block's `HANDOFF_TARGET`
- `REASON` — one sentence
- `REQUESTED_ACTION` — one imperative sentence, executable without reinterpretation
- `PAYLOAD` — concrete filenames / ids / findings the next actor needs
- `OPEN_RISKS` — comma list or `none`

Invariant: block exists ⟺ `HANDOFF_TARGET ≠ none`; `TARGET == HANDOFF_TARGET`.

## Value object: REVIEW SUMMARY block

Emitted by `review-findings-contract` preloaders.

- `REVIEW_SCOPE` — reviewer name / gate scope
- `REVIEW_VERDICT` ∈ {`pass`, `fail`, `needs_followup`}
- `CRITICAL_COUNT`, `HIGH_COUNT`, `MEDIUM_COUNT`, `LOW_COUNT` — explicit integers ≥ 0
- `TOP_ISSUES` — ≤5 lines or `none`
- `RECOMMENDATION` — one sentence

Invariants: `pass` ⟺ `CRITICAL_COUNT == 0 ∧ HIGH_COUNT == 0` and nothing else outstanding; `fail` ⟺
`CRITICAL_COUNT > 0 ∨ HIGH_COUNT > 0`; `needs_followup` ⟺ only Medium/Low remain. Every count is an
explicit integer including 0.

## Value object: QA SUMMARY block

Emitted by `qa-report-contract` preloaders.

- `QA_SCOPE` — one sentence
- `QA_VERDICT` ∈ {`pass`, `fail`, `blocked`}
- `NEW_UNIT_TESTS`, `NEW_FUNCTIONAL_TESTS`, `NEW_BROWSER_TESTS`, `TOTAL_PASS_COUNT`, `TOTAL_FAIL_COUNT`, `BUGS_FOUND` — explicit integers ≥ 0
- `QA_RECOMMENDATION` — one sentence

Invariants: `pass` ⟺ scope complete ∧ `TOTAL_FAIL_COUNT == 0`; `blocked` = could not run
(environment/prereq), distinct from `fail`.

## Relation

`Wired agent —preloads→ Contract` (many-to-many). The wiring table in research.md is the authoritative
mapping; tests assert it holds in the bundled output. The wired set is: the five auditors
(architecture, performance, security, a11y, dependency) and two reviewers (code, test) →
`review-findings-contract` + `workflow-contract`; `review-coordinator` →
`workflow-contract` + `handoff-protocol` + `review-findings-contract` (its aggregated REVIEW SUMMARY
conforms to the same schema); `developer` and `workflow-manager` → `workflow-contract` +
`handoff-protocol`; `qa-tester` → `qa-report-contract` + `workflow-contract`.
