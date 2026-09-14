#!/usr/bin/env bash
# Create a GitHub Issue and attach it to the configured Project. Optional
# `--parent <num>` flag links the new issue as a sub-issue of an existing
# parent via GitHub's native `/sub_issues` REST endpoint (beta).
#
# Usage:
#   add.sh "<title>" [body] [labels-csv] [--parent <num>]
set -euo pipefail

# Parse arguments before sourcing _config.sh so `--help` and unknown-flag
# handling work regardless of whether the backlog backend is configured.
PARENT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]'
      exit 0
      ;;
    --parent)
      if [ $# -lt 2 ]; then
        echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]' >&2
        exit 2
      fi
      PARENT="$2"
      shift 2
      ;;
    --*)
      echo "add.sh: unknown flag '$1'" >&2
      echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]' >&2
      exit 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "${#ARGS[@]}" -lt 1 ]; then
  echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]' >&2
  exit 2
fi
TITLE="${ARGS[0]}"
BODY="${ARGS[1]:-}"
LABELS="${ARGS[2]:-}"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
require_project   # a project that does not resolve fails here, not mid-write

# When --parent is set, fail fast if the parent issue doesn't exist —
# GitHub's sub_issues POST returns a confusing 404 otherwise.
if [ -n "$PARENT" ]; then
  if ! gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$PARENT" --jq '.number' >/dev/null 2>&1; then
    echo "✗ parent issue #$PARENT not found in $REPO_OWNER/$REPO_NAME" >&2
    exit 3
  fi
fi

CREATE_ARGS=("--repo" "$REPO" "--title" "$TITLE")
if [ -n "$BODY" ]; then CREATE_ARGS+=("--body" "$BODY"); else CREATE_ARGS+=("--body" ""); fi
if [ -n "$LABELS" ]; then CREATE_ARGS+=("--label" "$LABELS"); fi

URL=$(gh issue create "${CREATE_ARGS[@]}")
echo "✓ created: $URL"

# ─── FROM HERE ON, NOTHING MAY ABORT THIS SCRIPT ──────────────────────────
# The issue exists now. A non-zero exit past this point leaves the caller
# unsure whether anything was created, and a re-run duplicates it. The
# placement step below already said exactly this; the attach did not, and
# that omission is #603: under `set -e` a failed attach killed the script
# after `✓ created:` had already printed a working URL.
NUM="${URL##*/}"

# Attach to the project. `item-add` leaves Status *null* — it does not fall
# back to the first column — so the item is invisible to every column-filtered
# board view AND to any grooming sweep that enumerates the columns, because it
# matches none of them. Place it explicitly, below.
ITEM_ID=""
if ITEM_ID=$(gh project item-add "$PROJECT_NUMBER" --owner "$REPO_OWNER" \
  --url "$URL" --format json --jq '.id' 2>/dev/null); then
  echo "✓ attached to Project #$PROJECT_NUMBER"
else
  # The commonest cause is not an error at all: GitHub's built-in "Auto-add to
  # project" workflow races this call, wins, and the API then refuses a second
  # insert. Ask the BOARD whether the item is there — the refusal's wording is
  # not a contract and keying on it would break the day GitHub rephrases it.
  ITEM_ID=$(project_item_id "$NUM")
  if [ -n "$ITEM_ID" ]; then
    echo "✓ already on Project #$PROJECT_NUMBER (a project workflow attached it first)"
  else
    echo "⚠ could not attach to Project #$PROJECT_NUMBER — the issue exists at $URL" >&2
    echo "  attach it by hand, or it stays off the board" >&2
  fi
fi

# Placing the item is best-effort and MUST NOT fail this script: the issue
# already exists by now, so a non-zero exit would leave the caller unsure
# whether anything was created, and a re-run would duplicate it. Every failure
# path below warns and returns 0.
place_in_backlog() {
  local fields
  if [ -z "$ITEM_ID" ]; then
    # Not attached, so there is no item to place. Said explicitly rather than
    # letting `item-edit` fail on an empty --id and reporting the wrong cause.
    echo "⚠ not on the project — nothing to place" >&2
    return 0
  fi
  if ! fields=$("$(dirname "$0")/detect-fields.sh" 2>/dev/null); then
    echo "⚠ could not read the project's fields — item attached but not placed" >&2
    return 0
  fi
  # detect-fields.sh emits assignments only, and is the single source of the
  # Status lookup — no third copy of the field/option resolution.
  eval "$fields"

  if [ -z "${STATUS_FIELD_ID:-}" ]; then
    echo "⚠ project has no Status field — item attached but not placed" >&2
    return 0
  fi

  local option_id="${STATUS_OPT_BACKLOG:-}" placed="Backlog"
  if [ -z "$option_id" ]; then
    # The board belongs to the user and need not have a "Backlog" column.
    # Fall back to whatever its first column is rather than refusing.
    option_id="${STATUS_FIRST_OPT_ID:-}"
    placed="${STATUS_OPT_NAMES%%,*}"
    if [ -n "$option_id" ]; then
      echo "⚠ no 'Backlog' column on this board (found: ${STATUS_OPT_NAMES:-none})" >&2
    fi
  fi

  if [ -z "$option_id" ]; then
    echo "⚠ Status field has no options — item attached but not placed" >&2
    return 0
  fi

  if gh project item-edit \
    --id "$ITEM_ID" \
    --project-id "$PROJECT_NODE_ID" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$option_id" >/dev/null 2>&1; then
    echo "✓ placed in $placed"
  else
    echo "⚠ could not set Status — item attached but not placed" >&2
  fi
  return 0
}

place_in_backlog || true

# Link as a sub-issue if --parent was given. Two-step: extract the new
# issue's REST id (NOT its number — sub_issues is keyed by id), then POST
# to the parent's /sub_issues endpoint.
if [ -n "$PARENT" ]; then
  CHILD_NUM="${URL##*/}"
  CHILD_ID=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$CHILD_NUM" --jq '.id')
  gh api -X POST "repos/$REPO_OWNER/$REPO_NAME/issues/$PARENT/sub_issues" \
    -F sub_issue_id="$CHILD_ID" >/dev/null
  echo "✓ linked as sub-issue of #$PARENT"
fi
