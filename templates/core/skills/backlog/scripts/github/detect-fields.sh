#!/usr/bin/env bash
# Detect native Project V2 single-select fields for Priority and Size.
# Outputs eval-friendly env lines on stdout. Empty *_FIELD_ID means the field
# does not exist on the project — caller should fall back to labels.
# Usage: eval "$(detect-fields.sh)"
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

FIELDS_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json)

emit() {
  local field="$1" prefix="$2"
  local field_block
  field_block=$(echo "$FIELDS_JSON" | jq -r --arg n "$field" '
    .fields[]
    | select(.type == "ProjectV2SingleSelectField")
    | select((.name | ascii_downcase) == ($n | ascii_downcase))
  ')
  if [ -z "$field_block" ]; then
    echo "${prefix}_FIELD_ID="
    return
  fi
  echo "${prefix}_FIELD_ID=$(echo "$field_block" | jq -r '.id')"
  echo "$field_block" | jq -r --arg p "$prefix" '
    .options[] | "\($p)_OPT_\(.name | ascii_upcase)=\(.id)"
  '
}

emit Priority PRIORITY
emit Size SIZE

# Date + number fields used by the Roadmap view (#264). They are
# regular ProjectV2Field nodes, not single-select — emit just the
# field ID; the writer routes by axis name to --date or --number.
emit_simple() {
  local field="$1" prefix="$2"
  local field_id
  field_id=$(echo "$FIELDS_JSON" | jq -r --arg n "$field" '
    .fields[]
    | select(.type == "ProjectV2Field")
    | select((.name | ascii_downcase) == ($n | ascii_downcase))
    | .id
  ')
  if [ -z "$field_id" ]; then
    echo "${prefix}_FIELD_ID="
    return
  fi
  echo "${prefix}_FIELD_ID=$field_id"
}

emit_simple "Start date"  STARTDATE
emit_simple "Target date" TARGETDATE
emit_simple "Estimate"    ESTIMATE

# Project node ID — handy for callers that also want to write field values.
echo "PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json | jq -r '.id')"
