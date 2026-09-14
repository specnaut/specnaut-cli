#!/usr/bin/env bash
# Helper: read repo + project_number from .specnaut/backlog-config.yml.
# Sourced by the other github-backend scripts.
set -euo pipefail

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

# Fail here, not four calls deeper.
#
# This config carries TWO independent addressing keys — `repo:` and
# `project_number:` — and the read paths use only the first. `list.sh` and
# `view.sh` go through `gh issue list` / `gh issue view`, which never touch the
# project, so a wrong `project_number` leaves every visible command working
# while every project WRITE is dead. Nothing says so until someone moves a
# card, and by then the failure surfaces as a resolution error four calls
# inside a mutation — the worst possible place to learn the config is wrong.
#
# So the number is checked once, when the config is read, and the message says
# which project numbers DO exist for the owner.
#
# Skipped when `gh` is absent or unauthenticated: this must not turn a missing
# tool into a config error, and the callers report those separately.
require_project() {
  command -v gh >/dev/null 2>&1 || return 0
  gh auth status >/dev/null 2>&1 || return 0
  if gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" >/dev/null 2>&1; then
    return 0
  fi
  echo "error: project #$PROJECT_NUMBER does not resolve for owner '$REPO_OWNER'." >&2
  echo "  configured in: $CONFIG" >&2
  local available
  # `grep -o` per occurrence, not `sed -n s/.*"number":\\([0-9]*\\).*/` — `.*`
  # is greedy, so on `gh`'s single-line JSON that captures only the LAST
  # project and the message names one number while claiming to list them all.
  # `|| true` because a no-match `grep` exits 1, and a failed substitution is
  # the assignment's status: under `set -e` this function would die here
  # instead of reaching the fallback message two lines down.
  available="$(gh project list --owner "$REPO_OWNER" --format json 2>/dev/null |
    grep -o '"number"[[:space:]]*:[[:space:]]*[0-9]*' |
    sed 's/.*[^0-9]//' | tr '\n' ' ' || true)"
  if [ -n "$available" ]; then
    echo "  projects that exist for '$REPO_OWNER': $available" >&2
  else
    echo "  could not list this owner's projects — check 'gh auth status' has the 'project' scope." >&2
  fi
  exit 2
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
    jq -r --arg p "$PROJECT_NODE_ID" \
      '.data.repository.issue.projectItems.nodes[]? | select(.project.id==$p) | .id' 2>/dev/null |
    head -1 || true
}
