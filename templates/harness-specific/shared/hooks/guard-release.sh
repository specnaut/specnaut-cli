#!/usr/bin/env bash
# PreToolUse(Bash), Codex only — publishing a release needs the user (spec
# 036, US5, FR-006). The one home of "is this Codex release command approved"
# (plan § 5). Claude holds the same list with permissions.ask, so there this
# hook exits 0 before reading anything.
#
# Refused unless the user's own prompt this turn approved a release (`release
# it`, `/ship release`): every command in release-commands.txt, and any push
# of a tag ref — --tags, --follow-tags, --mirror, push.followTags=true, a
# refs/tags/ ref, `tag <name>`, or a name that is a tag, or not a branch and
# either version-shaped or created as a tag on the same line (tag.sh and
# `git tag` run before the push does, so the tag does not exist yet when this
# hook reads the command). And a line too nested to read (eval, sh -c in
# sh -c, a shell fed on stdin, a line that never closes): fail closed.
#
# Usage: guard-release.sh <claude|codex>   (payload on stdin)
[ "${1:-}" != claude ] || exit 0
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing — refusing" >&2; exit 2; }
# shellcheck source=_command.sh
. "$HOOK_DIR/_command.sh"
# shellcheck source=_git.sh
. "$HOOK_DIR/_git.sh"
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
guard_init guard-release "${1:-}" argv:.tool_input.command
[ "$P_TOOL" = Bash ] || guard_fail "expected a Bash tool call, got '$P_TOOL'"
[ -n "${GF[0]}" ] || guard_fail "a Bash call without tool_input.command"
[ -f "$HOOK_DIR/release-commands.txt" ] || guard_fail "release-commands.txt is missing beside this hook — refusing"
cmd_parse "${GF[0]}"

# A git tag ref, by name: an existing tag, or no branch of that name and version-shaped or made on this line.
is_tag() {
  local n=$1
  case $n in refs/tags/*) return 0 ;; refs/* | HEAD | @ | '') return 1 ;; esac
  [[ $n =~ ^[A-Za-z0-9._/-]+$ ]] || return 1 # a revision expression (HEAD~1, @{u}), not a ref name
  if guard_git -C "$GUARD_CWD" show-ref --verify --quiet "refs/tags/$n"; then return 0; fi
  if guard_git -C "$GUARD_CWD" show-ref --verify --quiet "refs/heads/$n"; then return 1; fi
  [ "$tags_made" = 1 ] || [[ $n =~ ^v?[0-9]+(\.[0-9]+)+ ]]
}

# tag_push <push args…> — the push publishes a tag.
tag_push() {
  local a skip=0 follow
  local -a pos=()
  follow=$(guard_git -C "$GUARD_CWD" config --type=bool --get push.followTags 2>/dev/null) || follow=false
  [ "$follow" != true ] || return 0
  for a in "$@"; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case $a in
      --tags | --follow-tags | --mirror) return 0 ;;
      -o | --push-option | --repo | --receive-pack | --exec) skip=1 ;;
      -*) ;;
      *) pos+=("$a") ;;
    esac
  done
  for a in ${pos[@]+"${pos[@]:1}"}; do
    [ "$a" != tag ] || return 0
    a=${a#+}
    if is_tag "${a%%:*}" || { [[ $a == *:* ]] && is_tag "${a#*:}"; }; then return 0; fi
  done
  return 1
}

# listed — HIT: the entry of release-commands.txt the segment (W, and POS:
# its words without options) runs, else "". Always returns 0 and is called
# bare, never in `$(…)` or a condition: there an error is muted, and a crash
# would read as "not listed" — an allow.
listed() {
  local line entry except i ok w
  local -a e
  HIT=""
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in '' | '#'*) continue ;; esac
    entry=${line%% except *} except=""
    if [ "$entry" != "$line" ]; then except=${line#* except }; fi
    read -r -a e <<<"$entry"
    ok=1
    for ((i = 0; i < ${#e[@]}; i++)); do
      if [ "${e[i]}" != "${POS[i]:-}" ]; then ok=0; break; fi
    done
    [ "$ok" = 1 ] || continue
    if [ -n "$except" ]; then
      for w in "${W[@]}"; do if [ "$w" = "$except" ]; then continue 2; fi; done
    fi
    HIT=$entry
    return 0
  done <"$HOOK_DIR/release-commands.txt"
}

tags_made=0 pushes=() hits=()
for seg in ${CMD_SEGS[@]+"${CMD_SEGS[@]}"}; do
  cmd_words "$seg"
  if [ "${W[0]}" = git ]; then
    cmd_git "${W[@]}"
    case $GIT_SUB in
      tag) tags_made=1 ;;
      push) pushes+=("$(IFS=$CMD_SEP; echo "${GIT_ARGS[*]:-}")") ;;
    esac
    continue
  fi
  [ "${W[0]}" != tag.sh ] || tags_made=1
  cmd_pos
  listed
  if [ -n "$HIT" ]; then hits+=("$HIT"); fi
done
if [ "$CMD_OPAQUE" = 1 ]; then hits+=("a command it cannot read (eval, sh -c in sh -c, a shell fed on stdin, a quote or heredoc left open)"); fi
for p in ${pushes[@]+"${pushes[@]}"}; do
  cmd_words "$p"
  if tag_push ${W[@]+"${W[@]}"}; then hits+=("a push of a tag"); fi
done
[ ${#hits[@]} -gt 0 ] || guard_allow

approval_gate release \
  "$(IFS=';'; echo "${hits[*]}") publishes a release, and Codex needs the user's go-ahead in this turn" \
  "\`release it\` (or \`/ship release\`)"
