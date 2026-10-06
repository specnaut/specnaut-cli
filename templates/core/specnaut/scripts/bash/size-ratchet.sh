#!/usr/bin/env bash
# Hold every staged file to the constitution's file size limits.
#
#   size-ratchet.sh                 the staged changes (pre-commit)
#   size-ratchet.sh --since <ref>   the commits from <ref> to HEAD (quality gates)
#
# Reads the `file` row and the `Exempt:` line of the `## Size limits` table in
# `.specnaut/memory/constitution.md`. With no such table, or no `file` row in
# it, the defaults in `.specnaut/memory/size-limits.md` apply (300 / 500). That
# file states the rule; this script is its deterministic half, for the edits
# that never go through an agent.
#
# For each changed file (added, copied, modified or renamed), it compares the
# line count before with the line count after. Staged: HEAD against the index —
# what the commit will contain, not the working tree. --since: <ref> against
# HEAD — what a branch has committed:
#
#   - over the ceiling and did not shrink  → violation
#   - over the target and grew             → violation
#   - anything that shrinks                → passes
#
# Run it by hand, from any pre-commit runner, or from the quality gates. It
# installs nothing: Specnaut never writes a git hook into a project.
#
# Exit codes:
#   0   every staged file is within its limits (or nothing is staged)
#   1   at least one violation — each printed as
#       `path: before → after (target T, ceiling C)`
#   2   the constitution has a Size limits section this script cannot read.
#       An unreadable table never passes silently.
#   3   not inside a git work tree, a bad <ref>, or a usage error
set -uo pipefail

SINCE=""
case "${1:-}" in
  "") ;;
  --since)
    SINCE="${2:-}"
    [ -n "$SINCE" ] || { echo "usage: size-ratchet.sh [--since <ref>]" >&2; exit 3; }
    ;;
  *) echo "usage: size-ratchet.sh [--since <ref>]" >&2; exit 3 ;;
esac

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

target="$DEFAULT_TARGET"
ceiling="$DEFAULT_CEILING"
source_label="default"
exempt=()

# --- read the table -----------------------------------------------------------
if [ -f "$CONSTITUTION" ]; then
  section="$(awk '
    /^## Size limits[[:space:]]*$/ { inside = 1; next }
    inside && /^## / { exit }
    inside { print }
  ' "$CONSTITUTION")"
  if grep -q '^## Size limits[[:space:]]*$' "$CONSTITUTION"; then
    if ! printf '%s\n' "$section" | grep -Eq '^\|[[:space:]]*Unit[[:space:]]*\|[[:space:]]*Target[[:space:]]*\|[[:space:]]*Ceiling[[:space:]]*\|'; then
      echo "size-ratchet: $CONSTITUTION has a '## Size limits' section without a 'Unit | Target | Ceiling' table" >&2
      exit 2
    fi
    file_rows="$(printf '%s\n' "$section" | grep -Ei '^\|[[:space:]]*file[[:space:]]*\|' || true)"
    if [ -n "$file_rows" ]; then
      if [ "$(printf '%s\n' "$file_rows" | wc -l | tr -d ' ')" != "1" ]; then
        echo "size-ratchet: $CONSTITUTION lists the 'file' unit more than once" >&2
        exit 2
      fi
      value_re='(none|[0-9]+)'
      row_re="^\|[[:space:]]*[Ff][Ii][Ll][Ee][[:space:]]*\|[[:space:]]*${value_re}[[:space:]]*\|[[:space:]]*${value_re}[[:space:]]*\|[[:space:]]*$"
      if ! printf '%s\n' "$file_rows" | grep -Eq "$row_re"; then
        echo "size-ratchet: cannot read the 'file' row in $CONSTITUTION: $file_rows" >&2
        echo "  expected: | file | <lines or none> | <lines or none> |" >&2
        exit 2
      fi
      target="$(printf '%s\n' "$file_rows" | awk -F'|' '{ gsub(/[[:space:]]/, "", $3); print $3 }')"
      ceiling="$(printf '%s\n' "$file_rows" | awk -F'|' '{ gsub(/[[:space:]]/, "", $4); print $4 }')"
      source_label="constitution"
    fi
    exempt_line="$(printf '%s\n' "$section" | grep -E '^Exempt:' || true)"
    if [ -n "$exempt_line" ]; then
      while IFS= read -r glob; do
        [ -n "$glob" ] && exempt+=("$glob")
      done < <(printf '%s\n' "$exempt_line" | grep -o '`[^`]*`' | tr -d '`')
    fi
  fi
fi

is_exempt() {
  local path="$1" glob
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

# --- walk the changed files ---------------------------------------------------
# Staged: HEAD → the index. --since: <ref> → HEAD.
if [ -n "$SINCE" ]; then
  base="$SINCE" head_prefix="HEAD:" diff_args=("$SINCE" HEAD) scope="changed since $SINCE"
else
  base="HEAD" head_prefix=":" diff_args=(--cached) scope="staged"
fi
has_base=1
git rev-parse --verify -q "$base" >/dev/null || has_base=0

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
  # Binary files have no line count worth holding.
  numstat="$(git diff "${diff_args[@]}" --numstat -- "$path" | head -n 1)"
  case "$numstat" in -$'\t'-*) continue ;; esac

  if [ "$has_base" = 1 ]; then before="$(count_at "$base:$old")"; else before=0; fi
  after="$(count_at "$head_prefix$path")"
  checked=$((checked + 1))
  line="$path: $before → $after (target $target, ceiling $ceiling)"

  if [ "$ceiling" != "none" ] && [ "$after" -gt "$ceiling" ]; then
    if [ "$after" -lt "$before" ]; then
      notes+=("$line — over the ceiling, shrinking")
    else
      violations+=("$line — over the ceiling")
    fi
  elif [ "$target" != "none" ] && [ "$after" -gt "$target" ] && [ "$after" -gt "$before" ]; then
    violations+=("$line — over the target and grew")
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
