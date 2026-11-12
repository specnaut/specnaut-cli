# shellcheck shell=bash
# The one home of how a backlog writer reads the arguments every backend's
# add.sh, clarify-comment.sh and close.sh share: a positional body, or
# `--body-file <path>` in its place, and `--parent <num>`. Sourced before
# `_config.sh`, so `--help` and a usage error need no configured backend;
# installed beside it. A usage error ends the calling script with status 2.
#
# An argument a writer would not record is refused, never dropped: a caller
# that passed it must not believe it reached the tracker.

# args_refuse [<message>] -- the message, when there is one, then the usage
# (ARGS_USAGE) on stderr; ends the script with status 2.
args_refuse() {
  [ -z "${1:-}" ] || echo "${0##*/}: $1" >&2
  echo "$ARGS_USAGE" >&2
  exit 2
}

# body_file_arg --body-file <path> -- BODY_FILE set to <path>, which must be a
# file; the writer reads it, so the text never stands on a command line.
body_file_arg() {
  [ "$#" -ge 2 ] && [ -f "$2" ] || { echo "${0##*/}: --body-file needs a file" >&2; exit 2; }
  BODY_FILE=$2
}

# parse_add_args <usage> <extra> <args...> -- add.sh's arguments: a title, an
# optional body, then at most <extra> more positionals (a backend's labels), and
# `--parent <num>` and `--body-file <path>` anywhere. Sets TITLE, BODY,
# BODY_FILE, PARENT and EXTRA. `--help` prints <usage> and ends with status 0.
parse_add_args() {
  ARGS_USAGE=$1
  local extra=$2 pos=()
  shift 2
  PARENT="" BODY_FILE=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h | --help) echo "$ARGS_USAGE"; exit 0 ;;
      --parent) [ "$#" -ge 2 ] || args_refuse; PARENT=$2; shift 2 ;;
      --body-file) body_file_arg "$@"; shift 2 ;;
      --*) args_refuse "unknown flag '$1'" ;;
      *) pos+=("$1"); shift ;;
    esac
  done
  [ "${#pos[@]}" -ge 1 ] || args_refuse
  _positionals_fit "$extra" "${pos[@]}"
  TITLE=${pos[0]} BODY=${pos[1]:-} EXTRA=("${pos[@]:2}")
  [ -z "$BODY_FILE" ] || [ -z "$BODY" ] || { echo "${0##*/}: give a body or --body-file, not both" >&2; exit 2; }
}

# _positionals_fit <extra> <title> [<body> ...] -- a usage error when more than
# a title, a body and <extra> positionals were given. Labels are the only extra
# positional any backend takes, so a backend that takes none says so.
_positionals_fit() {
  local extra=$1
  shift
  [ "$#" -gt $((extra + 2)) ] || return 0
  [ "$extra" -gt 0 ] || args_refuse "this backlog has no labels field; '$3' would not be recorded"
  shift $((extra + 2))
  args_refuse "one argument too many; '$1' would not be recorded"
}

# parse_comment_args <args...> -- clarify-comment.sh's arguments: an issue
# number, then the text or `--body-file <path>`. Sets NUM_ARG, BODY and BODY_FILE.
parse_comment_args() {
  ARGS_USAGE='usage: clarify-comment.sh <number> "<question>" | <number> --body-file <path>'
  [ "$#" -ge 2 ] || args_refuse
  NUM_ARG=$1 BODY="" BODY_FILE=""
  case "$#:$2" in
    3:--body-file) body_file_arg "$2" "$3" ;;
    *:--body-file) body_file_arg "$2" ;;
    2:*) BODY=$2 ;;
    *) args_refuse "one argument too many; '$3' would not be recorded" ;;
  esac
}
