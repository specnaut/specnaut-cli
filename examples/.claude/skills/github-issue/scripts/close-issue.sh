#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Close or delete a GitHub Issue
# ------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

ISSUE_NUM=""
REASON="completed"
DELETE=false

usage() {
  echo "Usage: close-issue.sh <number> [--reason completed|\"not planned\"] [--delete]"
}

# Parse args
if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

ISSUE_NUM="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="$2"; shift 2 ;;
    --delete) DELETE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo -e "${RED}Unknown option: $1${RESET}" >&2; usage; exit 1 ;;
  esac
done

# --- Check gh auth ---
if ! gh auth status &>/dev/null; then
  echo -e "${RED}ERROR: gh is not authenticated. Run: gh auth login${RESET}" >&2
  exit 1
fi

# --- Verify issue exists ---
ISSUE_INFO=$(gh issue view "$ISSUE_NUM" --json number,title,state 2>/dev/null || true)

if [ -z "$ISSUE_INFO" ]; then
  echo -e "${RED}ERROR: Issue #${ISSUE_NUM} not found.${RESET}" >&2
  exit 1
fi

ISSUE_TITLE=$(echo "$ISSUE_INFO" | jq -r '.title')
ISSUE_STATE=$(echo "$ISSUE_INFO" | jq -r '.state')

echo -e "${BOLD}Issue #${ISSUE_NUM}:${RESET} ${ISSUE_TITLE}"
echo -e "Current state: ${ISSUE_STATE}"
echo ""

# --- Delete ---
if [ "$DELETE" = true ]; then
  echo -e "${YELLOW}Deleting issue #${ISSUE_NUM}...${RESET}"
  read -r -p "Are you sure? This cannot be undone. (y/N) " CONFIRM
  CONFIRM=${CONFIRM:-N}
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi

  gh issue delete "$ISSUE_NUM" --yes
  echo -e "${GREEN}Issue #${ISSUE_NUM} deleted.${RESET}"
  exit 0
fi

# --- Close ---
if [ "$ISSUE_STATE" = "CLOSED" ]; then
  echo -e "${YELLOW}Issue #${ISSUE_NUM} is already closed.${RESET}"
  exit 0
fi

echo -e "${BLUE}Closing issue #${ISSUE_NUM} (reason: ${REASON})...${RESET}"

CLOSE_ARGS=(gh issue close "$ISSUE_NUM")
if [ "$REASON" = "not planned" ]; then
  CLOSE_ARGS+=(--reason "not planned")
fi

"${CLOSE_ARGS[@]}"

echo ""
echo -e "${GREEN}Issue #${ISSUE_NUM} closed.${RESET}"
