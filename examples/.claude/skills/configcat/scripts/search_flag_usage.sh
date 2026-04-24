#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <flagKey> [repoRoot]" >&2
  exit 1
fi

FLAG_KEY="$1"
REPO_ROOT="${2:-$PWD}"

SEARCH_PATHS=()

for candidate in app inertia tests config providers start commands scripts; do
  if [[ -d "$REPO_ROOT/$candidate" ]]; then
    SEARCH_PATHS+=("$REPO_ROOT/$candidate")
  fi
done

if [[ "${#SEARCH_PATHS[@]}" -eq 0 ]]; then
  SEARCH_PATHS=("$REPO_ROOT")
fi

RG_OUTPUT="$(rg \
  -n \
  --json \
  --hidden \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!build/**' \
  --glob '!tmp/**' \
  --glob '!public/assets/**' \
  --glob '!.claude/**' \
  --glob '!.agents/**' \
  --glob '!.claude/skills/**/.env' \
  --glob '!.agents/skills/**/.env' \
  -e "'$FLAG_KEY'" \
  -e "\"$FLAG_KEY\"" \
  -e "\`$FLAG_KEY\`" \
  "${SEARCH_PATHS[@]}" || true)"

if [[ -z "$RG_OUTPUT" ]]; then
  printf '[]\n'
  exit 0
fi

printf '%s\n' "$RG_OUTPUT" | jq -s '[.[] | select(.type == "match") | { path: .data.path.text, line: .data.line_number, text: (.data.lines.text | sub("\\n$"; "")) }]'