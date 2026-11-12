#!/usr/bin/env bash
# collect-audit-scope.sh — resolve the scope for `/task audit` and emit the
# CODE-AUDIT SCOPE block + CATEGORY SIGNALS the orchestrator skill parses.
#
# Read-only: it never mutates the tree. Pure bash + git, so it runs in any
# scaffolded project. Every git call goes through _git_untrusted.sh, installed
# beside it: no program the unvetted repository's configuration names may run.
#
# Resolution priority (first match wins):
#   1. --path <subtree>     → files tracked under that subtree (SCOPE: path)
#   2. --range <a>..<b>     → diff of an explicit commit range (SCOPE: range)
#   3. unpushed             → origin/main..HEAD, if origin/main exists and is
#                             behind HEAD (SCOPE: unpushed)
#   4. since-tag            → <latest-tag>..HEAD, if a tag is reachable
#                             (SCOPE: since-tag)
#   5. last-N               → HEAD~<N>..HEAD, N default 20, --last <n> overrides
#                             (SCOPE: last-N)
#
# --head <sha> [--objects <dir>] puts that commit in HEAD's place, read from git's
# objects only (_explicit_head.sh): --path lists its tree, and no range may name HEAD.
#
# Contract: .specnaut/specs/013-code-audit/contracts/scope-signals.md
set -euo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for lib in _git_untrusted.sh _audit_scopes.sh; do
  [ -f "$here/$lib" ] || { echo "error: $here/$lib is missing" >&2 && exit 70; }
done
# shellcheck source=SCRIPTDIR/_git_untrusted.sh
. "$here/_git_untrusted.sh" || exit 70
# shellcheck source=SCRIPTDIR/_audit_scopes.sh
. "$here/_audit_scopes.sh" || exit 70

PATH_ARG=""
RANGE_ARG=""
LAST_N=20

usage() {
  echo "usage: collect-audit-scope.sh [--path <subtree> | --range <a>..<b>] [--last <n>] [--head <sha> [--objects <dir>]]" >&2
  # Known limitation: the --range allowlist excludes '{' '}', so no stash@{N}.
  echo "note: stash refs (stash@{N}) are not valid --range endpoints" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --path)
      PATH_ARG="${2:-}"
      if [ -z "$PATH_ARG" ]; then
        echo "error: --path requires a non-empty subtree argument" >&2
        usage
        exit 2
      fi
      # Before any git call, and by the library's own rule: relative and in-tree.
      if ! _gu_path "$PATH_ARG"; then
        echo "error: --path must be a relative path inside the repo (got: $PATH_ARG)" >&2
        usage
        exit 2
      fi
      shift 2
      ;;
    --range)
      RANGE_ARG="${2:-}"
      if [ -z "$RANGE_ARG" ]; then
        echo "error: --range requires a non-empty <a>..<b> argument" >&2
        usage
        exit 2
      fi
      # A malformed range errors, never falls through to auto-scope: two
      # revisions around one two-dot '..', by the library's own rule.
      if ! _gu_range "$RANGE_ARG"; then
        echo "error: --range must match <a>..<b> with ref-name-shaped endpoints (got: $RANGE_ARG)" >&2
        usage
        exit 2
      fi
      shift 2
      ;;
    --last)
      LAST_N="${2:-}"
      # --last must be a positive integer (>= 1).
      if ! printf '%s' "$LAST_N" | grep -Eq '^[0-9]+$' || [ "$LAST_N" -lt 1 ]; then
        echo "error: --last requires a positive integer (got: ${2:-<empty>})" >&2
        usage
        exit 2
      fi
      shift 2
      ;;
    --head | --objects)
      explicit_head_option "$@" || { echo "error: $EXPLICIT_REFUSAL" >&2; usage; exit 2; }
      shift 2
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

# Git-repo guard — abort with a clear message, no block on stdout.
if ! _gu_git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: /task audit requires a git repository" >&2
  exit 1
fi
explicit_head_from_options _gu_git || { echo "error: --head: $EXPLICIT_REFUSAL" >&2; exit 2; }
# shellcheck disable=SC2034  # read by _audit_scopes.sh
TIP="${EXPLICIT_HEAD:-HEAD}"

SCOPE=""
SCOPE_LABEL=""
COMMITS=""
FILES=""

# Each scope resolves in _audit_scopes.sh; the first that applies wins.
if [ -n "$PATH_ARG" ]; then
  scope_path
elif [ -n "$RANGE_ARG" ]; then
  scope_range
elif count="$(scope_unpushed_count)"; then
  scope_unpushed "$count"
elif tag="$(scope_latest_tag)"; then
  scope_since_tag "$tag"
else
  scope_last_n
fi

# Normalize: drop blank lines once, then count the surviving lines.
FILES="$(printf '%s\n' "$FILES" | sed '/^$/d')"
if [ -z "$FILES" ]; then
  TOTAL_FILES=0
else
  TOTAL_FILES="$(printf '%s\n' "$FILES" | wc -l | tr -d ' ')"
fi

# CATEGORY SIGNALS — heuristic path/extension globs (research.md Decision 1).
# Signal intent (contract: contracts/scope-signals.md): FRONTEND_COUNT and
# DEP_COUNT are GATING (they decide whether the accessibility and dependency
# seats run); TEST_COUNT is GATING for a checklist, not a seat — above zero,
# `/task review` has `code-reviewer` run its test checklist; INFRA_COUNT is
# INFORMATIONAL only (no seat consumes it) — all four are always emitted per
# the #379 contract.
scope_classify "$FILES"

# Emit the fixed block.
echo "CODE-AUDIT SCOPE"
echo "SCOPE: ${SCOPE}"
echo "SCOPE_LABEL: ${SCOPE_LABEL}"
echo "COMMITS:"
[ -n "$COMMITS" ] && printf '%s\n' "$COMMITS"
echo "FILES:"
[ -n "$FILES" ] && printf '%s\n' "$FILES"
echo "TOTAL_FILES: ${TOTAL_FILES}"
echo "CATEGORY SIGNALS"
echo "FRONTEND_COUNT: ${FRONTEND_COUNT}"
echo "TEST_COUNT: ${TEST_COUNT}"
echo "DEP_COUNT: ${DEP_COUNT}"
echo "INFRA_COUNT: ${INFRA_COUNT}"
