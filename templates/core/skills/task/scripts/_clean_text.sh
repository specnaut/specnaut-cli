# shellcheck shell=bash
# The one home of the backlog writers' text check: no text the secret scan
# refuses reaches a tracker or a task file. `text_refusal` judges bytes;
# `require_clean_text` and `require_clean_file` end a writer on a refusal.
# Sourced, never run, by `_backlog_plan.sh`, so every script that sources the
# plan's vocabulary has it; installed beside it. The scan itself
# (`scan_hard`, the patterns' one home) is `_report_text.sh`, in `../bash`.

_TEXT_DIR=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# CLEAN_TEXT_JQ -- jq definitions of what a plan's text may hold, which the
# executor's validator (PLAN_JQ, _backlog_plan.sh) is appended to:
#   unquoted   the text with closed code taken out, a fenced block or a
#              single-line span each becoming a space, so what follows still
#              starts a word; an unclosed backtick or fence hides nothing
#   mentions   the logins its @s name outside closed code, in GitHub's and
#              GitLab's forms: an @ after anything but a letter, digit or `_`,
#              the login running on through . _ / -, a closing dot dropped,
#              lower-cased (a login is case-blind on both)
#   text_refusals($who)
#              the classes a text is refused under: `entity` for a character
#              reference (`&#64;`, `&#x40;`, `&commat;`), which the tracker
#              decodes after this check, and `mention` for a login not in $who
# shellcheck disable=SC2016  # jq program.
CLEAN_TEXT_JQ='
  def unquoted: gsub("(?:^|(?<=\n))[ \t]*```[^\n]*\n(?:[^\n]*\n)*?[ \t]*```[^\n]*"; "\n") | gsub("`[^`\n]+`"; " ");
  def mentions: [unquoted | match("(?<![A-Za-z0-9_])@([A-Za-z0-9_][A-Za-z0-9_./-]*)"; "g")
    | .captures[0].string | sub("[./]+$"; "") | ascii_downcase];
  def text_refusals($who): (if test("&[#A-Za-z0-9]+;") then "entity" else empty end),
    (if any(mentions[]; . as $m | $who | index([$m]) == null) then "mention" else empty end);
'

# text_refusal < text -- the rule every backlog write meets: no text the secret
# scan refuses (`scan_hard`, `_report_text.sh`: the patterns' one home) reaches
# a tracker or a task file. It reads the bytes on stdin through the scan's own
# `read_bytes`, so a NUL is judged rather than dropped. Its own subshell sources
# the scan (only a caller that writes pays for it), in the C locale the scan
# pins, with `set +e`: a writer's `set -e` would end a scan at the first grep
# that finds nothing. Status: 0 clean, 1 refused with the class (`secret`,
# `hidden`) on stdout, 2 with one line on stderr when there is no scan to run,
# the text could not be read, or a grep of the scan failed: a scan that did not
# run is no verdict, neither clean nor a refusal. Never 0 unscanned.
text_refusal() (
  set +e
  # shellcheck source=../../../specnaut/scripts/bash/_report_text.sh
  if ! . "$_TEXT_DIR/../bash/_report_text.sh" 2>/dev/null || ! declare -F scan_hard >/dev/null; then
    echo "${0##*/}: the secret scan is missing" >&2
    exit 2
  fi
  # The scans' verdict: every one refuses by calling this, and it ends the
  # subshell; `error` as the second word is a grep that could not run.
  # shellcheck disable=SC2329
  refuse() {
    [ "${2-}" != error ] || { echo "${0##*/}: the secret scan could not run" >&2; exit 2; }
    printf '%s' "$1"
    exit 1
  }
  bytes=$(read_bytes) || { echo "${0##*/}: the text could not be read" >&2; exit 2; }
  scan_hard "${bytes%x}"
  exit 0
)

# require_clean_text <field> <text> -- a writer's check of one text field, before
# its first tracker call or file write: clean, or it ends the calling script with
# status 14 and `REFUSED <class> <field>` on stderr, never the text (stdout stays
# the script's result). 14 is used by no other backlog script. A scan that could
# not run ends it with status 2. Call it from the script's own shell.
require_clean_text() {
  local class rc=0
  class=$(printf '%s' "${2-}" | text_refusal) || rc=$?
  _clean_or_exit "$1" "$rc" "$class"
}

# clean_work_dir -- the writer's private work directory, made on first call: a
# fresh directory only the user can open, removed when the script exits.
# CLEAN_DIR names it; a writer builds what it sends from a judged text there.
# It sets the script's EXIT trap, so a writer that calls it sets none of its
# own. Call it from the script's own shell, never in `$(…)`.
clean_work_dir() {
  [ -z "${CLEAN_DIR:-}" ] || return 0
  CLEAN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/backlog-text.XXXXXXXX") || { echo "${0##*/}: no temporary directory" >&2; exit 2; }
  chmod 700 "$CLEAN_DIR"
  trap 'rm -rf "$CLEAN_DIR"' EXIT
}

# require_clean_file <field> <path> -- require_clean_text for a file's bytes. The
# file is copied first into clean_work_dir, which owns the script's EXIT trap;
# CLEAN_FILE names the copy, the one the writer then sends, so the bytes sent
# are the bytes judged.
require_clean_file() {
  local class rc=0
  clean_work_dir
  CLEAN_FILE="$CLEAN_DIR/$1"
  cp -- "$2" "$CLEAN_FILE" || { echo "${0##*/}: could not read the $1 file" >&2; exit 2; }
  class=$(text_refusal <"$CLEAN_FILE") || rc=$?
  _clean_or_exit "$1" "$rc" "$class"
}

_clean_or_exit() {
  case $2 in
    0) ;;
    1) printf 'REFUSED %s %s\n' "${3:-secret}" "$1" >&2; exit 14 ;;
    *) exit 2 ;;
  esac
}
