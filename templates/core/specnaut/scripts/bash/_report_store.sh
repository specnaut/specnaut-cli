# shellcheck shell=bash disable=SC2154,SC2034
# Sourced by report-upstream.sh: where a report lives on disk, and how it is read
# back. It uses that script's `refuse`, $HOME and $DIGEST_RE, and _report_text.sh's
# read_bytes, digest_of and scan_hard. A place that cannot be used refuses as
# `storage`, so the phase can still give the user a link.

use_report_dir() {
  DIR=$HOME/.specnaut/reports
  if [ -L "$HOME/.specnaut" ] || [ -L "$DIR" ]; then refuse storage; fi
  mkdir -p "$DIR" 2>/dev/null || refuse storage
  [ -w "$DIR" ] || refuse storage
  chmod 700 "$DIR" 2>/dev/null
}

# write_file <dest> <content>: whole or not at all, through a name nothing can guess.
write_file() {
  local tmp
  tmp=$(mktemp "$DIR/.tmp.XXXXXX" 2>/dev/null) || refuse storage
  if ! { printf '%s' "$2" >"$tmp" && mv -f "$tmp" "$1"; }; then
    rm -f "${tmp:?}"
    refuse storage
  fi
}

# Sets RAW from stdin: bounded, with LF line ends.
read_input() {
  RAW=$(read_bytes)
  RAW=${RAW%x}
  [ "${#RAW}" -le "$MAX_BYTES" ] || refuse size
  RAW=${RAW//"$CR$NL"/"$NL"}
}

# Sets TITLE and BODY from RAW; the body starts at its first line and ends in a newline.
split_report() {
  case $RAW in
    *"$NL"*) TITLE=${RAW%%"$NL"*}; BODY=${RAW#*"$NL"} ;;
    *) TITLE=$RAW; BODY="" ;;
  esac
  [ -n "$(printf '%s' "$TITLE" | tr -d ' \t')" ] || refuse empty
  [ "${#TITLE}" -le 256 ] || refuse size
  [ -n "$(printf '%s' "$BODY" | tr -d ' \t\n')" ] || refuse empty
  while :; do
    case $BODY in "$NL"*) BODY=${BODY#"$NL"} ;; *) break ;; esac
  done
  case $BODY in *"$NL") ;; *) BODY=$BODY$NL ;; esac
}

# A report the user declined leaves no trace past a day; one that was sent keeps its URL.
prune_drafts() {
  local f
  while IFS= read -r f; do
    if [ -n "$f" ] && [ ! -e "${f%.md}.sent" ]; then
      rm -f "${f:?}" "${f%.md}.login"
    fi
  done <<<"$(find "$DIR" -maxdepth 1 -name '*.md' -mmin +1440 2>/dev/null)"
}

# Sets TEXT, KIND_LABEL, TITLE, BODY from the file, hashed once from the bytes
# then used, so what is sent cannot differ from what was checked.
load_report() {
  local first rest kind
  [[ ${1:-} =~ $DIGEST_RE ]] || refuse digest
  use_report_dir
  [ -f "$DIR/$1.md" ] && [ ! -L "$DIR/$1.md" ] || refuse digest
  TEXT=$(read_bytes <"$DIR/$1.md")
  TEXT=${TEXT%x}
  [ "$(digest_of "$TEXT")" = "$1" ] || refuse digest
  first=${TEXT%%"$NL"*}
  rest=${TEXT#*"$NL"}
  kind=${first#kind: }
  TITLE=${rest%%"$NL"*}
  TITLE=${TITLE#title: }
  BODY=${rest#*"$NL"}
  BODY=${BODY#"$NL"}
  case $kind in bug) KIND_LABEL=bug ;; proposal) KIND_LABEL=enhancement ;; *) refuse digest ;; esac
  scan_hard "$TEXT"
}
