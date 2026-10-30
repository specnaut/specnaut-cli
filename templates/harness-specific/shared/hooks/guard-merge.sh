#!/usr/bin/env bash
# PreToolUse(Bash) — under `merge: manual`, nothing lands on the base branch
# without the user (spec 036: FR-001, FR-016, FR-017, D3). The one home of
# "does this command land on the base branch" (plan § 5).
#
# Inert unless `.specnaut/scripts/bash/merge-mode.sh --strict` prints `manual`
# (a missing or failing reader counts as manual). Then, gated:
#   git merge, git pull  unless HEAD is a branch other than the base, and the
#                        command neither switches branch nor leaves the repo
#   git push             unless every refspec is explicit and none lands on
#                        the base — an allow list (§ 11 F6): no refspec, HEAD
#                        on the base, :dst deletes, globs, a refspec the
#                        shell would expand ($VAR, `…`, quotes, ?, [, {),
#                        --all, --mirror, --delete and unknown options are
#                        all gated
#   a git subcommand it cannot read (_git.sh: a shell alias, `git $(…)`,
#                        `git "$X"`), a line it cannot read
#   every command in merge-commands.txt — the scripts that land on the base
#                        themselves (land-feature.sh, remove-spec.sh), matched
#                        by basename however they are reached, and gh pr
#                        merge, glab mr merge (_listed.sh)
#   a line that sets or clears what the landing hold below reads — the
#                        session id, XDG_STATE_HOME, env -i (CMD_SCRUB)
# A `cd` can only tighten this (cli#710): the mode is read for the session's
# project AND for each folder a cd on the line names, and the line is inert
# only if every one reads `auto`. A target's mode is read by this project's
# own reader (`merge-mode.sh --project`), never by a script under the target.
# The base is always the session's: the name base-branch.sh prints now AND
# every name the user's prompts found it to be (_baseline.sh, cli#718) — a
# repointed origin/HEAD adds a base, never removes one. Each is also read by
# merge-mode (`--base`). And a turn whose prompt found the session's project
# on manual stays manual (_baseline.sh): the copies merge-mode reads sit on
# refs the model can move. An unknown base gates every form.
# Every gated reason goes through one arm,
# approval_require (spec 048 § 8): denied unless this turn's prompt approved
# `merge`, in Claude's ask modes too — a click on a permission prompt is not
# the user's word — and, with that approval, Claude's own prompt once where it
# can ask (FR-017). One arm, so a denied model has no laxer spelling to try.
#
# The limit: it reads the command line, not what a program does — what it
# reads is what cmd_git and _command.sh read, and what they cannot read with
# certainty is gated (CMD_OPAQUE). Past the parser, land-feature.sh and
# remove-spec.sh hold themselves: they run merge-hold.sh, which under manual
# exits 13 without the same approval (read by merge-approved.sh), whatever
# the spelling that reached them. A hand-written script that lands by itself,
# or a merge through `gh api`, gets past both.
#
# What it is for: an agent that lands by mistake, or by a spelling it did not
# think of as landing. Not an agent set on getting round it — one with a
# shell can rewrite what the hold reads (the reader scripts, the state store
# under XDG_STATE_HOME, refs). That is the forge's job: branch protection.
# Bypasses that need a deliberate rewrite are out of scope (cli#720, cli#721).
#
# Usage: guard-merge.sh <claude|codex>   (payload on stdin)
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing — refusing" >&2; exit 2; }
# shellcheck source=_command.sh
. "$HOOK_DIR/_command.sh"
# shellcheck source=_git.sh
. "$HOOK_DIR/_git.sh" # and _listed.sh
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
# shellcheck source=_baseline.sh
. "$HOOK_DIR/_baseline.sh"
guard_init guard-merge "${1:-}" argv:.tool_input.command
[ "$P_TOOL" = Bash ] || guard_fail "expected a Bash tool call, got '$P_TOOL'"
[ -n "${GF[0]}" ] || guard_fail "a Bash call without tool_input.command"

cmd_parse "${GF[0]}"

# The folders a cd on the line names (cli#710), wherever the cd sits — in a
# subshell, a substitution, a `-c` string, behind a wrapper: each is judged
# beside the session's project, never instead of it, so no reading of where
# a cd takes effect can loosen the hold. `?` for one this cannot name.
CD_DIR="" CD_DIRS=()

# cd_step <cd|pushd|popd> <args…> — CD_DIR: the folder after it, carried as
# the shell carries it: logical, as cd is by default, physical after -P. `?`
# when that is not certain: a non-literal word ($X, a substitution, ~, a glob),
# `-`, no operand or two, an option other than -L/-P, popd, a pushd option, a
# relative name CDPATH may redirect, a folder that does not exist. A step
# from `?` needs no case: the `?` already holds the line.
cd_step() {
  local a t="" n=0 p="" from=${CD_DIR:-$GUARD_CWD}
  CD_DIR='?'
  for a in "${@:2}"; do
    case $1:$a in popd:*) n=9 ;; *:--) ;; cd:-L) p="" ;; cd:-P) p=-P ;; *:-* | *:+*) n=9 ;; *) t=$a n=$((n + 1)) ;; esac
  done
  if [ "$n" = 1 ] && [[ $t =~ ^[A-Za-z0-9._/@+,-]+$ ]]; then
    case $t in /* | . | .. | ./* | ../*) ;; *) if [ -n "${CDPATH:-}" ] || [[ ${GF[0]} == *CDPATH* ]]; then t=""; fi ;; esac
    if [ -n "$t" ] && a=$(cd -- "$from" 2>/dev/null && CDPATH='' cd ${p:+"$p"} -- "$t" 2>/dev/null && pwd); then CD_DIR=$a; fi
  fi
  CD_DIRS+=("$CD_DIR")
}

reasons=() pushes=() merges=0 switched=0
for seg in ${CMD_SEGS[@]+"${CMD_SEGS[@]}"}; do
  cmd_words "$seg"
  case ${W[0]:-} in
    '') continue ;; # an empty word as the command runs nothing
    cd | pushd | popd) cd_step "${W[@]}"; continue ;;
    git)
      cmd_git "${W[@]}"
      case $GIT_SUB in
        merge | pull) merges=1 ;;
        push) pushes+=("$(IFS=$CMD_SEP; echo "${GIT_ARGS[*]:-}")") ;;
        checkout | switch) switched=1 ;;
        '!') reasons+=("$GIT_WHY") ;;
      esac
      continue ;;
  esac
  cmd_pos
  listed "$HOOK_DIR/merge-commands.txt"
  if [ -n "$HIT" ]; then reasons+=("$HIT"); fi
done
if [ "$CMD_OPAQUE" = 1 ]; then reasons+=("a command it cannot read (eval, sh -c in sh -c, a shell fed on stdin, a quote or heredoc left open)"); fi
if [ "$CMD_SCRUB" = 1 ]; then reasons+=("a command that sets or clears what the landing scripts' hold reads (CLAUDE_CODE_SESSION_ID, CODEX_SESSION_ID, XDG_STATE_HOME, env -i)"); fi
if [ "$merges" = 0 ] && [ ${#pushes[@]} = 0 ] && [ ${#reasons[@]} = 0 ]; then guard_allow; fi

# cd_project <dir> — CD_PROJ: the Specnaut project <dir> is in, physically —
# the nearest folder holding .specnaut/scripts/bash/merge-mode.sh (looked at,
# never run), up to its git toplevel: a project without a .git of its own is
# its own, as guard_root has it. Fails outside a git repository, or in one
# that is no Specnaut project.
cd_project() {
  local d top
  d=$(cd -- "$1" 2>/dev/null && pwd -P) || return 1
  top=$(guard_git -C "$d" rev-parse --show-toplevel 2>/dev/null) || return 1
  guard_path top "$top"
  while [ ! -f "$d/.specnaut/scripts/bash/merge-mode.sh" ]; do
    if [ "$d" -ef "$top" ] || [ -z "${d%/*}" ]; then return 1; fi
    d=${d%/*}
  done
  CD_PROJ=$d
}

# Every candidate read by the session's own reader; one not on auto, or one
# with no project to read (`?`, no repository, no Specnaut), holds the line.
guard_root
baseline_bases
began=""
if approval_session_ok "$P_SESSION"; then
  began=$(cat "$(approval_state baselines "$P_SESSION")/mode" 2>/dev/null) || began=""
fi
mode=auto
for d in "$GUARD_ROOT" ${CD_DIRS[@]+"${CD_DIRS[@]}"}; do
  a=()
  if [ "$d" = '?' ] || { [ "$d" != "$GUARD_ROOT" ] && ! cd_project "$d"; }; then mode=manual; break; fi
  if [ "$d" = "$GUARD_ROOT" ] && [ "$began" = manual ]; then mode=manual; break; fi
  if [ "$d" != "$GUARD_ROOT" ]; then a=(--project "$CD_PROJ")
  else for b in ${PINNED_BASES[@]+"${PINNED_BASES[@]}"}; do a+=(--base "$b"); done; fi
  mode=$(cd "$GUARD_ROOT" && bash .specnaut/scripts/bash/merge-mode.sh --strict ${a[@]+"${a[@]}"} 2>/dev/null) || mode=manual
  [ "$mode" = auto ] || break
done
[ "$mode" != auto ] || guard_allow

if ! base=$(cd "$GUARD_ROOT" && bash .specnaut/scripts/bash/base-branch.sh 2>/dev/null); then base=""; fi
# A prompt found no base, and none since found one: still unknown (cli#718).
if [ "$PINNED_UNKNOWN" = 1 ] && [ ${#PINNED_BASES[@]} = 0 ]; then base=""; fi
if ! head=$(guard_git -C "$GUARD_CWD" symbolic-ref --quiet --short HEAD 2>/dev/null); then head=""; fi

# is_base <branch> — the branch is the base now, or one a prompt pinned;
# PINNED_HIT: a pinned name that matched when the base now does not.
PINNED_HIT=""
is_base() {
  local b
  if [ -n "$base" ] && guard_ieq "$1" "$base"; then return 0; fi
  for b in ${PINNED_BASES[@]+"${PINNED_BASES[@]}"}; do
    if guard_ieq "$1" "$b"; then PINNED_HIT=$b; return 0; fi
  done
  return 1
}

# lands_on_base <ref> — the ref, as a push destination, names a base branch.
lands_on_base() {
  local r=$1
  case $r in HEAD | @) r=$head ;; esac
  r=${r#refs/heads/}
  r=${r#heads/}
  [ -z "$r" ] || is_base "$r"
}

# A refspec as written: [+]src[:dst], ref-name characters only. Anything else
# ($VAR, `…`, a glob, a quote) is resolved by the shell after this hook reads
# it, so what it names is unknown here.
RE_REFSPEC='^\+?[A-Za-z0-9._/@-]*(:[A-Za-z0-9._/@-]+)?$'

# push_allowed <args…> — every refspec explicit, none landing on the base.
push_allowed() {
  local a dst skip=0 tags=0
  local -a pos=()
  for a in "$@"; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case $a in
      --all | --mirror | --delete | -d | --prune | --branches) return 1 ;;
      -o | --push-option | --repo | --receive-pack | --exec) skip=1 ;;
      --tags) tags=1 ;;
      --push-option=* | --repo=* | --receive-pack=* | --exec=* | --force-with-lease* | --force-if-includes | --recurse-submodules=* | --signed* | --no-signed) ;;
      --set-upstream | --force | --dry-run | --verbose | --quiet | --follow-tags | --no-follow-tags | --no-verify | --verify | --atomic | --no-atomic | --porcelain | --progress | --no-progress | --thin | --no-thin | --ipv4 | --ipv6) ;;
      -[ufnvq46]*) [[ $a =~ ^-[ufnvq46]+$ ]] || return 1 ;;
      -*) return 1 ;;
      *) pos+=("$a") ;;
    esac
  done
  if [ ${#pos[@]} -le 1 ]; then [ "$tags" = 1 ] && return 0; return 1; fi
  for a in "${pos[@]:1}"; do
    [[ $a =~ $RE_REFSPEC ]] || return 1
    a=${a#+}
    case $a in *:*) dst=${a#*:}; [ -n "${a%%:*}" ] || return 1 ;; *) dst=$a ;; esac
    if lands_on_base "$dst"; then return 1; fi
  done
  return 0
}

if [ "$merges" = 1 ]; then
  if [ -z "$base" ]; then reasons+=("git merge/pull with the base branch unknown")
  elif [ "$CMD_MOVED" = 1 ] || [ "$switched" = 1 ] || [ -z "$head" ] || is_base "$head"; then
    reasons+=("git merge/pull onto $base")
  fi
fi
for p in ${pushes[@]+"${pushes[@]}"}; do
  cmd_words "$p"
  if [ -z "$base" ]; then reasons+=("git push with the base branch unknown")
  elif [ "$CMD_MOVED" = 1 ]; then reasons+=("git push from another directory or repository")
  elif ! push_allowed ${W[@]+"${W[@]}"}; then reasons+=("git push that is not an explicit push of a branch other than $base")
  fi
done
[ ${#reasons[@]} -gt 0 ] || guard_allow

pin=""
if [ -n "$PINNED_HIT" ]; then pin=", or on $PINNED_HIT, which an earlier prompt found to be the base (kept in $(approval_state bases pinned))"; fi
approval_require merge \
  "merge: manual — held: $(IFS=';'; echo "${reasons[*]}"). Landing on the base branch (${base:-unknown}$pin) needs the user's own \`merge\`" \
  "To let it through, reply \`merge\` (or \`/task merge\`) — a plain \"yes\" does not approve it."
