# shellcheck shell=bash disable=SC2154 # here, base and the refs: set by the sourcing script
# The intake gate (cli#760): is an earlier landing still unsettled? The one
# home of that rule. Sourced, never run, by `wip-audit.sh --gate`, which has
# set `here`, NUM, first_naming and `set -euo pipefail`, and sourced
# _base_refs.sh. phases/auto-chain.md says what a caller does with its lines.
#
# A landing is unsettled while either holds:
#   (P) the local base holds commits refs/remotes/origin/<base> lacks;
#   (C) the published base tracks .specnaut/feature.json with a numeric
#       linked_issue. The last step of a closeout removes that file, on every
#       backend (phases/merge-close.md step 4), so while it is there the
#       closeout has not finished. A linked_issue of null never blocks.
#
# Output — fixed tokens, digits, 40-hex shas and one validated path, never
# text read from a commit or from the file. First every commit of (P), oldest
# first, then for the marker the first of these that matches:
#   PENDING push <sha>
#   INVALID closeout <n or ->       linked_issue neither digits nor null; a
#                                   feature_directory that is not one tracked
#                                   directory, not a link, directly under
#                                   .specnaut/specs/; no landed commit for <n>;
#                                   or, under --since <n>@<epoch>, the
#                                   directory's first commit is older than it
#   FENCED closeout <n> <dir> <sha> .specnaut/backlog-config.yml differs
#                                   between the anchor (below) and the tip
#   PARTIAL closeout <n> <dir> <sha> "delivery": "partial", a --no-close slice
#   PENDING closeout <n> <dir> <sha> the closeout has not finished
#   gate clear | gate blocked       always the last line
# <dir> is `-` when the file names no feature_directory. <sha> is the newest
# commit on the published history whose subject names #<n> (first_naming);
# when none does, the first CHILD line of `epic-status.sh --landed`, because an
# epic's subjects never name the epic (phases/epic-commits.md).
#
# --own <n> prints PENDING as `OWN closeout …` and PARTIAL as `OWN partial …`,
# so a reader still tells a partial delivery from a pending closeout.
# --fence-ack <n>, given for one run after the user's yes, reads a FENCED <n>
# as unfenced. PENDING push and INVALID are never OWN. The anchor is the
# newest --first-parent commit that deleted .specnaut/feature.json and did
# nothing but delete paths under .specnaut/ (what remove-spec.sh commits),
# else the parent of the oldest one that added it; no anchor, or a parent a
# shallow clone lacks, reads FENCED — the user's yes is the way out, never 3.
#
# Exit: 0 every line printed is OWN (`gate clear`) · 4 any other line
# (`gate blocked`) · 2 usage · 3 the base or a read could not be resolved,
# origin/<base> missing while origin exists included — nothing printed then.

gate_usage() {
  echo "usage: wip-audit.sh --gate [--own <n>]... [--since <n>@<epoch>] [--fence-ack <n>]" >&2
  exit 2
}
GATE_FJ=.specnaut/feature.json GATE_CFG=.specnaut/backlog-config.yml
GATE_DIR_RE='^\.specnaut/specs/[A-Za-z0-9][A-Za-z0-9._-]*$'

# gate_anchor_fenced — 0 when the config moved since the last settled
# closeout, or there is no anchor to compare against; 1 when it did not.
gate_anchor_fenced() {
  local c dels adds names p anchor="" s=0
  dels=$(git --no-pager log --first-parent --no-renames --diff-filter=D --format=%H "$published" -- "$GATE_FJ" 2>/dev/null) ||
    unread "the history of $GATE_FJ"
  while IFS= read -r c; do
    [[ $c =~ ^[0-9a-f]{40}$ ]] || continue
    # A parent a shallow clone lacks is no anchor; the next one may be.
    names=$(git --no-pager diff --no-renames --name-status "$c^" "$c" -- 2>/dev/null) || continue
    anchor=$c
    # Deletions only, all under .specnaut/: a commit that also edits the config
    # would hide that edit. A quoted name (core.quotePath) fails the prefix too.
    while IFS= read -r p; do [[ $p == D$'\t'.specnaut/* ]] || anchor=""; done <<<"$names"
    [ -z "$anchor" ] || break
  done <<<"$dels"
  if [ -z "$anchor" ]; then
    adds=$(git --no-pager log --first-parent --no-renames --diff-filter=A --format=%H "$published" -- "$GATE_FJ" 2>/dev/null) ||
      unread "the history of $GATE_FJ"
    c=$(printf '%s\n' "$adds" | sed -n '$p')
    [[ $c =~ ^[0-9a-f]{40}$ ]] || return 0
    anchor=$(git --no-pager rev-parse --verify --quiet "$c^1^{commit}" 2>/dev/null) || return 0
  fi
  git --no-pager diff --quiet --no-ext-diff "$anchor" "$published" -- "$GATE_CFG" 2>/dev/null || s=$?
  [ "$s" -le 1 ] || unread "$GATE_CFG"
  [ "$s" -eq 1 ]
}

# gate_marker — sets MARKER to the line for the published marker, or "".
gate_marker() {
  local entry json n dir="-" since=0 sha="" first rec
  MARKER=""
  entry=$(GIT_LITERAL_PATHSPECS=1 git --no-pager ls-tree "$published" -- "$GATE_FJ" 2>/dev/null) || unread "$GATE_FJ"
  [ -n "$entry" ] || return 0
  [[ $entry =~ ^100(644|755)\ blob\ ([0-9a-f]{40}) ]] || { MARKER="INVALID closeout -"; return 0; }
  json=$(git --no-pager cat-file blob "${BASH_REMATCH[2]}" 2>/dev/null) || unread "$GATE_FJ"
  n=$(printf '%s\n' "$json" |
    sed -n 's/.*"linked_issue"[[:space:]]*:[[:space:]]*\([^,}[:space:]]*\).*/\1/p' | sed -n 1p)
  [ "$n" != null ] || return 0
  [[ $n =~ $NUM ]] || { MARKER="INVALID closeout -"; return 0; }
  if [[ $GATE_SINCE == *" $n@"* ]]; then
    since=${GATE_SINCE##*" $n@"}
    since=${since%% *}
  fi
  if [[ $json == *'"feature_directory"'* ]]; then
    dir=$(printf '%s\n' "$json" |
      sed -n 's/.*"feature_directory"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n 1p)
    dir=${dir%/}
    [[ $dir =~ $GATE_DIR_RE ]] || { MARKER="INVALID closeout $n"; return 0; }
    entry=$(GIT_LITERAL_PATHSPECS=1 git --no-pager ls-tree "$published" -- "$dir" 2>/dev/null) || unread "$dir"
    [ "$entry" = "040000 tree ${entry:12:40}"$'\t'"$dir" ] && [[ ${entry:12:40} =~ ^[0-9a-f]{40}$ ]] ||
      { MARKER="INVALID closeout $n"; return 0; }
    if [ "$since" != 0 ]; then
      first=$(GIT_LITERAL_PATHSPECS=1 git --no-pager log --reverse --format=%ct "$published" -- "$dir" 2>/dev/null) ||
        unread "$dir"
      first=$(printf '%s\n' "$first" | sed -n 1p)
      [[ $first =~ ^[0-9]+$ ]] && [ "$first" -ge "$since" ] || { MARKER="INVALID closeout $n"; return 0; }
    fi
  fi
  rec=$(git --no-pager log --format='%H%x1f%ct%x1f%s' "$published" -- 2>/dev/null) || unread "$published"
  if ! sha=$(first_naming "$n" "$since" "$rec"); then
    rec=$(bash "$here/epic-status.sh" --landed "$n@$since" 2>/dev/null) || unread "the epic's landed children"
    sha=$(printf '%s\n' "$rec" | sed -n '1s/^CHILD T[0-9][0-9]* #[1-9][0-9]* \([0-9a-f]\{40\}\)$/\1/p')
  fi
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { MARKER="INVALID closeout $n"; return 0; }
  if [[ $GATE_ACK != *" $n "* ]] && gate_anchor_fenced; then
    MARKER="FENCED closeout $n $dir $sha"
  elif [[ $json =~ \"delivery\"[[:space:]]*:[[:space:]]*\"partial\" ]]; then
    MARKER="PARTIAL closeout $n $dir $sha"
    [[ $GATE_OWN != *" $n "* ]] || MARKER="OWN partial $n $dir $sha"
  else
    MARKER="PENDING closeout $n $dir $sha"
    [[ $GATE_OWN != *" $n "* ]] || MARKER="OWN closeout $n $dir $sha"
  fi
}

intake_gate() {
  GATE_OWN=" " GATE_SINCE=" " GATE_ACK=" "
  while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || gate_usage
    case $1 in
      --own) [[ $2 =~ $NUM ]] || gate_usage; GATE_OWN+="$2 " ;;
      --fence-ack) [[ $2 =~ $NUM ]] || gate_usage; GATE_ACK+="$2 " ;;
      --since) [[ $2 =~ ^([1-9][0-9]{0,9})@([0-9]{1,12})$ ]] || gate_usage; GATE_SINCE+="$2 " ;;
      *) gate_usage ;;
    esac
    shift 2
  done
  resolve_base_refs
  local s=0 pushes="" c out=() blocked=0 top
  # Every path below is the repository's, whatever directory the caller is in.
  top=$(git --no-pager rev-parse --show-toplevel 2>/dev/null) || unread "the repository's top"
  cd "$top" || unread "the repository's top"
  if [ -z "$remote" ]; then
    git --no-pager config --get remote.origin.url >/dev/null 2>&1 || s=$?
    [ "$s" -le 1 ] || unread "the origin remote"
    if [ "$s" -eq 0 ]; then
      echo "wip-audit: origin has no $base branch - publish it first: git push -u origin $base" >&2
      exit 3
    fi
  elif [ -n "$local" ]; then
    pushes=$(git --no-pager rev-list --reverse "$local" --not "$remote" -- 2>/dev/null) || unread "$local"
  fi
  while IFS= read -r c; do
    [ -z "$c" ] || { [[ $c =~ ^[0-9a-f]{40}$ ]] || unread "$local"; out+=("PENDING push $c"); }
  done <<<"$pushes"
  gate_marker
  [ -z "$MARKER" ] || out+=("$MARKER")
  for c in ${out[@]+"${out[@]}"}; do
    printf '%s\n' "$c"
    [[ $c == "OWN "* ]] || blocked=1
  done
  if [ "$blocked" -eq 0 ]; then echo "gate clear"; exit 0; fi
  echo "gate blocked"
  exit 4
}
