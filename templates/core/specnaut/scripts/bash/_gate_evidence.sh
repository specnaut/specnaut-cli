# shellcheck shell=bash
# shellcheck disable=SC2016  # the $ in these strings belongs to jq
# Sourced by run-gate.sh, and the one writer of gate evidence: what ran on which tree,
# what was omitted and why, and what was taken on trust. It is write-only. Nothing
# reads it to decide anything: a stale file must never be able to skip a check, and
# a pass is only ever what this run saw. Requires gate_git, jq_lf and the head state
# _gate_candidate.sh holds.

# gate_evidence_write <tier> <tree> <records> <ran> <result> <valid> [<folder>] - writes
# the file atomically and prints its path, or prints `unwritten (<cause>)`. Always
# returns 0: failing to record a result does not change the result.
#
# The file goes under <folder> when one is given, else inside the repository's git
# directory. Given a head (_explicit_head.sh) a folder is required: absolute, already
# there, and outside the folder that holds the head's repository. The evidence of a
# commit read by id is the caller's own, never written beside the commit it speaks for.
gate_evidence_write() {
  local path dir tmp
  command -v jq >/dev/null 2>&1 || { echo "unwritten (jq-absent)"; return 0; }
  path="$(gate_evidence_path "$1" "$2" "${7:-}")" || { echo "$path"; return 0; }
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

# gate_evidence_path <tier> <tree> <folder or ""> - prints where the file goes, or prints
# `unwritten (<cause>)` and returns 1.
gate_evidence_path() {
  local path name="specnaut/gate-evidence/$1-$2.json"
  if [ -n "$3" ]; then
    case "$3" in /* | [A-Za-z]:[/\\]*) ;; *) echo "unwritten (evidence-folder-relative)"; return 1 ;; esac
    if [ -n "$EXPLICIT_HEAD" ]; then
      [ -d "$3" ] || { echo "unwritten (evidence-folder-missing)"; return 1; }
      gate_evidence_apart "$3" || { echo "unwritten (evidence-beside-the-head)"; return 1; }
    fi
    echo "$3/$name"
  elif [ -n "$EXPLICIT_HEAD" ]; then
    echo "unwritten (no-evidence-folder)"
    return 1
  else
    path="$(gate_git rev-parse --git-path "$name" 2>/dev/null)" || { echo "unwritten (no-git-path)"; return 1; }
    case "$path" in /*|[A-Za-z]:*) ;; *) path="$REPO_ROOT/$path" ;; esac
    echo "$path"
  fi
}

# gate_evidence_apart <dir> - false when <dir> lies inside the folder holding the head's
# repository (two levels above its objects folder). <dir> and each folder above it are
# compared with that folder by identity (`-ef`), never by spelling: a file system that
# folds case, or a short 8.3 name, gives one folder several spellings.
gate_evidence_apart() {
  local dir theirs
  [ -n "$EXPLICIT_OBJECTS" ] || return 0
  theirs="$EXPLICIT_OBJECTS/../.."
  [ -d "$theirs" ] && dir="$(cd -P -- "$1" && pwd)" || return 1
  while ! [ "$dir" -ef "$theirs" ]; do
    [ "$dir" != "$(dirname -- "$dir")" ] || return 0
    dir="$(dirname -- "$dir")"
  done
  return 1
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
