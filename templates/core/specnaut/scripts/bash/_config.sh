# shellcheck shell=bash disable=SC2034
# (SC2034: the CONFIG_* paths and defaults are read by the sourcing script.)
#
# Sourced by the gate scripts beside it (size-ratchet.sh, boundary-check.sh):
# the one bash reader of the project-owned configs (spec 038). Its TypeScript
# twin is `readSizeLimits` in the CLI; both are held to one fixture corpus, so
# the two cannot read one file two ways.
#
# The grammar is a narrow block YAML, and nothing else:
#
#   # a full-line comment
#   file:               a key alone on its line, at column 0
#     target: 300       a map child, indented two spaces
#   exempt:
#     - "*.lock"        a list entry; "…" or '…' quotes are stripped
#
# Refused, with exit 2: a tab, a carriage return other than a CRLF line end,
# a flow map or inline value (`file: {…}`, `exempt: [...]`), a block scalar or
# deeper indentation (a multi-line value), an unknown or repeated key, a key
# with no value, and a plain entry YAML would read as something else (`*x`,
# `a: b`, a trailing ` #`). A trailing comment is not stripped: it fails the
# value check. A link at the config path is refused too — the hooks guard the
# file by its path, and a link moves it where they do not look.
#
# Values are checked, never evaluated: a limit is `none` or at most nine
# digits, so a later `[ -gt ]` can neither run code nor overflow.
#
# API — each function prints to stdout; on exit 2, stdout is the one-line
# reason (`line N: …`, or `is a link …`), which the caller prefixes:
#
#   config_present <file>       0 when anything is at the path, a dangling link included
#   config_parse <file> "<map keys>" "<list keys>"
#                               0, one tab-separated record per line:
#                                 K <line> <key>                 a key
#                                 M <line> <key> <child> <value> a map child
#                                 L <line> <key> <value>         a list entry
#                               nothing when the file is absent; 2 unreadable
#   config_size_limits <file>   0, the limits with the defaults filled in:
#                                 <unit> <target> <ceiling> <config|default>
#                                 exempt <glob>
#                               for file, function, constitution in that order;
#                               2 unreadable

# The project-owned paths the gates read. The TypeScript twin is
# src/domain/constitution_paths.ts; paths_parity_test.ts holds them equal.
CONFIG_CONSTITUTION=docs/constitution.md
CONFIG_SIZE_LIMITS=.specnaut/size-limits.yml
CONFIG_BOUNDARIES=.specnaut/boundaries.yml

# The defaults of .specnaut/memory/size-limits.md — "target ceiling" per unit.
# size_thresholds_single_arbiter_test.ts pins them to that file's table.
CONFIG_DEFAULT_FILE="300 500"
CONFIG_DEFAULT_FUNCTION="30 50"
CONFIG_DEFAULT_CONSTITUTION="60 100"

config_present() { [ -e "$1" ] || [ -L "$1" ]; }

# Read with `read -d ''`, not `$(cat <<…)`: bash 3.2 mis-parses a quoted
# heredoc inside a command substitution when it holds unbalanced quotes.
IFS= read -r -d '' _CONFIG_AWK <<'AWK' || true
BEGIN {
  n = split(maps, a, " "); for (i = 1; i <= n; i++) kind[a[i]] = "map"
  n = split(lists, a, " "); for (i = 1; i <= n; i++) kind[a[i]] = "list"
}
function fail(m) { if (err == "") err = "line " NR ": " m; exit }
{
  line = $0
  sub(/\r$/, "", line)
  if (index(line, "\r")) fail("a carriage return inside a line")
  if (index(line, "\t")) fail("a tab — indent with two spaces")
  if (line ~ /^ *$/ || line ~ /^ *#/) next
  if (line ~ /^[a-z_]+: *$/) {
    key = line; sub(/: *$/, "", key)
    if (!(key in kind)) fail("unknown key '" key "'")
    if (key in seen) fail("'" key "' is given twice")
    seen[key] = NR; order[++nk] = key; cur = key
    out = out "K\t" NR "\t" key "\n"; next
  }
  if (line ~ /^[a-z_]+:/) fail("an inline or flow value — write the block form, one value per line")
  if (line ~ /^[^ ]/) fail("a line this reader does not take")
  if (cur == "") fail("a value outside any key")
  if (kind[cur] == "map" && line ~ /^  [a-z_]+:/) {
    child = line; sub(/^  /, "", child); sub(/:.*$/, "", child)
    val = line; sub(/^  [a-z_]+:/, "", val); sub(/^ +/, "", val); sub(/ +$/, "", val)
    if (val == "") fail("'" cur "." child "' has no value")
    if ((cur, child) in got) fail("'" cur "." child "' is given twice")
    got[cur, child] = 1; has[cur] = 1
    out = out "M\t" NR "\t" cur "\t" child "\t" val "\n"; next
  }
  if (kind[cur] == "list" && substr(line, 1, 4) == "  - ") {
    val = substr(line, 5); sub(/ +$/, "", val)
    if (val ~ /^"[^"\\]*"$/ || val ~ /^'[^']*'$/) val = substr(val, 2, length(val) - 2)
    else if (val ~ /^[][{}*&!|>%@`#,?:'"]/ || val ~ /^- / || val ~ / #/ || val ~ /: / || val ~ /:$/) fail("a value YAML reads otherwise — quote it")
    if (val == "") fail("an empty entry")
    has[cur] = 1
    out = out "L\t" NR "\t" cur "\t" val "\n"; next
  }
  fail("a line this reader does not take — one value per line, indented two spaces")
}
END {
  if (err != "") { print err; exit 2 }
  for (i = 1; i <= nk; i++) if (!(order[i] in has)) { print "line " seen[order[i]] ": '" order[i] "' has no value"; exit 2 }
  printf "%s", out
}
AWK

config_parse() {
  local file="$1"
  if [ -L "$file" ]; then echo "is a link — the config is read only from a regular file"; return 2; fi
  [ -e "$file" ] || return 0
  if [ ! -f "$file" ]; then echo "is not a regular file"; return 2; fi
  if [ ! -r "$file" ]; then echo "cannot be read"; return 2; fi
  awk -v maps="$2" -v lists="$3" "$_CONFIG_AWK" "$file" || return 2
}

# One unit's "<target> <ceiling>" from its M records, or the reason and 2.
# $1 unit, $2 its key line, $3 the records. Values are already checked.
_config_unit() {
  local kind n key child value t="" c=""
  while IFS=$'\t' read -r kind n key child value; do
    [ "$kind" = M ] && [ "$key" = "$1" ] || continue
    case "$child" in target) t="$value" ;; ceiling) c="$value" ;; esac
  done <<<"$3"
  [ -n "$t" ] || { echo "line $2: '$1' lacks its target"; return 2; }
  [ -n "$c" ] || { echo "line $2: '$1' lacks its ceiling"; return 2; }
  echo "$t $c"
}

config_size_limits() {
  local records kind n key child value lim
  local re='^(none|[0-9]{1,9})$' file="" function="" constitution=""
  records="$(config_parse "$1" "file function constitution" "exempt")" || {
    echo "$records"
    return 2
  }
  # Settings in file order, then each unit in key order — the order the
  # TypeScript reader checks them in, so both name the same first fault.
  while IFS=$'\t' read -r kind n key child value; do
    [ "$kind" = M ] || continue
    case "$child" in target | ceiling) ;; *)
      echo "line $n: '$key.$child' is not a setting — expected target and ceiling"
      return 2
      ;;
    esac
    [[ $value =~ $re ]] || {
      echo "line $n: '$key.$child' is '$value' — expected a whole number of lines or none"
      return 2
    }
  done <<<"$records"
  while IFS=$'\t' read -r kind n key child; do
    [ "$kind" = K ] && [ "$key" != exempt ] || continue
    lim="$(_config_unit "$key" "$n" "$records")" || { echo "$lim"; return 2; }
    case "$key" in
      file) file="$lim config" ;;
      function) function="$lim config" ;;
      constitution) constitution="$lim config" ;;
    esac
  done <<<"$records"
  echo "file ${file:-$CONFIG_DEFAULT_FILE default}"
  echo "function ${function:-$CONFIG_DEFAULT_FUNCTION default}"
  echo "constitution ${constitution:-$CONFIG_DEFAULT_CONSTITUTION default}"
  while IFS=$'\t' read -r kind n key child; do
    [ "$kind" != L ] || printf 'exempt %s\n' "$child"
  done <<<"$records"
}
