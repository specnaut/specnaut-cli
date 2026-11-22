# shellcheck shell=bash disable=SC2154 # me, last, out, sn and the digest: set before its call
# The approvals a yes leaves, for land-feature.sh - sourced, never run, after _hooks_off.sh and
# _verifier.sh, under the caller's `set -Eeuo pipefail`. record_approvals runs after judge_head,
# whose `out` and `sn` it reads with `last` and `instructions_digest`. Exits 12 and 13 are the
# caller's: its header says what they mean.

# After a yes that held, the approvals of the customised shipped skills it covered: the binary
# writes the whole file to a temp file, and commit_approvals commits it on top of the judged commit.
# `land` is what lands: that commit, or the judged commit itself. A binary too old for the command
# (exit 2) records nothing; the next merge asks again. A yes that moved since judge_head is exit 13.
record_approvals() {
  local rc=0 rec file
  land=$last
  { [ -n "$instructions_digest" ] && grep -q '^APPROVAL instructions holds ' <<<"$out"; } || return 0
  rec=$("$sn" record-approvals --instructions-digest "$instructions_digest" --head "$last" \
    --base-tip "$(sed -n 's/^BASE_TIP //p' <<<"$out")") || rc=$?
  case $rc in
    0) ;;
    2) echo "$me: APPROVALS NOT RECORDED - this specnaut cannot record them; the next merge asks again" >&2; return 0 ;;
    1) echo "$me: the yes no longer holds for HEAD - nothing was landed" >&2; exit 13 ;;
    *) echo "$me: the approvals could not be recorded (exit $rc) - nothing was pushed" >&2; exit 12 ;;
  esac
  file=$(sed -n 's/^APPROVALS_FILE //p' <<<"$rec")
  [ -n "$file" ] || return 0
  commit_approvals "$file"
  grep '^APPROVED ' <<<"$rec" >&2 || true
}

# The approvals file $1, committed on the judged commit into `land` with git's plumbing - no
# work-tree write, no filter, no hook - through an index of its own; $1 is removed once read.
commit_approvals() {
  local path blob tree idx
  path="$(git rev-parse --show-prefix).specnaut/approved-skills.txt"
  blob=$(git hash-object -w --no-filters -- "$1")
  rm -f "$1"
  idx=$(mktemp -d)
  GIT_INDEX_FILE=$idx/index git read-tree "$last^{tree}"
  GIT_INDEX_FILE=$idx/index git update-index --add --cacheinfo 100644 "$blob" "$path"
  tree=$(GIT_INDEX_FILE=$idx/index git write-tree)
  rm -rf "$idx"
  land=$(git commit-tree "$tree" -p "$last" -m "chore(specnaut): approve customised skill content")
  approvals_commit_is "$blob" "$path"
}

# Exit 12 unless `land` has the judged commit as its one parent and changes that one file, path $2,
# to blob $1, a regular file.
approvals_commit_is() {
  local raw m s p
  raw=$(git -c core.quotePath=false diff-tree -r --no-renames --raw --no-abbrev "$last" "$land")
  read -r _ m _ s _ <<<"${raw%%$'\t'*}"
  p=${raw#*$'\t'}
  if [ "$(git rev-list --parents -n 1 "$land")" != "$land $last" ] || [ "$m $s" != "100644 $1" ] ||
    [ "$p" != "$2" ]; then
    echo "$me: the approvals commit is not the one file on the judged commit - nothing was pushed" >&2
    exit 12
  fi
}
