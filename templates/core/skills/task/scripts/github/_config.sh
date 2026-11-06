#!/usr/bin/env bash
# Helper: read repo + project_number from .specnaut/backlog-config.yml.
# Sourced by the other github-backend scripts.
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
  echo "error: $CONFIG not found. Fill in repo + project_number first." >&2
  exit 2
fi

# Extract YAML scalars: repo, project_number. Strip surrounding quotes.
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

REPO=$(extract repo)
PROJECT_NUMBER=$(extract project_number)

if [ -z "$REPO" ] || [ -z "$PROJECT_NUMBER" ]; then
  echo "error: backlog-config.yml is missing 'repo' or 'project_number'." >&2
  echo "Edit $CONFIG before running this command." >&2
  exit 2
fi

REPO_OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

export REPO REPO_OWNER REPO_NAME PROJECT_NUMBER

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

# Fail here, not four calls deeper. This config carries TWO addressing keys,
# `repo:` and `project_number:`, and the read paths (`gh issue list` / `view`)
# use only the first, so a wrong `project_number` leaves every visible command
# working while every project WRITE is dead — and surfaces four calls inside a
# mutation. So the number is checked once, when the config is read, and the
# message says which project numbers DO exist for the owner.
#
# Exit 2 ONLY on proof: a listing that SUCCEEDED and does not contain the
# number. A failed `gh project view` is not proof — a rate limit, a network
# error, a 5xx or a missing scope fail it too, and a rate-limited view has
# printed `unknown owner type`. Every other outcome exits 13, "could not
# verify", quoting `gh`'s own stderr rather than guessing from error texts.
# 13 means what it means in `set-field.sh`: retry or report, never a fallback
# signal, never a reason to edit the config. The listing asks for closed
# projects and far past `gh`'s page of 30: a partial listing proves nothing.
#
# Skipped when `gh` is absent or unauthenticated: this must not turn a missing
# tool into a config error, and the callers report those separately.
require_project() {
  command -v gh >/dev/null 2>&1 || return 0
  gh auth status >/dev/null 2>&1 || return 0
  local view_err list_out list_err list_rc errfile available
  # `2>&1 >/dev/null`: stderr into the substitution, stdout discarded.
  if view_err="$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" 2>&1 >/dev/null)"; then
    return 0
  fi

  # The listing's exit status is captured APART from its output: piped into
  # `grep … || true`, "the listing failed" and "the listing is empty" read the
  # same. stderr goes to a file: it is quoted apart from the JSON parsed.
  errfile="$(mktemp "${TMPDIR:-/tmp}/gh-project-list.XXXXXX")"
  list_rc=0
  list_out="$(gh project list --owner "$REPO_OWNER" --closed --limit 1000 \
    --format json 2>"$errfile")" || list_rc=$?
  list_err="$(cat "$errfile")"
  rm -f "$errfile"

  if [ "$list_rc" -eq 0 ]; then
    # `grep -o` per occurrence, not `sed -n s/.*"number":\\([0-9]*\\).*/` —
    # `.*` is greedy, so on `gh`'s single-line JSON that captures only the
    # LAST project. `|| true` because a no-match `grep` exits 1 under pipefail,
    # and here "no match" is a real answer: zero projects.
    available="$(printf '%s' "$list_out" |
      grep -o '"number"[[:space:]]*:[[:space:]]*[0-9]*' |
      sed 's/.*[^0-9]//' | tr '\n' ' ' || true)"
    case " $available " in
      *" $PROJECT_NUMBER "*) ;; # listed: the view failure proves nothing
      *)
        echo "error: project #$PROJECT_NUMBER does not resolve for owner '$REPO_OWNER'." >&2
        echo "  configured in: $CONFIG" >&2
        if [ -n "$available" ]; then
          echo "  projects that exist for '$REPO_OWNER': $available" >&2
        else
          echo "  no projects are visible to this token for '$REPO_OWNER'." >&2
        fi
        exit 2
        ;;
    esac
  fi

  echo "error: could not verify project #$PROJECT_NUMBER for owner '$REPO_OWNER' — gh failed." >&2
  echo "  This is not evidence the configured number is wrong. Retry; report it if it persists." >&2
  echo "  gh project view said:" >&2
  _quote_gh_stderr "$view_err"
  if [ "$list_rc" -eq 0 ]; then
    echo "  gh project list succeeded and lists #$PROJECT_NUMBER, so the project exists." >&2
  else
    echo "  could not list this owner's projects either (gh exit $list_rc); gh project list said:" >&2
    _quote_gh_stderr "$list_err"
  fi
  exit 13
}

# `gh`'s stderr, verbatim and indented, or a note that it printed nothing — an
# empty quote would read as a formatting slip rather than as a silent `gh`.
_quote_gh_stderr() {
  if [ -n "${1:-}" ]; then
    printf '%s\n' "$1" | sed 's/^/    /' >&2
  else
    echo "    (nothing)" >&2
  fi
}

# Browser URL for one item, per `backlog-reference-contract`. Prints nothing
# when it cannot be resolved — callers degrade to "#<n> — <title>" rather than
# guessing. Never fails: a reference must never block a workflow.
item_url() {
  [ -n "${1:-}" ] || return 0
  [ -n "$REPO" ] || return 0
  echo "https://github.com/$REPO/issues/$1"
}

# The Project V2 item id for one issue on THIS project, or nothing.
#
# Targeted by issue number: a single issue costs ~2 GraphQL points against a
# paginated walk of the whole board. This is the ONE home of the question
# "which item on this project corresponds to issue #N" — `move.sh` asked it
# inline, and `add.sh` needed to ask it too, which is how a rule ends up with
# two spellings that drift.
#
# **Never fails, and that is load-bearing.** A caller must decide for itself
# what "no id" means; `set -e` deciding for it is exactly how a script dies
# between creating an issue and placing it, leaving a real issue nobody can see.
project_item_id() {
  local num="${1:-}"
  [ -n "$num" ] || return 0
  # Resolve the project's node id ourselves when the caller has not. `add.sh`
  # only learns it from `detect-fields.sh`, which runs AFTER the attach — so a
  # helper that required it as a precondition would silently answer "not
  # attached" on the one path that needs the answer. A shared helper owns its
  # own preconditions; anything else is a fourth thing to remember.
  if [ -z "${PROJECT_NODE_ID:-}" ]; then
    PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" \
      --format json --jq '.id' 2>/dev/null) || PROJECT_NODE_ID=""
    [ -n "$PROJECT_NODE_ID" ] || return 0
  fi
  gh api graphql -f query='
    query($owner:String!, $name:String!, $num:Int!) {
      repository(owner:$owner, name:$name) {
        issue(number:$num) {
          projectItems(first:5) { nodes { id project { id } } }
        }
      }
    }' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$num" 2>/dev/null |
    jq_lf -r --arg p "$PROJECT_NODE_ID" \
      '.data.repository.issue.projectItems.nodes[]? | select(.project.id==$p) | .id' 2>/dev/null |
    head -1 || true
}
