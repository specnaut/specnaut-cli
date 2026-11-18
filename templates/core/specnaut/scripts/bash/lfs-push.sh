#!/usr/bin/env bash
# Pushes to origin the git-lfs objects <commit> brings, before the merge phase pushes the commits
# themselves (cli#799). git-lfs uploads them from its pre-push hook, and no hook runs in that phase
# (phases/merge.md § Steps), so a push alone leaves origin serving pointers no other clone can
# fetch. land-feature.sh runs it before the landing's push, merge.md step 2 before the `--pr` push.
# The closeout's push needs none: remove-spec.sh commits deletions only.
#
# In order: <commit> is HEAD on a clean tree. A file in it, or one a commit of
# merge-base(origin/<base>, <commit>)..<commit> touched, that git's own attribute resolution marks
# `filter=lfs` - with none it prints `LFS none` and calls no `git lfs`. git-lfs answers, at 2.13.3
# or later; absent, with no lfs filter configured here no pointer was made here (`LFS skipped`).
# The branch leaves `.lfsconfig` as the base has it. Then `git lfs push origin <commit>`, an
# incomplete push refused whatever the config says. It pushes what the hook would have: the objects
# of commits no ref of origin's holds. Not `--all`: a clone lacking an old object origin already
# holds fails that push, so every landing would stop.
#
# Prints `LFS none`, `LFS skipped ...` or `LFS pushed <commit>`.
#
# Exit:
#   0  pushed, or nothing to push
#   2  usage, or <commit> is not HEAD on a clean tree
#   3  the base is unknown
#   12 an unexpected git failure, named on stderr
#   13 the PATH holds an entry _verifier.sh refuses, or no repository holds the working folder
#      (VERIFIER REFUSED)
#   17 the objects could not be pushed, so the commits must not be: LFS UNAVAILABLE, LFS TOO OLD,
#      LFS CONFIG CHANGED or LFS PUSH FAILED, named on stderr
#
# Usage: lfs-push.sh [<commit sha>]
set -Eeuo pipefail
export GIT_OPTIONAL_LOCKS=0
here=${BASH_SOURCE[0]}
# Git Bash runs a script by its Windows path too (C:\...\bash\<name>.sh): cut at the last `/` or `\`.
case $here in *[/\\]*) here=${here%[/\\]*} ;; *) here=. ;; esac
here=$(CDPATH="" cd "${here:-/}" && pwd)
# land-feature.sh's prologue, for its reason: the branch can commit hooks and a hooksPath naming
# them. An unexpected failure is exit 12.
# shellcheck source=./_hooks_off.sh
. "$here/_hooks_off.sh" lfs-push
# shellcheck source=./_verifier.sh
. "$here/_verifier.sh"
# git-lfs and git are looked up on it.
refuse_unsafe_path pushed

refuse() {
  echo "lfs-push: $1 - $2. Nothing was pushed" >&2
  exit 17
}

# How many paths git marks `filter=lfs`: every file of HEAD's index, and every one a commit of the
# range touched - one added and removed inside it still has an object nobody pushed. Its rules are
# git's own (nested .gitattributes, info/attributes, core.attributesFile), as HEAD has them: a range
# that touches a .gitattributes at any depth may have marked a file it no longer marks, so it counts
# as LFS. awk reads to the end, never `grep -q`: a reader that closes the pipe early fails it under
# pipefail, which reads as none.
lfs_paths() {
  local touched
  touched=$(git log --format= --name-only --no-renames ${mb:+"$mb.."}"$c")
  if awk '/(^|\/)\.gitattributes"?$/ { f = 1 } END { exit !f }' <<<"$touched"; then
    echo 1
    return 0
  fi
  { git ls-files; printf '%s\n' "$touched"; } |
    git check-attr --cached --stdin filter | awk '/: filter: lfs$/ { n++ } END { print n + 0 }'
}

# git-lfs answers, at 2.13.3 or later: older, on Windows it runs a git found in the working folder,
# the branch's (CVE-2020-27955, CVE-2021-21237). Returns 1 when it does not answer.
lfs_ready() {
  local v
  v=$(git lfs version 2>/dev/null) || return 1
  if [[ $v =~ git-lfs/([0-9]+)\.([0-9]+)\.([0-9]+) ]] &&
    ((10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]} >= 2013003)); then
    return 0
  fi
  refuse "LFS TOO OLD" "git-lfs is older than 2.13.3, or its version is unreadable - upgrade it"
}

# The branch's .lfsconfig is git-lfs's input on this push and nobody's yes: it can send the upload,
# and the credentials with it, elsewhere (lfs.url, lfs.pushurl), or allow an incomplete push. Judged
# as git-lfs reads it: a working-tree one git does not track, or one tracked as anything but a
# regular file, is changed; else its tree entries at the merge-base and at <commit>, empty where it
# is absent. No merge-base, nothing to compare: changed. Sets `changed`; run as a plain statement,
# so a git failure is the ERR trap's 12, never an absent file.
judge_lfsconfig() {
  local now was
  changed=1
  if [ -e .lfsconfig ] || [ -L .lfsconfig ]; then
    git ls-files --error-unmatch -- .lfsconfig >/dev/null 2>&1 || return 0
  fi
  now=$(git ls-tree "$c" -- .lfsconfig)
  case $now in "" | "100644 blob "*) ;; *) return 0 ;; esac
  [ -n "$mb" ] || return 0
  was=$(git ls-tree "$mb" -- .lfsconfig)
  [ "$was" != "$now" ] || changed=0
}

# stdin with every credential a URL carries redacted: its userinfo, and the value of the query
# parameters X-Amz-Signature, X-Amz-Security-Token, sig, token and access_token, the name kept.
# In any case, so each letter is spelled in both: macOS's sed has no case-insensitive flag.
redact_urls() {
  local token='[Tt][Oo][Kk][Ee][Nn]' sig='[Ss][Ii][Gg]' q
  q="[Xx]-[Aa][Mm][Zz]-(${sig}[Nn][Aa][Tt][Uu][Rr][Ee]|[Ss][Ee][Cc][Uu][Rr][Ii][Tt][Yy]-$token)"
  q="$q|$sig|([Aa][Cc][Cc][Ee][Ss][Ss]_)?$token"
  sed -E -e 's#(://)[^/@[:space:]]+@#\1<redacted>@#g' -e "s#([?&]($q)=)[^&[:space:]]+#\\1<redacted>#g"
}

# The upload, an incomplete push refused: a `-c` outranks every file git-lfs reads its config from.
# Its output is printed redacted.
push_objects() {
  local out
  if ! out=$(GIT_TERMINAL_PROMPT=0 git -c lfs.allowincompletepush=false lfs push origin "$c" 2>&1); then
    printf '%s\n' "$out" | redact_urls >&2
    refuse "LFS PUSH FAILED" "git lfs push origin ${c:0:12} failed"
  fi
}

if [ $# -gt 1 ] || { [ $# -eq 1 ] && ! [[ $1 =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]]; }; then
  echo "usage: lfs-push.sh [<commit sha>]" >&2
  exit 2
fi
c=$(git rev-parse HEAD)
dirty=$(git status --porcelain)
if [ "${1:-$c}" != "$c" ] || [ -n "$dirty" ]; then
  echo "lfs-push: ${1:-HEAD} must be HEAD, on a clean tree - nothing was pushed" >&2
  exit 2
fi
cd "$(git rev-parse --show-toplevel)"
base=$(bash "$here/base-branch.sh") || exit 3
mb=$(git merge-base "refs/remotes/origin/$base" "$c" 2>/dev/null) || mb=""
n=$(lfs_paths)
if [ "$n" -eq 0 ]; then
  echo "LFS none"
  exit 0
fi
if ! lfs_ready; then
  if git config --get filter.lfs.process >/dev/null || git config --get filter.lfs.clean >/dev/null; then
    refuse "LFS UNAVAILABLE" "git-lfs does not answer, yet an lfs filter is configured here: this clone made pointers whose objects only it holds"
  fi
  echo "LFS skipped - git-lfs is not installed and no lfs filter is configured, so no pointer was made here"
  exit 0
fi
judge_lfsconfig
[ "$changed" = 0 ] ||
  refuse "LFS CONFIG CHANGED" "this branch changes .lfsconfig, or holds one git does not track as a regular file; it decides where the objects and the credentials go. Compare: git diff ${mb:-<merge-base>} ${c:0:12} -- .lfsconfig"
push_objects
echo "LFS pushed ${c:0:12}"
