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
#
# The agent name lives under `.agent_type` in the real Claude Code
# SubagentStart/Stop payload (empirically captured, #388); the earlier
# `.agent_name`/`.subagent_name`/`.tool_name` probes matched nothing and the
# ledger recorded `agent:"unknown"` for every event. We prefer `.agent_type`
# and keep the historical keys as version-drift fallbacks.
HAVE_JQ=0
AGENT_ID=""
EFFORT=""
if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
  HAVE_JQ=1
  SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
  AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_type // .agent_name // .subagent_name // .tool_name // "unknown"' 2>/dev/null || echo "unknown")
  # Optional context (omit-if-absent): `agent_id` disambiguates two concurrent
  # agents of the same type in `/status-audit`; `effort.level` is cheap context.
  AGENT_ID=$(printf '%s' "$INPUT" | jq -r '.agent_id // ""' 2>/dev/null || echo "")
  EFFORT=$(printf '%s' "$INPUT" | jq -r '.effort.level // ""' 2>/dev/null || echo "")
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
  # The agent's final message — where the end-of-turn contract blocks live — is
  # carried under `.last_assistant_message` in the real SubagentStop payload
  # (#388). The earlier `.output`/`.result`/… probes matched nothing, so the
  # ledger captured zero contract fields. Prefer `.last_assistant_message`,
  # keep the historical keys as version-drift fallbacks, then fall back to the
  # raw payload. The first candidate that yields a non-empty string wins.
  OUTPUT=$(printf '%s' "$INPUT" | jq -r \
    '(.last_assistant_message // .output // .result // .response // .tool_response // .message // "") | if type=="string" then . else tojson end' \
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

  # The #378 contract blocks use canonical UPPERCASE field names
  # (`STATE:` / `DONE_CRITERIA_MET:` / `HANDOFF_TARGET:` / `REVIEW_VERDICT:` /
  # `QA_VERDICT:`). The earlier lowercase `state:`/`verdict:` greps never
  # matched a real contract block. We grep the canonical names
  # CASE-INSENSITIVELY (`-i`) for robustness, then strip the `FIELD:` prefix.
  # `field_value` lowercases the whole matched token before stripping the prefix
  # so the case-insensitive sed needs no per-letter alternation; the values
  # (state names, yes/no, verdicts, agent names) are themselves lowercase.
  field_value() {
    # $1 = segment text; $2 = canonical field name; $3 = value charclass/alt.
    printf '%s' "$1" |
      grep -ioE "$2:[[:space:]]*$3" |
      head -1 |
      tr '[:upper:]' '[:lower:]' |
      sed -E "s/^[a-z_]+:[[:space:]]*//" || true
  }

  # WORKFLOW STATUS fields — extracted only from the WORKFLOW STATUS segment.
  STATE=$(field_value "$WORKFLOW_SEG" "STATE" "[a-z_]+")
  DONE_MET=$(field_value "$WORKFLOW_SEG" "DONE_CRITERIA_MET" "(yes|no)")
  HANDOFF=$(field_value "$WORKFLOW_SEG" "HANDOFF_TARGET" "[A-Za-z0-9_-]+")

  # `REVIEW_VERDICT` and `QA_VERDICT` are DISTINCT canonical names. Extracting
  # each from its OWN block segment is belt-and-suspenders — even a stray match
  # of the other name in the wrong block can't cross-contaminate.
  REVIEW=$(field_value "$REVIEW_SEG" "REVIEW_VERDICT" "(pass|fail|needs_followup)")
  QA=$(field_value "$QA_SEG" "QA_VERDICT" "(pass|fail|blocked)")
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
    [ -n "$AGENT_ID" ] && { JQ_ARGS+=(--arg agent_id "$AGENT_ID"); JQ_FILTER+=' + {agent_id: $agent_id}'; }
    [ -n "$EFFORT" ] && { JQ_ARGS+=(--arg effort "$EFFORT"); JQ_FILTER+=' + {effort: $effort}'; }
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
