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

# Attach to the project
gh project item-add "$PROJECT_NUMBER" --owner "$REPO_OWNER" --url "$URL" >/dev/null
echo "✓ attached to Project #$PROJECT_NUMBER"

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
