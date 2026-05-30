#!/usr/bin/env bash
# Helper: read api_url + api_token + project_key from .specflow/backlog-config.yml.
# Sourced by the other cloud-backend scripts. Exports API_BASE (…/api/v1).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/.specflow/backlog-config.yml"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Fill in api_url + api_token + project_key first." >&2
  exit 2
fi

# Extract YAML scalars. Strip surrounding quotes.
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

API_URL=$(extract api_url)
API_TOKEN=$(extract api_token)
PROJECT_KEY=$(extract project_key)

if [ -z "$API_URL" ] || [ -z "$API_TOKEN" ] || [ -z "$PROJECT_KEY" ]; then
  echo "error: backlog-config.yml is missing api_url, api_token, or project_key." >&2
  echo "Edit $CONFIG before running this command." >&2
  exit 2
fi

API_BASE="${API_URL%/}/api/v1"

export API_URL API_TOKEN PROJECT_KEY API_BASE
