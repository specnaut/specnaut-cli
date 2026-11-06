#!/usr/bin/env bash
# Hand the product owner the items it works on, their text as data — every
# backend. Shared: installed beside each backend's own scripts, as
# `_close_shipped.sh` is, and run as `.specnaut/scripts/backlog/read-items.sh`.
#
# Issue text is written by whoever can open or comment on an issue. So it is
# read here, by the backend's `item-record.sh` (one run: Cloud resolves one
# token), and written to ONE file in a fresh directory only the user can open,
# outside the repository. stdout is three lines and nothing else:
#
#   ITEMS_FILE: <path>     the file, for the product owner to read
#   ITEMS: <n> <n> ...     the numbers read, in order (`none` when there are none)
#   FINGERPRINT: <hex>     `git hash-object` of `git status --porcelain`, at the read
#
# The file, top to bottom:
#   - a header — format, verb, id, fingerprint, nonce, items — the facts a plan
#     made from this file is later checked against;
#   - per item, the values the tracker itself vouches for, one `key: value`
#     line each, each checked against its shape: item, created, status, size,
#     priority, state, closed_reason, association, by_viewer, comments. A value
#     outside its shape is not written on its line; it becomes a block below.
#   - every field another person can write — title, body, each comment — as
#       <untrusted-issue-text nonce="N" item="42" field="comment" author="login" association="NONE" by_viewer="false">
#       "the value, JSON-encoded on one line"
#       </untrusted-issue-text nonce="N">
#     N is 128 bits from /dev/urandom, new each run, drawn again should the
#     text hold it. The value is first kept to `_issue_text.sh`'s inert
#     characters, then cut at its field's cap (the tag then says
#     truncated="true"), and every < and > is written < and >, so no
#     line inside a block can read as a tag. An author login outside
#     [A-Za-z0-9._-]{1,64} is written author="".
# How a reader treats the blocks is the agent definition's rule, not this file's.
#
# Usage: read-items.sh <verb> [--id <n>] [<n>... | --status <column>]
#   <verb>      the work the items are read for, one `scope_for` lists in
#               `_backlog_plan.sh` (`groom`, `edit`, ...); recorded in the header
#   --id <n>    the item the verb acts on; read first, recorded in the header
#   --status    every item in that column, as `list.sh --numbers` lists them
# A verb that creates items (SCOPE_REFS) may read nothing: `items: none`.
# Exit: 0 written · 2 usage, a verb scope_for refuses, a refused number, an item
# that cannot be read, no git work tree, no randomness, or a temporary
# directory inside the repository.
# On any failure stdout stays empty and no directory is left behind.
set -euo pipefail

here=$(dirname "$0")
usage() {
  echo "usage: read-items.sh <verb> [--id <n>] [<n>... | --status <column>]" >&2
  exit 2
}
die() { echo "read-items.sh: $*" >&2; exit 2; }

[ "$#" -gt 0 ] || usage
VERB=$1
shift
[[ $VERB =~ ^[a-z][a-z-]{0,31}$ ]] || die "not a verb: $(printf '%q' "$VERB")"
ID=""
STATUS=""
BY_STATUS=false
NUMS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) [ -n "${2:-}" ] && [ -z "$ID" ] || usage; ID=$2; shift 2 ;;
    --status) [ "$#" -ge 2 ] && [ "$BY_STATUS" = false ] || usage; STATUS=$2; BY_STATUS=true; shift 2 ;;
    -*) usage ;;
    *) NUMS+=("$1"); shift ;;
  esac
done
# jq_lf, the family's CR-safe jq; scope_for, the fingerprint and, through
# _issue_text.sh, ISSUE_TEXT_JQ: the characters that pass.
# shellcheck source=../../specnaut/scripts/bash/common.sh
. "$here/../bash/common.sh"
# shellcheck source=./_backlog_plan.sh
. "$here/_backlog_plan.sh"
scope_for "$VERB" "$ID" || die "no plan can follow a read for: $(printf '%q' "$VERB")${ID:+ --id}"
if [ "$BY_STATUS" = true ]; then
  [ "${#NUMS[@]}" -eq 0 ] || usage
  (LC_ALL=C; [[ $STATUS =~ ^[^[:cntrl:]]{1,64}$ ]]) || die "not a column name: $(printf '%q' "$STATUS")"
elif [ "${#NUMS[@]}" -eq 0 ] && [ -z "$ID" ] && [ "$SCOPE_REFS" != true ]; then
  usage
fi

ROOT=$(cd "$here/../../.." && pwd)
FINGERPRINT=$(backlog_fingerprint "$ROOT") || die "$ROOT is not a git work tree: the fingerprint needs one"

if [ "$BY_STATUS" = true ]; then
  listed=$(bash "$here/list.sh" --numbers "$STATUS") || die "could not list the column"
  while IFS= read -r n; do
    n=${n%$'\r'}
    [ -z "$n" ] || NUMS+=("$n")
  done <<<"$listed"
fi
ALL=()
[ -z "$ID" ] || ALL+=("$ID")
ALL+=(${NUMS[@]+"${NUMS[@]}"})

RECORDS=""
if [ "${#ALL[@]}" -gt 0 ]; then
  RECORDS=$(bash "$here/item-record.sh" "${ALL[@]}") || die "nothing read"
fi

# 128 bits, as 32 hex digits. A nonce the fetched text already holds is drawn
# again: only the closing tag this run wrote may carry it.
NONCE=""
for _ in 1 2 3 4 5; do
  NONCE=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \t\r\n') || NONCE=""
  [[ $NONCE =~ ^[0-9a-f]{32}$ ]] || die "could not read 128 random bits from /dev/urandom"
  case "$RECORDS" in *"$NONCE"*) NONCE="" ;; *) break ;; esac
done
[ -n "$NONCE" ] || die "could not draw a nonce the issue text does not hold"

TMP=${TMPDIR:-/tmp}
DIR=$(mktemp -d "${TMP%/}/specnaut-items.XXXXXXXX") || die "could not make a temporary directory"
trap 'rm -rf "$DIR"' EXIT
chmod 700 "$DIR"
case "$(cd "$DIR" && pwd -P)/" in
  "$(cd "$ROOT" && pwd -P)"/*) die "the temporary directory is inside the repository: set TMPDIR elsewhere" ;;
esac
FILE="$DIR/items.txt"

# shellcheck disable=SC2016  # jq program.
PROGRAM='
  def alnum: (. >= 48 and . <= 57) or (. >= 65 and . <= 90) or (. >= 97 and . <= 122);
  def number: type == "string" and length <= 10 and (explode | all(.[]; . >= 48 and . <= 57))
    and (.[0:1] | . != "" and . != "0");
  def word($max): type == "string" and length > 0 and length <= $max
    and (explode | all(.[]; alnum or . == 32 or . == 45 or . == 95 or . == 46 or . == 58 or . == 47));
  def created:
    if type != "string" then "-"
    else (if endswith("Z") and index(".") != null then split(".")[0] + "Z" else . end) as $v
      | ($v | explode) as $c
      | ("0000-00-00T00:00:00Z" | explode) as $t
      | if ($c | length) == ($t | length)
           and all(range($t | length); if $t[.] == 48 then $c[.] >= 48 and $c[.] <= 57 else $c[.] == $t[.] end)
        then $v else "-" end
    end;
  def assoc: . as $a
    | if any("COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN",
             "MEMBER", "NONE", "OWNER"; . == $a) then . else "UNKNOWN" end;
  def viewer: if . == true then "true" elif . == false then "false" else "unknown" end;
  def login: if type == "string" and length <= 64 and (explode | all(.[]; alnum or . == 45 or . == 95 or . == 46))
    then . else "" end;
  def encoded: tojson | split("<") | join("\\u003c") | split(">") | join("\\u003e");
  def block($item; $field; $who; $cap):
    (if type == "string" then . elif . == null then "" else tojson end | inert_body) as $v
    | ($v | length > $cap) as $cut
    | "<untrusted-issue-text nonce=\"\($nonce)\" item=\"\($item)\" field=\"\($field)\" author=\"\($who.author | login)\" association=\"\($who.association | assoc)\" by_viewer=\"\($who.by_viewer | viewer)\"\(if $cut then " truncated=\"true\"" else "" end)>",
      ($v | if $cut then .[:$cap] else . end | encoded),
      "</untrusted-issue-text nonce=\"\($nonce)\">";
  def line($item; $key; $v; $ok):
    if $ok then "\($key): \($v)"
    else "\($key): (outside its shape; the block below holds it)", ($v | block($item; $key; {}; 256)) end;
  def listed($max): (. // []) as $a | { ok: all($a[]; word($max)), v: ($a | join(", ")) };

  [inputs]
  | if all(.[]; .item | number) | not then error("a record without an issue number") else . end
  | reduce .[] as $r ([]; if any(.[]; .item == $r.item) then . else . + [$r] end)
  | (map(.item) | if length == 0 then "none" else join(" ") end) as $items
  | "specnaut-items: 1",
    "verb: \($verb)",
    "id: \(if $has_id then .[0].item else "none" end)",
    "fingerprint: \($fingerprint)",
    "nonce: \($nonce)",
    "items: \($items)",
    (.[] | . as $r | .item as $n
      | "",
        "item: \($n)",
        "created: \(.created | created)",
        line($n; "status"; .status; (.status == "" or (.status | word(64)))),
        ((.sizes | listed(16)) as $s | line($n; "size"; $s.v; $s.ok)),
        ((.priorities | listed(16)) as $p | line($n; "priority"; $p.v; $p.ok)),
        line($n; "state"; $r.state; ($r.state == "open" or $r.state == "closed")),
        line($n; "closed_reason"; $r.closed_reason; ($r.closed_reason == "" or ($r.closed_reason | word(32)))),
        "association: \($r.association | assoc)",
        "by_viewer: \($r.by_viewer | viewer)",
        "comments: \(if $r.comments == null then "unreadable" else $r.comments | length end)",
        ($r.title | block($n; "title"; $r; 512)),
        ($r.body | block($n; "body"; $r; 65536)),
        ($r.comments // [] | .[] | . as $c | .body | block($n; "comment"; $c; 16384)))
'
HAS_ID=false
[ -z "$ID" ] || HAS_ID=true
(
  umask 077
  printf '%s\n' "$RECORDS" | jq_lf -n -r --arg nonce "$NONCE" --arg verb "$VERB" \
    --arg fingerprint "$FINGERPRINT" --argjson has_id "$HAS_ID" "$ISSUE_TEXT_JQ$PROGRAM" >"$FILE"
) || die "could not write the items file"
ITEMS=$(sed -n 's/^items: //p' "$FILE" | head -1)
[[ $ITEMS =~ ^(none|[0-9]+( [0-9]+)*)$ ]] || die "the items file has no item list"

SHOWN=$FILE
if command -v cygpath >/dev/null 2>&1; then SHOWN=$(cygpath -m "$FILE"); fi
trap - EXIT
printf 'ITEMS_FILE: %s\nITEMS: %s\nFINGERPRINT: %s\n' "$SHOWN" "$ITEMS" "$FINGERPRINT"
