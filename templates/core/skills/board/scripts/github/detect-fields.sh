#!/usr/bin/env bash
# Detect native Project V2 single-select fields for Status, Priority and Size.
# Outputs eval-friendly env lines on stdout. Empty *_FIELD_ID means the field
# does not exist on the project — caller should fall back to labels.
# Usage: eval "$(detect-fields.sh)"
#
# For each single-select field <P> this emits:
#   <P>_FIELD_ID       the field's node id
#   <P>_OPT_<NAME>     one per option, name upper-cased and non-alphanumerics
#                      folded to `_` (so "In progress" -> STATUS_OPT_IN_PROGRESS)
#   <P>_OPT_NAMES      the option names in board order, comma-separated
#   <P>_FIRST_OPT_ID   the first option's id — the safe default for a caller
#                      that must place an item on a board it did not create
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
require_project   # a project that does not resolve fails here, not mid-write

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
  # `.options` is NOT guaranteed present on a single-select field.
  #
  # An organization-level issue field projected into a Project V2 is reported
  # with `type: "ProjectV2SingleSelectField"` and `options` null or absent — its
  # options live on the organization, not on the project. Iterating null is a
  # jq error (exit 5), and under `set -euo pipefail` that kills the script
  # part-way through the fields: the caller's `eval` then succeeds on a
  # half-written block, holding the fields emitted before the projected one and
  # silently missing every field after it.
  #
  # So every read goes through `(.options // [])`. An optionless field is
  # reported as present-but-optionless — all three variables set, all three
  # agreeing — which routes the caller to the label fallback. That is a
  # deliberate stopgap, not the end state: a native field exists and a label
  # beside it is dual-signal drift. Reading it natively is #601. It is accepted
  # here because an abort blocks every axis while the fallback blocks none.
  #
  # Option names are not identifiers either: "In progress" would emit
  # `STATUS_OPT_IN PROGRESS=…`, which breaks the caller's `eval`. Fold every
  # non-alphanumeric character to `_` so the name is always assignable.
  echo "$field_block" | jq -r --arg p "$prefix" '
    (.options // [])[]
    | "\($p)_OPT_\(.name | ascii_upcase | gsub("[^A-Z0-9]"; "_"))=\(.id)"
  '
  echo "$field_block" | jq -r --arg p "$prefix" '
    "\($p)_OPT_NAMES=\"\([(.options // [])[].name] | join(", "))\""
  '
  echo "$field_block" | jq -r --arg p "$prefix" '
    "\($p)_FIRST_OPT_ID=\((.options // [])[0].id // "")"
  '
}

emit Status STATUS
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
