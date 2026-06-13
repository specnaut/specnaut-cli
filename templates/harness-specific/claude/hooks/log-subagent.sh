#!/usr/bin/env bash
# Append a structured JSON line to .specflow/logs/agents.jsonl per
# subagent start/stop event so workflow audits can read who-dispatched-
# whom-when after the fact.
#
# Argument: "start" or "stop" (passed by the hook config in settings.json).
# Reads the Claude Code event payload from stdin.
set -euo pipefail

EVENT="${1:-unknown}"

ROOT="$(pwd)"
LOG_DIR="$ROOT/.specflow/logs"
LOG_FILE="$LOG_DIR/agents.jsonl"
mkdir -p "$LOG_DIR"

INPUT=$(cat || true)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Best-effort field extraction — the exact payload shape varies by
# Claude Code version; defaults to "unknown" when fields are absent.
HAVE_JQ=0
if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
  HAVE_JQ=1
  SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
  AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_name // .subagent_name // .tool_name // "unknown"' 2>/dev/null || echo "unknown")
else
  SESSION="unknown"
  AGENT="unknown"
fi

# Optional contract-field enrichment (#381). On a `stop` event the subagent's
# final message may carry the machine-readable contract blocks (WORKFLOW STATUS
# / REVIEW SUMMARY / QA SUMMARY) defined by mechanism A (#378). We parse those
# values out of the output text and append them as OPTIONAL JSONL keys beside
# the four base fields. Every extraction is guarded so a parse miss can never
# abort the hook — a missing field is simply omitted (never emitted empty).
STATE=""
DONE_MET=""
HANDOFF=""
REVIEW=""
QA=""
if [ "$HAVE_JQ" = "1" ] && [ "$EVENT" = "stop" ]; then
  # The key holding the agent's output text is Claude-Code-version-dependent;
  # probe the likely candidates and fall back to the raw payload. The first
  # candidate that yields a non-empty string wins.
  OUTPUT=$(printf '%s' "$INPUT" | jq -r \
    '(.output // .result // .response // .tool_response // .message // "") | if type=="string" then . else tojson end' \
    2>/dev/null || echo "")
  if [ -z "$OUTPUT" ]; then
    OUTPUT="$INPUT"
  fi

  # SEGMENT the output per contract block before extracting any field, so a
  # value is read only from inside its own block. A naive whole-output grep
  # would let the FIRST block's `verdict:` satisfy BOTH review_verdict and
  # qa_verdict when both blocks are present (cross-contamination). `awk`
  # captures the text from a header line up to (but excluding) the next
  # all-caps block header — the headers being WORKFLOW STATUS / REVIEW SUMMARY
  # / QA SUMMARY.
  segment() {
    # $1 = header to capture from. Emits the block body (header included) up to
    # the next recognised block header.
    printf '%s' "$OUTPUT" | awk -v hdr="$1" '
      $0 ~ ("^[[:space:]]*" hdr "[[:space:]]*$") { capture=1; print; next }
      capture && /^[[:space:]]*(WORKFLOW STATUS|REVIEW SUMMARY|QA SUMMARY)[[:space:]]*$/ { capture=0 }
      capture { print }
    '
  }

  WORKFLOW_SEG=$(segment "WORKFLOW STATUS")
  REVIEW_SEG=$(segment "REVIEW SUMMARY")
  QA_SEG=$(segment "QA SUMMARY")

  # WORKFLOW STATUS fields — extracted only from the WORKFLOW STATUS segment.
  STATE=$(printf '%s' "$WORKFLOW_SEG" | grep -oE 'state:[[:space:]]*[a-z_]+' | head -1 | sed -E 's/^state:[[:space:]]*//' || true)
  DONE_MET=$(printf '%s' "$WORKFLOW_SEG" | grep -oE 'done_criteria_met:[[:space:]]*(yes|no)' | head -1 | sed -E 's/^done_criteria_met:[[:space:]]*//' || true)
  HANDOFF=$(printf '%s' "$WORKFLOW_SEG" | grep -oE 'handoff_target:[[:space:]]*[A-Za-z0-9_-]+' | head -1 | sed -E 's/^handoff_target:[[:space:]]*//' || true)

  # `verdict:` appears under both REVIEW SUMMARY and QA SUMMARY; extracting it
  # from each block's OWN segment is what keeps the two verdicts distinct even
  # when both blocks (and overlapping value sets like pass/fail) are present.
  REVIEW=$(printf '%s' "$REVIEW_SEG" | grep -oE 'verdict:[[:space:]]*(pass|fail|needs_followup)' | head -1 | sed -E 's/^verdict:[[:space:]]*//' || true)
  QA=$(printf '%s' "$QA_SEG" | grep -oE 'verdict:[[:space:]]*(pass|fail|blocked)' | head -1 | sed -E 's/^verdict:[[:space:]]*//' || true)
fi

# Compose the line with jq so every field is quoted/escaped correctly and a
# hostile session_id/agent_name (e.g. one containing `"` or `:`) can never
# break the JSON or inject a key. Optional contract keys are merged in only
# when their shell var is non-empty (omit-if-absent), via the args list.
if [ "$HAVE_JQ" = "1" ]; then
  JQ_ARGS=(--arg ts "$TS" --arg event "$EVENT" --arg session "$SESSION" --arg agent "$AGENT")
  # The `$ts`/`$state`/… tokens below are jq variables (bound via --arg), NOT
  # shell variables — single quotes are deliberate so the shell leaves them for
  # jq to resolve.
  # shellcheck disable=SC2016
  {
    JQ_FILTER='{ts: $ts, event: $event, session: $session, agent: $agent}'
    [ -n "$STATE" ] && { JQ_ARGS+=(--arg state "$STATE"); JQ_FILTER+=' + {state: $state}'; }
    [ -n "$DONE_MET" ] && { JQ_ARGS+=(--arg done_criteria_met "$DONE_MET"); JQ_FILTER+=' + {done_criteria_met: $done_criteria_met}'; }
    [ -n "$HANDOFF" ] && { JQ_ARGS+=(--arg handoff_target "$HANDOFF"); JQ_FILTER+=' + {handoff_target: $handoff_target}'; }
    [ -n "$REVIEW" ] && { JQ_ARGS+=(--arg review_verdict "$REVIEW"); JQ_FILTER+=' + {review_verdict: $review_verdict}'; }
    [ -n "$QA" ] && { JQ_ARGS+=(--arg qa_verdict "$QA"); JQ_FILTER+=' + {qa_verdict: $qa_verdict}'; }
  }
  jq -nc "${JQ_ARGS[@]}" "$JQ_FILTER" >> "$LOG_FILE"
else
  # No-jq fallback: emit only the four base fields. SESSION/AGENT are "unknown"
  # in this path (contract parsing requires jq), so no untrusted interpolation
  # reaches this printf.
  printf '{"ts":"%s","event":"%s","session":"%s","agent":"%s"}\n' \
    "$TS" "$EVENT" "$SESSION" "$AGENT" >> "$LOG_FILE"
fi

exit 0
