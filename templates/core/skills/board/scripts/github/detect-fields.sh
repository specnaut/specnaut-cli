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

# Organization issue fields, fetched at most once per run.
#
# A single-select projected into a project from the organization is reported by
# `gh project field-list` with `options` null: the field is the project's, the
# OPTIONS belong to the org. Resolving them needs a second query, and
# `Organization.issueFields` returns a connection whose nodes are the union
# `IssueFields` — so the inline fragment is required, not stylistic.
#
# Cached because `emit` is called once per axis and the answer cannot change
# inside a run. Never fails: an org that has no issue fields, a token without
# the scope, or an outright error all yield an empty document, and every caller
# below treats that as "no projected field" and degrades to the label fallback.
ORG_FIELDS_JSON=""
org_fields() {
  if [ -z "$ORG_FIELDS_JSON" ]; then
    ORG_FIELDS_JSON=$(gh api graphql -f query='
      query($org: String!) {
        organization(login: $org) {
          issueFields(first: 50) {
            nodes {
              __typename
              ... on IssueFieldSingleSelect { id name options { id name } }
            }
          }
        }
      }' -f org="$REPO_OWNER" 2>/dev/null || echo '{}')
    [ -n "$ORG_FIELDS_JSON" ] || ORG_FIELDS_JSON='{}'
  fi
  printf '%s' "$ORG_FIELDS_JSON"
}

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
    echo "${prefix}_FIELD_FORM="
    return
  fi

  # Options come from the project when the project has them, and from the
  # organization when it does not. `form` is emitted so the WRITER can route
  # without asking again: the two forms take different mutations, and a writer
  # that re-derived the answer would be a second place for the rule to live.
  local opts form org_field_id=""
  opts=$(echo "$field_block" | jq -c '(.options // [])')
  form=local
  if [ "$opts" = "[]" ]; then
    local org_block
    org_block=$(org_fields | jq -c --arg n "$field" '
      [ .data.organization.issueFields.nodes[]?
        | select(.__typename == "IssueFieldSingleSelect")
        | select((.name | ascii_downcase) == ($n | ascii_downcase)) ][0] // empty
    ' 2>/dev/null || true)
    if [ -n "$org_block" ]; then
      form=projected
      org_field_id=$(echo "$org_block" | jq -r '.id // ""')
      opts=$(echo "$org_block" | jq -c '(.options // [])')
    fi
  fi

  echo "${prefix}_FIELD_ID=$(echo "$field_block" | jq -r '.id')"
  echo "${prefix}_FIELD_FORM=$form"
  echo "${prefix}_ORG_FIELD_ID=$org_field_id"
  # Option names are not identifiers: "In progress" would emit
  # `STATUS_OPT_IN PROGRESS=…`, which breaks the caller's `eval`. Fold every
  # non-alphanumeric character to `_` so the name is always assignable.
  echo "$opts" | jq -r --arg p "$prefix" '
    .[]
    | "\($p)_OPT_\(.name | ascii_upcase | gsub("[^A-Z0-9]"; "_"))=\(.id)"
  '
  echo "$opts" | jq -r --arg p "$prefix" '
    "\($p)_OPT_NAMES=\"\([.[].name] | join(", "))\""
  '
  echo "$opts" | jq -r --arg p "$prefix" '
    "\($p)_FIRST_OPT_ID=\(.[0].id // "")"
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
