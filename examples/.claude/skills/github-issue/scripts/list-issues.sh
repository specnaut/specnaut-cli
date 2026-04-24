#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# List GitHub Issues with optional filters
# ------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

LIMIT=10
LABEL=""
ASSIGNEE=""
STATE="open"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)    LIMIT="$2"; shift 2 ;;
    --label)    LABEL="$2"; shift 2 ;;
    --assignee) ASSIGNEE="$2"; shift 2 ;;
    --state)    STATE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: list-issues.sh [--limit N] [--label L] [--assignee U] [--state open|closed|all]"
      exit 0
      ;;
    *) echo -e "${RED}Unknown option: $1${RESET}" >&2; exit 1 ;;
  esac
done

# --- Check gh auth ---
if ! gh auth status &>/dev/null; then
  echo -e "${RED}ERROR: gh is not authenticated. Run: gh auth login${RESET}" >&2
  exit 1
fi

# --- Build command ---
CMD=(gh issue list --state "$STATE" --limit "$LIMIT" --json number,title,labels,assignees,state,createdAt,url)

if [ -n "$LABEL" ]; then
  CMD+=(--label "$LABEL")
fi

if [ -n "$ASSIGNEE" ]; then
  CMD+=(--assignee "$ASSIGNEE")
fi

# --- Execute ---
echo -e "${BOLD}GitHub Issues (${STATE}, limit ${LIMIT})${RESET}"
echo ""

ISSUES=$("${CMD[@]}")

if [ "$(echo "$ISSUES" | jq 'length')" -eq 0 ]; then
  echo -e "${YELLOW}No issues found.${RESET}"
  exit 0
fi

echo "$ISSUES" | jq -r '.[] |
  "  #\(.number | tostring | if length < 4 then . + " " * (4 - length) else . end)  \(.state | if . == "OPEN" then "OPEN  " else "CLOSED" end)  \(.labels | map(.name) | join(", ") | if length == 0 then "-" elif length > 30 then .[:27] + "..." else . end)  \(.title | if length > 60 then .[:57] + "..." else . end)"'

echo ""
TOTAL=$(echo "$ISSUES" | jq 'length')
echo -e "${BLUE}Showing ${TOTAL} issue(s).${RESET}"
