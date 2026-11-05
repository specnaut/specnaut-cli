# shellcheck shell=bash
# shellcheck disable=SC2016  # the $ in these strings belongs to jq
# Sourced by gate-impact.sh, and the one reader of `.specnaut/impact.json` and of
# an adapter's output. Each file is validated once and written back out normalized;
# everything downstream reads the normalized copy, never the original.
#
# A function here reports what is wrong and returns 1. Whether that widens the run
# is gate-impact.sh's call, not this file's. Requires jq_lf.
#
# Anchored with \A and \z, because $ also matches before a final newline, and an id
# or a path ending in one must not pass.
GATE_READ_DEFS='
def owner_id: type == "string" and test("\\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\z");
def clean: type == "string" and length > 0 and (test("[\\x00-\\x1f\\x7f]") | not);
def path_ok: type == "string" and length > 0
  and (test("\\A/|\\\\|[*?\\[\\]{}]|[\\x00-\\x1f\\x7f]|\\.\\.|//|\\./|\\A\\.\\z|/\\.\\z") | not);
def paths_ok: type == "array" and all(path_ok);
def ids_ok: type == "array" and all(owner_id);
'

# gate_read_declaration <file> <normalized-out> - prints the first problem and
# returns 1, or writes the normalized declaration.
gate_read_declaration() {
  local problem
  problem="$(jq_lf -r --slurp "$GATE_READ_DEFS"'
    def check_ok: type == "object" and (.gate | clean) and (.scoped | clean)
      and (.owners == null or ((.owners | ids_ok) and (.owners | length) > 0));
    if length != 1 then "not-json"
    elif (.[0] | type) != "object" then "not-an-object"
    else .[0] |
      if .schema != 1 then "schema"
      elif (.adapter | type) != "object" or (.adapter.command | clean | not) then "adapter.command"
      elif (.adapter.files | paths_ok | not) or (.adapter.files | length) == 0 then "adapter.files"
      elif (.scoped_tiers | type) != "array"
        or (.scoped_tiers | all(. == "fast" or . == "full") | not) then "scoped_tiers"
      elif (.full_on | paths_ok | not) then "full_on"
      elif (.inert | paths_ok | not) then "inert"
      elif (.checks | type) != "array" or (.checks | all(check_ok) | not) then "checks"
      elif ([.checks[].gate] | length) != ([.checks[].gate] | unique | length) then "checks.gate-duplicated"
      else "" end
    end' "$1" 2>/dev/null)" || { echo "not-json"; return 1; }
  if [ -n "$problem" ]; then echo "$problem"; return 1; fi
  jq_lf --slurp '.[0] | {adapter, scoped_tiers, full_on, inert, checks}' "$1" >"$2"
}

# gate_read_jq_usable - can this jq do what the graph needs? --rawfile came with jq 1.6,
# and a jq without it would fail at a stage no one would think to look at.
gate_read_jq_usable() { jq_lf -n --rawfile gate_probe "$1" 1 >/dev/null 2>&1; }

gate_read_adapter_command() { jq_lf -r '.adapter.command' "$1"; }
gate_read_adapter_files() { jq_lf -r '.adapter.files[]' "$1"; }
gate_read_scoped_tiers() { jq_lf -r '.scoped_tiers | join(" ")' "$1"; }

# gate_read_checks <normalized> - one `gate<TAB>scoped<TAB>owners` line per check,
# `-` for no owners. Nothing here can hold a tab or a newline: `clean` refused it.
gate_read_checks() {
  jq_lf -r '.checks[] | [.gate, .scoped, ((.owners // ["-"]) | join(" "))] | join("\t")' "$1"
}

# gate_read_unknown_owner <normalized> <snapshot...> - prints an owner a check names
# that no snapshot holds. A check that can never match is a declaration out of date
# with the graph, and would omit its gate on every change.
gate_read_unknown_owner() {
  local normalized="$1"
  shift
  jq_lf -r --slurp --slurpfile declared "$normalized" '
    (map(.owners | keys) | add // []) as $known
    | [$declared[0].checks[] | (.owners // [])[] | select(. as $o | $known | all(. != $o))]
    | .[0] // empty
  ' "$@"
}

# gate_read_snapshot <adapter-output> <expected-commit> <normalized-out> - prints the
# first problem and returns 1, or writes `{owners: {id: {roots, depends_on}}}`.
gate_read_snapshot() {
  local problem
  problem="$(jq_lf -r --slurp --arg commit "$2" "$GATE_READ_DEFS"'
    if length != 1 or (.[0] | type) != "object" then "invalid-json"
    else .[0] |
      if .schema != 1 then "schema-mismatch"
      elif .complete != true then "incomplete"
      elif .commit != $commit then "commit-mismatch"
      elif (.owners | type) != "array"
        or (.owners | all(type == "object" and (.id | owner_id)) | not)
        or ([.owners[].id] | length) != ([.owners[].id] | unique | length) then "invalid-owner"
      elif (.owners | all(.roots | paths_ok) | not) then "invalid-root"
      elif (.owners | all(.depends_on | ids_ok) | not) then "invalid-owner"
      elif ([.owners[].id] as $ids | .owners | all(.depends_on | all(. as $d | $ids | any(. == $d))) | not)
        then "dangling-depends-on"
      else "" end
    end' "$1" 2>/dev/null)" || { echo "invalid-json"; return 1; }
  if [ -n "$problem" ]; then echo "$problem"; return 1; fi
  jq_lf --slurp '.[0] | {owners: (.owners | map({key: .id,
    value: {roots: (.roots | unique), depends_on: (.depends_on | unique)}}) | from_entries)}' "$1" >"$3"
}
