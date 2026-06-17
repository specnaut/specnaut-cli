#!/usr/bin/env bash
# collect-audit-scope.sh — resolve the scope for `/code-audit` and emit the
# CODE-AUDIT SCOPE block + CATEGORY SIGNALS the orchestrator skill parses.
#
# Read-only: it never mutates the tree. Pure bash + git, no extra deps, so it
# runs unmodified in any scaffolded project (the Specnaut binary need not be on
# PATH at audit time).
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
# Contract: .specflow/specs/013-code-audit/contracts/scope-signals.md
set -euo pipefail

PATH_ARG=""
RANGE_ARG=""
LAST_N=20

usage() {
  echo "usage: collect-audit-scope.sh [--path <subtree> | --range <a>..<b>] [--last <n>]" >&2
  # Known limitation: the --range allowlist excludes '{' '}', so stash refs of
  # the form 'stash@{N}' are not accepted as range endpoints.
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
      # Reject anything that escapes the repo root before any git call: an
      # absolute path (leading '/') or any '..' path segment lets the caller
      # point the scope outside the working tree. Only relative, in-tree
      # subtrees are valid scope arguments.
      case "$PATH_ARG" in
        /* | ../* | */../* | */.. | ..)
          echo "error: --path must be a relative path inside the repo (got: $PATH_ARG)" >&2
          usage
          exit 2
          ;;
      esac
      shift 2
      ;;
    --range)
      RANGE_ARG="${2:-}"
      if [ -z "$RANGE_ARG" ]; then
        echo "error: --range requires a non-empty <a>..<b> argument" >&2
        usage
        exit 2
      fi
      # Validate the range shape before handing it to git — a malformed range
      # must error, not silently fall through to auto-scope. Two endpoints,
      # each restricted to a git-ref-name allowlist ([A-Za-z0-9._/@^~-]), around
      # a single two-dot '..'. This rejects three-dot ranges, shell
      # metacharacters, and whitespace (so a value can never become a shell
      # injection or a misleading empty scope). The '.' is allowed inside a ref
      # (tags like v1.0) but the '..' separator must be exactly two dots.
      if ! printf '%s' "$RANGE_ARG" | grep -Eq '^[A-Za-z0-9._/@^~-]+\.\.[A-Za-z0-9._/@^~-]+$' ||
        printf '%s' "$RANGE_ARG" | grep -Eq '\.\.\.'; then
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
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

# Git-repo guard — abort with a clear message, no block on stdout.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: /code-audit requires a git repository" >&2
  exit 1
fi

SCOPE=""
SCOPE_LABEL=""
COMMITS=""
FILES=""

# Classifies a newline-separated file list into the four CATEGORY SIGNAL
# counters in a SINGLE pass over the list. Each file is tested against every
# category's glob set independently (a file can count toward more than one
# category, e.g. a frontend test file). Sets FRONTEND_COUNT / TEST_COUNT /
# DEP_COUNT / INFRA_COUNT. The globs are heuristic (research.md Decision 1):
# good enough to pick which auditor seats run. Walking the list once instead of
# four times is purely a perf optimization — the per-category counts are
# identical to testing each category in its own pass.
#
# matches_any <file> <glob...> — 0 if the file matches any of the globs.
matches_any() {
  local f="$1"
  shift
  local pat
  for pat in "$@"; do
    # shellcheck disable=SC2254
    case "$f" in
      $pat) return 0 ;;
    esac
  done
  return 1
}

classify_files() {
  local list="$1"
  FRONTEND_COUNT=0
  TEST_COUNT=0
  DEP_COUNT=0
  INFRA_COUNT=0
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    # `matches_any … && COUNT=$((…))` relies on `set -e` NOT aborting on a
    # failed `&&` compound list (a non-match is expected, not an error). This is
    # bash semantics; a future shebang switch to /bin/sh would need an explicit
    # `if matches_any …; then COUNT=…; fi` rewrite to stay safe.
    matches_any "$f" \
      '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.css' '*.scss' '*inertia*' '*frontend*' '*components*' &&
      FRONTEND_COUNT=$((FRONTEND_COUNT + 1))
    matches_any "$f" \
      '*_test.*' '*.test.*' '*.spec.*' 'tests/*' '*/tests/*' '*/test/*' '*__tests__*' &&
      TEST_COUNT=$((TEST_COUNT + 1))
    matches_any "$f" \
      'package.json' '*/package.json' 'deno.json' '*/deno.json' 'deno.jsonc' '*.lock' \
      'Cargo.toml' 'pyproject.toml' 'go.mod' 'composer.json' 'Gemfile' 'requirements.txt' &&
      DEP_COUNT=$((DEP_COUNT + 1))
    matches_any "$f" \
      'Dockerfile' '*/Dockerfile' '*.tf' '*.pulumi.*' 'k8s/*' '*/k8s/*' \
      '.github/workflows/*' '*.yaml' '*.yml' &&
      INFRA_COUNT=$((INFRA_COUNT + 1))
  done <<EOF
$list
EOF
  # A trailing non-match leaves $? non-zero; return 0 so `set -e` doesn't abort
  # (the function's job is to set the four counters, not to report a status).
  return 0
}

if [ -n "$PATH_ARG" ]; then
  SCOPE="path"
  SCOPE_LABEL="$PATH_ARG"
  # Tracked files under the subtree; no commit list for a path scope.
  FILES="$(git ls-files -- "$PATH_ARG" 2>/dev/null || true)"
  COMMITS=""
  if [ -z "$FILES" ]; then
    echo "warning: --path '$PATH_ARG' matched no tracked files (empty scope)" >&2
  fi
elif [ -n "$RANGE_ARG" ]; then
  SCOPE="range"
  SCOPE_LABEL="$RANGE_ARG"
  # Trailing `--` ends option/revision parsing so a ref-shaped value can never
  # be mistaken for a pathspec (matches the `git ls-files --` call above).
  FILES="$(git diff --name-only "$RANGE_ARG" -- 2>/dev/null || true)"
  COMMITS="$(git log --oneline "$RANGE_ARG" -- 2>/dev/null || true)"
elif git rev-parse --verify --quiet origin/main >/dev/null 2>&1 &&
  local_count="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)" &&
  [ "$local_count" -gt 0 ]; then
  # Reuse the count captured in the guard rather than running rev-list twice.
  SCOPE="unpushed"
  SCOPE_LABEL="origin/main..HEAD (${local_count} commits)"
  FILES="$(git diff --name-only origin/main..HEAD 2>/dev/null || true)"
  COMMITS="$(git log --oneline origin/main..HEAD 2>/dev/null || true)"
elif TAG="$(git describe --tags --abbrev=0 2>/dev/null)" && [ -n "$TAG" ]; then
  SCOPE="since-tag"
  SCOPE_LABEL="${TAG}..HEAD"
  FILES="$(git diff --name-only "${TAG}..HEAD" 2>/dev/null || true)"
  COMMITS="$(git log --oneline "${TAG}..HEAD" 2>/dev/null || true)"
else
  SCOPE="last-N"
  # Clamp N to the available history so HEAD~N never points before the root.
  AVAIL="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
  N="$LAST_N"
  if [ "$N" -gt "$AVAIL" ]; then
    N="$AVAIL"
  fi
  SCOPE_LABEL="last ${N} commits"
  if [ "$N" -ge "$AVAIL" ]; then
    # The window covers all of history; HEAD~N would precede the root, so diff
    # against the empty tree to surface every file the history touched.
    EMPTY_TREE="$(git hash-object -t tree /dev/null)"
    FILES="$(git diff --name-only "$EMPTY_TREE" HEAD 2>/dev/null || true)"
  else
    FILES="$(git diff --name-only "HEAD~${N}..HEAD" 2>/dev/null || true)"
  fi
  COMMITS="$(git log --oneline -n "$N" 2>/dev/null || true)"
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
# seats run); TEST_COUNT and INFRA_COUNT are INFORMATIONAL only (no seat
# consumes them) — all four are always emitted per the #379 contract.
classify_files "$FILES"

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
