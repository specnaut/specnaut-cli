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
# explicit_head_option <option> [<value>...] - the one parse of `--head <sha>` and
#   `--objects <dir>`: keeps the value in EXPLICIT_HEAD_OPTION or EXPLICIT_OBJECTS_OPTION and
#   the caller shifts two. Returns 1 for any other option, and 2 with EXPLICIT_REFUSAL set for
#   a value that is missing or empty: an empty head is a refusal, never "no head".
# explicit_head_from_options <git...> - takes the head those options named, if any: refuses
#   --objects without --head, then runs explicit_head_take.
# explicit_head_take <sha> <objects or ""> <git...> - checks both, then that <git...>
#   resolves <sha> as a commit to itself; sets EXPLICIT_HEAD and EXPLICIT_OBJECTS. A
#   refusal sets EXPLICIT_REFUSAL to why and returns 2, leaving both empty.
# explicit_head_env - exports the objects folder for git. Call it in the subshell that
#   runs git, after any inherited GIT_* variable was dropped.
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

explicit_head_from_options() {
  [ -n "$EXPLICIT_HEAD_OPTION$EXPLICIT_OBJECTS_OPTION" ] || return 0
  [ -n "$EXPLICIT_HEAD_OPTION" ] || { EXPLICIT_REFUSAL="--objects needs --head"; return 2; }
  explicit_head_take "$EXPLICIT_HEAD_OPTION" "$EXPLICIT_OBJECTS_OPTION" "$@"
}

explicit_head_take() {
  local sha="$1" objects="$2" full re='^[0-9a-f]{40}([0-9a-f]{24})?$'
  shift 2
  EXPLICIT_HEAD="" EXPLICIT_OBJECTS=""
  [[ $sha =~ $re ]] || { EXPLICIT_REFUSAL="not a full commit id: $sha"; return 2; }
  if [ -n "$objects" ]; then
    case "$objects" in
      /* | [A-Za-z]:[/\\]*) ;;
      *) EXPLICIT_REFUSAL="not an absolute path: $objects"; return 2 ;;
    esac
    [ -d "$objects" ] || { EXPLICIT_REFUSAL="not a folder: $objects"; return 2; }
  fi
  # A 40-digit id in a SHA-256 repository is a prefix: only an exact answer passes.
  full="$(EXPLICIT_OBJECTS="$objects" && explicit_head_env &&
    "$@" rev-parse --verify --quiet --end-of-options "$sha^{commit}" 2>/dev/null)"
  [ "$full" = "$sha" ] || { EXPLICIT_REFUSAL="no commit $sha in reach"; return 2; }
  EXPLICIT_HEAD="$sha" EXPLICIT_OBJECTS="$objects" EXPLICIT_REFUSAL=""
}

explicit_head_env() {
  [ -z "$EXPLICIT_OBJECTS" ] || export GIT_ALTERNATE_OBJECT_DIRECTORIES="$EXPLICIT_OBJECTS"
}

explicit_head_names_head() {
  local re='^([Hh][Ee][Aa][Dd]|@)([~^].*)?$'
  [[ $1 =~ $re ]]
}
