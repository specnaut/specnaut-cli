# shellcheck shell=bash disable=SC2034,SC2153
# (SC2034/SC2153: CMD_* are shared with _command.sh, which sources this file.)
# Sourced by _command.sh. What ONE simple command runs, once cmd_parse has cut
# it out of the line: redirections dropped, VAR=val prefixes and wrappers
# (env, command, sudo, nice, time, timeout, xargs, flock, …) skipped, the
# command word reduced to its basename, `source <script>` read as the script,
# each `find -exec … ;` as a command of its own, and `sh|bash|zsh -c '…'` one
# level deep — the string is parsed again as a command line.
#
# Unknown means opaque (cli#711, plan § 4): a wrapper is known by its
# basename, with the options it takes and which of them take a value; any
# other option, a shell's own input as a script, or text the shell evaluates
# later (a trap action, a mapfile callback, a `[$(…)]` subscript, zsh
# `${(e)…}`) marks the line CMD_OPAQUE — never "skip one word and go on".
#
# The helpers below share _cmd_emit's locals by bash's dynamic scope: v (the
# words), m (their count) and k (the index of the command word). So does
# CMD_ON_SEG: when a guard sets it to a function name, _cmd_emit calls it with
# the raw segment once v and k are read, before the command word is reduced
# to its basename — what protect-constitution.sh needs to judge `/x/cat`, a
# VAR= prefix, or a redirection the words here no longer show.

_CMD_RE_REDIR='^[0-9]*(>>|>&|<&|<>|>[|]|<<<|>|<)(.*)$'
_CMD_RE_AMP='^&>>?(.*)$'

# _cmd_opaque — a form this parser cannot read with certainty: the guard gates
# the line (plan § 4, unknown means opaque). k=m: nothing of it is recorded.
_cmd_opaque() { CMD_OPAQUE=1 k=$m; }

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

# _cmd_skip_prefixes — k: past VAR=val (and VAR+=val) assignments, read by
# _cmd_env (_command.sh), reserved words, the
# prefix words that run what follows (coproc, nocorrect, repeat N, function
# NAME), and the wrappers that run their argument (env, sudo, nice, exec, …).
_cmd_skip_prefixes() {
  local x
  while [ "$k" -lt "$m" ]; do
    x=${v[k]}
    if [[ $x =~ ^[A-Za-z_][A-Za-z0-9_]*[+]?= ]]; then _cmd_env "$x"; k=$((k + 1)); continue; fi
    case $x in
      '{' | '}' | '!' | if | then | else | elif | do | while | until | noglob | nocorrect) k=$((k + 1)) ;;
      coproc) k=$((k + 1)); if [ "${v[k + 1]:-}" = '{' ]; then k=$((k + 1)); fi ;; # coproc NAME { …; }
      repeat) k=$((k + 2)) ;;
      # function NAME { …: the body's first command follows. zsh takes more
      # names, or a bare command as the body: not read here, so opaque.
      function) k=$((k + 2)); if [ "$k" -lt "$m" ] && [ "${v[k]}" != '{' ]; then _cmd_opaque; fi ;;
      *) _cmd_wrapper || _cmd_runner || return 0 ;;
    esac
  done
}

# _cmd_getopt <flags> <valued> [long flags] [long valued] — k: past v[k] and
# its options, read as getopt reads them. <flags> are the letters that take
# no value, <valued> the ones that take one (attached, or the next word); the
# long ones likewise, `--opt=value` accepted for either; `--` ends them. Any
# other option makes the line opaque: an option this list does not know may
# take a value, and skipping one word for it lets the command hide as that
# value — `exec -a foo land-feature.sh` was read as running `foo` (cli#711).
_cmd_getopt() {
  local x l c fl=" ${3:-} " vl=" ${4:-} "
  for ((k = k + 1; k < m; k++)); do
    x=${v[k]}
    case $x in
      --) k=$((k + 1)); return 0 ;;
      --*=*) case "$fl$vl" in *" ${x%%=*} "*) continue ;; esac; _cmd_opaque; return 0 ;;
      -*)
        case $fl in *" $x "*) continue ;; esac
        case $vl in *" $x "*) k=$((k + 1)); continue ;; esac
        if [[ $x == --* ]] || [ "$x" = - ]; then _cmd_opaque; return 0; fi
        for ((l = 1; l < ${#x}; l++)); do
          c=${x:l:1}
          if [ -n "$1" ] && [[ $1 == *"$c"* ]]; then continue; fi
          # a valued letter ends the cluster: the rest is its value, else the next word is
          if [ -n "$2" ] && [[ $2 == *"$c"* ]]; then [ $((l + 1)) -lt ${#x} ] || k=$((k + 1)); break; fi
          _cmd_opaque; return 0
        done ;;
      *) return 0 ;;
    esac
  done
}

# _cmd_wrapper — v[k] (by its basename: `/usr/bin/env` is env) is a builtin
# or a program that runs the command after its options: k moves there.
# Returns 1 when v[k] is none of them.
_cmd_wrapper() {
  local k0=$k j
  case ${v[k]##*/} in
    exec) _cmd_getopt cl a - ;;
    # -v/-V name the command and run nothing (cli#711): nothing is recorded
    command) _cmd_getopt pvV ""; for ((j = k0 + 1; j < k; j++)); do case ${v[j]} in -*[vV]*) k=$m ;; esac; done ;;
    builtin | nohup) _cmd_getopt "" "" ;;
    time) _cmd_getopt plavq of "--portability --verbose --append --quiet" "--output --format" ;;
    nice) _cmd_getopt 0123456789 n "" --adjustment ;;
    env) # -S/--split-string is a command line of its own: unknown, so opaque
      _cmd_getopt i0v uCPLU "--ignore-environment --null --debug -" "--unset --chdir"; _cmd_env_opts "$k0"
      while [ "$k" -lt "$m" ] && [[ ${v[k]} == *=* ]]; do _cmd_env "${v[k]}"; k=$((k + 1)); done ;;
    sudo | doas)
      _cmd_getopt ABbEHKknPSVvsil ugpCDhrtUTR \
        "--askpass --bell --background --preserve-env --set-home --remove-timestamp --reset-timestamp --non-interactive --preserve-groups --stdin --shell --login" \
        "--user --group --prompt --close-from --chdir --host --role --type --other-user --command-timeout --chroot" ;;
    *) return 1 ;;
  esac
  # -C/--chdir (env), -D/--chdir (sudo): elsewhere. sudo -s|-i with no command: a shell on stdin.
  for ((j = k0 + 1; j < k && j < m; j++)); do
    case ${v[k0]##*/}:${v[j]} in env:--chdir* | env:-C* | env:-[!-]*C* | sudo:--chdir* | sudo:-D* | sudo:-[!-]*D*) CMD_MOVED=1 ;; esac
    if [ "$k" -lt "$m" ]; then continue; fi
    case ${v[k0]##*/}:${v[j]} in sudo:--shell | sudo:--login | sudo:-[si]* | sudo:-[!-]*[si]* | doas:-s* | doas:-[!-]*s*) _cmd_opaque ;; esac
  done
}

# _cmd_runner — v[k] (by its basename) is a command that runs the command
# after its options and its own operands (a duration, a priority, a CPU mask,
# a lock file): k moves there. Returns 1 when v[k] is none of them. After
# flock's lock file, `-c '…'` is left for _cmd_emit, which reads the string
# as a shell's.
_cmd_runner() {
  local k0=$k
  case ${v[k]##*/} in
    timeout | gtimeout) _cmd_getopt v sk "--preserve-status --foreground --verbose" "--signal --kill-after"; k=$((k + 1)) ;;
    caffeinate) _cmd_getopt dimsu tw ;;
    stdbuf) _cmd_getopt "" ioe "" "--input --output --error" ;;
    ionice) _cmd_getopt t cnp --ignore "--class --classdata --pid" ;;
    chrt)
      _cmd_getopt abdfiormpRv TPD "--all-tasks --batch --deadline --fifo --idle --other --rr --reset-on-fork --max --pid --verbose" \
        "--sched-runtime --sched-period --sched-deadline"
      k=$((k + 1)) ;;
    taskset) _cmd_getopt acp "" "--all-tasks --cpu-list --pid"; k=$((k + 1)) ;;
    xargs)
      _cmd_getopt 0prtxoile adEIJLnPRSs "--null --interactive --no-run-if-empty --verbose --exit --open-tty --show-limits --replace --eof --max-lines" \
        "--arg-file --delimiter --max-args --max-procs --max-chars --process-slot-var"
      _cmd_xargs "$k0" ;;
    flock) _cmd_getopt sexnouF wE "--shared --exclusive --nonblock --no-fork --close --unlock --verbose" "--timeout --conflict-exit-code"; k=$((k + 1)) ;;
    *) return 1 ;;
  esac
}

# _cmd_xargs <index of xargs> — k: the command xargs runs, whose words stdin
# fills in: each word holding the -I/-J replace string (-i, --replace: `{}`)
# has it as `$`, and a `$` word ends it — `echo merge | xargs git` is a git
# subcommand the shell fills in (_listed.sh), not `git` (cli#711).
_cmd_xargs() {
  local j r=""
  for ((j = $1 + 1; j < k; j++)); do
    case ${v[j]} in
      --replace) r='{}' ;; --replace=*) r=${v[j]#*=} ;; --*) ;;
      -*[IJ]) j=$((j + 1)) r=${v[j]:-} ;; -*[IJ]*) r=${v[j]#*[IJ]} ;; -*i*) r='{}' ;;
    esac
  done
  [ "$k" -lt "$m" ] || return 0 # no command: xargs runs echo
  if [ -n "$r" ]; then for ((j = k; j < m; j++)); do v[j]=${v[j]//"$r"/\$}; done; fi
  v+=('$') m=$((m + 1))
}

# _cmd_shell_c <depth> [1] — v[k] is a shell (1: or flock's `-c`, already
# seen). `-c '…'` at depth 0 is parsed as a command line, deeper it is opaque;
# either way the shell itself is not recorded (k=m). A script operand becomes
# the command (k moves to it); no operand at all, or `-s`, means commands on
# stdin: opaque. `--rcfile|--init-file <file>`: that file runs too. Always
# returns 0, so the nested cmd_parse never runs where bash mutes the ERR trap
# (an `||` list).
_cmd_shell_c() {
  local x j sawc=${2:-0} stdin=0
  for ((j = k + 1; j < m; j++)); do
    x=${v[j]}
    case $x in
      --rcfile | --init-file) j=$((j + 1)); _cmd_script "${v[j]:-}" ;;
      --*) ;;
      -* | +*)
        case $x in -*c*) sawc=1 ;; -*s*) stdin=1 ;; esac
        case $x in *[oO]) j=$((j + 1)) ;; esac ;; # -o/-O, or a cluster ending in one (-euxo pipefail), take a value
      *)
        if [ "$sawc" = 0 ]; then
          if [ "$stdin" = 1 ]; then CMD_OPAQUE=1 k=$m; else k=$j; _cmd_base; fi
          return 0
        fi
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

# _cmd_name <word> — CMD_NAME: the word as a command name, its basename. When
# an expansion encloses that basename (`${X:-a/land-feature.sh}`), a `$` is
# kept in front of it: what the word names is still the shell's to decide
# (_listed.sh). `${HOME}/x.sh` is x.sh. A path to the shell's own input
# (/dev/stdin, /dev/fd/N, /proc/…/fd/N) names what this hook never sees: opaque.
_cmd_name() {
  CMD_NAME=${1##*/}
  case $CMD_NAME in *'}'*) case $1 in *"\${"*) CMD_NAME=\$$CMD_NAME ;; esac ;; esac
  case $1 in /dev/stdin | /dev/fd/* | /proc/*/fd/*) CMD_OPAQUE=1 ;; esac
}

# _cmd_base — v[k] reduced to its name (_cmd_name).
_cmd_base() { _cmd_name "${v[k]}"; v[k]=$CMD_NAME; }

# _cmd_script <path> — a script the shell runs that is no word of the line
# (BASH_ENV=, --rcfile): recorded as a command of its own.
_cmd_script() { if [ -n "$1" ]; then _cmd_name "$1"; CMD_SEGS+=("$CMD_NAME"); fi; }

# _cmd_evals — opaque when a word holds code the shell runs later, where this
# parser never reads it: a zsh `${(…)` whose flags hold `e` (the value is
# expanded again), and, for a builtin that evaluates the array subscript of a
# name it is given (let, printf -v, read, declare, test -v, …), `$(…)` or a
# backtick after a `[`. A quoted word keeps that text as it is; unquoted,
# cmd_parse already read the substitution. Given to any other command, it is
# data: `git commit -m '[x] $(y)'` runs nothing (cli#711).
# shellcheck disable=SC2016 # the `$(` and `${(` are matched as text, on purpose
_cmd_evals() {
  local x f o='${(' sub=0
  case ${v[k]:-} in let | printf | read | test | '[' | '[[' | declare | typeset | local | export | readonly | unset | getopts | wait | mapfile | readarray | print | vared) sub=1 ;; esac
  for x in ${v[@]+"${v[@]}"}; do
    if [ "$sub" = 1 ]; then case $x in *'['*'$('* | *'['*'`'*) CMD_OPAQUE=1; return 0 ;; esac; fi
    while [[ $x == *"$o"* ]]; do
      x=${x#*"$o"} f=${x%%')'*}
      case $f in *e*) CMD_OPAQUE=1; return 0 ;; esac
    done
  done
}

# _cmd_trap — v[k] is trap: an action (a first operand other than `-`, '' or
# -p/-l, with a signal after it) is a command line the shell runs later.
_cmd_trap() {
  local j=$((k + 1))
  if [ "${v[j]:-}" = -- ]; then j=$((j + 1)); fi
  if [ $((m - j)) -ge 2 ]; then case ${v[j]} in - | '' | -p | -l) ;; *) CMD_OPAQUE=1 ;; esac; fi
}

# _cmd_emit <raw segment> <depth> — strip redirections, prefixes and wrappers; record the command.
_cmd_emit() {
  local -a v
  local x j k=0 m=0 IFS=$' \t\n'
  _cmd_strip_redirs "$1"
  _cmd_skip_prefixes
  _cmd_evals
  if [ -n "${CMD_ON_SEG:-}" ]; then "$CMD_ON_SEG" "$1"; fi
  [ "$k" -lt "$m" ] || return 0
  _cmd_base
  case ${v[k]} in
    cd | pushd | popd) CMD_MOVED=1 ;;
    eval) CMD_OPAQUE=1 ;;
    trap) _cmd_trap ;;
    mapfile | readarray) for ((j = k + 1; j < m; j++)); do case ${v[j]} in -*C*) CMD_OPAQUE=1 ;; esac; done ;; # -C: a callback
    export | declare | typeset | local | readonly | unset) for x in "${v[@]:k}"; do _cmd_env "$x"; done ;;
    sh | bash | zsh | dash | ksh) _cmd_shell_c "$2"; [ "$k" -lt "$m" ] || return 0 ;;
    -c | --command) _cmd_shell_c "$2" 1; [ "$k" -lt "$m" ] || return 0 ;;
    # no operand left: it was a stripped `<(…)` (or a here-string) — the shell's own input
    source | .) k=$((k + 1)); if [ "$k" -ge "$m" ]; then CMD_OPAQUE=1; return 0; fi; _cmd_base ;;
    find) _cmd_find "$2" ;;
  esac
  IFS=$CMD_SEP
  CMD_SEGS+=("${v[*]:k}")
}
