# shellcheck shell=bash disable=SC2034,SC1003
# (SC2034: the CMD_* results are read by the sourcing guard. SC1003: the case
# patterns match a literal quote or backslash.)
# Sourced after _guard.sh by the guards that read a Bash command (guard-merge,
# guard-release): splits one command line into the simple commands a shell
# would run, so a rule matches what runs — not text that merely mentions it.
#
# A heuristic by design (plan § 6 threat model). It sees: ; && || | & and
# newlines, ( ) $( ) and backticks (also inside "…"), quotes and escapes,
# comments, heredoc bodies (skipped: they are data), `<<<` herestrings, `<<`
# inside `$((…))`/`((…))` (a shift, not a heredoc), redirections, VAR=val
# prefixes, the env/command/sudo/nice/timeout/xargs/… wrappers, `source x`,
# the command of `find -exec`, and ONE level of `sh|bash|zsh -c '…'`. A
# deeper `-c`, or `eval`, sets CMD_OPAQUE — and so does a line that never
# closes: a quote, `(`, `$(` or backtick left open, a heredoc whose body never
# ends. Fail closed: a guard gates what it cannot read rather than guessing at
# it. Scripts, interpreters and shell functions are not seen: the stated limit.
#
# After cmd_parse: CMD_SEGS holds one entry per simple command, its words
# joined by CMD_SEP, the first word reduced to its basename. CMD_MOVED=1 when
# the line may act on another repository: cd/pushd, env -C, a GIT_DIR/
# GIT_WORK_TREE/GIT_CONFIG* assignment (and, through _git.sh's cmd_git,
# git -C/--git-dir/--work-tree and -c alias.*).
CMD_SEP=$'\x1f'
# shellcheck source=_simple.sh
. "${BASH_SOURCE[0]%/*}/_simple.sh" || guard_fail "_simple.sh is missing beside _command.sh"
CMD_SEGS=()
CMD_MOVED=0
CMD_OPAQUE=0

_cmd_word() { if [ "$have" = 1 ] || [ -n "$word" ]; then seg+="$word$CMD_SEP"; fi; word=""; have=0; }
_cmd_end() { _cmd_word; if [ -n "$seg" ]; then _cmd_emit "$seg" "$depth"; fi; seg=""; }

# Skips the bodies of the heredocs opened on the line just ended. A body that
# runs to the end of the input never closed: as likely a misread as a typo,
# and what follows a phantom heredoc is hidden — so the line is opaque.
_cmd_heredocs() {
  local d strip line closed
  for d in $heredocs; do
    strip=${d:0:1} d=${d:1} closed=0
    while [ "$i" -lt "$n" ]; do
      line=${s:i}
      line=${line%%$'\n'*}
      i=$((i + ${#line} + 1))
      if [ "$strip" = 1 ]; then line=${line#"${line%%[!$'\t']*}"}; fi
      if [ "$line" = "$d" ]; then closed=1; break; fi
    done
    if [ "$closed" = 0 ]; then CMD_OPAQUE=1; fi
  done
  heredocs=""
}

# Reads the delimiter of the `<<` / `<<-` heredoc whose operator ends at i and
# queues it for _cmd_heredocs. Quotes and escapes in it are dropped, as bash does.
_cmd_heredoc_open() {
  local strip=0 d="" ch
  if [ "${s:i:1}" = "-" ]; then strip=1 i=$((i + 1)); fi
  while [ "${s:i:1}" = " " ]; do i=$((i + 1)); done
  while [ "$i" -lt "$n" ]; do
    ch=${s:i:1}
    case $ch in [[:space:]] | ';' | '&' | '|' | '<' | '>' | '(' | ')') break ;; "'" | '"' | '\') ;; *) d+=$ch ;; esac
    i=$((i + 1))
  done
  heredocs+="$strip$d$CMD_SEP"
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

# cmd_parse <command line> [depth]
cmd_parse() {
  local s=$1 depth=${2:-0} n=${#1} i=0 c nx q="" word="" have=0 seg="" stack="" bt="" heredocs="" d
  local IFS=$CMD_SEP
  while [ "$i" -lt "$n" ]; do
    c=${s:i:1} nx=${s:i+1:1}
    i=$((i + 1))
    if [ "$q" = "'" ]; then
      if [ "$c" = "'" ]; then q=""; else word+=$c; fi
    elif [ "$q" = '"' ]; then
      case $c in
        '\') case $nx in '"' | '\' | '$' | '`') word+=$nx i=$((i + 1)) ;; $'\n') i=$((i + 1)) ;; *) word+=$c ;; esac ;;
        '"') q="" ;;
        '$') if [ "$nx" = "(" ]; then _cmd_end; stack="d$stack" q="" i=$((i + 1)); _cmd_arith; else word+=$c; fi ;;
        '`') _cmd_end; bt=d q="" ;;
        *) word+=$c ;;
      esac
    else
      case $c in
        '\') if [ "$nx" != $'\n' ]; then word+=$nx have=1; fi; i=$((i + 1)) ;;
        "'" | '"') q=$c have=1 ;;
        ' ' | $'\t') _cmd_word ;;
        $'\n') _cmd_end; if [ -n "$heredocs" ]; then _cmd_heredocs; fi ;;
        ';' | '|') _cmd_end ;;
        '&') case $word in *'>' | *'<') word+=$c ;; *) if [ "$nx" = ">" ]; then word+=$c; else _cmd_end; fi ;; esac ;;
        '$') if [ "$nx" = "(" ]; then _cmd_end; stack="u$stack" i=$((i + 1)); _cmd_arith; else word+=$c; fi ;;
        '(') _cmd_end; stack="u$stack"; _cmd_arith ;;
        ')') _cmd_end; if [ "${stack:0:1}" = d ]; then q='"'; fi; stack=${stack:1} ;;
        '`') _cmd_end; if [ -z "$bt" ]; then bt=u; elif [ "$bt" = d ]; then q='"' bt=""; else bt=""; fi ;;
        '#') if [ -z "$word" ] && [ "$have" = 0 ]; then d=${s:i}; d=${d%%$'\n'*}; i=$((i + ${#d})); else word+=$c; fi ;;
        '<') _cmd_lt ;;
        *) word+=$c ;;
      esac
    fi
  done
  _cmd_end
  if [ -n "$q$stack$bt$heredocs" ]; then CMD_OPAQUE=1; fi
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
    case "${W[0]}:$w" in
      gh:-R | gh:--repo | glab:-R | glab:--repo) skip=1 ;;
      *:-*) ;;
      *) POS+=("$w") ;;
    esac
  done
}
