# shellcheck shell=bash disable=SC2154 # me, last, out, sn, base_tip, the digest: set before its call
# The approvals a yes leaves, for land-feature.sh - sourced, never run, after _hooks_off.sh and
# _verifier.sh, under the caller's `set -Eeuo pipefail`. record_approvals runs after judge_head,
# whose `out`, `sn` and `base_tip` it reads with `last` and `instructions_digest`. Exits 12 and 13
# are the caller's: its header says what they mean. It sets no trap: the caller installs
# approvals_cleanup as its EXIT trap.

# After a yes that held, the approvals of the customised shipped skills it covered: the binary
# writes the whole file to a temp file, and commit_approvals commits it on top of the judged commit.
# `land` is what lands: that commit, or the judged commit itself. The temp file and the index folder
# are removed by approvals_cleanup, which the sourcing script installs as its EXIT trap (cli#828):
# the process's trap is the caller's, and an ERR trap's exit 12 runs it too.
record_approvals() {
  local rc=0 rec
  land=$last
  { [ -n "$instructions_digest" ] && grep -q '^APPROVAL instructions holds ' <<<"$out"; } || return 0
  approvals_tmp="" approvals_idx=""
  rec=$("$sn" record-approvals --instructions-digest "$instructions_digest" --head "$last" \
    --base-tip "$base_tip") || rc=$?
  [ "$rc" = 0 ] || { not_recorded "$rc"; return 0; }
  approvals_tmp=$(sed -n 's/^APPROVALS_FILE //p' <<<"$rec")
  [ -n "$approvals_tmp" ] || return 0
  commit_approvals
  grep '^APPROVED ' <<<"$rec" >&2 || true
}

# What the binary's exit $1 means when it recorded nothing. A binary too old for the command (an
# unknown command, exit 2) records nothing, and the next merge asks again: return. A binary that
# knows it answers exit 2 only when it refuses its arguments, a defect of this call: exit 12. A yes
# that moved since judge_head is exit 13.
not_recorded() {
  case $1 in
    1) echo "$me: the yes no longer holds for HEAD - nothing was landed" >&2; exit 13 ;;
    2) if ! knows_record_approvals; then
         echo "$me: APPROVALS NOT RECORDED - this specnaut cannot record them; the next merge asks again" >&2
         return 0
       fi
       echo "$me: specnaut refused the arguments of record-approvals (exit 2) - nothing was pushed" >&2; exit 12 ;;
    *) echo "$me: the approvals could not be recorded (exit $1) - nothing was pushed" >&2; exit 12 ;;
  esac
}

# Whether the binary knows `record-approvals`: its help names every command it has. Both an older
# binary's unknown command and the parser's refusal exit 2, so the exit alone cannot tell them apart.
knows_record_approvals() {
  local help
  help=$("$sn" --help 2>/dev/null) || return 1
  grep -qF 'specnaut record-approvals ' <<<"$help"
}

# The approvals file `approvals_tmp`, committed on the judged commit into `land` with git's
# plumbing - no work-tree write, no filter, no hook - through an index of its own.
commit_approvals() {
  local path blob tree
  path="$(git rev-parse --show-prefix).specnaut/approved-skills.txt"
  blob=$(git hash-object -w --no-filters -- "$approvals_tmp")
  approvals_idx=$(mktemp -d)
  GIT_INDEX_FILE=$approvals_idx/index git read-tree "$last^{tree}"
  GIT_INDEX_FILE=$approvals_idx/index git update-index --add --cacheinfo 100644 "$blob" "$path"
  tree=$(GIT_INDEX_FILE=$approvals_idx/index git write-tree)
  approvals_cleanup
  land=$(git commit-tree "$tree" -p "$last" -m "chore(specnaut): approve customised skill content")
  approvals_commit_is "$blob" "$path"
}

# Removes the temp file and the index folder, when there are: on the way, and as the caller's EXIT
# trap.
approvals_cleanup() {
  [ -z "${approvals_tmp:-}" ] || rm -f -- "$approvals_tmp"
  [ -z "${approvals_idx:-}" ] || rm -rf -- "$approvals_idx"
  approvals_tmp="" approvals_idx=""
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
