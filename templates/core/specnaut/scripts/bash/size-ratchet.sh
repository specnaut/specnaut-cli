#!/usr/bin/env bash
# Hold every changed file to the constitution's file size limits.
#
#   size-ratchet.sh [--report]                  staged changes (pre-commit)
#   size-ratchet.sh --since <ref> [--report]    committed changes, <ref> → HEAD
#
# Reads the `file` row and the `Exempt:` line of the `## Size limits` table in
# `.specnaut/memory/constitution.md`. With no such table, or no `file` row in
# it, the defaults in `.specnaut/memory/size-limits.md` apply (300 / 500). That
# file states the rules; this script is their deterministic half, and the one
# measurer the review coordinator calls.
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
# binary files and the constitution's `Exempt:` globs.
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
#   2   the constitution has a size-limits section this script cannot read.
#       An unreadable table never passes silently, and never falls back to
#       the defaults.
#   3   not inside a git work tree, a bad <ref>, or a usage error
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

DEFAULT_TARGET=300
DEFAULT_CEILING=500

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "size-ratchet: not inside a git work tree" >&2
  exit 3
}
cd -- "$REPO_ROOT" || exit 3
if [ -n "$SINCE" ] && ! git rev-parse --verify -q "$SINCE^{commit}" >/dev/null; then
  echo "size-ratchet: not a commit: $SINCE" >&2
  exit 3
fi
CONSTITUTION=".specnaut/memory/constitution.md"
LOCK=".specnaut/installed.lock"

target="$DEFAULT_TARGET"
ceiling="$DEFAULT_CEILING"
source_label="default"
exempt=()

unreadable() { echo "size-ratchet: $CONSTITUTION: $1" >&2; exit 2; }

# --- read the table -----------------------------------------------------------
if [ -f "$CONSTITUTION" ]; then
  if grep -q '^## Size limits[[:space:]]*$' "$CONSTITUTION"; then
    section="$(awk '
      /^## Size limits[[:space:]]*$/ { inside = 1; next }
      inside && /^## / { exit }
      inside { print }
    ' "$CONSTITUTION")"
    printf '%s\n' "$section" |
      grep -Eq '^\|[[:space:]]*Unit[[:space:]]*\|[[:space:]]*Target[[:space:]]*\|[[:space:]]*Ceiling[[:space:]]*\|' ||
      unreadable "the '## Size limits' section has no 'Unit | Target | Ceiling' table"
    # Any row naming a file-like unit must be exactly `file`; `files` or `File`
    # would otherwise be skipped and the defaults would silently apply.
    file_like="$(printf '%s\n' "$section" | grep -Ei '^\|[[:space:]]*files?[[:space:]]*\|' || true)"
    if [ -n "$file_like" ]; then
      [ "$(printf '%s\n' "$file_like" | wc -l | tr -d ' ')" = "1" ] ||
        unreadable "the 'file' unit is listed more than once"
      value_re='(none|[0-9]+)'
      printf '%s\n' "$file_like" |
        grep -Eq "^\|[[:space:]]*file[[:space:]]*\|[[:space:]]*${value_re}[[:space:]]*\|[[:space:]]*${value_re}[[:space:]]*\|[[:space:]]*$" ||
        unreadable "cannot read the row '$file_like' — expected: | file | <lines or none> | <lines or none> |"
      target="$(printf '%s\n' "$file_like" | awk -F'|' '{ gsub(/[[:space:]]/, "", $3); print $3 }')"
      ceiling="$(printf '%s\n' "$file_like" | awk -F'|' '{ gsub(/[[:space:]]/, "", $4); print $4 }')"
      source_label="constitution"
    fi
    exempt_line="$(printf '%s\n' "$section" | grep -E '^Exempt:' || true)"
    if [ -n "$exempt_line" ]; then
      while IFS= read -r glob; do
        [ -n "$glob" ] && exempt+=("$glob")
      done < <(printf '%s\n' "$exempt_line" | grep -o '`[^`]*`' | tr -d '`')
    fi
  elif grep -Eiq '^#+[[:space:]]*size[[:space:]-]*limits?[[:space:]]*$' "$CONSTITUTION"; then
    # A heading that means the table but is not spelled the way it is read.
    unreadable "found a size-limits heading that is not exactly '## Size limits'"
  fi
fi

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
  for glob in ${exempt[@]+"${exempt[@]}"}; do
    # shellcheck disable=SC2254 — the glob is the pattern
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
violations=()
notes=()
while IFS=$'\t' read -r status first second; do
  [ -n "$status" ] || continue
  case "$status" in
    R* | C*) old="$first" path="$second" ;;
    *) old="$first" path="$first" ;;
  esac
  is_exempt "$path" && continue
  numstat="$(git diff "${diff_args[@]}" --numstat -- "$path" | head -n 1)"
  case "$numstat" in -$'\t'-*) continue ;; esac

  if [ -n "$base" ]; then before="$(count_at "$base:$old")"; else before=0; fi
  after="$(count_at "$head_prefix$path")"
  checked=$((checked + 1))
  line="$path: $before → $after (target $target, ceiling $ceiling)"
  [ "$REPORT" = 1 ] && echo "  $path: $before → $after"

  if [ "$ceiling" != "none" ] && [ "$after" -gt "$ceiling" ]; then
    if [ "$after" -lt "$before" ]; then
      notes+=("$line — over the ceiling, shrinking")
    else
      violations+=("$line — over the ceiling")
    fi
  elif [ "$target" != "none" ] && [ "$after" -gt "$target" ]; then
    if [ "$before" -gt "$target" ] && [ "$after" -gt "$before" ]; then
      violations+=("$line — over the target and grew")
    elif [ "$before" -le "$target" ]; then
      notes+=("$line — crosses the target")
    fi
  fi
done < <(git diff "${diff_args[@]}" --name-status -M --diff-filter=ACMR)

for n in ${notes[@]+"${notes[@]}"}; do echo "  note: $n"; done

if [ "${#violations[@]}" -gt 0 ]; then
  echo "size-ratchet: ${#violations[@]} of $checked $scope file(s) break the file limits (source: $source_label)" >&2
  for v in "${violations[@]}"; do echo "  $v" >&2; done
  echo "  extract before you add — .specnaut/memory/size-limits.md" >&2
  exit 1
fi
echo "size-ratchet: $checked $scope file(s) within the file limits (target $target, ceiling $ceiling, source: $source_label)"
exit 0
