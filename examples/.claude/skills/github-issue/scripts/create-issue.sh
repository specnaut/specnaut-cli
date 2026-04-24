#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Create a GitHub Issue with structured body for Copilot consumption
# ------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

TITLE=""
BODY=""
LABELS=()
ASSIGNEE=""
MILESTONE=""
PROJECT=""
DRY_RUN=false

usage() {
  echo "Usage: create-issue.sh --title <title> --body <body> [options]"
  echo ""
  echo "Options:"
  echo "  --title <title>       Issue title (required)"
  echo "  --body <body>         Issue body in markdown (required)"
  echo "  --label <label>       Add a label (repeatable)"
  echo "  --assignee <user>     Assign to a user"
  echo "  --milestone <name>    Set milestone"
  echo "  --project <name>      Add to project"
  echo "  --dry-run             Print without creating"
  echo "  -h, --help            Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)    TITLE="$2"; shift 2 ;;
    --body)     BODY="$2"; shift 2 ;;
    --label)    LABELS+=("$2"); shift 2 ;;
    --assignee) ASSIGNEE="$2"; shift 2 ;;
    --milestone) MILESTONE="$2"; shift 2 ;;
    --project)  PROJECT="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    *)          echo -e "${RED}Unknown option: $1${RESET}" >&2; usage; exit 1 ;;
  esac
done

# --- Validation ---
if [ -z "$TITLE" ]; then
  echo -e "${RED}ERROR: --title is required${RESET}" >&2
  exit 1
fi

if [ -z "$BODY" ]; then
  echo -e "${RED}ERROR: --body is required${RESET}" >&2
  exit 1
fi

# --- Check gh auth ---
if ! gh auth status &>/dev/null; then
  echo -e "${RED}ERROR: gh is not authenticated. Run: gh auth login${RESET}" >&2
  exit 1
fi

# --- Check for potential duplicates ---
echo -e "${BLUE}Checking for duplicate issues...${RESET}"
SEARCH_QUERY=$(echo "$TITLE" | head -c 80)
DUPLICATES=$(gh issue list --state open --search "$SEARCH_QUERY" --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null || true)

if [ -n "$DUPLICATES" ]; then
  echo -e "${YELLOW}Potential duplicates found:${RESET}"
  echo "$DUPLICATES"
  echo ""
  read -r -p "Create anyway? (y/N) " CONFIRM
  CONFIRM=${CONFIRM:-N}
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# --- Build command ---
CMD=(gh issue create --title "$TITLE" --body "$BODY")

for label in "${LABELS[@]}"; do
  CMD+=(--label "$label")
done

if [ -n "$ASSIGNEE" ]; then
  CMD+=(--assignee "$ASSIGNEE")
fi

if [ -n "$MILESTONE" ]; then
  CMD+=(--milestone "$MILESTONE")
fi

if [ -n "$PROJECT" ]; then
  CMD+=(--project "$PROJECT")
fi

# --- Dry run ---
if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${BOLD}DRY RUN — Issue preview:${RESET}"
  echo -e "${BOLD}Title:${RESET} $TITLE"
  echo -e "${BOLD}Labels:${RESET} ${LABELS[*]:-none}"
  echo -e "${BOLD}Assignee:${RESET} ${ASSIGNEE:-none}"
  echo -e "${BOLD}Milestone:${RESET} ${MILESTONE:-none}"
  echo ""
  echo -e "${BOLD}Body:${RESET}"
  echo "$BODY"
  echo ""
  echo -e "${YELLOW}No issue created (dry run).${RESET}"
  exit 0
fi

# --- Create issue ---
echo ""
echo -e "${BLUE}Creating issue...${RESET}"

ISSUE_URL=$("${CMD[@]}")

echo ""
echo -e "${GREEN}${BOLD}Issue created: ${ISSUE_URL}${RESET}"
echo ""

# Extract issue number from URL
ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')

echo -e "${BOLD}Next steps:${RESET}"
echo -e "  Create a branch:  ${BLUE}gh issue develop ${ISSUE_NUM} --checkout${RESET}"
echo -e "  Or manually:      ${BLUE}git checkout -b feat/${ISSUE_NUM}-$(echo "$TITLE" | sed 's/^[a-z]*: //;s/ /-/g;s/[^a-zA-Z0-9-]//g' | head -c 40 | tr '[:upper:]' '[:lower:]')${RESET}"
echo -e "  View issue:       ${BLUE}gh issue view ${ISSUE_NUM}${RESET}"
