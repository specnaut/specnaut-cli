#!/usr/bin/env bash
# Helper: read api_url + project_key from .specflow/backlog-config.yml and get a
# fresh access token from `specflow cloud token`. Sourced by the other
# cloud-backend scripts. Exports API_BASE (…/api/v1) + API_TOKEN.
#
# Credentials are NOT stored in backlog-config.yml — they live in the OS keychain
# (or ~/.specflow/credentials.json). Run `specflow cloud login` once to
# authenticate. For CI / headless, set SPECFLOW_CLOUD_TOKEN instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/.specflow/backlog-config.yml"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Run \`specflow init --backlog cloud\` first." >&2
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
PROJECT_KEY=$(extract project_key)

if [ -z "$API_URL" ] || [ -z "$PROJECT_KEY" ]; then
  echo "error: backlog-config.yml is missing api_url or project_key." >&2
  echo "Run \`specflow cloud login\` to authenticate and link a project." >&2
  exit 2
fi

# Resolve a fresh access token (refreshes transparently; honors
# SPECFLOW_CLOUD_TOKEN for headless / CI).
if ! API_TOKEN=$(specflow cloud token --api-url "$API_URL"); then
  echo "error: not authenticated with Specflow Cloud." >&2
  echo "Run \`specflow cloud login\` (or set SPECFLOW_CLOUD_TOKEN)." >&2
  exit 2
fi

API_BASE="${API_URL%/}/api/v1"

export API_URL API_TOKEN PROJECT_KEY API_BASE
