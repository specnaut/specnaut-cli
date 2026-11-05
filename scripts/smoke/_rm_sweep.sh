# shellcheck shell=bash
# The static sweep: every `rm -rf` in the smoke scripts deletes a vetted path.
# smoke-toolbox.sh sources it after _common.sh and runs it on the suite's own
# directory; tests/scripts/rm_sweep_test.ts runs it on fixtures. Source it; do
# not run it.
#
# smoke-toolbox.sh's dynamic cases cover the three entry points somebody
# thought to test. This covers the ones nobody did. A deleting line passes
# only if:
#   * it holds one delete, whose whole argument list is one quoted variable,
#     optionally after `--`, followed by the end of the line or of the command;
#   * every assignment of that variable in the same file, inline ones
#     included, is `""`, scenario_dir (which validates) or a fresh
#     `mktemp -d`, and there is at least one. SANDBOX_ROOT is the exception:
#     _common.sh derives it from its own location, and no other file may
#     assign it.
#
# No file is skipped, this one included: the command is assembled below, so
# the sweep's own patterns never read as a deleting line. Narrowing the match
# to lines STARTING with the command would stop matching
# `trap 'rm -rf "$SANDBOX"' EXIT`, which is a real deleting path. Whole-line
# comments are dropped by the first non-blank character after `path:lineno:`,
# never by any `#`, which would drop code carrying a trailing comment.
# Not seen: a variable set by `read`, by `for`, or by `${v:=…}`.

# smoke_rm_sweep <dir> — every finding is a `fail`; each vetted path a `pass`.
smoke_rm_sweep() {
  local dir=$1 rm="rm -r""f" hit file rest line code n v pair f bad=0 seen=""
  # shellcheck disable=SC2016 # a sed pattern: the \$ is a literal dollar sign
  local arg='(-- )?"\$([A-Za-z_][A-Za-z0-9_]*)"'
  while IFS= read -r hit; do
    file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"; code="${rest#*:}"
    n="$(grep -o "$rm" <<<"$code" | wc -l | tr -d ' ')"
    v=""
    [ "$n" -eq 1 ] && v="$(sed -nE "s/.*$rm ${arg}[[:space:]]*(\$|[;&|)']).*/\\2/p" <<<"$code")"
    if [ "$n" -gt 1 ]; then
      fail "$file:$line holds $n deletes on one line" "one per line, so each can be read"
    elif [ -z "$v" ]; then
      fail "$file:$line deletes an unvetted path" "$(printf '%s' "$code" | sed 's/^[[:space:]]*//')"
    else
      seen="$seen${file##*/}:$v"$'\n'; continue
    fi
    bad=$((bad + 1))
  done < <(grep -Hn "$rm" "$dir"/*.sh | grep -vE ':[0-9]+:[[:space:]]*#' || true)
  [ "$bad" -eq 0 ] && pass "every $rm in the toolbox targets a validated path"
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    f="${pair%%:*}"; v="${pair##*:}"
    if _smoke_rm_vetted "$dir/$f" "$v"; then
      [ "$v" = SANDBOX_ROOT ] && { pass "$f takes \$$v from _common.sh, unassigned"; continue; }
      pass "$f builds \$$v through scenario_dir or mktemp -d"
    else
      fail "$f assigns \$$v other than through scenario_dir or mktemp -d" \
        "the sweep would pass the delete anyway"
    fi
  done < <(sort -u <<<"$seen")
}

# _smoke_rm_vetted <file> <var> — every assignment of <var> in <file> is
# vetted, and there is one (none at all, for SANDBOX_ROOT).
_smoke_rm_vetted() {
  local v=$2 a n=0
  while IFS= read -r a; do
    n=$((n + 1))
    [ "$v" = SANDBOX_ROOT ] && return 1
    # shellcheck disable=SC2016 # literal source text, matched, never expanded
    case "${a#*=}" in
      '""' | '"$(scenario_dir '* | '$(scenario_dir' | '"$(mktemp -d'* | '$(mktemp -d') ;;
      *) return 1 ;;
    esac
  done < <(grep -vE '^[[:space:]]*#' "$1" \
    | grep -oE "(^|[^A-Za-z0-9_])$v=(\"[^\"]*\"|\\\$\\([a-z_]+( -d)?|[^[:space:];]*)" || true)
  [ "$v" = SANDBOX_ROOT ] || [ "$n" -gt 0 ]
}
