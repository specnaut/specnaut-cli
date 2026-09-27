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

# Resolved first, not last: the link query below addresses the project by it.
# Assigned before it is printed: inside `echo "…=$(…)"` a failed lookup is
# invisible — `echo`'s status is the line's — and the detector exits 0 having
# emitted an empty id as if it were an answer. As an assignment, `set -e` sees
# the failure and the caller learns that discovery failed.
PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json | jq -r '.id')

# Which of the project's fields are organization issue fields, fetched at most
# once per run (cli#619).
#
# A field projected from the organization is listed by `gh project field-list`
# like a field the project owns, and nothing in that listing decides which it
# is. Two inferences were tried and both failed on a real board: an `IFD_…` id
# prefix (a second board listed the same projected date with a `PVTF_…` id) and
# a name match against the organization's fields (a board may own a field named
# like the organization's without projecting it — the match then wrote a value
# on a field the board does not show). The project's own `isIssueField`, and
# the `issueField` it links to, are the answer: they decide the form and
# supply the organization field's id and options. `issueField` is declared per
# field type, not on the common interface, hence one fragment per type.
#
# Cached because every ambiguous axis needs it and the answer cannot change
# inside a run. **Call it in the current shell, never inside `$( … )`**: a
# command substitution is a subshell, the cache it fills dies with it, and the
# next axis queries again. Read the answer through `resolve_form`.
#
# Never fails: a token without the scope, a server whose schema predates
# `isIssueField`, or an outright error yield an empty document, and every field
# then reads as the project's — the detector must keep working where the link
# cannot be read. The degradation is announced on stderr, not silent.
FIELD_LINKS_JSON=""
load_field_links() {
  [ -z "$FIELD_LINKS_JSON" ] || return 0
  FIELD_LINKS_JSON=$(gh api graphql -f query='
    query($project: ID!) {
      node(id: $project) {
        ... on ProjectV2 {
          fields(first: 100) {
            nodes {
              ... on ProjectV2FieldCommon { id isIssueField }
              ... on ProjectV2Field {
                issueField { __typename ... on IssueFieldDate { id } }
              }
              ... on ProjectV2SingleSelectField {
                issueField { __typename ... on IssueFieldSingleSelect { id options { id name } } }
              }
            }
          }
        }
      }
    }' -f project="$PROJECT_NODE_ID" 2>/dev/null) || FIELD_LINKS_JSON=""
  if ! printf '%s' "$FIELD_LINKS_JSON" | jq -e '.data.node.fields.nodes' >/dev/null 2>&1; then
    echo "⚠ could not read which of Project #$PROJECT_NUMBER's fields are organization issue fields — they will read as the project's own" >&2
    FIELD_LINKS_JSON='{}'
  fi
}

# Decide the form of the listed project field <field-id>, in the current shell:
# sets FORM (local|projected), ORG_FIELD_ID and ORG_OPTIONS (JSON array).
#
# The project's link decides. One secondary signal survives it: an `IFD_…` id
# is an organization date's own node, which the project mutation cannot resolve
# whatever the link says, so it is never routed `local` — with the link
# unreadable, its organization id stays unknown and the writer skips it (exit
# 10) rather than sending it to a mutation certain to refuse it.
resolve_form() {
  local link
  load_field_links
  link=$(printf '%s' "$FIELD_LINKS_JSON" | jq -c --arg id "$1" '
    [ .data.node.fields.nodes[]? | select(.id == $id) ][0] // {}
  ')
  FORM=local ORG_FIELD_ID="" ORG_OPTIONS='[]'
  if [ "$(jq -r '.isIssueField == true' <<<"$link")" = true ] || [[ "$1" == IFD_* ]]; then
    FORM=projected
    ORG_FIELD_ID=$(jq -r '.issueField.id // ""' <<<"$link")
    ORG_OPTIONS=$(jq -c '.issueField.options // []' <<<"$link")
  fi
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
    echo "${prefix}_ORG_FIELD_ID="
    return
  fi

  # Options come from the project when the project has them. A listing with
  # none is ambiguous — the shape of a projected field, and of a project field
  # whose options were all deleted — so only then is the project asked, and the
  # options of a projected field are its organization field's. A listing WITH
  # options is taken as the project's without asking: no projected field has
  # been seen listing any, and asking anyway would put a GraphQL call on every
  # `add.sh`, which runs this detector for Status alone.
  #
  # `form` is emitted so the WRITER can route without asking again: the two
  # forms take different mutations, and a writer that re-derived the answer
  # would be a second place for the rule to live.
  local opts form=local org_field_id="" field_id
  field_id=$(echo "$field_block" | jq -r '.id')
  opts=$(echo "$field_block" | jq -c '(.options // [])')
  if [ "$opts" = "[]" ]; then
    resolve_form "$field_id"
    form=$FORM org_field_id=$ORG_FIELD_ID
    [ "$form" = local ] || opts=$ORG_OPTIONS
  fi

  echo "${prefix}_FIELD_ID=$field_id"
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

# Roadmap dates (#264), in either of their two forms (cli#614, cli#619).
#
# A date the project owns is written through the project item; a projected
# organization date is written on the issue. `gh project field-list` lists both
# as `ProjectV2Field`, and its id does not tell them apart — one board listed a
# projected date with an `IFD_…` id, another with a `PVTF_…` one — so every
# listed date is resolved through the project's link (`resolve_form`). Same
# vocabulary as the single-selects (`_FIELD_FORM` + `_ORG_FIELD_ID`): one
# routing rule, not two.
#
# Only a date the project LISTS is resolved. An organization date this board
# does not carry stays absent — the gate `groom.md` reads is unchanged — and a
# board with no date fields never pays for the link query.
emit_date() {
  local field="$1" prefix="$2"
  local field_id
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
  resolve_form "$field_id"
  echo "${prefix}_FIELD_ID=$field_id"
  echo "${prefix}_FIELD_FORM=$FORM"
  echo "${prefix}_ORG_FIELD_ID=$ORG_FIELD_ID"
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
echo "PROJECT_NODE_ID=$PROJECT_NODE_ID"
