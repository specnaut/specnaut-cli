# Research — status ledger + `/status-audit`

## Decision 1 — Hook enrichment: parse contract fields from the stop-event payload

**Decision**: Extend `log-subagent.sh`. After the existing `session`/`agent` extraction, when `jq` is
available and the payload carries the agent's output text, grep that text for the contract block fields
and emit them as OPTIONAL JSONL keys: `state`, `done_criteria_met`, `handoff_target` (from `WORKFLOW
STATUS`), `review_verdict` (from `REVIEW SUMMARY`), `qa_verdict` (from `QA SUMMARY`). Build the JSON
line by composing a base object and conditionally adding present keys (e.g. via `jq -n` arg assembly or
careful string building) so absent fields are omitted, not emitted empty. The agent-output field in the
payload is version-dependent — probe likely keys (`.output`, `.result`, `.response`, `.tool_response`,
`.message`, the raw `$INPUT` as a last resort) and extract from whichever is non-empty; if none, emit
the original four-field line.

**Rationale**: Mirrors the hook's existing best-effort philosophy ("payload shape varies by Claude Code
version; defaults to unknown"). Grepping the block fields out of the output text is robust to the exact
payload nesting. Composing the JSON with only-present keys keeps backward compatibility (FR-002) and
avoids garbage fields.

**Alternatives considered**: require a specific payload field — rejected: brittle across CC versions and
violates the never-break-dispatch rule. A separate parser invoked by the hook — rejected: over-engineered;
the extraction is a few `grep -oE` lines.

**Implementation note**: keep `set -euo pipefail` but guard every extraction with `|| true` / `// ""`
so a parse miss never aborts; always `exit 0`.

## Decision 2 — `/status-audit` as a read+reason skill (no new runtime)

**Decision**: `/status-audit` is a markdown orchestrator skill. Its body instructs the lead to read
`.specflow/logs/agents.jsonl`, group entries by agent (latest by `ts` = current state), and report the
seven views (state counts; per-agent latest state/verdict/last-update; blocked; stale ≥15m;
`done`+`done_criteria_met:no` contradiction; missing handoffs; review/QA verdict summary). Absent ledger
→ "no ledger yet"; malformed line → skip with note; absent fields → "unknown".

**Rationale**: Specflow projects are runtime-agnostic; shipping a Deno/Node parser would add a
dependency the scaffolded project may not have. The data determinism lives in the hook (unit-tested);
the report is a reasoning task well-suited to the lead. Matches the AC's "skill that reads and reports".

**Alternatives considered**: ship an `audit_workflow.mjs`-style parser (as miximodel did) — rejected for
the CLI: runtime-dependency + cross-project portability cost outweighs determinism for a read-only
human-facing report. (Mechanism-A's hook captures the structured data; the report needn't be a program.)

## Decision 3 — Schema doc + distribution

**Decision**: Author `.specflow/logs/README.md` (ledger schema: field names, types, omit-if-absent) and
register it in the manifest alongside the existing `.specflow/`-destined entries. `/status-audit` is
markdown-only → mirror to `plugin/`. The hook already has a manifest entry (edit-in-place, no new
registration).

**Rationale**: FR-008 wants the schema documented where the ledger lives; the manifest already ships
`.specflow/`-target files, so follow that shape.

## Open implementation detail (for the developer, not a blocker)

The exact payload key holding agent output is CC-version-dependent — the developer probes the candidate
keys (Decision 1) and falls back to the four-field line. The hermetic test feeds a synthetic payload
shaped like the real stop event (a JSON object with the output under the probed key) to lock the parse.
