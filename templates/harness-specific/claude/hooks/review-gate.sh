#!/usr/bin/env bash
# Runs before each shell command. A command that starts a review of a branch
# the session cannot trust (`specnaut review start`) runs only when the
# session's checkout holds, judged against the record this session's start
# took: the binary does the work (`specnaut review gate` reads this hook's
# input on stdin, and says which commands it judges); this script only calls it.
#
# Exit 2 stops the command and shows the session why; 0 lets it run, and what
# the gate prints is this hook's answer: for a line it passes, the line
# rewritten to carry the pass's nonce, the one line the start takes it from.
# Input that never mentions a review is let through without starting the binary. With no
# `specnaut` on the cleaned PATH (below), nothing is stopped here: `specnaut review start` cannot
# run either - unless the hook dropped an entry, as the start runs on the session's own PATH, where
# that entry could supply the `specnaut` performing it; a line that starts a review, or whose
# command runs `specnaut` (`specnaut.exe`, `.cmd` or `.bat` too) as a word the PATH is searched for
# (in any letter case: a case-blind disk finds it so), or holds `$'`, whose escapes spell any name,
# is then refused, whatever it asks. `dropped` is judged on this hook's PATH, the one Claude Code
# starts it with, not the Bash tool's, which an env file or a shell snapshot can change; a line
# that starts a review and names PATH bare, which can set it, is refused, an entry dropped or not.
# Matching reads bytes, in the C locale, whatever the session's. This stops a mistaken start, not
# a session set on getting past it: a name spelled so the line never holds it - a parameter
# default, `${IFS}`, brace expansion, a `$"..."` a message catalog translates, command
# substitution, `eval`, an alias, text decoded into a shell (`base64 -d | sh`), a file sourced or
# written and then run - is out of its reach, as is a PATH that `read`, `printf -v` or `declare -n`
# names in double quotes or between quotes that pair the wrong way (`cut -d'"'`), or that the Bash
# tool's env file or snapshot sets. Before any of that, every time, the pass a gated line left is
# removed: a pass lives only until the next command, and a check stopped part-way leaves none
# behind. A `specnaut` that resolves into the tree stops a review's command: it would be the tree
# judging itself. The input is read by a builtin, PATH or none.
# Not exported: only this shell's matching reads it. A session that exports LC_ALL passes C on.
LC_ALL=C
refuse() {
  echo "review-gate: $1" >&2
  exit 2
}
dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) ||
  refuse "cannot enter the project folder"
# The PATH rule - tree_top, clean_path, resolve_cmd - from _clean-path.sh beside this file, by its
# path: nothing is looked up before the PATH is cleaned.
lib=${BASH_SOURCE[0]%/*}
[ "$lib" != "${BASH_SOURCE[0]}" ] || lib=.
# shellcheck source-path=SCRIPTDIR source=_clean-path.sh
. "$lib/_clean-path.sh" || refuse "cannot read $lib/_clean-path.sh"
# Removes the pass where git keeps it. When git cannot say where that is (a
# repository it refuses to read, say), the `.git` above the folder does; a
# folder with none holds no pass. One whose git directory still cannot be
# found might: the command is stopped, never let through.
drop_pass() {
  local git_dir
  git_dir=$(cd "$dir" && git rev-parse --absolute-git-dir 2>/dev/null) ||
    git_dir=$(git_dir_above "$dir") || return 0
  [ -n "$git_dir" ] && [ -d "$git_dir" ] ||
    refuse "cannot find the git directory of the project folder"
  rm -f -- "$git_dir/specnaut/review-pass.json" ||
    refuse "cannot remove the review pass${dropped:+ - VERIFIER REFUSED: $dropped$without}"
}
# The git directory of the repository $1 is in, read without git: a `.git`
# folder, or the one a `.git` file names (empty when it names none). Fails
# when no `.git` is above $1.
git_dir_above() {
  local dir=$1 up line=
  while :; do
    if [ -d "$dir/.git" ]; then
      printf '%s' "$dir/.git"
      return 0
    elif [ -e "$dir/.git" ]; then
      { IFS= read -r line <"$dir/.git"; } 2>/dev/null
      line=${line%$'\r'}
      case "$line" in "gitdir: "?*) line=${line#gitdir: } ;; *) return 0 ;; esac
      case "$line" in /* | [A-Za-z]:*) ;; *) line="$dir/$line" ;; esac
      printf '%s' "$line"
      return 0
    fi
    up=$(dirname "$dir")
    [ "$up" = "$dir" ] && return 1
    dir=$up
  done
}
# Whether $1 matches the pattern $2, into BASH_REMATCH. One the shell cannot compile (`[[ =~ ]]`
# exits 2) stops the command: read as no match, it would let through the line it is there to stop.
matches() {
  local rc=0
  # shellcheck disable=SC2319 # the test's own status is the point: 2 is a pattern that failed
  [[ $1 =~ $2 ]] || rc=$?
  [ "$rc" -gt 1 ] || return "$rc"
  refuse "a pattern this shell cannot compile: $2"
}
# Each `command` value of the input into `vals`, the description never: a key is a quote after `{`
# or `,`, and a quote inside a value is always escaped, so no value adds a key or hides one. A value
# is read with JSON's own pairing of escapes, an escaped backslash first (as \001, an escaped quote
# as \002), so it ends at the quote that ends it, whatever backslashes and quotes it holds.
command_values() {
  local rest=$input v
  local key='[{,][[:space:]]*"command"[[:space:]]*:[[:space:]]*"(.*)$'
  vals=()
  while matches "$rest" "$key"; do
    rest=${BASH_REMATCH[1]}
    v=${rest//\\\\/$'\001'}
    v=${v//\\\"/$'\002'}
    vals+=("${v%%\"*}")
  done
}
# Whether a command value runs `specnaut` as a word the PATH is searched for: not after or before a
# letter, a digit, `.`, `_`, `/` or `-`, so `.specnaut/x`, `specnaut-cli/` and `/opt/bin/specnaut`
# do not. A value holding `$'` is refused: its escapes can spell the name. Then the shell's quoting
# goes, wider than the shell removes it, never narrower: each backslash and quote, a `$` before a
# quote with it. A backslash-newline is read both ways, as this does not parse the line: removed, a
# line continuation, before any quote is read, as the shell joins it; and kept, as the shell keeps
# it after an escaped backslash or in a comment, where the newline ends the command.
runs_specnaut() {
  local v j
  local name='[Ss][Pp][Ee][Cc][Nn][Aa][Uu][Tt](\.([Ee][Xx][Ee]|[Cc][Mm][Dd]|[Bb][Aa][Tt]))?'
  local word="(^|[^A-Za-z0-9._/-])$name(\$|[^A-Za-z0-9._/-])"
  for v in "${vals[@]}"; do
    j=${v//$'\001'\\n/}
    case $v$'\n'$j in *\$\'*) refuse "VERIFIER REFUSED: $dropped$ansi" ;; esac
    v=${v//\$$'\002'/}
    j=${j//\$$'\002'/}
    { holds "$j" "$word" || holds "$v" "$word"; } && return 0
  done
  return 1
}
# Whether a command value names PATH so it can set it, in any letter case. An assignment
# (`PATH=`, `PATH+=`, `PATH[0]=`, zsh's tied `path+=(...)`) is read over the whole value, quotes
# and all: `export "PATH=..."` assigns it. Then, double-quoted strings left out, a bare word:
# `read PATH`, `read path`, `printf -v PATH`. Neither is `$PATH`, `${PATH...}`, `GOPATH=`, nor a
# message in double quotes, as the resolve block prints. The assignment is read both ways at a
# backslash-newline, as runs_specnaut reads one; the bare word joined only, as a word a kept
# newline would start is a command, where only an assignment sets PATH.
names_path() {
  local v j pre post q=$'\002'
  # shellcheck disable=SC2016 # a `$` before the name is a read: it is in the class, not expanded
  local assign='(^|[^$A-Za-z0-9_{])[Pp][Aa][Tt][Hh](\[[^]]*\])?\+?='
  # shellcheck disable=SC2016 # the same class
  local bare='(^|[^$A-Za-z0-9_{])[Pp][Aa][Tt][Hh]([^A-Za-z0-9_]|$)'
  for v in "${vals[@]}"; do
    v=${v//$'\001'$q/}
    j=${v//$'\001'\\n/}
    { holds "$j" "$assign" || holds "$v" "$assign"; } && return 0
    while [[ $v == *$q*$q* ]]; do pre=${v%%"$q"*} post=${v#*"$q"} v=$pre${post#*"$q"}; done
    j=${v//$'\001'\\n/}
    holds "$j" "$bare" && return 0
  done
  return 1
}
# Whether value $1, its escapes paired, holds the word $2 once its quotes and backslashes are gone,
# a JSON-escaped blank read as a blank.
holds() {
  local v=${1//\\[nrt]/ }
  v=${v//[$'\001\002'\']/}
  matches "$v" "$2"
}
tree_top "$dir"
top=${top:-$dir}
clean_path
without=" - start the session from a shell without that entry"
ansi=" - the command holds \$', whose escapes can spell any name: write it without (printf, say), or write the \$ as [\$]"
IFS= read -r -d '' input || true
drop_pass
# The line with every backslash-newline, quote and backslash removed, JSON-escaped or not, and a
# `$` before a double quote with it: wider than the shell's removal, never narrower, so
# `"review" start`, `re"vi"ew st'ar't`, `re$"view" start`, `review\ start` and `rev\<newline>iew
# start` read as the start they run. A backslash-newline the shell keeps (escaped, or in a comment)
# ends the command, so removing it joins no start the shell runs; while an entry is dropped, a
# command holding `$'` is refused before this is read.
flat=${input//\\\\\\n/}
flat=${flat//\\\\/}
flat=${flat//\$\\\"/}
flat=${flat//\\\"/}
flat=${flat//\'/}
[ -z "$dropped" ] || { command_values; ! runs_specnaut; } ||
  refuse "VERIFIER REFUSED: $dropped$without"
case "$flat" in *review*) ;; *) exit 0 ;; esac
# A start, as startsReview (src/domain/review_gate.ts) reads one, its blanks as JSON escapes them
# too: wider than the binary's, never narrower. One whose line names PATH may run on a PATH this
# hook never sees.
start='review([[:space:]]|\\[nrt\\])+start'
if matches "$flat" "$start"; then
  [ -z "$dropped" ] || refuse "VERIFIER REFUSED: $dropped$without"
  command_values
  ! names_path ||
    refuse "VERIFIER REFUSED: PATH is named on the line that starts a review, where it can be set - start it with no PATH on the line"
fi
if ! resolve_cmd specnaut; then
  [ -z "$why" ] || refuse "VERIFIER REFUSED: $why"
  exit 0
fi
cd "$dir" || refuse "cannot enter the project folder"
printf '%s' "$input" | "$cmd" review gate && exit 0
exit 2
