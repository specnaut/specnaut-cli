#!/usr/bin/env bash
#
# Dispatcher for the `miximodel` Claude Code skill. Loads the sibling
# `.env` file, validates the admin token is present, and delegates to the
# Python implementation.
#
# Usage:
#   bash miximodel.sh blog-create <path/to/article.md>
#   bash miximodel.sh blog-list [--status=published]
#   bash miximodel.sh blog-show <slug>
#   bash miximodel.sh blog-update <slug> <path/to/article.md>
#   bash miximodel.sh blog-delete <slug>
#   bash miximodel.sh blog-publish <slug>
#   bash miximodel.sh api <GET|POST|PUT|DELETE> <path> [--data @file.json]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$SKILL_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
Missing skill .env file: $ENV_FILE

Create it with:
  MIXIMODEL_ADMIN_TOKEN="<plaintext-token>"
  MIXIMODEL_API_URL="https://miximodel.com"

Get a token by running on the server:
  node ace admin:token:issue --email <admin-email> --label "miximodel-skill"
EOF
  exit 1
fi

# shellcheck disable=SC1090
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" != *=* ]] && continue

  key="${line%%=*}"
  value="${line#*=}"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  export "$key=$value"
done <"$ENV_FILE"

if [[ -z "${MIXIMODEL_ADMIN_TOKEN:-}" ]]; then
  echo "MIXIMODEL_ADMIN_TOKEN is not set in $ENV_FILE" >&2
  exit 1
fi

export MIXIMODEL_API_URL="${MIXIMODEL_API_URL:-https://miximodel.com}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to run this skill" >&2
  exit 1
fi

exec python3 "$SCRIPT_DIR/blog.py" "$@"
