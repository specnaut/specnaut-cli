#!/usr/bin/env bash
# List items on Project #4 with their Status. Uses `gh issue list --json
# projectItems` — the gh CLI exposes the Project V2 Status field via its
# REST-ish JSON projection, costing ~1 GraphQL point per call (vs ~20 for
# the hand-rolled `repository.issues[].projectItems[].fieldValues[]` query
# that lived here previously and was the main rate-limit offender).
#
# Project #4 spans three repos — `specflow`, `specflow-cloud`,
# `specflow-monorepo`. By default we query all three (1 GraphQL point each,
# so ~3 total) and merge. Pass `--repo <short>` to restrict the listing to
# one repo.
#
# Usage:
#   list.sh                            # all repos, every open item NOT in Done
#   list.sh <STATUS>                   # all repos, filtered by Status
#   list.sh --repo <short> [<STATUS>]  # one repo only
#   <STATUS> ∈ Backlog | Ready | "In progress" | "In review" | Done
set -euo pipefail

. "$(dirname "$0")/_repo.sh"

# Detect whether the caller passed `--repo` so we know if we should query one
# repo or all of them. We don't use `resolve_repo` directly because the
# default (`mkrlabs/specflow`) would mask the "all repos" intent.
REPOS=("${ALLOWED_REPOS[@]}")
FILTER=""
ARGS=("$@")
i=0
while [ $i -lt ${#ARGS[@]} ]; do
  case "${ARGS[$i]}" in
    --repo)
      i=$((i + 1))
      REPOS=("${ARGS[$i]:-}")
      ;;
    --repo=*)
      REPOS=("${ARGS[$i]#--repo=}")
      ;;
    *)
      FILTER="${ARGS[$i]}"
      ;;
  esac
  i=$((i + 1))
done

for r in "${REPOS[@]}"; do
  case "$r" in
    specflow | specflow-cloud | specflow-monorepo) ;;
    *)
      echo "--repo must be one of: ${ALLOWED_REPOS[*]} (got '$r')" >&2
      exit 2
      ;;
  esac
done

ROWS=""
for SHORT in "${REPOS[@]}"; do
  JSON=$(gh issue list --repo "mkrlabs/$SHORT" --state open --limit 200 \
    --json number,title,projectItems)
  PART=$(echo "$JSON" | jq -r --arg filter "$FILTER" --arg repo "$SHORT" '
    .[]
    | . as $issue
    | (.projectItems[0].status.name // "—") as $status
    | select($issue.projectItems | length > 0)
    | select(
        if $filter == "" then $status != "Done"
        else $status == $filter
        end
      )
    | "[\($status)]\t#\($issue.number)\t(\($repo))\t\($issue.title)"
  ')
  if [ -n "$PART" ]; then
    ROWS="${ROWS}${PART}"$'\n'
  fi
done

printf '%s' "$ROWS" | sort | column -ts $'\t'
