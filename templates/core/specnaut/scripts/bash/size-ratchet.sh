#!/usr/bin/env bash
# Hold every changed file to the project's file size limits.
#
#   size-ratchet.sh [--report]                  staged changes (pre-commit)
#   size-ratchet.sh --since <ref> [--report]    committed changes, <ref> → HEAD
#
# Reads the `file` and `constitution` units and the `exempt:` globs of
# `.specnaut/size-limits.yml` through `_config.sh` beside it. A unit the file
# does not set — every unit, with no file — takes the defaults of
# `.specnaut/memory/size-limits.md`. That file states the rules; this script is
# their deterministic half, and the one measurer the review phase calls.
#
# "Before" is the size at the BASE OF THE CHANGE, not at the previous commit:
#
#   - staged:  the merge base of HEAD with the default branch (HEAD itself on
#              the default branch), compared with the index — what the commit
#              will contain, not the working tree;
#   - --since: <ref>, compared with HEAD.
#
# That is what lets rule 3 work commit by commit: an extraction commit shrinks
# a file, and the next commit may add back up to the size the file had when the
# branch began. Measured per commit, the second one would be refused.
#
#   - over the ceiling and did not shrink   → violation
#   - over the target at the base and grew  → violation
#   - crosses the target for the first time → note (MEDIUM in a review)
#   - anything that shrinks                 → passes
#
# Exempt without asking: `.specnaut/**` and every file `.specnaut/installed.lock`
# lists — Specnaut's own artefacts, which `specnaut upgrade` rewrites — plus
# binary files and the config's `exempt:` globs. One file is the exception:
# `docs/constitution.md`, loaded into every session, is held to the
# `constitution` unit whenever it changes. `exempt:` globs do not reach it; a
# project that wants no limit sets its `target` and `ceiling` to `none`.
#
# `--report` also prints every checked file, `path: before → after`.
#
# Run it by hand, from any pre-commit runner, or from the quality gates. It
# installs nothing: Specnaut never writes a git hook into a project.
#
# Exit codes:
#   0   every changed file is within its limits (or nothing changed)
#   1   at least one violation — each printed as
#       `path: before → after (target T, ceiling C)`
#   2   `.specnaut/size-limits.yml` cannot be read (see `_config.sh` for the
#       grammar). An unreadable config never passes silently, and never falls
#       back to the defaults.
#   3   not inside a git work tree, a bad <ref>, a missing `_config.sh`, or a
#       usage error
set -uo pipefail

usage() { echo "usage: size-ratchet.sh [--since <ref>] [--report]" >&2; exit 3; }

SINCE="" REPORT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --since) [ -n "${2:-}" ] || usage; SINCE="$2"; shift 2 ;;
    --report) REPORT=1; shift ;;
    *) usage ;;
  esac
done

# Sourced before the `cd` below: the script's own directory may be relative.
# shellcheck source=SCRIPTDIR/_config.sh
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_config.sh" || {
  echo "size-ratchet: _config.sh is missing beside the script" >&2
  exit 3
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "size-ratchet: not inside a git work tree" >&2
  exit 3
}
cd -- "$REPO_ROOT" || exit 3
if [ -n "$SINCE" ] && ! git rev-parse --verify -q "$SINCE^{commit}" >/dev/null; then
  echo "size-ratchet: not a commit: $SINCE" >&2
  exit 3
fi
CONSTITUTION="$CONFIG_CONSTITUTION"
LOCK=".specnaut/installed.lock"

# The limits, defaults filled in: `<unit> <target> <ceiling> <source>` and
# `exempt <glob>` lines. Captured before it is split, so its exit 2 is seen.
limits="$(config_size_limits "$CONFIG_SIZE_LIMITS")" || {
  echo "size-ratchet: $CONFIG_SIZE_LIMITS: $limits" >&2
  exit 2
}
exempt=()
while read -r unit rest; do
  case "$unit" in
    file) read -r target ceiling source_label <<<"$rest" ;;
    constitution) read -r c_target c_ceiling c_source <<<"$rest" ;;
    exempt) exempt+=("$rest") ;;
  esac
done <<<"$limits"

# Specnaut's own files: the lock's entries, two-space indented keys under `entries:`.
managed=""
if [ -f "$LOCK" ]; then
  managed="$(awk '
    /^entries:/ { inside = 1; next }
    inside && /^[^ ]/ { exit }
    inside && /^  [^ ]/ {
      sub(/^  /, ""); sub(/:[[:space:]]*$/, "")
      gsub(/^["\047]|["\047]$/, "")
      print
    }
  ' "$LOCK")"
fi

is_exempt() {
  local path="$1" glob
  case "$path" in .specnaut/*) return 0 ;; esac
  if [ -n "$managed" ] && printf '%s\n' "$managed" | grep -Fxq -- "$path"; then return 0; fi
  # shellcheck disable=SC2254 # the glob is the pattern, in both arms
  for glob in ${exempt[@]+"${exempt[@]}"}; do
    case "$path" in $glob) return 0 ;; esac
    case "/$path" in $glob) return 0 ;; esac
  done
  return 1
}

count_at() { # <rev-spec> → line count, 0 when the blob does not exist
  git show "$1" 2>/dev/null | wc -l | tr -d ' '
}

default_branch_base() {
  local branch
  for branch in $(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null) main master; do
    if git rev-parse --verify -q "$branch^{commit}" >/dev/null; then
      git merge-base HEAD "$branch" 2>/dev/null && return 0
    fi
  done
  return 1
}

# --- walk the changed files ---------------------------------------------------
if [ -n "$SINCE" ]; then
  base="$SINCE" head_prefix="HEAD:" diff_args=("$SINCE" HEAD) scope="changed since $SINCE"
elif git rev-parse --verify -q HEAD >/dev/null; then
  base="$(default_branch_base || git rev-parse HEAD)"
  head_prefix=":" diff_args=(--cached "$base") scope="staged"
else
  base="" head_prefix=":" diff_args=(--cached) scope="staged"
fi

checked=0
constitution_over=0
violations=()
notes=()
while IFS=$'\t' read -r status first second; do
  [ -n "$status" ] || continue
  case "$status" in
    R* | C*) old="$first" path="$second" ;;
    *) old="$first" path="$first" ;;
  esac
  if [ "$path" = "$CONSTITUTION" ]; then
    t="$c_target" c="$c_ceiling" label=" (unit constitution, source: $c_source)"
  else
    is_exempt "$path" && continue
    t="$target" c="$ceiling" label=""
  fi
  numstat="$(git diff "${diff_args[@]}" --numstat -- "$path" | head -n 1)"
  case "$numstat" in -$'\t'-*) continue ;; esac

  if [ -n "$base" ]; then before="$(count_at "$base:$old")"; else before=0; fi
  after="$(count_at "$head_prefix$path")"
  checked=$((checked + 1))
  line="$path: $before → $after (target $t, ceiling $c)$label"
  [ "$REPORT" = 1 ] && echo "  $path: $before → $after"

  verdict=""
  if [ "$c" != "none" ] && [ "$after" -gt "$c" ]; then
    if [ "$after" -lt "$before" ]; then
      notes+=("$line — over the ceiling, shrinking")
    else
      verdict="over the ceiling"
    fi
  elif [ "$t" != "none" ] && [ "$after" -gt "$t" ]; then
    if [ "$before" -gt "$t" ] && [ "$after" -gt "$before" ]; then
      verdict="over the target and grew"
    elif [ "$before" -le "$t" ]; then
      notes+=("$line — crosses the target")
    fi
  fi
  if [ -n "$verdict" ]; then
    violations+=("$line — $verdict")
    [ "$path" = "$CONSTITUTION" ] && constitution_over=1
  fi
done < <(git diff "${diff_args[@]}" --name-status -M --diff-filter=ACMR)

for n in ${notes[@]+"${notes[@]}"}; do echo "  note: $n"; done

if [ "${#violations[@]}" -gt 0 ]; then
  echo "size-ratchet: ${#violations[@]} of $checked $scope file(s) break the file limits (source: $source_label)" >&2
  for v in "${violations[@]}"; do echo "  $v" >&2; done
  echo "  extract before you add — .specnaut/memory/size-limits.md" >&2
  if [ "$constitution_over" = 1 ]; then
    echo "  the constitution keeps principles only: move delivery status, task and epic" >&2
    echo "  narratives, dated incident history and every Sync Impact Report but the" >&2
    echo "  latest out of it, and link the issue or spec instead" >&2
  fi
  exit 1
fi
echo "size-ratchet: $checked $scope file(s) within the file limits (target $target, ceiling $ceiling, source: $source_label)"
exit 0
