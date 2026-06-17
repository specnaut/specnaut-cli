# Feature Specification: Fix log-subagent hook to capture from the real Claude Code payload

**Feature Branch**: `017-hook-payload-fix` **Created**: 2026-06-13 **Status**: Draft **Input**: User
description: "Bug #388 (P1). The log-subagent hook captures no agent name and no contract fields
from the REAL Claude Code SubagentStop payload — a monorepo#12 dogfood showed 219/219 ledger entries
came out agent:'unknown' with zero state/verdict fields despite agents emitting the blocks. The hook
probes the wrong payload keys (and greps the wrong field-name case), so mechanism C (/status-audit)
is inert in practice. Fix the extraction against the actual payload schema and add a test fixture
using the REAL shape."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The ledger actually records who ran and what they concluded (Priority: P1)

When a subagent finishes, the `log-subagent` hook records its real agent identity and — when the
agent emitted contract blocks — its state and verdict, into `.specflow/logs/agents.jsonl`. A
`/status-audit` over that ledger then reports real agent names and verdicts instead of a wall of
`unknown`.

**Why this priority**: This is the bug. Until the hook reads the real payload keys, mechanism C (the
entire status-supervision feature, #381) produces no usable signal — it parses the ledger fine but
every entry is `unknown` with no verdict.

**Independent Test**: Feed the hook a payload shaped exactly like the real Claude Code
`SubagentStop` event (an `agent_type` + a `last_assistant_message` containing a `REVIEW SUMMARY`
block); assert the appended JSONL line carries the real `agent` (from `agent_type`) and the parsed
`review_verdict`.

**Acceptance Scenarios**:

1. **Given** a `SubagentStop` payload with `agent_type: "security-auditor"`, **When** the hook runs,
   **Then** the JSONL line has `agent: "security-auditor"` (not `unknown`).
2. **Given** that payload's `last_assistant_message` contains a `REVIEW SUMMARY` block with
   `REVIEW_VERDICT: fail`, **When** the hook runs, **Then** the line carries
   `review_verdict: "fail"`.
3. **Given** a payload with `agent_id`, **When** the hook runs, **Then** the line carries `agent_id`
   so two concurrent same-type agents are distinguishable in `/status-audit`.

---

### User Story 2 - Robust across payload-shape and field-case variation (Priority: P2)

Extraction degrades gracefully: it prefers the real keys but keeps fallbacks for other Claude Code
versions, matches the canonical UPPERCASE contract field names case-insensitively (agents' emitted
casing varies), and still produces a valid backward-compatible line when a field or the whole block
is absent.

**Why this priority**: The original bug was brittleness against the real shape; the fix must not
re-introduce brittleness against a slightly different shape or against case-varying LLM output.

**Acceptance Scenarios**:

1. **Given** a payload using a legacy output key (`.output`) instead of `last_assistant_message`,
   **When** the hook runs, **Then** it still extracts the block (fallback chain).
2. **Given** a block emitted with lowercase field names, **When** the hook parses, **Then** it still
   captures the values (case-insensitive match of the canonical names).
3. **Given** a `start` event or a payload with no block, **When** the hook runs, **Then** it appends
   a valid base line (no empty contract keys) and exits 0.

---

### Edge Cases

- **`last_assistant_message` absent** (older CC) → fall back to `.output`/`.result`/…/the agent
  transcript path is NOT required; if none yield text, emit the base line.
- **`agent_type` absent** → fall back to `.agent_name`/`.subagent_name`/`.tool_name`/`unknown`.
- **Field emitted as `REVIEW_VERDICT` vs `review_verdict` vs mixed case** → matched
  case-insensitively.
- **jq absent** → base line only, exit 0 (unchanged).
- **Hostile `agent_type`/`session_id`** (quotes/colons) → still JSON-safe (jq -n composition,
  unchanged).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The hook MUST derive the agent name from `agent_type` first, then fall back to
  `agent_name` / `subagent_name` / `tool_name` / `unknown`.
- **FR-002**: The hook MUST derive the agent output for contract parsing from
  `last_assistant_message` first, then fall back to `output` / `result` / `response` /
  `tool_response` / `message`, then the raw payload.
- **FR-003**: The hook MUST record an optional `agent_id` field (from the payload's `agent_id`) so
  concurrent same-type agents are distinguishable; omit-if-absent.
- **FR-004**: The hook SHOULD record an optional `effort` field (from `effort.level`) when present;
  omit-if-absent. (Cheap, useful context; not required for the core fix.)
- **FR-005**: Contract-field extraction MUST match the canonical UPPERCASE block field names —
  `STATE`, `DONE_CRITERIA_MET`, `HANDOFF_TARGET`, `REVIEW_VERDICT`, `QA_VERDICT` —
  case-insensitively (emitted casing varies). `REVIEW_VERDICT`/`QA_VERDICT` are distinct names,
  parsed from their own block segments.
- **FR-006**: All prior invariants hold: JSON-safe `jq -n` composition; per-block segmentation;
  omit-if-absent optional keys; backward-compatible base line; `set -euo pipefail`; ALWAYS exit 0;
  jq-absent fallback emits the base line.
- **FR-007**: The hook's enrichment test MUST use a fixture shaped like the REAL `SubagentStop`
  payload (`agent_type` + `last_assistant_message` with UPPERCASE block fields), plus a legacy-key
  fallback case and a case-insensitivity case.
- **FR-008**: The ledger schema doc (`.specflow/logs/README.md`) MUST document the new
  `agent_id`/`effort` fields and that `agent` comes from `agent_type` and the block source is
  `last_assistant_message`.
- **FR-009**: The change ships through the bundle (`init`/`upgrade`); the hook is the existing
  harness-specific claude entry (edit in place).

### Key Entities _(see Domain Model below)_

- **Hook payload**: the real Claude Code SubagentStart/Stop event object (keys documented in
  research.md).
- **Ledger entry**: gains correct `agent` + optional `agent_id`/`effort` + the contract fields now
  actually captured.

## Domain Model _(mandatory)_

**Bounded context:** Status Supervision data-capture (the hook side of mechanism C). Owns the
mapping from the real Claude Code hook payload → the JSONL ledger entry.

**Vocabulary (Ubiquitous language):**

- **Hook payload** — the JSON object Claude Code pipes to the hook on stdin per subagent event.
- **`agent_type`** — the real payload key holding the dispatched agent's name.
- **`last_assistant_message`** — the real `SubagentStop` key holding the agent's final message text
  (where contract blocks live).
- **`agent_id`** — unique per dispatch; disambiguates concurrent same-type agents.

**Entities (have identity):**

- **Ledger entry** — identified by `(session, agent_id|agent, ts, event)`; append-only. This fixes
  which payload keys populate `agent` and adds `agent_id`.

**Value objects (no identity, immutable):**

- **PayloadKeys(agentName=agent_type→fallbacks, output=last_assistant_message→fallbacks, agent_id,
  effort.level)** — the corrected extraction map.

**Invariants (rules the domain must never break):**

- `agent` is `agent_type` when present (never `unknown` for a real dispatch carrying `agent_type`).
- Contract fields are matched against the canonical UPPERCASE names, case-insensitively, each from
  its own block segment.
- All prior hook invariants hold (JSON-safe, omit-if-absent, exit 0, backward-compatible, jq-absent
  fallback).

**Out of scope (other bounded contexts touched but not owned here):**

- `/status-audit` reporting logic (#381) — unchanged; it benefits automatically from richer entries.
- The contract block formats (#378) — unchanged; this matches them.
- Reading the subagent transcript file (`agent_transcript_path`) — not needed;
  `last_assistant_message` carries the final block. (Possible future enhancement if a block ever
  lands in a non-final message.)
- Cloud/Mobile.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A real-shaped `SubagentStop` fixture (`agent_type: "security-auditor"`,
  `last_assistant_message` with `REVIEW_VERDICT: fail`) yields a JSONL line with
  `agent: "security-auditor"` and `review_verdict: "fail"` — verified by the enrichment test.
- **SC-002**: `agent_id` is captured when present; two concurrent same-type dispatches produce
  distinguishable entries.
- **SC-003**: Legacy-key and case-insensitivity fallbacks both extract correctly (test-verified);
  start/no-block/jq-absent all emit a valid base line and exit 0.
- **SC-004**: The schema doc documents the corrected key mapping + new fields.
- **SC-005**: `deno task test` green; a fresh `init`/`upgrade` ships the fixed hook.

## Assumptions

- The real Claude Code hook payload schema is as captured empirically (research.md): SubagentStop
  carries `session_id`, `transcript_path`, `cwd`, `agent_id`, `agent_type`, `effort.level`,
  `hook_event_name`, `agent_transcript_path`, `last_assistant_message`. SubagentStart carries the
  same minus the stop-only fields. Fallback chains guard against version drift.
- `last_assistant_message` contains the agent's final message, where end-of-turn contract blocks are
  emitted; sufficient without reading the transcript file.
- The hook remains the bundled harness-specific claude entry; this is an edit-in-place + test +
  schema-doc update.
