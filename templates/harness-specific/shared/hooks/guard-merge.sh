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
# The mode and the base are the project's the gated commands run in (cli#710):
# after a `cd`, its literal target's — see cd_step below. An unknown base
# gates every form. Every gated reason goes through one arm,
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
guard_init guard-merge "${1:-}" argv:.tool_input.command
[ "$P_TOOL" = Bash ] || guard_fail "expected a Bash tool call, got '$P_TOOL'"
[ -n "${GF[0]}" ] || guard_fail "a Bash call without tool_input.command"

# Where the gated commands run (cli#710). A `cd` moves what lands only if it
# runs in this shell, unconditionally, before anything else on the line: the
# leading run of `cd`/`pushd`/`popd`, each bare (VAR= prefixes only — `env cd`
# runs no builtin), outside any subshell, substitution or `-c` string, joined
# by `&&`, `;` or a newline. Counted per raw segment (CMD_ON_SEG, cmd_parse's
# locals by dynamic scope: c/nx the character that ended it, sp the open
# substitutions, stack the open frames); a cd not counted — after `false &&`,
# in `( )` or `$( )`, piped, in a function body — leaves the line judged by
# every state. A `-c` string or a `find -exec` is read after the command
# holding it, which already ended the run.
CD_LEAD=1 CD_TRUSTED=0 CD_SEEN=0 CD_DIR="" CD_STATES=()
# shellcheck disable=SC2154,SC2329 # cmd_parse's locals; called through CMD_ON_SEG
_cd_seg() {
  local j
  case ${v[k]:-} in cd | pushd | popd) ;; *) CD_LEAD=0; return 0 ;; esac
  for ((j = 0; j < k; j++)); do [[ ${v[j]} =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || CD_LEAD=0; done
  case $c:$nx in '|':* | ')':* | '(':*) CD_LEAD=0 ;; '&':'&') ;; '&':*) CD_LEAD=0 ;; esac
  if [ "$CD_LEAD" = 1 ] && [ "$sp" = 0 ] && [ -z "$stack" ]; then CD_TRUSTED=$((CD_TRUSTED + 1)); else CD_LEAD=0; fi
}
CMD_ON_SEG=_cd_seg
cmd_parse "${GF[0]}"

# cd_step <cd|pushd|popd> <args…> — CD_DIR: the directory after it, as this
# shell resolves it, or `?` when that is not certain: a non-literal word ($X,
# a substitution, ~, a glob), `-`, no operand or two, an option other than
# -L/-P, popd, a pushd option, a relative name CDPATH may redirect, a
# directory that does not exist. After `?`, only an absolute target is named.
cd_step() {
  local a t="" n=0 from=${CD_DIR:-$GUARD_CWD}
  CD_SEEN=$((CD_SEEN + 1)) CD_DIR='?'
  for a in "${@:2}"; do
    case $1:$a in popd:*) n=9 ;; *:--) ;; cd:-L | cd:-P) ;; *:-* | *:+*) n=9 ;; *) t=$a n=$((n + 1)) ;; esac
  done
  if [ "$n" = 1 ] && [[ $t =~ ^[A-Za-z0-9._/@+,-]+$ ]]; then
    case $t in
      /*) from=/ ;;
      . | .. | ./* | ../*) [ "$from" != '?' ] || t="" ;;
      *) if [ "$from" = '?' ] || [ -n "${CDPATH:-}" ] || [[ ${GF[0]} == *CDPATH* ]]; then t=""; fi ;;
    esac
    if [ -n "$t" ] && a=$(cd -- "$from" 2>/dev/null && CDPATH='' cd -- "$t" 2>/dev/null && pwd -P); then CD_DIR=$a; fi
  fi
  CD_STATES+=("$CD_DIR")
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

# cd_project <dir> — CD_PROJ: the Specnaut project <dir> is in — the nearest
# folder holding .specnaut/scripts/bash/merge-mode.sh, up to its git toplevel
# (a project without a .git of its own reads its own mode, as guard_root does).
# Fails outside a git repository, or in one that is no Specnaut project.
cd_project() {
  local d=$1 top
  top=$(guard_git -C "$d" rev-parse --show-toplevel 2>/dev/null) || return 1
  guard_path top "$top"
  while [ ! -f "$d/.specnaut/scripts/bash/merge-mode.sh" ]; do
    if [ "$d" -ef "$top" ] || [ -z "${d%/*}" ]; then return 1; fi
    d=${d%/*}
  done
  CD_PROJ=$d
}

# The projects that may be landed on: the session's, with no cd on the line;
# the last cd's, when every cd is in the leading run; else the session's and
# every state the line's cds pass through. Any of them not on auto holds the
# line, and its base is the one the reasons name. Unnamed (`?`): manual.
guard_root
cands=("$GUARD_ROOT") mode=auto proj=""
if [ "$CD_SEEN" -gt 0 ]; then
  if [ "$CD_SEEN" = "$CD_TRUSTED" ]; then cands=("$CD_DIR"); else cands+=("${CD_STATES[@]}"); fi
fi
for d in "${cands[@]}"; do
  if [ "$d" = "$GUARD_ROOT" ]; then CD_PROJ=$d
  elif [ "$d" = '?' ] || ! cd_project "$d"; then mode=manual proj=""; break; fi
  mode=$(cd "$CD_PROJ" && bash .specnaut/scripts/bash/merge-mode.sh --strict 2>/dev/null) || mode=manual
  if [ "$mode" != auto ]; then proj=$CD_PROJ; break; fi
done
[ "$mode" != auto ] || guard_allow

if [ -z "$proj" ] || ! base=$(cd "$proj" && bash .specnaut/scripts/bash/base-branch.sh 2>/dev/null); then base=""; fi
if ! head=$(guard_git -C "$GUARD_CWD" symbolic-ref --quiet --short HEAD 2>/dev/null); then head=""; fi

# lands_on_base <ref> — the ref, as a push destination, names the base branch.
lands_on_base() {
  local r=$1
  case $r in HEAD | @) r=$head ;; esac
  r=${r#refs/heads/}
  r=${r#heads/}
  [ -z "$r" ] || guard_ieq "$r" "$base"
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
  elif [ "$CMD_MOVED" = 1 ] || [ "$switched" = 1 ] || [ -z "$head" ] || guard_ieq "$head" "$base"; then
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

approval_require merge \
  "merge: manual — held: $(IFS=';'; echo "${reasons[*]}"). Landing on the base branch (${base:-unknown}) needs the user's own \`merge\`" \
  "To let it through, reply \`merge\` (or \`/task merge\`) — a plain \"yes\" does not approve it."
