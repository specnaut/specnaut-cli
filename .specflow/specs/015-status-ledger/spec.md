# Feature Specification: Structured status ledger + `/status-audit` + `/loop` supervision

**Feature Branch**: `015-status-ledger` **Created**: 2026-06-13 **Status**: Draft **Input**: User
description: "Mechanism C of the miximodel audit-team port (epic mkrlabs/specflow-monorepo#12).
Enrich the log-subagent hook to capture the machine-readable contract-block fields (from #378) into
.specnaut/logs/agents.jsonl, add a /status-audit skill that reads the ledger and reports session
health (blocked / stale / done-but-criteria-unmet / missing-handoffs / verdict summary), document
the ledger schema, and document the /loop 5m /status-audit supervision pattern for long-running
headless work."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See the health of a long-running headless session (Priority: P1)

A maintainer kicks off long autonomous work (e.g. a `/code-audit` over a large scope, or a
multi-issue loop). They run `/status-audit` and get a concise health read: how many agents are in
each state, which are blocked, which finished, and the review/QA verdicts so far — without scrolling
the transcript.

**Why this priority**: The whole point of mechanism C is a health-check layer over the ledger; this
is the primary capability.

**Independent Test**: Against a ledger with a mix of agent entries, run `/status-audit`; confirm it
reports per-state counts, per-agent state/verdict/last-update, and a verdict summary.

**Acceptance Scenarios**:

1. **Given** a ledger with agents in `in_progress`, `blocked`, and `done`, **When** `/status-audit`
   runs, **Then** it reports the count per state and lists each agent's latest state + timestamp.
2. **Given** an agent whose latest entry has `STATE: done` but `DONE_CRITERIA_MET: no`, **When**
   `/status-audit` runs, **Then** it flags that contradiction explicitly.
3. **Given** an agent with `HANDOFF_TARGET: review-coordinator` but no later entry for a
   review-coordinator in the session, **When** `/status-audit` runs, **Then** it flags the missing
   handoff.

---

### User Story 2 - The ledger captures verdicts, not just dispatch events (Priority: P1)

When a contract-emitting agent (auditor / reviewer / qa / developer, per #378) finishes, the
`log-subagent` hook records — in addition to the existing `{ts, event, session, agent}` — the
machine-readable fields the agent emitted: `STATE`, `DONE_CRITERIA_MET`, `HANDOFF_TARGET`,
`REVIEW_VERDICT`, `QA_VERDICT` (whichever are present). Agents that don't emit a block still log the
original fields — the new fields are optional and absent-by-default.

**Why this priority**: Without the verdicts in the ledger, `/status-audit` has nothing to report
beyond who-ran-when. This is the data foundation for US1.

**Independent Test**: Feed the hook a stop-event payload whose agent output contains a
`WORKFLOW STATUS`

- `REVIEW SUMMARY` block; assert the appended JSONL line carries the parsed
  `state`/`done_criteria_met`/ `handoff_target`/`review_verdict` fields. Feed a payload with no
  block; assert the line is the original four-field shape (no empty/garbage fields).

**Acceptance Scenarios**:

1. **Given** a stop-event payload whose agent output contains `STATE: blocked` and
   `HANDOFF_TARGET: developer`, **When** the hook runs, **Then** the JSONL line includes
   `state: "blocked"` and `handoff_target: "developer"`.
2. **Given** a payload with no contract block, **When** the hook runs, **Then** the line is the
   backward-compatible `{ts, event, session, agent}` shape with no contract fields.
3. **Given** `jq` is unavailable, **When** the hook runs, **Then** it still appends a valid line
   (degrades to `unknown`/original fields) and exits 0 — never breaks the dispatch.

---

### User Story 3 - Supervise long work with a periodic health ping (Priority: P2)

A maintainer running long headless work sets `/loop 5m /status-audit` to get a health summary every
5 minutes, surfacing blocked or stale agents as they arise. The `/status-audit` skill documents this
pattern.

**Why this priority**: Operationalizes US1 for unattended runs; trails the core read + data capture.

**Acceptance Scenarios**:

1. **Given** the `/status-audit` SKILL.md, **When** read, **Then** it documents
   `/loop 5m /status-audit` as the supervision pattern for long-running headless work.
2. **Given** an agent with no ledger entry for ≥15 minutes while non-terminal, **When**
   `/status-audit` runs, **Then** it flags the agent as stale.

---

### Edge Cases

- **No ledger file** (`.specnaut/logs/agents.jsonl` absent) → `/status-audit` reports "no ledger
  yet" rather than erroring.
- **Malformed JSONL line** → skipped with a note; the audit still processes the valid lines.
- **Agent emitted a block the hook couldn't locate in the payload** → the line simply omits those
  fields (graceful degradation); `/status-audit` treats absent fields as "unknown", never as a
  failure.
- **`jq` absent on the host** → hook still logs the backward-compatible line and exits 0.
- **Multiple entries for one agent** → `/status-audit` uses the latest by timestamp for current
  state.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The `log-subagent` hook MUST, when the event payload carries agent output containing
  contract blocks, extract and record these optional fields alongside the existing
  `{ts, event, session, agent}`: `state`, `done_criteria_met`, `handoff_target` (from
  `workflow-contract`), `review_verdict` (from `review-findings-contract`), `qa_verdict` (from
  `qa-report-contract`).
- **FR-002**: The hook MUST remain backward-compatible: when no block is present (or the payload
  lacks the agent output), it appends the original four-field line with no contract fields — never
  empty strings or garbage. New fields are omit-if-absent.
- **FR-003**: The hook MUST never break the dispatch: missing `jq`, absent payload, or unparseable
  output all degrade gracefully and exit 0.
- **FR-004**: A `/status-audit` skill MUST read `.specnaut/logs/agents.jsonl` and report: overall
  health (counts by state); per-agent latest state, verdict, and last-update timestamp; blocked
  agents; stale agents (no entry for ≥15 minutes while non-terminal); the
  `done`-with-`DONE_CRITERIA_MET: no` contradiction; missing handoffs (`handoff_target` ≠ none with
  no later session entry for that target); and a review/QA verdict summary across the session.
- **FR-005**: `/status-audit` MUST handle an absent ledger ("no ledger yet"), skip malformed lines
  with a note, and treat absent contract fields as "unknown" — never error on degraded data.
- **FR-006**: `/status-audit` MUST be read-only (reads the ledger, writes nothing).
- **FR-007**: The `/status-audit` SKILL.md MUST document the `/loop 5m /status-audit` supervision
  pattern for long-running headless work.
- **FR-008**: The enriched ledger schema MUST be documented (field names, types, omit-if-absent
  behaviour) in `.specnaut/logs/README.md` (or an equivalent bundled doc).
- **FR-009**: The hook change, the `/status-audit` skill, and the schema doc MUST ship through the
  bundle (`init`/`upgrade`) per the existing conventions (hook = harness-specific claude entry;
  skill = `templates/core/skills/`).

### Key Entities _(see Domain Model section below for full structure)_

- **Ledger entry**: one JSONL line — the original four fields plus optional contract fields.
- **Session health**: the derived view `/status-audit` computes over the entries.

## Domain Model _(mandatory)_

**Bounded context:** Status Supervision — the read/observe layer over the subagent ledger. Consumes
the mechanism-A contract blocks (recorded by the hook); produces a health report. Mutates nothing.

**Vocabulary (Ubiquitous language):**

- **Ledger** — `.specnaut/logs/agents.jsonl`, append-only, one JSON object per subagent start/stop
  event.
- **Ledger entry** — one line: `{ts, event, session, agent}` + optional
  `{state, done_criteria_met,
  handoff_target, review_verdict, qa_verdict}`.
- **Latest entry** — for an agent, the entry with the greatest `ts`; defines current state.
- **Stale** — a non-terminal agent with no entry for ≥15 minutes.
- **Contradiction** — `state == done` with `done_criteria_met == no`.
- **Missing handoff** — `handoff_target ≠ none` with no later entry for that target in the session.

**Entities (have identity):**

- **Ledger entry** — identified by `(session, agent, ts, event)`. Append-only; never mutated.

**Value objects (no identity, immutable):**

- **ContractFields(state?, done_criteria_met?, handoff_target?, review_verdict?, qa_verdict?)** —
  all optional; omitted when not emitted/parseable.
- **SessionHealth(stateCounts, perAgentLatest, blocked, stale, contradictions, missingHandoffs,
  verdictSummary)** — derived, read-only.

**Invariants (rules the domain must never break):**

- The ledger is append-only and the hook never blocks/fails a dispatch (always exit 0).
- New contract fields are optional and omit-if-absent — old four-field lines remain valid.
- `/status-audit` is read-only and degrades gracefully (absent ledger / malformed line / absent
  fields).
- Current state for an agent is its latest entry by `ts`.

**Out of scope (other bounded contexts touched but not owned here):**

- **The contracts themselves** (#378, merged) — this reads what they emit.
- **A UI / dashboard** — text output only.
- **Alerting / channel integrations** — Claude Code channel plugins, not Specflow.
- **FinOps cost-projection seat** — Cloud-specific.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Feeding the hook a payload with a `WORKFLOW STATUS`+`REVIEW SUMMARY` block yields a
  JSONL line carrying the parsed `state`/`done_criteria_met`/`handoff_target`/`review_verdict`;
  feeding one with no block yields the original four-field line — verifiable by a hermetic hook
  test.
- **SC-002**: The hook exits 0 and appends a valid line in all degraded cases (no jq, no payload, no
  block) — never breaks a dispatch.
- **SC-003**: `/status-audit` reports all seven required views (health counts, per-agent latest,
  blocked, stale, contradictions, missing handoffs, verdict summary) and handles an absent/dirty
  ledger without erroring.
- **SC-004**: The ledger schema doc and the `/loop 5m /status-audit` supervision pattern are present
  and accurate.
- **SC-005**: A fresh `specflow init` / `upgrade` delivers the enriched hook, the `/status-audit`
  skill, and the schema doc.

## Assumptions

- The mechanism-A contracts (#378, merged) define the block field names this hook parses and this
  skill reports.
- The stop-event payload exposes the agent's final output text under some field the hook can read;
  if a given Claude Code version does not, the hook degrades to the original four-field line
  (FR-002/FR-003) — the feature never depends on a specific payload shape being present.
- `/status-audit` is a Claude-Code orchestrator skill: it reads the JSONL and computes the health
  view by reasoning over entries (no new runtime dependency); determinism of the _data_ lives in the
  hook (which is unit-tested), the _report_ is the skill's job.
- The hook is bundled as the existing harness-specific claude entry; the skill + schema doc follow
  the established bundle/manifest conventions; the schema doc is a markdown file delivered under
  `.specnaut/logs/`.
