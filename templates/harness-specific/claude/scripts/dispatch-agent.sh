#!/usr/bin/env bash
# Dispatch a Claude Code subagent in headless mode.
#
# Reads the agent's `tools:` frontmatter from .claude/agents/<name>.md and
# passes it through to `claude -p --allowedTools`. The user prompt is
# wrapped with a directive that loads the agent's full definition (so the
# headless session adopts the agent's persona + system prompt).
#
# Useful for CI gates, pre-commit hooks, cron jobs, and any non-interactive
# context where you want a specific agent to act without opening a terminal.
#
# Usage:
#   .claude/scripts/dispatch-agent.sh <agent-name> "<prompt>"
#
# Environment variables:
#   MODEL          Override the model (e.g. "claude-sonnet-4-6").
#                  Defaults to whatever the agent or claude binary picks.
#   OUTPUT_FORMAT  json | text | stream-json. Defaults to text.
#
# Examples:
#   .claude/scripts/dispatch-agent.sh code-reviewer "Review the diff in /tmp/pr.diff"
#   .claude/scripts/dispatch-agent.sh product-owner "Open a backlog item titled X"
#   OUTPUT_FORMAT=json .claude/scripts/dispatch-agent.sh qa-tester "Run the suite"
set -euo pipefail

if [ "$#" -lt 2 ]; then
  cat >&2 <<USAGE
usage: dispatch-agent.sh <agent-name> "<prompt>"

Dispatches a bundled Claude Code subagent in headless mode (\`claude -p\`)
with the right tool allowlist, derived from the agent's frontmatter.

Examples:
  dispatch-agent.sh code-reviewer "Review /tmp/pr.diff"
  dispatch-agent.sh product-owner "Open a backlog item titled Foo"
USAGE
  exit 2
fi

AGENT="$1"
USER_PROMPT="$2"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_FILE="$ROOT/agents/$AGENT.md"

if [ ! -f "$AGENT_FILE" ]; then
  echo "error: agent file not found at $AGENT_FILE" >&2
  echo "       run from the project root, or check the agent name." >&2
  exit 1
fi

# Extract the `tools:` line from the agent's frontmatter (between the first
# two `---` delimiters). The raw value can include commas inside parens, e.g.
# `Read, Bash(git log *), Agent(code-reviewer, security-auditor)` — naive
# comma-splitting would break those compound entries. We do a depth-aware
# split, trim each token, and rejoin with commas (no spaces) so the value
# is unambiguous to claude's --allowedTools parser regardless of how it
# tokenises the flag value.
RAW_TOOLS=$(awk '/^---$/{n++; next} n==1 && /^tools:/ {sub(/^tools:[[:space:]]*/, ""); print; exit}' "$AGENT_FILE")

split_tools() {
  local input="$1"
  local depth=0
  local current=""
  local out=""
  local len=${#input}
  local i=0
  local c
  while [ $i -lt $len ]; do
    c="${input:$i:1}"
    case "$c" in
      "(") depth=$((depth + 1)); current="$current$c" ;;
      ")") depth=$((depth - 1)); current="$current$c" ;;
      ",")
        if [ $depth -eq 0 ]; then
          # Trim leading/trailing whitespace from current token.
          current="${current#"${current%%[![:space:]]*}"}"
          current="${current%"${current##*[![:space:]]}"}"
          if [ -n "$current" ]; then
            if [ -z "$out" ]; then out="$current"; else out="$out,$current"; fi
          fi
          current=""
        else
          current="$current$c"
        fi
        ;;
      *) current="$current$c" ;;
    esac
    i=$((i + 1))
  done
  current="${current#"${current%%[![:space:]]*}"}"
  current="${current%"${current##*[![:space:]]}"}"
  if [ -n "$current" ]; then
    if [ -z "$out" ]; then out="$current"; else out="$out,$current"; fi
  fi
  echo "$out"
}

TOOLS=""
if [ -n "$RAW_TOOLS" ]; then
  TOOLS=$(split_tools "$RAW_TOOLS")
fi

WRAPPED_PROMPT="You are the \`$AGENT\` subagent for this project. Read your full definition at \`.claude/agents/$AGENT.md\` (frontmatter + body) before doing anything. Then perform the task below.

---

$USER_PROMPT"

ARGS=("-p" "$WRAPPED_PROMPT")

if [ -n "$TOOLS" ]; then
  ARGS+=("--allowedTools" "$TOOLS")
fi

if [ -n "${MODEL:-}" ]; then
  ARGS+=("--model" "$MODEL")
fi

if [ -n "${OUTPUT_FORMAT:-}" ]; then
  ARGS+=("--output-format" "$OUTPUT_FORMAT")
fi

exec claude "${ARGS[@]}"
