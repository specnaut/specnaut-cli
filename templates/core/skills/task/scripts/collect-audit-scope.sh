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
[ -f "$here/_git_untrusted.sh" ] || { echo "error: $here/_git_untrusted.sh is missing" >&2 && exit 70; }
# shellcheck source=SCRIPTDIR/_git_untrusted.sh
. "$here/_git_untrusted.sh" || exit 70

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
TIP="${EXPLICIT_HEAD:-HEAD}"

SCOPE=""
SCOPE_LABEL=""
COMMITS=""
FILES=""

# scope_read <form> <args...> - the form's output. A refusal by the library stops
# the audit with its message: an argument it refuses is an error, not an empty
# scope. Any other failure (an unknown revision) reads as empty, as before.
scope_read() {
  local out rc=0 err
  err="$(mktemp)"
  out="$("$@" 2>"$err")" || rc=$?
  if [ "$rc" -eq 2 ] && grep -q '^git-read: refused' "$err"; then
    cat "$err" >&2
    rm -f "$err"
    exit 2
  fi
  rm -f "$err"
  printf '%s' "$out"
}

if [ -n "$PATH_ARG" ]; then
  SCOPE="path"
  SCOPE_LABEL="$PATH_ARG"
  # Tracked files under the subtree; no commit list for a path scope.
  FILES="$(scope_read gu_files "$PATH_ARG")"
  COMMITS=""
  if [ -z "$FILES" ]; then
    echo "warning: --path '$PATH_ARG' matched no tracked files (empty scope)" >&2
  fi
elif [ -n "$RANGE_ARG" ]; then
  SCOPE="range"
  SCOPE_LABEL="$RANGE_ARG"
  # The library takes the two endpoints apart; each is validated again there.
  FILES="$(scope_read gu_names "${RANGE_ARG%%..*}" "${RANGE_ARG#*..}")"
  COMMITS="$(scope_read gu_log "$RANGE_ARG")"
elif _gu_git rev-parse --verify --quiet origin/main >/dev/null 2>&1 &&
  local_count="$(_gu_git rev-list --count "origin/main..$TIP" 2>/dev/null || echo 0)" &&
  [ "$local_count" -gt 0 ]; then
  # Reuse the count captured in the guard rather than running rev-list twice.
  SCOPE="unpushed"
  SCOPE_LABEL="origin/main..$TIP (${local_count} commits)"
  FILES="$(scope_read gu_names origin/main "$TIP")"
  COMMITS="$(scope_read gu_log "origin/main..$TIP")"
elif TAG="$(_gu_git describe --tags --abbrev=0 "$TIP" 2>/dev/null)" && [ -n "$TAG" ]; then
  SCOPE="since-tag"
  SCOPE_LABEL="${TAG}..$TIP"
  FILES="$(scope_read gu_names "$TAG" "$TIP")"
  COMMITS="$(scope_read gu_log "${TAG}..$TIP")"
else
  SCOPE="last-N"
  # Clamp N to the available history so HEAD~N never points before the root.
  AVAIL="$(_gu_git rev-list --count "$TIP" 2>/dev/null || echo 1)"
  N="$LAST_N"
  if [ "$N" -gt "$AVAIL" ]; then
    N="$AVAIL"
  fi
  SCOPE_LABEL="last ${N} commits"
  if [ "$N" -ge "$AVAIL" ]; then
    # The window covers all of history; HEAD~N would precede the root, so diff
    # against the empty tree to surface every file the history touched.
    EMPTY_TREE="$(_gu_git hash-object -t tree /dev/null)"
    FILES="$(scope_read gu_names "$EMPTY_TREE" "$TIP")"
  else
    FILES="$(scope_read gu_names "$TIP~${N}" "$TIP")"
  fi
  COMMITS="$(scope_read gu_log "$TIP" "$N")"
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
