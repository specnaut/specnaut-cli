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
# `<words> except <flag>`: that flag anywhere in the segment exempts it.
# `#` comments and blank lines are skipped; a `\r` (a CRLF checkout) is read past.

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
  done <"$1"
}
