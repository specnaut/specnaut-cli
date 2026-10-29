# shellcheck shell=bash disable=SC2034
# (SC2034: CMD_MOVED belongs to _command.sh and is read by the guard.)
# Sourced after _command.sh by the guards that read git commands (guard-merge,
# guard-release). Reads one `git` segment the way git itself would: past its
# global options, and through its aliases — so `git -C x -c k=v pm` is seen as
# the command it runs, not as an unknown subcommand.

# cmd_git <git words…> — skip git's global options and expand git aliases
# (up to 5 levels), so `git -C x -c k=v pm` is read as the command it runs.
# Sets GIT_SUB and GIT_ARGS; GIT_SUB is "!" for a shell alias or an alias we
# cannot follow. git ignores an alias that shadows a builtin, so do we.
cmd_git() {
  shift
  GIT_SUB="" GIT_ARGS=()
  local inline_alias=0
  while [ $# -gt 0 ]; do
    case $1 in
      -C | --git-dir | --work-tree) CMD_MOVED=1; shift; if [ $# -gt 0 ]; then shift; fi ;;
      --git-dir=* | --work-tree=*) CMD_MOVED=1; shift ;;
      -c | --config-env) if [[ ${2:-} == [Aa][Ll][Ii][Aa][Ss].* ]]; then CMD_MOVED=1 inline_alias=1; fi; shift; if [ $# -gt 0 ]; then shift; fi ;;
      --namespace | --exec-path | --super-prefix) shift; if [ $# -gt 0 ]; then shift; fi ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  [ $# -gt 0 ] || return 0
  GIT_SUB=$1
  shift
  GIT_ARGS=("$@")
  # An alias set on the command line (`git -c alias.p=push p`) is not in any
  # config file, so `git config --get` cannot follow it, and how it fails
  # differs by platform: what the command runs is unknowable, so it is gated.
  if [ "$inline_alias" = 1 ]; then GIT_SUB="!"; return 0; fi
  local level val rc
  local -a a
  for level in 1 2 3 4 5; do
    case $GIT_SUB in
      merge | pull | push | checkout | switch | status | log | diff | show | add | commit | fetch | branch | tag | rebase | reset | config | rev-parse | stash) return 0 ;;
    esac
    [[ $GIT_SUB =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 0
    if val=$(guard_git -C "$GUARD_CWD" config --get "alias.$GIT_SUB" 2>/dev/null); then :; else
      rc=$?
      if [ "$rc" = 1 ]; then return 0; fi # not an alias: a builtin or an unknown command
      GIT_SUB="!"
      return 0
    fi
    case $val in '!'* | -*) GIT_SUB="!"; return 0 ;; esac
    IFS=$' \t\n' read -r -a a <<<"$val"
    [ ${#a[@]} -gt 0 ] || return 0
    GIT_SUB=${a[0]}
    GIT_ARGS=(${a[@]+"${a[@]:1}"} ${GIT_ARGS[@]+"${GIT_ARGS[@]}"})
    if [ "$level" = 5 ]; then GIT_SUB="!"; fi
  done
  return 0
}
