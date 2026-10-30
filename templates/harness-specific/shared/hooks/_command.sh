# shellcheck shell=bash disable=SC2034,SC1003
# (SC2034: the CMD_* results are read by the sourcing guard. SC1003: the case
# patterns match a literal quote or backslash.)
# Sourced after _guard.sh by the guards that read a Bash command (guard-merge,
# guard-release): splits one command line into the simple commands a shell
# would run, so a rule matches what runs — not text that merely mentions it.
#
# A heuristic by design (plan § 6 threat model). It sees: ; && || | & and
# newlines, ( ) $( ) and backticks (also inside "…"), `if(…)` and the other
# reserved words before a subshell, `[[ … ]]` (where | ( ) < > & ; are part of
# a word), quotes and escapes, comments, heredoc bodies (skipped: they are
# data, once the delimiter is quoted), `<<<` herestrings, `<<` inside
# `$((…))`/`((…))` (a shift, not a heredoc), redirections, VAR=val prefixes,
# the env/command/sudo/nice/timeout/xargs/… wrappers, `source x`, the command
# of `find -exec`, and ONE level of `sh|bash|zsh -c '…'`. A deeper `-c`, or
# `eval`, sets CMD_OPAQUE — and so does what it cannot read with certainty
# (cli#711): a `case` inside a substitution, an unquoted heredoc body holding
# `$(` or a backtick, a zsh glob qualifier that runs code, and a line that
# never closes: a quote, `(`, `$(`, backtick or `[[` left open, a heredoc whose
# body never ends. Fail closed: a guard gates what it cannot read rather than
# guessing at it. Scripts, interpreters and shell functions are not seen: the
# stated limit.
#
# After cmd_parse: CMD_SEGS holds one entry per simple command, its words
# joined by CMD_SEP, the first word reduced to its basename. A substitution is
# a command of its own, and it does not end the one around it: that command
# goes on, with a `$` in the word the substitution stood in — so `git -C
# "$(…)" merge` still reads as a merge, and a command word that is one still
# reads as a word the shell rewrites (_listed.sh). CMD_MOVED=1 when
# the line may act on another repository: cd/pushd, env -C, a GIT_DIR/
# GIT_WORK_TREE/GIT_CONFIG* assignment (and, through _git.sh's cmd_git,
# git -C/--git-dir/--work-tree and -c alias.*). CMD_SCRUB=1 when it may set or
# clear what the landing scripts' hold reads (_cmd_env, _cmd_scrub).
CMD_SEP=$'\x1f'
# shellcheck source=_simple.sh
. "${BASH_SOURCE[0]%/*}/_simple.sh" || guard_fail "_simple.sh is missing beside _command.sh"
CMD_SEGS=()
CMD_MOVED=0
CMD_OPAQUE=0
CMD_SCRUB=0

# _cmd_env <VAR=val | VAR+=val | VAR> — what an assignment, an export or an
# unset does to what runs: moving the repository sets CMD_MOVED; naming a
# script a shell reads at start (BASH_ENV, ENV) runs it; and setting or
# clearing what the landing scripts' hold reads — the session id each harness
# exports, the state dir its stamp is under — would send merge-hold.sh to
# another stamp, or to none (spec 048 § 8 F2): CMD_SCRUB, which guard-merge
# gates. Not CMD_OPAQUE: the line reads fine, and only the landing hold cares
# — the hooks read their approvals in their own environment. HOME is too common.
_cmd_env() {
  local n=${1%%=*}
  case ${n%+} in
    GIT_DIR | GIT_WORK_TREE | GIT_COMMON_DIR | GIT_INDEX_FILE | GIT_CONFIG*) CMD_MOVED=1 ;;
    BASH_ENV | ENV) _cmd_script "${1#*=}" ;;
    CLAUDE_CODE_SESSION_ID | CODEX_SESSION_ID | XDG_STATE_HOME) CMD_SCRUB=1 ;;
  esac
}

# _cmd_scrub <segment> — CMD_SCRUB on a word holding one of _cmd_env's names
# whole (no [A-Za-z0-9_] beside it), a read too: `read`, `for`, `printf -v`,
# `declare -n`, `${X:=…}` write one with no assignment word. And on `exec` with
# a cluster holding c before any `a` (its value): `env -i` by another name.
_cmd_scrub() {
  local x e=0 IFS=$CMD_SEP re='(^|[^A-Za-z0-9_])(CLAUDE_CODE_SESSION_ID|CODEX_SESSION_ID|XDG_STATE_HOME)([^A-Za-z0-9_]|$)'
  if [[ $1 =~ $re ]]; then CMD_SCRUB=1; fi
  for x in $1; do
    case $e:$x in *:exec | *:*/exec | 2:*) e=1 ;; 1:-[!-]*) case ${x%%a*} in *c*) CMD_SCRUB=1 ;; esac; case $x in *a) e=2 ;; esac ;; *) e=0 ;; esac
  done
}

# _cmd_env_opts <index of env> — env's options, up to k (_simple.sh's
# _cmd_wrapper has read them): emptying the environment (-i, a lone `-`,
# --ignore-environment) clears the hold's session id too: CMD_SCRUB;
# each -u/--unset NAME goes through _cmd_env. Only 0 and v take no value, so
# a cluster is read up to its first other letter: `-vi` empties, `-uXi`
# unsets `Xi`.
_cmd_env_opts() {
  local j x
  for ((j = $1 + 1; j < k && j < m; j++)); do
    x=${v[j]}
    case $x in
      - | --ignore-environment) CMD_SCRUB=1 ;;
      --unset=*) _cmd_env "${x#*=}" ;;
      --unset) j=$((j + 1)); _cmd_env "${v[j]:-}" ;;
      --*) ;;
      -*)
        if [[ $x =~ ^-[0v]*i ]]; then CMD_SCRUB=1
        elif [[ $x =~ ^-[0v]*u(.*)$ ]]; then
          if [ -n "${BASH_REMATCH[1]}" ]; then _cmd_env "${BASH_REMATCH[1]}"; else j=$((j + 1)); _cmd_env "${v[j]:-}"; fi
        fi ;;
    esac
  done
}

# _cmd_cmdpos — the word being read stands where a command word does:
# unquoted, with nothing before it in the segment but the reserved words that
# lead a command. Only there do `case`, `[[` and `if(` mean what bash reads.
_cmd_cmdpos() {
  local x
  [ "$have" = 0 ] || return 1
  for x in $seg; do case $x in if | then | else | elif | do | while | until | '!' | '{' | time) ;; *) return 1 ;; esac; done
}

# _cmd_word — the word read so far joins the segment. As a command word,
# `[[` opens its own mode (bk: the frame it was opened in) and `]]` closes it;
# `case` inside a substitution is opaque: an arm's bare `)` would close the
# substitution, and the arm's commands would read as words of the command
# around it — `echo $(case x in *) git push;; esac)` ran a push (cli#711).
_cmd_word() {
  case $word in
    '[[') if _cmd_cmdpos; then if [ -n "$bk" ]; then CMD_OPAQUE=1; fi; bk="+$stack$bt"; fi ;;
    ']]') if [ "$have" = 0 ] && [ "$bk" = "+$stack$bt" ]; then bk=""; fi ;;
    case) if _cmd_cmdpos; then case $stack in *[sd]*) CMD_OPAQUE=1 ;; esac; fi ;;
  esac
  if [ "$have" = 1 ] || [ -n "$word" ]; then seg+="$word$CMD_SEP"; fi
  word="" have=0
}

# _cmd_keyword — the word read so far is a reserved word in command position,
# so a `(` right after it opens a subshell: `if(…)`, `then(…)`, `while(…)`.
_cmd_keyword() { case $word in if | then | else | elif | do | while | until) _cmd_cmdpos ;; *) return 1 ;; esac; }
_cmd_end() { _cmd_word; if [ -n "$seg" ]; then _cmd_scrub "$seg"; _cmd_emit "$seg" "$depth"; fi; seg=""; }

# A `$(` or backtick opens: the command around it is set aside (sw/ss, sp deep)
# with a `$` standing in for the substitution, and the substitution is read as
# a line of its own. _cmd_pop, at its close, ends that line and resumes the
# command set aside — the word the `$` is in included.
_cmd_push() { sw[sp]=$word'$' ss[sp]=$seg sp=$((sp + 1)) word="" have=0 seg=""; }
_cmd_pop() { _cmd_end; if [ "$sp" -gt 0 ]; then sp=$((sp - 1)) have=1; word=${sw[sp]} seg=${ss[sp]}; fi; }

# `)` closes the innermost frame: a substitution (d: inside "…", s: bare), a
# zsh glob group inside a word (g: kept in the word), or a subshell/arithmetic.
_cmd_close() {
  local f=${stack:0:1}
  stack=${stack:1}
  case $f in g) _cmd_qual; word+=$c ;; d) _cmd_pop; q='"' ;; s) _cmd_pop ;; *) _cmd_end ;; esac
}

# _cmd_qual — the `)` at i-1 closes a zsh glob group. At the end of its word,
# or opened by `#q`, the group is a list of glob qualifiers, and an `e…` or
# `+cmd` among them runs code for each file the glob matches: `ls
# *(e:'git push':)`. Opaque. Quoted text opens no group, so a commit message
# never trips this.
_cmd_qual() {
  local g=${word##*[(]}
  case $g in '#q'*) ;; *) case ${s:i:1} in '' | [[:space:]] | ';' | '&' | '|' | ')' | '<' | '>') ;; *) return 0 ;; esac ;; esac
  case $g in *e* | *+*) CMD_OPAQUE=1 ;; esac
}

# Skips the bodies of the heredocs opened on the line just ended. A body that
# runs to the end of the input never closed: as likely a misread as a typo,
# and what follows a phantom heredoc is hidden — so the line is opaque. So is
# a body whose delimiter was not quoted, if it holds `$(` or a backtick: bash
# expands that body, and runs its substitutions (cli#711).
# shellcheck disable=SC2016 # the `$(` is matched as text, on purpose
_cmd_heredocs() {
  local d strip quoted line closed
  for d in $heredocs; do
    strip=${d:0:1} quoted=${d:1:1} d=${d:2} closed=0
    while [ "$i" -lt "$n" ]; do
      line=${s:i}
      line=${line%%$'\n'*}
      i=$((i + ${#line} + 1))
      if [ "$strip" = 1 ]; then line=${line#"${line%%[!$'\t']*}"}; fi
      if [ "$line" = "$d" ]; then closed=1; break; fi
      if [ "$quoted" = 0 ]; then case $line in *'$('* | *'`'*) CMD_OPAQUE=1 ;; esac; fi
    done
    if [ "$closed" = 0 ]; then CMD_OPAQUE=1; fi
  done
  heredocs=""
}

# Reads the delimiter of the `<<` / `<<-` heredoc whose operator ends at i and
# queues it for _cmd_heredocs. Quotes and escapes in it are dropped, as bash
# does, and recorded: any of them makes the body literal.
_cmd_heredoc_open() {
  local strip=0 quoted=0 d="" ch
  if [ "${s:i:1}" = "-" ]; then strip=1 i=$((i + 1)); fi
  while [ "${s:i:1}" = " " ]; do i=$((i + 1)); done
  while [ "$i" -lt "$n" ]; do
    ch=${s:i:1}
    case $ch in [[:space:]] | ';' | '&' | '|' | '<' | '>' | '(' | ')') break ;; "'" | '"' | '\') quoted=1 ;; *) d+=$ch ;; esac
    i=$((i + 1))
  done
  heredocs+="$strip$quoted$d$CMD_SEP"
}

# A `(` just opened a frame: if another follows (`$((`, `((`), this is
# arithmetic, where `<<` is a shift. Pushes an "a" frame for the second `(`,
# so the matching `))` pops both.
_cmd_arith() { if [ "${s:i:1}" = "(" ]; then stack="a$stack" i=$((i + 1)); fi; }

# `<` at i-1: a plain redirection, a herestring (its word is data, dropped
# with it by _cmd_emit), a shift inside arithmetic, or a heredoc.
_cmd_lt() {
  if [ "$nx" != "<" ]; then word+=$c
  elif [ "${s:i+1:1}" = "<" ]; then word+="<<<" i=$((i + 2))
  else
    case $stack in
      *a*) word+="<<" i=$((i + 1)) ;;
      *) _cmd_word; i=$((i + 1)); _cmd_heredoc_open ;;
    esac
  fi
}

# _cmd_test_char — inside `[[ … ]]`, in the frame it was opened in, c is one
# of | ( ) < > & ; : part of a word (`[[ $x =~ ^(a|b)$ ]]`), not an operator —
# returns 0, c kept. Only a word that is exactly `]]` ends the mode, before an
# operator too (`]];`). A newline first: opaque.
_cmd_test_char() {
  [ -n "$bk" ] && [ "$bk" = "+$stack$bt" ] || return 1
  case $c in
    '|' | '(' | ')' | '<' | '>' | '&' | ';')
      if [ "$word" != ']]' ] || [ "$have" = 1 ]; then word+=$c; return 0; fi
      bk="" ;;
    $'\n') CMD_OPAQUE=1 ;;
  esac
  return 1
}

# _cmd_dquote — c, inside "…", is a backslash, the closing quote, a `$` or a
# backtick (cmd_parse adds every other character to the word itself).
_cmd_dquote() {
  case $c in
    '\') case $nx in '"' | '\' | '$' | '`') word+=$nx i=$((i + 1)) ;; $'\n') i=$((i + 1)) ;; *) word+=$c ;; esac ;;
    '"') q="" ;;
    '$') if [ "$nx" = "(" ]; then _cmd_push; stack="d$stack" q="" i=$((i + 1)); _cmd_arith; else word+=$c; fi ;;
    '`') _cmd_push; bt=d q="" ;;
    *) word+=$c ;;
  esac
}

# _cmd_plain — c, unquoted, is not a plain word character: an operator, a
# quote, a blank, an expansion, a comment — or, inside `[[ … ]]`, part of a
# word (_cmd_test_char).
_cmd_plain() {
  if [ -n "$bk" ] && _cmd_test_char; then return 0; fi
  case $c in
    '\') if [ "$nx" != $'\n' ]; then word+=$nx have=1; fi; i=$((i + 1)) ;;
    "'" | '"') q=$c have=1 ;;
    ' ' | $'\t') _cmd_word ;;
    $'\n') _cmd_end; if [ -n "$heredocs" ]; then _cmd_heredocs; fi ;;
    ';' | '|') _cmd_end ;;
    '&') case $word in *'>' | *'<') word+=$c ;; *) if [ "$nx" = ">" ]; then word+=$c; else _cmd_end; fi ;; esac ;;
    '$') if [ "$nx" = "(" ]; then _cmd_push; stack="s$stack" i=$((i + 1)); _cmd_arith; else word+=$c; fi ;;
    '(') case $word in
        *'<' | *'>' | '=') _cmd_push; stack="s$stack" ;; # <(…) >(…) =(…): a command runs inside
        *) if [ -n "$word" ] && [ "$nx" != ")" ] && ! _cmd_keyword; then word+=$c stack="g$stack"; else _cmd_end; stack="u$stack"; _cmd_arith; fi ;;
      esac ;;
    ')') _cmd_close ;;
    '`') if [ -z "$bt" ]; then _cmd_push; bt=u; else _cmd_pop; if [ "$bt" = d ]; then q='"'; fi; bt=""; fi ;;
    '#') if [ -z "$word" ] && [ "$have" = 0 ]; then d=${s:i}; d=${d%%$'\n'*}; i=$((i + ${#d})); else word+=$c; fi ;;
    '<') _cmd_lt ;;
    *) word+=$c ;;
  esac
}

# cmd_parse <command line> [depth] — one character at a time. The characters
# that mean nothing but themselves are added to the word here, without a
# function call: they are most of any line, and a call costs more than the
# character (a 5 KB line is parsed in well under a second on bash 3.2).
cmd_parse() {
  local s=$1 depth=${2:-0} n=${#1} i=0 c nx q="" word="" have=0 seg="" stack="" bt="" heredocs="" d sp=0 bk=""
  local -a sw ss
  local IFS=$CMD_SEP
  while [ "$i" -lt "$n" ]; do
    c=${s:i:1} nx=${s:i+1:1}
    i=$((i + 1))
    if [ "$q" = "'" ]; then
      if [ "$c" = "'" ]; then q=""; else word+=$c; fi
    elif [ -n "$q" ]; then
      case $c in '\' | '"' | '$' | '`') _cmd_dquote ;; *) word+=$c ;; esac
    else
      case $c in [[:alnum:]_./=:,+-]) word+=$c ;; *) _cmd_plain ;; esac
    fi
  done
  _cmd_end
  if [ -n "$q$stack$bt$heredocs$bk" ]; then CMD_OPAQUE=1; fi
}

# cmd_words <segment> — split a CMD_SEGS entry into the array W.
# shellcheck disable=SC2206 # split on CMD_SEP on purpose; set -f rules out globbing
cmd_words() { local IFS=$CMD_SEP; W=($1); }

# cmd_pos — POS: the words of W that are not options. For gh and glab, the
# value of -R/--repo goes too: they take it before the subcommand, and
# `gh -R o/r release create` must read as `gh release create`.
cmd_pos() {
  local w skip=0
  POS=()
  for w in "${W[@]}"; do
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case $w in
      -R | --repo) case ${W[0]} in gh | glab) skip=1 ;; esac ;;
      -*) ;; # an option — and only the word itself says so: `${X:-y}` is none
      *) POS+=("$w") ;;
    esac
  done
}
