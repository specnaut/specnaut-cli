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
#   gh pr merge, glab mr merge, a git shell alias, a git subcommand the shell
#                        rewrites (`git $(…)`, `git "$X"`), a line it cannot read
#   every command in merge-commands.txt — the scripts that land on the base
#                        themselves (land-feature.sh, remove-spec.sh), matched
#                        by basename however they are reached (_listed.sh)
# An unknown base gates every form. A gated command goes through
# approval_gate: Claude's own prompt where it can ask, else this turn's
# `merge` approval (FR-017).
#
# The limit: it reads the command line, not what a program does. A listed
# script copied or renamed, a task-runner alias for it, or an interpreter
# that runs it gets past — the same limit a hand-written script that runs
# `git push` already has.
#
# Usage: guard-merge.sh <claude|codex>   (payload on stdin)
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing — refusing" >&2; exit 2; }
# shellcheck source=_command.sh
. "$HOOK_DIR/_command.sh"
# shellcheck source=_git.sh
. "$HOOK_DIR/_git.sh"
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
# shellcheck source=_listed.sh
. "$HOOK_DIR/_listed.sh"
guard_init guard-merge "${1:-}" argv:.tool_input.command
[ "$P_TOOL" = Bash ] || guard_fail "expected a Bash tool call, got '$P_TOOL'"
[ -n "${GF[0]}" ] || guard_fail "a Bash call without tool_input.command"
cmd_parse "${GF[0]}"

reasons=() pushes=() merges=0 switched=0
for seg in ${CMD_SEGS[@]+"${CMD_SEGS[@]}"}; do
  cmd_words "$seg"
  case ${W[0]:-} in
    '') continue ;; # an empty word as the command runs nothing
    git)
      cmd_git "${W[@]}"
      case $GIT_SUB in
        merge | pull) merges=1 ;;
        push) pushes+=("$(IFS=$CMD_SEP; echo "${GIT_ARGS[*]:-}")") ;;
        checkout | switch) switched=1 ;;
        '!') reasons+=("a git alias that runs a shell command") ;;
        *) if _listed_expands "$GIT_SUB"; then reasons+=("a git subcommand the shell rewrites"); fi ;;
      esac
      continue ;;
  esac
  cmd_pos
  case "${POS[*]:-}" in "gh pr merge"* | "glab mr merge"*) reasons+=("${POS[0]} ${POS[1]} merge") ;; esac
  listed "$HOOK_DIR/merge-commands.txt"
  if [ -n "$HIT" ]; then reasons+=("$HIT"); fi
done
if [ "$CMD_OPAQUE" = 1 ]; then reasons+=("a command it cannot read (eval, sh -c in sh -c, a shell fed on stdin, a quote or heredoc left open)"); fi
if [ "$merges" = 0 ] && [ ${#pushes[@]} = 0 ] && [ ${#reasons[@]} = 0 ]; then guard_allow; fi

guard_root
mode=$(cd "$GUARD_ROOT" && bash .specnaut/scripts/bash/merge-mode.sh --strict 2>/dev/null) || mode=manual
[ "$mode" != auto ] || guard_allow

if ! base=$(cd "$GUARD_ROOT" && bash .specnaut/scripts/bash/base-branch.sh 2>/dev/null); then base=""; fi
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

approval_gate merge \
  "merge: manual — $(IFS=';'; echo "${reasons[*]}") would land on the base branch (${base:-unknown}) without the user" \
  "\`merge\` (or \`/task merge\`)"
