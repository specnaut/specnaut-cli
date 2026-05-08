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
if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
  SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
  AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_name // .subagent_name // .tool_name // "unknown"' 2>/dev/null || echo "unknown")
else
  SESSION="unknown"
  AGENT="unknown"
fi

printf '{"ts":"%s","event":"%s","session":"%s","agent":"%s"}\n' \
  "$TS" "$EVENT" "$SESSION" "$AGENT" >> "$LOG_FILE"

exit 0
