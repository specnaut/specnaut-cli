# shellcheck shell=bash
# shellcheck disable=SC2016  # the $ in these strings belongs to jq
# Sourced by gate-impact.sh: the one home of the change set and of the affected set
# with its reverse closure. Reports facts; whether one widens the run is
# gate-impact.sh's call. Requires gate_git and jq_lf.
#
# Every path is top-relative: gate-impact refuses a project not at its work tree's top
# (gate_candidate_in_repo), so a declared path already is one; trees are listed whole
# (--full-tree). A path is compared as the text jq decodes it to, U+FFFD for bytes that
# are not UTF-8, as the PowerShell twin decodes it. A path holding U+FFFD or a newline is
# never compared: a changed one widens as `path-unreadable`, a protected one reads as not
# regular. The same rule in both twins, so they never answer apart on such a name.

# gate_graph_changes <base> <commit> <paths-out> - writes the changed paths,
# NUL-separated. --no-renames makes a rename its delete plus its add, so both of
# its owners are seen. Prints the first path whose kind no adapter can vouch for,
# as `gitlink: <path>`, `symlink: <path>` or `type-change: <path>`, and returns 1.
gate_graph_changes() {
  local meta path old new status raw="$3.raw"
  : >"$3"
  gate_git diff-tree -r -z --raw --no-renames --ignore-submodules=none "$1" "$2" >"$raw" 2>/dev/null ||
    { echo "diff-failed"; return 1; }
  while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
    old="${meta%% *}"; old="${old#:}"
    new="${meta#* }"; new="${new%% *}"
    status="${meta##* }"
    case "$status" in T*) echo "type-change: $path"; return 1 ;; esac
    case "$old $new" in
      160000\ *|*\ 160000) echo "gitlink: $path"; return 1 ;;
      120000\ *|*\ 120000) echo "symlink: $path"; return 1 ;;
    esac
    printf '%s\0' "$path" >>"$3"
  done <"$raw"
  return 0
}

# gate_graph_protected_entries <commit> <path> - the path's tracked entries as text,
# for comparing sides. Returns 1 when it has none, 2 when one is not a regular file
# or its name holds a newline or U+FFFD: the text is newline-joined, so a newline could
# read as two entries and match a side that holds them, and two names that are not
# UTF-8 can decode alike. ls-tree finds nothing through a symlink component, so that
# reads as untracked.
gate_graph_protected_entries() {
  local entry text="" found=1
  while IFS= read -r -d '' entry; do
    found=0
    case "$entry" in *$'\n'*) return 2 ;; esac
    case "$entry" in 100644\ *|100755\ *) ;; *) return 2 ;; esac
    text+="$entry"$'\n'
  done < <(gate_git ls-tree -r -z --full-tree "$1" -- "$2" 2>/dev/null)
  [ "$found" -eq 0 ] || return 1
  printf '%s' "$text" | jq_lf -Rse 'contains("\ufffd") | not' >/dev/null || return 2
  printf '%s' "$text"
}

# gate_graph_pair <paths> <snapshot> >>pairs - one line of the input to
# gate_graph_affected: a base's snapshot with the paths that differ from it.
gate_graph_pair() {
  jq_lf -c -n --rawfile paths "$1" --slurpfile snapshot "$2" \
    '{snapshot: $snapshot[0], changes: ($paths | split("\u0000") | map(select(length > 0)))}'
}

# The jq both steps below read a path with: which roots hold it, and who owns it.
# checkout_config: a root file that changes how every other path is checked out or fetched,
# whatever the declaration calls it. ASCII case folds, as a case-insensitive file system hands
# git `.GitAttributes` for `.gitattributes`. A non-ASCII letter some file systems also fold
# (U+017F to s) is not chased: that name is unowned, so it widens unless declared. The
# PowerShell twin's Test-GateCheckoutConfig holds the same list.
GATE_GRAPH_DEFS='
    def holds($p): . as $r | if endswith("/") then ($p | startswith($r)) else $p == $r end;
    def listed($list; $p): $list | any(holds($p));
    def owners_of($p): .owners | to_entries | map(select(.value.roots | any(holds($p))) | .key);
    def checkout_config($p): ($p | ascii_downcase) as $l
      | [".gitattributes", ".lfsconfig", ".gitmodules"] | any(. == $l);'

# gate_graph_cause <pairs> <candidate-snapshot> <normalized> - prints the first changed
# path's reason to widen, or nothing. Every base is walked against its own snapshot: a
# path must be owned on its own pair's sides, or an owner that only another base knows
# would stop it being unowned. One that cannot be compared as text is never looked up.
gate_graph_cause() {
  jq_lf -r --slurp --slurpfile cand "$2" --slurpfile declared "$3" "$GATE_GRAPH_DEFS"'
    . as $pairs | $cand[0] as $c | $declared[0] as $d
    | [$pairs[] as $b | $b.changes[] as $p
        | if ($p | contains("\ufffd") or contains("\n")) then "path-unreadable: \($p)"
          elif checkout_config($p) then "checkout-config: \($p)"
          elif listed($d.full_on; $p) then "full-on: \($p)"
          elif listed($d.inert; $p) then empty
          elif (($c | owners_of($p)) + ($b.snapshot | owners_of($p))) == [] then "unowned: \($p)"
          else empty end] | first // empty' "$1"
}

# gate_graph_affected <pairs> <candidate-snapshot> <normalized> - prints `full<TAB>
# <cause>` (gate_graph_cause) or `owners<TAB><space-separated ids>`. Once owned, a path
# affects whoever holds it in any snapshot, and the closure runs over every edge any
# snapshot holds, because a dependency removed on the branch still explains why the
# dependent broke.
gate_graph_affected() {
  local cause
  cause="$(gate_graph_cause "$@")" || return 1
  [ -z "$cause" ] || { printf 'full\t%s\n' "$cause"; return 0; }
  jq_lf -r --slurp --slurpfile cand "$2" --slurpfile declared "$3" "$GATE_GRAPH_DEFS"'
    def close($edges): . as $s
      | ($s + [$edges[] | select(.[1] as $d | $s | any(. == $d)) | .[0]] | unique) as $n
      | if $n == $s then $s else $n | close($edges) end;
    . as $pairs | $cand[0] as $c | $declared[0] as $d
    | ([$c] + [$pairs[].snapshot]) as $snaps
    | ([$pairs[].changes[] | select(. as $p | listed($d.inert; $p) | not)
        | . as $p | $snaps[] | owners_of($p)[]]) as $by_path
    | ([$pairs[].snapshot as $b | (($b.owners | keys) + ($c.owners | keys) | unique)[]
        | select($b.owners[.] != $c.owners[.])]) as $by_record
    | ([$snaps[].owners | to_entries[] | .key as $o | .value.depends_on[] | [$o, .]]) as $edges
    | "owners\t" + (($by_path + $by_record | unique | close($edges)) | join(" "))' "$1"
}
