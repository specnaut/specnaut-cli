# shellcheck shell=bash disable=SC2034
# (SC2034: HIT is read by the sourcing guard.)
# Sourced by the guards that hold a command list — guard-release.sh
# (release-commands.txt) and guard-merge.sh (merge-commands.txt): the one
# home of how a line of such a list matches a simple command.
#
# A line is the words a command starts with, matched against its words
# without options (POS, from cmd_pos), so `gh -R o/r release create` matches
# `gh release create`. A first word ending in `.sh` is a script: _command.sh
# has already reduced the command word to its basename, so it matches however
# the script is reached (a path, `bash x`, `source x`, `timeout 60 x`, …).
# The script word is matched ignoring ASCII case (a case-folding filesystem,
# APFS or NTFS, runs `Land-Feature.sh`). A word filled in after this hook has
# read it — by the shell (a `$VAR`, a substitution, a glob, a brace, a zsh
# glob group: `land-(feature).sh`), by the command (xargs' stdin, its -I
# placeholder, find's `{}`, which _simple.sh leaves as `$` or `{}`) — or that
# holds a byte outside printable ASCII matches the line's word at its
# position and every word after it — unquoted, or as stdin, it may be several
# words: what it names is unknown here, so it is gated (fail closed). `gh
# $(echo release) create` and `… | xargs gh` are `gh release create`
# (cli#711). Only at a position a line has a word for: `ls *.sh` runs `ls`.
# `<words> except <flag>`: that flag anywhere in the segment exempts it.
# `#` comments and blank or whitespace-only lines are skipped; a `\r` (a CRLF
# checkout) is read past.

# _listed_expands <word> — the shell rewrites it before it runs: a `$`, a
# substitution (_command.sh leaves a `$` where one stood), `*`, `?`, a `(`
# (zsh globs `a(b).sh`), or a bracket or brace pair. A lone `[` or `{` is
# literal — `[` is test(1). Or it holds a byte that is not printable ASCII
# (LC_ALL=C, set by _guard.sh): APFS folds `land-feature.ſh` (U+017F) to the
# script, and no fold this hook could do would match every filesystem's — so
# it does not fold, it gates (cli#711).
_listed_expands() {
  case $1 in *'$'* | *'`'* | *'*'* | *'?'* | *'('* | *'['*']'* | *'{'*'}'* | *[![:print:]]*) return 0 ;; esac
  return 1
}

# listed <list file> — HIT: the entry of the list the segment (W, and POS:
# its words without options) runs, else "". Always returns 0 and is called
# bare, never in `$(…)` or a condition: there an error is muted, and a crash
# would read as "not listed" — an allow. A missing list refuses.
listed() {
  local line entry except i ok w
  local -a e
  HIT=""
  [ -f "$1" ] || guard_fail "${1##*/} is missing beside this hook — refusing"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'} # a CRLF checkout (Windows, core.autocrlf)
    case $line in '' | '#'*) continue ;; esac
    entry=${line%% except *} except=""
    if [ "$entry" != "$line" ]; then except=${line#* except }; fi
    read -r -a e <<<"$entry"
    # Blank or whitespace-only: no words to compare, so it would match every
    # command. It matches nothing (cli#711).
    [ -n "${e[0]:-}" ] || continue
    ok=1
    for ((i = 0; i < ${#e[@]}; i++)); do
      w=${POS[i]:-}
      if _listed_expands "$w"; then break; fi
      if [ "${e[i]}" = "$w" ]; then continue; fi
      if [ "$i" = 0 ] && [[ ${e[0]} == *.sh ]] && guard_ieq "${e[0]}" "$w"; then continue; fi
      ok=0
      break
    done
    [ "$ok" = 1 ] || continue
    if [ -n "$except" ]; then
      for w in "${W[@]}"; do if [ "$w" = "$except" ]; then continue 2; fi; done
    fi
    HIT=$entry
    return 0
  done <"$1"
}
