#!/usr/bin/env bash
# Helper: read host + project_id from .specnaut/backlog-config.yml.
# Sourced by the other gitlab-backend scripts.
set -euo pipefail

# jq_lf <jq args…> — jq, for every call in this script family (cli#701). A
# native Windows jq.exe writes stdout in text mode, every \n as \r\n, so a
# value read with `$(jq -r …)` kept a \r: a path that opens nothing, an id the
# tracker does not know, a count `[ -gt ]` refuses. The \r\n is undone only
# when the jq on PATH was measured writing it, once, as this file is sourced —
# exact, never "drop every \r": a \r a value carries itself survives. jq's
# exit status and its trailing newline are kept. Every copy of this helper is
# the same text (tests/scripts/jq_crlf_test.ts).
JQ_CRLF=0
case $(jq -n 1 2>/dev/null; printf .) in *$'\r\n.') JQ_CRLF=1 ;; esac
jq_lf() {
  local _o _rc=0
  _o=$(_r=0; jq "$@" || _r=$?; printf .; exit "$_r") || _rc=$?
  _o=${_o%.}
  if [ "$JQ_CRLF" = 1 ]; then _o=${_o//$'\r\n'/$'\n'}; fi
  printf '%s' "$_o"
  return "$_rc"
}

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/.specnaut/backlog-config.yml"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Fill in host + project_id first." >&2
  exit 2
fi

# Extract a YAML scalar: a quoted value up to its closing quote, or a bare one
# up to an inline `# comment`, the shape `specnaut init` writes. A CRLF
# checkout's \r goes with what follows the quote, or with the trailing blanks.
extract() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      if ($0 ~ /^"/) { sub(/^"/, ""); sub(/".*$/, "") }
      else if ($0 ~ /^'"'"'/) { sub(/^'"'"'/, ""); sub(/'"'"'.*$/, "") }
      else { sub(/[[:space:]]+#.*$/, ""); sub(/[[:space:]]+$/, "") }
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

# glab is handed this host as GITLAB_HOST and signs its requests for it, so
# it is reached over https only: a bare host (glab's default scheme is https) or an
# https URL, with a port and a path at most -- plain http only to a loopback
# host, as for the cloud backend's api_url. LC_ALL=C keeps the classes ASCII
# whatever the locale.
if ! printf '%s\n' "$HOST" |
  LC_ALL=C grep -Eq '^(https?://)?([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*|\[::1\])(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "error: backlog-config.yml host is not a plain host or https URL." >&2
  exit 2
fi
case $HOST in http://*)
  LC_ALL=C grep -Eq '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)' <<<"$HOST" || {
    echo "error: backlog-config.yml host is plain http; use https (http only to localhost)." >&2
    exit 2
  } ;;
esac

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

# GitLab runs a quick action (`/close`, `/label`, ...) found on a line of an
# issue's text: every text this family sends is refused one
# (`quick_action_check`, _clean_text.sh).
BACKLOG_QUICK_ACTIONS=1

# `glab` reads the host from the GITLAB_HOST env var; the --repo flag
# accepts either a numeric id or a "group/project" path.
export GITLAB_HOST="$HOST"
export PROJECT_ID

# project_path -- project_id as one API path segment: a `group/project` path
# URL-encoded, a numeric id unchanged. `-j`, never `-r`: no newline is written,
# so a native Windows jq.exe has none to turn into CRLF.
project_path() { jq_lf -jn --arg p "$PROJECT_ID" '$p | @uri'; }

# glab_send <method> <path under the project> -- a write whose JSON request body
# glab reads on stdin. Never an argument: there it is visible to every process
# on the host, and a long text passes the limit on one command's arguments.
# An empty body is one that could not be built: nothing is sent then (status 2).
glab_send() {
  local p body
  body=$(cat) && [ -n "$body" ] ||
    { echo "${0##*/}: no request body to send; nothing was sent" >&2; return 2; }
  p=$(project_path) || return 2
  printf '%s\n' "$body" | glab api -X "$1" "projects/$p/$2" -H "Content-Type: application/json" --input -
}

# require_issue_number <id> — <id> as a bare decimal issue number on stdout, or
# a refusal on stderr and status 2. Every script that takes an id runs it first:
# the id reaches a URL path, a query variable or a file glob, so it is digits
# and nothing else — never a URL, an `@file` or query text. Zero padding is
# dropped (`042` is 42, never octal). Every copy is the same text
# (tests/scripts/backlog_issue_number_test.ts).
require_issue_number() {
  local n=${1:-}
  n=${n#"${n%%[!0]*}"}
  if [[ $n =~ ^[1-9][0-9]{0,9}$ ]]; then printf '%s\n' "$n"; return 0; fi
  printf '%s: not an issue number: %q\n' "${0##*/}" "${1:-}" >&2
  return 2
}

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
  # A bare host is reached over https, glab's default scheme.
  local base=${HOST%/}
  case $base in http://* | https://*) ;; *) base="https://$base" ;; esac
  echo "$base/$path/-/issues/$1"
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
    n="$(jq_lf 'length' <<<"$got" 2>/dev/null)" || return 1
    [ -n "$n" ] || return 1
    GLAB_ISSUES="$(jq_lf -c -n --argjson a "$GLAB_ISSUES" --argjson b "$got" '$a + $b')" || return 1
    [ "$(jq_lf '[.[].iid] | unique | length' <<<"$GLAB_ISSUES")" -eq "$(jq_lf 'length' <<<"$GLAB_ISSUES")" ] ||
      return 2
    [ "$n" -ge "$GLAB_PAGE_SIZE" ] || return 0
    page=$((page + 1))
  done
}
