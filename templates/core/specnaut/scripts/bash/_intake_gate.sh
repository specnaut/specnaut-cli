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
# Output - fixed tokens, digits, 40-hex shas and one validated path, never
# text read from a commit or from the file. First every commit of (P), oldest
# first, then for the marker the first of these that matches:
#   PENDING push <sha>
#   INVALID closeout <n|-> <fence>  linked_issue neither digits nor null; a
#                                   feature_directory not one tracked directory,
#                                   not a link, directly under .specnaut/specs/;
#                                   no landed commit for <n>; or, under --since
#                                   <n>@<epoch>, a directory older than it.
#                                   <fence>: `fenced` or `unfenced`, the FENCED
#                                   test below, --fence-ack aside
#   FENCED closeout <n> <dir> <sha> .specnaut/backlog-config.yml differs
#                                   between the anchor (below) and the tip
#   PARTIAL closeout <n> <dir> <sha> "delivery": "partial", a --no-close slice
#   PENDING closeout <n> <dir> <sha> the closeout has not finished
#   gate clear | gate blocked       always the last line
# <dir> is `-` when the file names no feature_directory. <sha> is the newest
# published commit that landed <n>: for an epic, whose subjects never name it
# (phases/epic-commits.md), the last CHILD of `epic-status.sh --landed`, asked
# first; otherwise the newest whose subject names #<n> (first_naming).
#
# --own <n> prints PENDING as `OWN closeout ...` and PARTIAL as `OWN partial ...`,
# so a reader still tells a partial delivery from a pending closeout.
# --fence-ack <n>, given for one run after the user's yes, reads a FENCED <n>
# as unfenced. PENDING push and INVALID are never OWN. The anchor is the
# newest --first-parent commit that deleted .specnaut/feature.json and did
# nothing but delete paths under .specnaut/ (what remove-spec.sh commits),
# else the parent of the oldest one that added it; no anchor, or a parent a
# shallow clone lacks, reads FENCED - the user's yes is the way out, never 3.
#
# Exit: 0 every line printed is OWN (`gate clear`) - 4 any other line
# (`gate blocked`) - 2 usage - 3 the base or a read could not be resolved,
# origin/<base> missing while origin exists included - nothing printed then.

gate_usage() { echo "usage: wip-audit.sh --gate [--own <n>]... [--since <n>@<epoch>] [--fence-ack <n>]" >&2; exit 2; }
GATE_FJ=.specnaut/feature.json GATE_CFG=.specnaut/backlog-config.yml
GATE_DIR_RE='^\.specnaut/specs/[A-Za-z0-9][A-Za-z0-9._-]*$'

# gate_removal_anchor - ANCHOR, the newest --first-parent commit that deleted
# the marker and did nothing but delete paths under .specnaut/, or "".
gate_removal_anchor() {
  local c dels names p
  ANCHOR=""
  dels=$(git --no-pager log --first-parent --no-renames --diff-filter=D --format=%H "$published" -- "$GATE_FJ" 2>/dev/null) ||
    unread "the history of $GATE_FJ"
  while IFS= read -r c; do
    [[ $c =~ ^[0-9a-f]{40}$ ]] || continue
    # A parent a shallow clone lacks is no anchor; the next one may be.
    names=$(git --no-pager diff --no-renames --name-status "$c^" "$c" -- 2>/dev/null) || continue
    ANCHOR=$c
    # Deletions only, all under .specnaut/: a commit that also edits the config
    # would hide that edit. A quoted name (core.quotePath) fails the prefix too.
    while IFS= read -r p; do [[ $p == D$'\t'.specnaut/* ]] || ANCHOR=""; done <<<"$names"
    [ -z "$ANCHOR" ] || return 0
  done <<<"$dels"
}

# gate_anchor_fenced - 0 when the config moved since the last settled
# closeout, or there is no anchor to compare against; 1 when it did not.
gate_anchor_fenced() {
  local adds c s=0
  gate_removal_anchor
  if [ -z "$ANCHOR" ]; then
    adds=$(git --no-pager log --first-parent --no-renames --diff-filter=A --format=%H "$published" -- "$GATE_FJ" 2>/dev/null) ||
      unread "the history of $GATE_FJ"
    c=$(printf '%s\n' "$adds" | sed -n '$p')
    [[ $c =~ ^[0-9a-f]{40}$ ]] || return 0
    ANCHOR=$(git --no-pager rev-parse --verify --quiet "$c^1^{commit}" 2>/dev/null) || return 0
  fi
  git --no-pager diff --quiet --no-ext-diff "$ANCHOR" "$published" -- "$GATE_CFG" 2>/dev/null || s=$?
  [ "$s" -le 1 ] || unread "$GATE_CFG"
  [ "$s" -eq 1 ]
}

# gate_invalid <n|-> - MARKER, the INVALID line; its fence asks before a hand fix.
gate_invalid() { MARKER="INVALID closeout $1 unfenced"; ! gate_anchor_fenced || MARKER="INVALID closeout $1 fenced"; }

# gate_read_marker - GATE_JSON, GATE_N and GATE_FROM (its --since epoch) from the
# published marker; 1 when there is none, its link is null, or MARKER is INVALID.
gate_read_marker() {
  local entry
  entry=$(GIT_LITERAL_PATHSPECS=1 git --no-pager ls-tree "$published" -- "$GATE_FJ" 2>/dev/null) || unread "$GATE_FJ"
  [ -n "$entry" ] || return 1
  [[ $entry =~ ^100(644|755)\ blob\ ([0-9a-f]{40}) ]] || { gate_invalid -; return 1; }
  GATE_JSON=$(git --no-pager cat-file blob "${BASH_REMATCH[2]}" 2>/dev/null) || unread "$GATE_FJ"
  GATE_N=$(printf '%s\n' "$GATE_JSON" |
    sed -n 's/.*"linked_issue"[[:space:]]*:[[:space:]]*\([^,}[:space:]]*\).*/\1/p' | sed -n 1p)
  [ "$GATE_N" != null ] || return 1
  [[ $GATE_N =~ $NUM ]] || { gate_invalid -; return 1; }
  [[ $GATE_SINCE == *" $GATE_N@"* ]] || return 0
  GATE_FROM=${GATE_SINCE##*" $GATE_N@"} && GATE_FROM=${GATE_FROM%% *}
}

# gate_check_dir - GATE_DIR, the marker's feature_directory when it names one;
# 1, MARKER INVALID, when it is not one per the header, or is older than --since.
gate_check_dir() {
  local entry first
  [[ $GATE_JSON == *'"feature_directory"'* ]] || return 0
  GATE_DIR=$(printf '%s\n' "$GATE_JSON" |
    sed -n 's/.*"feature_directory"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n 1p)
  GATE_DIR=${GATE_DIR%/}
  [[ $GATE_DIR =~ $GATE_DIR_RE ]] || { gate_invalid "$GATE_N"; return 1; }
  entry=$(GIT_LITERAL_PATHSPECS=1 git --no-pager ls-tree "$published" -- "$GATE_DIR" 2>/dev/null) || unread "$GATE_DIR"
  [ "$entry" = "040000 tree ${entry:12:40}"$'\t'"$GATE_DIR" ] && [[ ${entry:12:40} =~ ^[0-9a-f]{40}$ ]] ||
    { gate_invalid "$GATE_N"; return 1; }
  [ "$GATE_FROM" != 0 ] || return 0
  first=$(GIT_LITERAL_PATHSPECS=1 git --no-pager log --reverse --format=%ct "$published" -- "$GATE_DIR" 2>/dev/null) ||
    unread "$GATE_DIR"
  first=$(printf '%s\n' "$first" | sed -n 1p)
  [[ $first =~ ^[0-9]+$ ]] && [ "$first" -ge "$GATE_FROM" ] || { gate_invalid "$GATE_N"; return 1; }
}

# gate_landed_sha - GATE_SHA, the header's <sha>; 1, MARKER INVALID, when none. Its
# grep runs in git, so an epic never pays first_naming's walk of the whole history.
gate_landed_sha() {
  local rec
  rec=$(bash "$here/epic-status.sh" --landed "$GATE_N@$GATE_FROM" 2>/dev/null) || unread "the epic's landed children"
  GATE_SHA=$(printf '%s\n' "$rec" | sed -n '$s/^CHILD T[0-9][0-9]* #[1-9][0-9]* \([0-9a-f]\{40\}\)$/\1/p')
  if [ -z "$GATE_SHA" ]; then
    rec=$(git --no-pager log --format='%H%x1f%ct%x1f%s' "$published" -- 2>/dev/null) || unread "$published"
    GATE_SHA=$(first_naming "$GATE_N" "$GATE_FROM" "$rec") || GATE_SHA=""
  fi
  [[ $GATE_SHA =~ ^[0-9a-f]{40}$ ]] || { gate_invalid "$GATE_N"; return 1; }
}

# gate_marker - MARKER, the line for the published marker, or "".
gate_marker() {
  MARKER="" GATE_DIR="-" GATE_FROM=0
  gate_read_marker && gate_check_dir && gate_landed_sha || return 0
  local tail="$GATE_N $GATE_DIR $GATE_SHA"
  if [[ $GATE_ACK != *" $GATE_N "* ]] && gate_anchor_fenced; then
    MARKER="FENCED closeout $tail"
  elif [[ $GATE_JSON =~ \"delivery\"[[:space:]]*:[[:space:]]*\"partial\" ]]; then
    MARKER="PARTIAL closeout $tail"
    [[ $GATE_OWN != *" $GATE_N "* ]] || MARKER="OWN partial $tail"
  else
    MARKER="PENDING closeout $tail"
    [[ $GATE_OWN != *" $GATE_N "* ]] || MARKER="OWN closeout $tail"
  fi
}

# gate_args - the gate's flags into GATE_OWN, GATE_SINCE and GATE_ACK, else usage.
gate_args() {
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
}

# gate_pushes - GATE_OUT gains a PENDING push line per commit of (P), oldest first.
gate_pushes() {
  local s=0 pushes="" c
  if [ -z "$remote" ]; then
    git --no-pager config --get remote.origin.url >/dev/null 2>&1 || s=$?
    [ "$s" -le 1 ] || unread "the origin remote"
    [ "$s" -ne 0 ] || { echo "wip-audit: origin has no $base branch - publish it first: git push -u origin $base" >&2; exit 3; }
  elif [ -n "$local" ]; then
    pushes=$(git --no-pager rev-list --reverse "$local" --not "$remote" -- 2>/dev/null) || unread "$local"
  fi
  while IFS= read -r c; do
    [ -z "$c" ] || { [[ $c =~ ^[0-9a-f]{40}$ ]] || unread "$local"; GATE_OUT+=("PENDING push $c"); }
  done <<<"$pushes"
}

intake_gate() {
  local c blocked=0
  gate_args "$@"
  resolve_base_refs
  GATE_OUT=()
  gate_pushes
  gate_marker
  [ -z "$MARKER" ] || GATE_OUT+=("$MARKER")
  for c in ${GATE_OUT[@]+"${GATE_OUT[@]}"}; do
    printf '%s\n' "$c"
    [[ $c == "OWN "* ]] || blocked=1
  done
  if [ "$blocked" -eq 0 ]; then echo "gate clear"; exit 0; fi
  echo "gate blocked"
  exit 4
}
