#!/usr/bin/env bash
# Helper: read host + project_id from .specnaut/backlog-config.yml.
# Sourced by the other gitlab-backend scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/.specnaut/backlog-config.yml"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Fill in host + project_id first." >&2
  exit 2
fi

extract() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
  ' "$CONFIG"
}

HOST=$(extract host)
PROJECT_ID=$(extract project_id)

if [ -z "$HOST" ] || [ -z "$PROJECT_ID" ]; then
  echo "error: backlog-config.yml is missing 'host' or 'project_id'." >&2
  echo "Edit $CONFIG before running this command." >&2
  exit 2
fi

# No `require_project` guard here, and that is deliberate — do not add one to
# "restore parity" with the GitHub backend.
#
# The GitHub config carries two independent addressing keys, `repo:` and
# `project_number:`, and its read paths use only the first. That asymmetry is
# what lets a wrong project number sit there silently while every visible
# command works and every write is dead, so that backend checks the number once
# when the config is read.
#
# This backend has one addressing key. `project_id` is what `list.sh` and
# `view.sh` pass straight to `glab issue list` / `glab issue view` via --repo,
# so a wrong value fails on the very first read, loudly, with `glab`'s own
# error. There is no silent write-only path to guard, so a guard would buy
# nothing and add a second way to fail.

# `glab` reads the host from the GITLAB_HOST env var; the --repo flag
# accepts either a numeric id or a "group/project" path.
export GITLAB_HOST="$HOST"
export PROJECT_ID

# Browser URL for one item, per `backlog-reference-contract`. Prints nothing
# when it cannot be resolved — callers degrade rather than guessing. Never
# fails: a reference must never block a workflow.
#
# `project_id` is dual-form. A "group/project" path links directly; a numeric id
# has no browser path, so it is resolved once through the API. If that lookup
# fails there is no honest URL to emit, so emit none.
_GITLAB_PATH_CACHE=""
item_url() {
  [ -n "${1:-}" ] || return 0
  local path="$PROJECT_ID"
  case "$PROJECT_ID" in
    *[!0-9]*) ;;                       # already a path — use as-is
    *)
      if [ -n "$_GITLAB_PATH_CACHE" ]; then
        path="$_GITLAB_PATH_CACHE"
      else
        path=$(glab api "projects/$PROJECT_ID" 2>/dev/null \
          | sed -n 's/.*"path_with_namespace"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
          | head -1) || path=""
        [ -n "$path" ] || return 0
        _GITLAB_PATH_CACHE="$path"
      fi
      ;;
  esac
  echo "${HOST%/}/$path/-/issues/$1"
}

# Every issue a `glab issue list` query matches, across pages.
#
# The GitLab API serves at most 100 issues a page whatever `--per-page` asks
# for, and `glab issue list` returns that page without a word about the rest.
# One call with `--per-page 500` therefore read 100 issues and reported on them
# as if they were all: a sweep said `drifted 0` over work it never saw, and the
# cascade gate said "all closed" past its hundredth child.
#
# So page until a page comes back short. Sets GLAB_ISSUES to one JSON array.
# Returns 1 when a page could not be read (its stderr goes to $GLAB_ERR when
# set), 2 when two pages overlap — issues changed mid-read, or a glab that
# ignores `--page` served page 1 again, which would otherwise loop forever.
# Call it directly, never inside `$( )`: the caller decides how to stop.
GLAB_PAGE_SIZE=100
glab_issues_all() {
  local page=1 got n
  GLAB_ISSUES='[]'
  while :; do
    got="$(glab issue list --repo "$PROJECT_ID" "$@" --per-page "$GLAB_PAGE_SIZE" \
      --page "$page" --output json 2>"${GLAB_ERR:-/dev/null}")" || return 1
    n="$(jq 'length' <<<"$got" 2>/dev/null)" || return 1
    [ -n "$n" ] || return 1
    GLAB_ISSUES="$(jq -c -n --argjson a "$GLAB_ISSUES" --argjson b "$got" '$a + $b')" || return 1
    [ "$(jq '[.[].iid] | unique | length' <<<"$GLAB_ISSUES")" -eq "$(jq 'length' <<<"$GLAB_ISSUES")" ] ||
      return 2
    [ "$n" -ge "$GLAB_PAGE_SIZE" ] || return 0
    page=$((page + 1))
  done
}
