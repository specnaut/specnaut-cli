# shellcheck shell=bash
# shellcheck disable=SC2016  # the $ in these strings belongs to jq
# Sourced by run-gate.sh, and the one writer of gate evidence: what ran on which tree,
# what was omitted and why, and what was taken on trust. It is write-only. Nothing
# reads it to decide anything: a stale file must never be able to skip a check, and
# a pass is only ever what this run saw. Requires gate_git and jq_lf.

# gate_evidence_write <tier> <tree> <records> <ran> <result> <valid> - writes the file
# atomically and prints its path, or prints `unwritten (<cause>)`. Always returns 0:
# failing to record a result does not change the result.
gate_evidence_write() {
  local path dir tmp
  command -v jq >/dev/null 2>&1 || { echo "unwritten (jq-absent)"; return 0; }
  path="$(gate_git rev-parse --git-path "specnaut/gate-evidence/$1-$2.json" 2>/dev/null)" ||
    { echo "unwritten (no-git-path)"; return 0; }
  case "$path" in /*|[A-Za-z]:*) ;; *) path="$REPO_ROOT/$path" ;; esac
  dir="$(dirname -- "$path")"
  mkdir -p -- "$dir" 2>/dev/null || { echo "unwritten (cannot-create-directory)"; return 0; }
  tmp="$(mktemp "$dir/.evidence.XXXXXX" 2>/dev/null)" || { echo "unwritten (cannot-create-file)"; return 0; }
  # mv into a directory standing at the path would succeed, and report a file not there.
  if [ -d "$path" ] || ! gate_evidence_json "$1" "$2" "$3" "$4" "$5" "$6" >"$tmp" 2>/dev/null ||
    ! mv -f -- "$tmp" "$path" 2>/dev/null; then
    rm -f -- "$tmp"
    echo "unwritten (cannot-write-file)"
    return 0
  fi
  echo "$path"
}

gate_evidence_json() {
  jq_lf -n --arg tier "$1" --arg tree "$2" --rawfile records "$3" --rawfile ran "$4" \
    --arg result "$5" --argjson valid "$6" '
    def rows($text): $text | split("\n") | map(select(length > 0) | split("\t"));
    def rest: .[2:] | join("\t");
    rows($records) as $r
    | def kind($k): $r | map(select(.[0] == $k));
    {schema: 1, tier: $tier, tree: $tree, commit: (kind("candidate")[0][2] // null),
     result: $result, valid: $valid,
     bases: (kind("base") | map(.[1])),
     scope: (kind("scope")[0][1] // null),
     owners: ((kind("scope")[0][2] // "-") | if . == "-" then [] else split(" ") end),
     fallback: (kind("fallback") | map(.[1:] | join("\t"))),
     removed: (kind("removed") | map(.[1:] | join("\t"))),
     ran: (rows($ran) | map({exit: (.[0] | tonumber),
       owners: (.[1] | if . == "-" then [] else split(" ") end), command: rest})),
     omitted: (kind("omit") | map({reason: .[1], command: rest})),
     trusted: {adapter: (kind("adapter")[0][1] // null),
       scoped: (kind("run") | map(select(.[1] != "-") | rest))}}'
}
