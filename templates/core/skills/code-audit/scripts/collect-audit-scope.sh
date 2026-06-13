#!/usr/bin/env bash
# collect-audit-scope.sh — resolve the scope for `/code-audit` and emit the
# CODE-AUDIT SCOPE block + CATEGORY SIGNALS the orchestrator skill parses.
#
# Read-only: it never mutates the tree. Pure bash + git, no extra deps, so it
# runs unmodified in any scaffolded project (the Specflow binary need not be on
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
      shift 2
      ;;
    --range)
      RANGE_ARG="${2:-}"
      if [ -z "$RANGE_ARG" ]; then
        echo "error: --range requires a non-empty <a>..<b> argument" >&2
        usage
        exit 2
      fi
      # Validate the range shape (<a>..<b>, no dots inside either ref) before
      # handing it to git — a malformed range must error, not silently fall
      # through to auto-scope.
      case "$RANGE_ARG" in
        *..*)
          if ! printf '%s' "$RANGE_ARG" | grep -Eq '^[^.]+\.\.[^.]+$'; then
            echo "error: --range must match <a>..<b> (got: $RANGE_ARG)" >&2
            usage
            exit 2
          fi
          ;;
        *)
          echo "error: --range must match <a>..<b> (got: $RANGE_ARG)" >&2
          usage
          exit 2
          ;;
      esac
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

# Counts a newline-separated file list against a glob, printing the integer.
# Tolerates an empty list (prints 0). Matching is case-insensitive on the
# basename / path so heuristic globs stay "good enough to pick seats".
count_matches() {
  local list="$1"
  shift
  local n=0
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    local matched=0
    local pat
    for pat in "$@"; do
      # shellcheck disable=SC2254
      case "$f" in
        $pat)
          matched=1
          break
          ;;
      esac
    done
    [ "$matched" -eq 1 ] && n=$((n + 1))
  done <<EOF
$list
EOF
  printf '%s' "$n"
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
  FILES="$(git diff --name-only "$RANGE_ARG" 2>/dev/null || true)"
  COMMITS="$(git log --oneline "$RANGE_ARG" 2>/dev/null || true)"
elif git rev-parse --verify --quiet origin/main >/dev/null 2>&1 &&
  [ "$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)" -gt 0 ]; then
  SCOPE="unpushed"
  local_count="$(git rev-list --count origin/main..HEAD)"
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
FRONTEND_COUNT="$(count_matches "$FILES" \
  '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.css' '*.scss' '*inertia*' '*frontend*' '*components*')"
TEST_COUNT="$(count_matches "$FILES" \
  '*_test.*' '*.test.*' '*.spec.*' 'tests/*' '*/tests/*' '*/test/*' '*__tests__*')"
DEP_COUNT="$(count_matches "$FILES" \
  'package.json' '*/package.json' 'deno.json' '*/deno.json' 'deno.jsonc' '*.lock' \
  'Cargo.toml' 'pyproject.toml' 'go.mod' 'composer.json' 'Gemfile' 'requirements.txt')"
INFRA_COUNT="$(count_matches "$FILES" \
  'Dockerfile' '*/Dockerfile' '*.tf' '*.pulumi.*' 'k8s/*' '*/k8s/*' \
  '.github/workflows/*' '*.yaml' '*.yml')"

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
