# Plan: Cut the agent roster from 15 to 9; review fans out from the main session

**Branch**: `043-roster-cut` | **Date**: 2026-10-30 | **Backlog item**:
[specnaut-cli#678 — Cut the agent roster from 15 to 9 and prune unparsed contracts; review fans out under a cap](https://github.com/specnaut/specnaut-cli/issues/678),
child of epic #674.

**Full plan** — the change narrows and widens agent tool grants (`code-reviewer` gains the test
runners' `Bash(...)`, `security-expert` loses `Bash`): an agent instruction surface (plan.md step
4b). Lands on a green suite, no content guard weakened, bytes reported before and after (no model
eval).

## 1. Why this exists

The bundle ships 15 agents (133,618 B incl. README) and 5 output contracts (13,200 B). Measured at
1501ccdd: `workflow-manager`, `qa-tester` and `devops-sre` have no dispatcher (only lists and one
example mention); `ui-ux-designer` is dispatched by nothing; `review-coordinator`'s protocol spawns
three seats, so the Mode 1 of architect, performance, accessibility and dependency is unreachable;
and in practice the coordinator's seats hit their turn limit and come back empty (four times in
cli#677's review alone). Three contracts are parsed by nothing: `handoff-protocol` (the hook
segments only WORKFLOW/REVIEW/QA), `qa-report-contract` (its only producer has no dispatcher),
`alert-triage-contract` (its caller `/release` is retired).

## 2. User scenarios

### US1 — review fans out from the main session (P1)

**Given** a frozen tree on a feature branch **When** `/task review` runs **Then** the main session
measures (size ratchet, boundary check), selects seats from `collect-audit-scope.sh`, dispatches
them by name — `Task(subagent_type)` / `spawn_agent(agent_type)` — at most 4 in flight, and
aggregates one REVIEW SUMMARY with the NOT RUN arithmetic intact.

### US2 — a project upgrades (P1)

**Given** a project scaffolded with the 15 agents **When** `specnaut upgrade` runs **Then** the six
retired vanilla agents, their Codex TOMLs, memory seeds and the three contract skills are removed; a
customised one is kept and warned about until `--force` (which backs it up); the managed
`agent-dispatch` section names no retired agent; `/design` is installed.

### US3 — a designer asks for a design system (P2)

**Given** a project **When** the user types `/design` **Then** the skill runs the former
`ui-ux-designer` protocol (discovery, edit, audit of `DESIGN.md`) from a template.

### Edge cases

- A diff larger than ~40 files: a seat is split across instances; each counts in `SEATS_EXPECTED`.
- A seat returns partial at its turn limit: NOT RUN; resume it first, re-dispatch narrower second.
- A project addendum or custom agent dispatches a retired agent by name: the upgrade prints a notice
  naming the successor (`/design`, `code-reviewer`, or "the main session").

## 3. Requirements

- **FR-001**: `review-coordinator`, `test-reviewer`, `workflow-manager`, `qa-tester`, `devops-sre`
  and `ui-ux-designer` are absent from every bundled surface: `templates/`, `plugin/`, the manifest,
  `_agents.txt`, `plugin_coverage.ts`, `specnaut-facts`, `agents/README.md`, the root `AGENTS.md`
  template, `cursor/specify-rules.mdc`, `dispatch-agent.sh`. Search: `grep -rl` of each name over
  `templates src plugin`, allowed only in the retired-agent notice table and upgrade tests.
- **FR-002**: `phases/review.md` holds the fan-out: Phase 0 measure, seat selection by signal
  (`code-reviewer` + `security-expert` always; `accessibility-expert` on `FRONTEND_COUNT>0`,
  `dependency-expert` on `DEP_COUNT>0`, `performance-expert` when the plan records a hot path), the
  cap, the turn budget, the NOT RUN / EVIDENCE arithmetic moved verbatim, route-by-fix-cost (one
  copy), the missing-seat rule and the report format.
- **FR-003**: the cap equals `DEFAULT_MAX_CONCURRENT` in `src/domain/codex_config.ts`, pinned by a
  test.
- **FR-004**: `code-reviewer` carries the test-review checklist (runs when `TEST_COUNT>0`) and the
  test-runner `Bash(...)` grants; `maxTurns` 40.
- **FR-005**: the five experts keep their catalogue pointers, project gates (measure-first, license
  allowlist, FE gate), Mode 2 (dispatched by `/task audit`) and — architect, security, performance —
  Mode 3 plan-audit questions; generic checklists go; `security-expert` loses alert triage and
  `Bash`.
- **FR-006**: `developer`, `product-owner`, `specnaut-guide` stay, slimmed; every kept agent reads
  `docs/constitution.md` first (the #685 guard enforces it); `developer` names no
  `handoff-protocol`.
- **FR-007**: `workflow-contract` keeps `STATE`, `DONE_CRITERIA_MET`, `HANDOFF_TARGET` (parsed by
  `log-subagent.sh`) and `BLOCKERS` (read by `developer.md`); the other fields go.
  `review-findings-contract` stays, compressed. `handoff-protocol`, `qa-report-contract`,
  `alert-triage-contract` are removed.
- **FR-008**: `/design` is a user-invocable skill (`disable-model-invocation: true`) with its
  template at `templates/core/specnaut/templates/design-template.md`, reading the constitution first
  and preloading `mobile-first-contract`.
- **FR-009**: `specnaut upgrade` prunes every retired file through the lock-driven orphan path and
  prints the retired-agent notice when an addendum or project agent names one; pinned by an
  integration test on claude and codex.
- **FR-010**: every lock that pinned a moved rule pins it at its new home; none is deleted because
  its file went away.

## 4. Success criteria

- **SC-001**: `deno task test` green; `deno fmt --check`, `deno lint`, `gen-hooks.ts --check`, size
  ratchet, `smoke-features`, `smoke-task`, `smoke-hooks`, `audit.sh` green; `go test ./...` green.
- **SC-002**: bundled agents + contracts bytes reported before (146,818 B) and after.
- **SC-003**: a red-probe of each new lock (the cap pin, the NOT RUN arithmetic, the upgrade prune,
  the retired-name sweep) is observed red.

## 5. 🔒 Decision table

| The decision                                                            | Its single home                                                      | What would duplicate it                                                                       |
| :---------------------------------------------------------------------- | :------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| NOT RUN arithmetic, EVIDENCE counting, missing-seat stop, report format | `templates/core/skills/task/phases/review.md`                        | the contract's "coordinator counts that seat as 0" sentence (cut there)                       |
| Verdict rule (fail on CRITICAL/HIGH)                                    | `templates/core/skills/review-findings-contract/SKILL.md`            | any seat restating it (review.md is the one exempt restatement, `verdict_rule_one_home_test`) |
| Route by fix cost / the four filing reasons                             | `phases/review.md` § 🔒                                              | developer.md rule 4 (becomes a pointer)                                                       |
| Fan-out cap                                                             | `src/domain/codex_config.ts` `DEFAULT_MAX_CONCURRENT`                | a bare `4` in review.md without the pin test                                                  |
| Which seats run                                                         | `templates/core/skills/task/scripts/collect-audit-scope.sh` signals  | a second heuristic in review.md                                                               |
| Test-review checklist, test-runner grants                               | `templates/core/agents/code-reviewer.md`                             | a checklist left in review.md                                                                 |
| Plan-audit questions                                                    | each expert's Mode 3                                                 | plan.md step 6 restating them                                                                 |
| Retired agent → successor                                               | `src/application/upgrade_retired_notices.ts` (extended at its owner) | a second table in a new module                                                                |
| DESIGN.md shape                                                         | `templates/core/specnaut/templates/design-template.md`               | the skill inlining it                                                                         |

New helpers: none. The upgrade notice **extends** `upgrade_retired_notices.ts` (inventory: it
already emits the `extensions.yml` notice, cli#676); the prune reuses `orphan_scope.ts` /
`upgrade_orphan_removal.ts`; seat signals reuse `collect-audit-scope.sh`.

## 6. Technical context

**Language/Version**: Deno 2 / TypeScript; bash 3.2-compatible scripts; Markdown templates.
**Primary Dependencies**: none added. **Storage**: N/A. **Testing**: `deno task test`
(`--allow-read --allow-write --allow-run --allow-env`), smoke scripts, `go test ./...`. **Target
Platform**: Claude Code and Codex (frontier); other harnesses follow. **Project Type**: cli.
**Performance Goals**: fewer always-shipped bytes; no seat empty at its turn limit. **Constraints**:
plugin/ byte-identical to templates/core; size ratchet (300/500). **Scale/Scope**: 6 agents and 3
contracts removed; 9 agents slimmed; ~25 locks re-homed.

## 7. Domain model

Seat (name, signal, required?) → Review run (seats expected, reported, NOT RUN) → Verdict. A retired
agent maps to one successor. No stored data changes.

## 8. Constitution check

- **§ I (halves)** — public CLI only; no private name. Kept.
- **§ VIII (no pinned versions)** — no model version, counts or dates in shipped prose. Kept.
- **§ X (backlog truth)** — review still produces the merge request; nothing moves a card. Kept.
- **§ XII (Kevin asked only about product)** — the removals are named in the approved AC; nothing
  open.

## 9. Surfaces

Bundled agents, skills, `review.md`, root `AGENTS.md` managed sections, Codex TOMLs, hook
`_agents.txt` (hash-pinned), `plugin/`, upgrade. **Surfaces added or widened**: `code-reviewer`
gains `Bash(<runner>*)` test-runner grants (moved from `test-reviewer`, not new); `/design` is a new
user-invocable skill. **Narrowed**: `security-expert` loses `Bash`.

## 10. Risks

- Main-session context grows during review (seat reports land in it) — bounded by the cap and the
  REVIEW SUMMARY-first report format.
- Codex: re-trust hooks (`_agents.txt` hash changes) — named in the adoption prompt.
- A project addendum dispatching a retired agent silently fails — the upgrade notice.

## 11. Audit findings

_(filled by the architect-expert and security-expert seats)_

## 12. Open questions

None for the user: every removal is in the approved acceptance criteria. Decided here (one line
each): signal-gated experts in review (only way a11y/deps findings reach a diff); `log-subagent.sh`
QA parsing left inert (hash-pinned hook, status-audit sibling owns it); workflow-contract keeps 3
parsed fields + BLOCKERS; one branch, five ordered commits — (1) fan-out into review.md, coordinator
removed, test-reviewer merged; (2) the three undispatched agents and three contracts removed,
security `Bash` dropped; (3) `/design`; (4) upgrade test and notice; (5) slim the nine agents +
README, byte report.
