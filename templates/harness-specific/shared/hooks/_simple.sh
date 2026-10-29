# shellcheck shell=bash disable=SC2034,SC2153
# (SC2034/SC2153: CMD_* are shared with _command.sh, which sources this file.)
# Sourced by _command.sh. What ONE simple command runs, once cmd_parse has cut
# it out of the line: redirections dropped, VAR=val prefixes and wrappers
# (env, command, sudo, nice, time, timeout, xargs, flock, …) skipped, the
# command word reduced to its basename, `source <script>` and `. <script>`
# read as the script, each `find -exec … ;` read as a command of its own, and
# `sh|bash|zsh -c '…'` read one level deep — the string is parsed again as a
# command line; a second level, or a shell fed on stdin, or `eval`, sets
# CMD_OPAQUE instead of being guessed at.
#
# The helpers below share _cmd_emit's locals by bash's dynamic scope: v (the
# words), m (their count) and k (the index of the command word). So does
# CMD_ON_SEG: when a guard sets it to a function name, _cmd_emit calls it with
# the raw segment once v and k are read, before the command word is reduced
# to its basename — what protect-constitution.sh needs to judge `/x/cat`, a
# VAR= prefix, or a redirection the words here no longer show.

_CMD_RE_REDIR='^[0-9]*(>>|>&|<&|<>|>[|]|<<<|>|<)(.*)$'
_CMD_RE_AMP='^&>>?(.*)$'

_cmd_env() { case ${1%%=*} in GIT_DIR | GIT_WORK_TREE | GIT_COMMON_DIR | GIT_INDEX_FILE | GIT_CONFIG*) CMD_MOVED=1 ;; esac; }

# _cmd_strip_redirs <raw segment> — v: its words, each redirection dropped
# with its target (the next word, when the operator stands alone).
_cmd_strip_redirs() {
  local -a w
  local x skip=0 IFS=$CMD_SEP
  # shellcheck disable=SC2206 # split on CMD_SEP on purpose; set -f rules out globbing
  w=($1)
  IFS=$' \t\n' # bash 3.2 joins "${a[@]:n}" with spaces under an IFS without one
  v=()
  for x in ${w[@]+"${w[@]}"}; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    if [[ $x =~ $_CMD_RE_REDIR ]] || [[ $x =~ $_CMD_RE_AMP ]]; then
      [ -n "${BASH_REMATCH[${#BASH_REMATCH[@]}-1]}" ] || skip=1
      continue
    fi
    v+=("$x")
  done
  m=${#v[@]}
}

# _cmd_skip_prefixes — k: past VAR=val assignments, reserved words and the
# wrappers that run their argument (env, sudo, nice, command, exec, …).
_cmd_skip_prefixes() {
  local x
  while [ "$k" -lt "$m" ]; do
    x=${v[k]}
    if [[ $x =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then _cmd_env "$x"; k=$((k + 1)); continue; fi
    case $x in
      '{' | '}' | '!' | if | then | else | elif | do | while | until | time | nohup | exec | command | builtin | noglob)
        k=$((k + 1))
        while [ "$k" -lt "$m" ] && [[ ${v[k]} == -* ]]; do k=$((k + 1)); done ;;
      env)
        for ((k = k + 1; k < m; )); do
          case ${v[k]} in
            -C | --chdir) CMD_MOVED=1 k=$((k + 2)) ;;
            -u | --unset) k=$((k + 2)) ;;
            -*) k=$((k + 1)) ;;
            *=*) _cmd_env "${v[k]}"; k=$((k + 1)) ;;
            *) break ;;
          esac
        done ;;
      sudo | doas)
        for ((k = k + 1; k < m; )); do
          case ${v[k]} in -u | -g | -p | -C | -D | -h | -r | -t | -U) k=$((k + 2)) ;; -*) k=$((k + 1)) ;; *) break ;; esac
        done ;;
      nice) k=$((k + 1)); if [ "${v[k]:-}" = -n ]; then k=$((k + 2)); elif [[ ${v[k]:-} == -* ]]; then k=$((k + 1)); fi ;;
      *) _cmd_runner || return 0 ;;
    esac
  done
}

# _cmd_opts <option that takes a value…> — k: past v[k] and the options that
# follow it, each listed one with its value; `--` ends them.
_cmd_opts() {
  local o
  for ((k = k + 1; k < m; k++)); do
    case ${v[k]} in
      --) k=$((k + 1)); return 0 ;;
      -*) for o in "$@"; do if [ "${v[k]}" = "$o" ]; then k=$((k + 1)); break; fi; done ;;
      *) return 0 ;;
    esac
  done
}

# _cmd_runner — v[k] is a command that runs the command after its options and
# its own operands (a duration, a priority, a CPU mask, a lock file): k moves
# there. Returns 1 when v[k] is none of them. After flock's lock file, `-c
# '…'` is left for _cmd_emit, which reads the string as a shell's.
_cmd_runner() {
  case ${v[k]} in
    timeout | gtimeout) _cmd_opts -s -k --signal --kill-after; k=$((k + 1)) ;;
    caffeinate) _cmd_opts -t -w ;;
    stdbuf) _cmd_opts -i -o -e --input --output --error ;;
    ionice) _cmd_opts -c -n -p --class --classdata --pid ;;
    chrt) _cmd_opts -T -P -D --sched-runtime --sched-period --sched-deadline; k=$((k + 1)) ;;
    taskset) _cmd_opts; k=$((k + 1)) ;;
    xargs) _cmd_opts -a -d -E -I -J -L -n -P -R -S -s --arg-file --delimiter --max-args --max-procs --max-chars --max-lines --process-slot-var ;;
    flock) _cmd_opts -w -E --timeout --conflict-exit-code; k=$((k + 1)) ;;
    *) return 1 ;;
  esac
}

# _cmd_shell_c <depth> [1] — v[k] is a shell (1: or flock's `-c`, already
# seen). `-c '…'` at depth 0 is parsed as a command line, deeper it is opaque;
# either way the shell itself is not recorded (k=m). A script operand becomes
# the command (k moves to it); no operand at all means commands on stdin:
# opaque. Always returns 0, so the nested cmd_parse never runs where bash
# mutes the ERR trap (an `||` list).
_cmd_shell_c() {
  local x j sawc=${2:-0}
  for ((j = k + 1; j < m; j++)); do
    x=${v[j]}
    case $x in
      -o | +o | -O | +O) j=$((j + 1)) ;;
      --*) ;;
      -*c*) sawc=1 ;;
      -* | +*) ;;
      *)
        if [ "$sawc" = 0 ]; then v[j]=${x##*/} k=$j; return 0; fi
        if [ "$1" = 0 ]; then cmd_parse "$x" 1; else CMD_OPAQUE=1; fi
        k=$m
        return 0 ;;
    esac
  done
  CMD_OPAQUE=1
}

# _cmd_find <depth> — v[k] is find: the command of each -exec, -execdir, -ok
# or -okdir, up to its `;` or `+`, is emitted as a simple command of its own.
_cmd_find() {
  local j run="" on=0
  for ((j = k + 1; j < m; j++)); do
    if [ "$on" = 0 ]; then
      case ${v[j]} in -exec | -execdir | -ok | -okdir) on=1 ;; esac
      continue
    fi
    case ${v[j]} in
      ';' | '+') _cmd_emit "$run" "$1"; run="" on=0 ;;
      *) run+="${v[j]}$CMD_SEP" ;;
    esac
  done
  if [ -n "$run" ]; then _cmd_emit "$run" "$1"; fi
}

# _cmd_emit <raw segment> <depth> — strip redirections, prefixes and wrappers; record the command.
_cmd_emit() {
  local -a v
  local x k=0 m=0 IFS=$' \t\n'
  _cmd_strip_redirs "$1"
  _cmd_skip_prefixes
  if [ -n "${CMD_ON_SEG:-}" ]; then "$CMD_ON_SEG" "$1"; fi
  [ "$k" -lt "$m" ] || return 0
  v[k]=${v[k]##*/}
  case ${v[k]} in
    cd | pushd | popd) CMD_MOVED=1 ;;
    eval) CMD_OPAQUE=1 ;;
    export | declare | typeset | local | readonly) for x in "${v[@]:k}"; do _cmd_env "$x"; done ;;
    sh | bash | zsh | dash | ksh) _cmd_shell_c "$2"; [ "$k" -lt "$m" ] || return 0 ;;
    -c | --command) _cmd_shell_c "$2" 1; [ "$k" -lt "$m" ] || return 0 ;;
    source | .) k=$((k + 1)); [ "$k" -lt "$m" ] || return 0; v[k]=${v[k]##*/} ;;
    find) _cmd_find "$2" ;;
  esac
  IFS=$CMD_SEP
  CMD_SEGS+=("${v[*]:k}")
}
