# shellcheck shell=bash disable=SC2034
# (SC2034: EXPLICIT_* are read by the sourcing script.)
# _explicit_head.sh - the one home of an explicit head: the commit a script is told to
# judge, by its full id, in place of HEAD. Sourced, never run, by size-ratchet.sh,
# boundary-check.sh, _git_untrusted.sh (git-read.sh, collect-audit-scope.sh) and
# _gate_candidate.sh (gate-impact.sh).
#
#   --head <sha>      a full commit id: 40 or 64 lowercase hex digits, the object
#                     format's own length, so no ref name, revision expression or
#                     option can be spelled with it
#   --objects <dir>   an absolute git objects folder holding that commit, such as the
#                     one of a repository a single branch was fetched into
#
# Given a head, a script reads the branch only from git's objects, by that id: never
# HEAD, the index or a work tree, so no file on disk stands in for the commit and no
# folder is searched for a repository. The objects folder is added to the repository's
# own as an alternate (GIT_ALTERNATE_OBJECT_DIRECTORIES) for each git call: its objects
# become readable and nothing else of its repository is read, neither refs, config nor
# hooks. Without it, the head must already be in the repository.
#
# The precondition is the control: the objects folder belongs to a fresh bare repository
# (`git init` with no template) that GitBranchFetcher filled by one fetch with
# transfer.fsckObjects and fetch.fsckObjects, and that is never mounted in a sandbox, so
# nothing the branch runs could write into it after fsck. The checks below stand behind
# that precondition, never in its place: they read the folder before git's own read, so
# a folder something could still write into between the two is not one they can judge.
# The trees and blobs a commit reaches are read by id and not hashed again here. What else
# such a folder could make git read is refused, or turned off on each git call:
#
#   - a path git would split as a list (`:` or `;`, past a drive letter under MSYS only)
#     or unquote (a leading `"`): GIT_ALTERNATE_OBJECT_DIRECTORIES is a list;
#   - info/http-alternates;
#   - an info/alternates other than the one line GitBranchFetcher writes: this
#     repository's own objects folder, absolute, compared once resolved. The line is
#     taken as git reads it, so what the two would read differently is refused: a NUL
#     or another control byte, a `.` or `..` component (git resolves them by spelling,
#     the file system through links), a drive letter outside MSYS (git reads it there
#     as a relative path), a leading `/` under MSYS (bash maps it to a drive, git.exe
#     does not);
#   - its commit graphs and multi-pack indexes, which git reads in place of the
#     objects: explicit_head_git runs git with both off.
#
# explicit_head_option <option> [<value>...] - the one parse of `--head <sha>` and
#   `--objects <dir>`: keeps the value in EXPLICIT_HEAD_OPTION or EXPLICIT_OBJECTS_OPTION and
#   the caller shifts two. Returns 1 for any other option, and 2 with EXPLICIT_REFUSAL set for
#   a value that is missing or empty: an empty head is a refusal, never "no head".
# explicit_head_options <args...> - the one loop over a command line of only those two
#   options: returns 2 with EXPLICIT_REFUSAL set as explicit_head_option does, and 1 with it
#   set for any other argument.
# explicit_head_from_options <git...> - takes the head those options named, if any: refuses
#   --objects without --head, then runs explicit_head_take.
# explicit_head_take <sha> <objects or ""> <git...> - checks both, then that <git...>
#   resolves <sha> as a commit to itself; sets EXPLICIT_HEAD and EXPLICIT_OBJECTS. A
#   refusal sets EXPLICIT_REFUSAL to why and returns 2, leaving both empty.
# explicit_head_is_id <text> - true for a full commit id, in the form --head takes.
# explicit_head_env - exports the objects folder for git. Call it in the subshell that
#   runs git, after any inherited GIT_* variable was dropped.
# explicit_head_git <args...> - git, with `-c core.commitGraph=false -c
#   core.multiPackIndex=false` while an objects folder is taken. Every git call a
#   script makes once explicit_head_env ran goes through it, the check above included.
# explicit_head_names_head <rev> - true for a spelling of HEAD (`HEAD`, `@`, either
#   followed by `~` or `^`), in any case: where the file system folds case, git
#   resolves `head` to HEAD. A script given a head must not read it.

EXPLICIT_HEAD="" EXPLICIT_OBJECTS="" EXPLICIT_REFUSAL=""
EXPLICIT_HEAD_OPTION="" EXPLICIT_OBJECTS_OPTION=""

explicit_head_option() {
  case "$1" in --head | --objects) ;; *) return 1 ;; esac
  [ -n "${2:-}" ] || { EXPLICIT_REFUSAL="$1 takes a value"; return 2; }
  if [ "$1" = --head ]; then EXPLICIT_HEAD_OPTION="$2"; else EXPLICIT_OBJECTS_OPTION="$2"; fi
}

explicit_head_options() {
  local rc
  while [ "$#" -gt 0 ]; do
    rc=0 && explicit_head_option "$@" || rc=$?
    case $rc in
      0) shift 2 ;;
      2) return 2 ;;
      *) EXPLICIT_REFUSAL="usage: [--head <sha> [--objects <dir>]], not $1"; return 1 ;;
    esac
  done
}

explicit_head_from_options() {
  [ -n "$EXPLICIT_HEAD_OPTION$EXPLICIT_OBJECTS_OPTION" ] || return 0
  [ -n "$EXPLICIT_HEAD_OPTION" ] || { EXPLICIT_REFUSAL="--objects needs --head"; return 2; }
  explicit_head_take "$EXPLICIT_HEAD_OPTION" "$EXPLICIT_OBJECTS_OPTION" "$@"
}

explicit_head_take() {
  local sha="$1" objects="$2" full
  shift 2
  EXPLICIT_HEAD="" EXPLICIT_OBJECTS=""
  explicit_head_is_id "$sha" || { EXPLICIT_REFUSAL="not a full commit id: $sha"; return 2; }
  if [ -n "$objects" ]; then
    EXPLICIT_REFUSAL="$(_explicit_head_objects_refusal "$objects" "$@")" || return 2
  fi
  # A 40-digit id in a SHA-256 repository is a prefix: only an exact answer passes.
  full="$(EXPLICIT_OBJECTS="$objects" && explicit_head_env &&
    "$@" rev-parse --verify --quiet --end-of-options "$sha^{commit}" 2>/dev/null)"
  [ "$full" = "$sha" ] || { EXPLICIT_REFUSAL="no commit $sha in reach"; return 2; }
  EXPLICIT_HEAD="$sha" EXPLICIT_OBJECTS="$objects" EXPLICIT_REFUSAL=""
}

explicit_head_is_id() {
  local re='^[0-9a-f]{40}([0-9a-f]{24})?$'
  [[ $1 =~ $re ]]
}

explicit_head_env() {
  [ -z "$EXPLICIT_OBJECTS" ] || export GIT_ALTERNATE_OBJECT_DIRECTORIES="$EXPLICIT_OBJECTS"
}

explicit_head_git() {
  if [ -n "$EXPLICIT_OBJECTS" ]; then
    command git -c core.commitGraph=false -c core.multiPackIndex=false "$@"
  else
    command git "$@"
  fi
}

# _explicit_head_objects_refusal <dir> <git...> - prints why <dir> is refused and returns
# 1, or prints nothing. The list and quote checks come first: a path git would split or
# unquote names folders this one does not.
_explicit_head_objects_refusal() {
  local dir="$1" info="$1/info" list="$1"
  shift
  # Only Git for Windows reads a drive letter as a path's start, not as a list's first item.
  ! _explicit_head_msys || list="${dir#[A-Za-z]:}"
  case "$dir" in \"*) echo "a path git would unquote: $dir"; return 1 ;; esac
  case "$list" in *[:\;]*) echo "a path git would split as a list: $dir"; return 1 ;; esac
  case "$dir" in /* | [A-Za-z]:[/\\]*) ;; *) echo "not an absolute path: $dir"; return 1 ;; esac
  [ -d "$dir" ] || { echo "not a folder: $dir"; return 1; }
  if [ -e "$info/http-alternates" ] || [ -L "$info/http-alternates" ]; then
    echo "an objects folder naming http alternates: $dir"
    return 1
  fi
  _explicit_head_own_alternates "$info/alternates" "$@" ||
    { echo "an objects folder borrowing from more than this repository: $dir"; return 1; }
}

# _explicit_head_own_alternates <file> <git...> - true when <file> is absent, or a regular
# file of exactly one line naming, absolutely, the objects folder of the repository
# <git...> runs in: what GitBranchFetcher writes. A line in another form - relative, a
# comment, quoted, a second line, a control byte, a `.` or `..` component, a drive letter
# outside MSYS, a leading `/` under it - is one git would read and this check could not judge.
_explicit_head_own_alternates() {
  local file="$1" line own
  shift
  [ -e "$file" ] || [ -L "$file" ] || return 0
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  # No control byte but the newline: read drops a NUL git would not, and no path written holds one.
  [ "$(LC_ALL=C tr -dc '\000-\011\013-\037\177' <"$file" | wc -c | tr -d ' ')" = 0 ] || return 1
  # The first line is the whole file, but for the newline after it.
  IFS= read -r line <"$file" && [ "$(cat -- "$file")" = "$line" ] || return 1
  case "$line" in
    # Under MSYS, bash maps `/c/x` to C:\x, while git.exe reads it from the current drive.
    /*) ! _explicit_head_msys || return 1 ;;
    [A-Za-z]:[/\\]*) _explicit_head_msys || return 1; line="${line//\\//}" ;;
    *) return 1 ;;
  esac
  case "$line/" in */./* | */../*) return 1 ;; esac
  own="$("$@" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [ "$line" -ef "$own/objects" ]
}

# _explicit_head_msys - true under Git for Windows' bash, whose git reads a drive letter as
# the start of an absolute path.
_explicit_head_msys() { case "${OSTYPE:-}" in msys*) return 0 ;; *) return 1 ;; esac; }

explicit_head_names_head() {
  local re='^([Hh][Ee][Aa][Dd]|@)([~^].*)?$'
  [[ $1 =~ $re ]]
}
