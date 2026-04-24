#!/usr/bin/env bash
# find-spec.sh — Finds a spec directory by number or partial name
# Usage: bash find-spec.sh <identifier>
# Examples:
#   bash find-spec.sh 001
#   bash find-spec.sh multi-role
#   bash find-spec.sh 001-multi-role-registration
#
# Output (JSON):
#   { "found": true, "count": 1, "specs": [{ "dir": "...", "name": "..." }] }
#   { "found": false, "count": 0, "specs": [] }

set -euo pipefail

SPECS_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/specs"
IDENTIFIER="${1:-}"

if [[ -z "$IDENTIFIER" ]]; then
  # List all specs
  RESULTS=()
  if [[ -d "$SPECS_DIR" ]]; then
    for dir in "$SPECS_DIR"/*/; do
      [[ -d "$dir" ]] || continue
      name=$(basename "$dir")
      has_spec=$([[ -f "$dir/spec.md" ]] && echo "true" || echo "false")
      has_plan=$([[ -f "$dir/plan.md" ]] && echo "true" || echo "false")
      has_tasks=$([[ -f "$dir/tasks.md" ]] && echo "true" || echo "false")
      RESULTS+=("{\"dir\":\"$dir\",\"name\":\"$name\",\"has_spec\":$has_spec,\"has_plan\":$has_plan,\"has_tasks\":$has_tasks}")
    done
  fi

  count=${#RESULTS[@]}
  if [[ $count -eq 0 ]]; then
    echo '{"found":false,"count":0,"specs":[]}'
  else
    specs_json=$(printf '%s,' "${RESULTS[@]}" | sed 's/,$//')
    echo "{\"found\":true,\"count\":$count,\"specs\":[${specs_json}]}"
  fi
  exit 0
fi

# Search by number prefix (e.g., "001")
if [[ "$IDENTIFIER" =~ ^[0-9]+$ ]]; then
  PATTERN="${IDENTIFIER}-*"
# Search by full or partial name
else
  PATTERN="*${IDENTIFIER}*"
fi

RESULTS=()
for dir in "$SPECS_DIR"/$PATTERN; do
  [[ -d "$dir" ]] || continue
  name=$(basename "$dir")
  has_spec=$([[ -f "$dir/spec.md" ]] && echo "true" || echo "false")
  has_plan=$([[ -f "$dir/plan.md" ]] && echo "true" || echo "false")
  has_tasks=$([[ -f "$dir/tasks.md" ]] && echo "true" || echo "false")
  RESULTS+=("{\"dir\":\"$dir\",\"name\":\"$name\",\"has_spec\":$has_spec,\"has_plan\":$has_plan,\"has_tasks\":$has_tasks}")
done

count=${#RESULTS[@]}
if [[ $count -eq 0 ]]; then
  echo '{"found":false,"count":0,"specs":[]}'
else
  specs_json=$(printf '%s,' "${RESULTS[@]}" | sed 's/,$//')
  echo "{\"found\":true,\"count\":$count,\"specs\":[${specs_json}]}"
fi
