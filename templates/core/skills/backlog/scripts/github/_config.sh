#!/usr/bin/env bash
# Helper: read repo + project_number from .specnaut/backlog-config.yml.
# Sourced by the other github-backend scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/.specnaut/backlog-config.yml"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Fill in repo + project_number first." >&2
  exit 2
fi

# Extract YAML scalars: repo, project_number. Strip surrounding quotes.
extract() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
  ' "$CONFIG"
}

REPO=$(extract repo)
PROJECT_NUMBER=$(extract project_number)

if [ -z "$REPO" ] || [ -z "$PROJECT_NUMBER" ]; then
  echo "error: backlog-config.yml is missing 'repo' or 'project_number'." >&2
  echo "Edit $CONFIG before running this command." >&2
  exit 2
fi

REPO_OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

export REPO REPO_OWNER REPO_NAME PROJECT_NUMBER
