#!/usr/bin/env bash
# Detect the board's native fields: the single-selects Status, Priority and
# Size, the Roadmap dates Start date / Target date, and Estimate.
# Outputs eval-friendly env lines on stdout. Empty *_FIELD_ID means the field
# does not exist on the project — caller should fall back to labels.
# Usage: fields=$(detect-fields.sh) || <discovery failed>; eval "$fields"
# (not `eval "$(detect-fields.sh)"` — `eval` hides a failed run; see set-field.sh)
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
# Cached because it is needed once per projected axis and the answer cannot
# change inside a run. **Call it in the current shell, never inside `$( … )`**:
# a command substitution is a subshell, the cache it fills dies with it, and the
# next axis queries again — which is how this cache once held nothing at all.
# Read the answer through `org_field`.
#
# Never fails: an org that has no issue fields, a token without the scope, or an
# outright error all yield an empty document, and every caller below treats that
# as "no projected field" and degrades to the label fallback. The degradation is
# announced on stderr, not silent — it makes a projected field look absent.
ORG_FIELDS_JSON=""
load_org_fields() {
  [ -z "$ORG_FIELDS_JSON" ] || return 0
  ORG_FIELDS_JSON=$(gh api graphql -f query='
    query($org: String!) {
      organization(login: $org) {
        issueFields(first: 50) {
          nodes {
            __typename
            ... on IssueFieldSingleSelect { id name options { id name } }
            ... on IssueFieldDate { id name }
          }
        }
      }
    }' -f org="$REPO_OWNER" 2>/dev/null) || ORG_FIELDS_JSON=""
  if ! printf '%s' "$ORG_FIELDS_JSON" | jq -e . >/dev/null 2>&1; then
    echo "⚠ could not read $REPO_OWNER's organization issue fields — projected fields will read as absent" >&2
    ORG_FIELDS_JSON='{}'
  fi
}

# The first organization issue field of GraphQL type <typename> named <name>
# (case-insensitive), as compact JSON — or nothing. Requires `load_org_fields`.
org_field() {
  printf '%s' "$ORG_FIELDS_JSON" | jq -c --arg t "$1" --arg n "$2" '
    [ .data.organization.issueFields.nodes[]?
      | select(.__typename == $t)
      | select((.name | ascii_downcase) == ($n | ascii_downcase)) ][0] // empty
  '
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
    load_org_fields
    org_block=$(org_field IssueFieldSingleSelect "$field")
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

# Roadmap dates (#264), in either of their two forms (cli#614).
#
# A date the project owns is a `ProjectV2Field` with a `PVTF_…` id, written
# through the project item. A date that exists only as an organization issue
# field is listed by `gh project field-list` under the SAME type but with an
# `IFD_…` id — an `IssueFieldDate` node, which the project mutation refuses to
# resolve ("Could not resolve to ProjectV2Field … 'IFD_…'"). The prefix is the
# cheap, query-free signal of the form; the organization lookup is the
# authority for the id the writer uses. Same vocabulary as the single-selects
# (`_FIELD_FORM` + `_ORG_FIELD_ID`): one routing rule, not two.
#
# Only a date the project LISTS is looked up. An organization date this board
# does not carry stays absent — the gate `groom.md` reads is unchanged — and a
# board with no date fields never pays for the organization query.
emit_date() {
  local field="$1" prefix="$2"
  local field_id form=local org_field_id=""
  field_id=$(echo "$FIELDS_JSON" | jq -r --arg n "$field" '
    [ .fields[]
      | select(.type == "ProjectV2Field")
      | select((.name | ascii_downcase) == ($n | ascii_downcase)) ][0].id // ""
  ')
  if [ -z "$field_id" ]; then
    echo "${prefix}_FIELD_ID="
    echo "${prefix}_FIELD_FORM="
    echo "${prefix}_ORG_FIELD_ID="
    return
  fi
  if [[ "$field_id" == IFD_* ]]; then
    form=projected
    load_org_fields
    org_field_id=$(org_field IssueFieldDate "$field" | jq -r '.id // ""')
  fi
  echo "${prefix}_FIELD_ID=$field_id"
  echo "${prefix}_FIELD_FORM=$form"
  echo "${prefix}_ORG_FIELD_ID=$org_field_id"
}

emit_date "Start date"  STARTDATE
emit_date "Target date" TARGETDATE

# Estimate (#264) is a regular ProjectV2Field number — emit just the field ID;
# the writer routes it to --number. Its issue-level (`IssueFieldNumber`) form is
# not routed yet.
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

emit_simple "Estimate"    ESTIMATE

# Project node ID — handy for callers that also want to write field values.
#
# Assigned before it is printed: inside `echo "…=$(…)"` a failed lookup is
# invisible — `echo`'s status is the line's — and the detector exits 0 having
# emitted an empty id as if it were an answer. As an assignment, `set -e` sees
# the failure and the caller learns that discovery failed.
PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json | jq -r '.id')
echo "PROJECT_NODE_ID=$PROJECT_NODE_ID"
