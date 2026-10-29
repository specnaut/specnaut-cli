#!/usr/bin/env bash
# groom-rules.sh — what makes a groomed backlog item complete. The ONE home of
# that rule: `groom.md` points here, and each backend's
# `.specnaut/scripts/backlog/groom-verify.sh` only fetches an item, normalises
# it, and pipes it in. A backend that decided anything itself would be a second
# copy of the rule set, free to drift from this one.
#
# A processed item is complete when it has ALL of:
#
#   1. the body sections `## Why`, `## Acceptance criteria`, `## Out of scope`,
#      each with at least one non-blank line before the next `#`/`##` heading
#      (a `###` sub-heading is content). A heading with nothing under it is a
#      template nobody filled in, not a section.
#   2. exactly one size, one of XS S M L XL;
#   3. exactly one priority, one of P0 P1 P2 P3. The same value on two surfaces
#      (a native field and a label) is one value; two different values are two,
#      and the item is incomplete until one is removed.
#   4. an outcome: in the ready column, OR a comment whose text starts with the
#      marker `🤖 specnaut-groom`, OR closed with the reason `not_planned`.
#      With `--ready none` (the user chose to groom without promoting) the item
#      stays where it is by design, and the outcome is not checked.
#
# Pure: reads stdin, writes stdout, touches nothing else.
#
# Input: one JSON object per item, as a stream (one per line is fine):
#
#   { "item": "42",              item number, as the backend names it
#     "body": "…",               the item's description
#     "sizes": ["M"],            every size value found, on every surface
#     "priorities": ["P1"],      every priority value found, on every surface
#     "status": "Ready",         the board column, "" when the item has none
#     "comments": ["…"] | null,  comment texts; null = this backend cannot read
#                                them, which counts as no comment, never as one
#     "state": "open"|"closed",
#     "closed_reason": "not_planned" | "completed" | "" }
#
# A value the backend could not read is passed as absent (an empty list, "",
# null) — never invented. Missing is the safe direction: it is reported.
#
# Usage:  <records> | groom-rules.sh [--ready <column>|none]   (default Ready)
# Output: one line per incomplete item, nothing for a complete one:
#           #42: missing ## Why; size (none); outcome (not in Ready, …)
# Exit:   0 every item complete · 1 at least one incomplete ·
#         2 usage, `jq` missing, no record, or a record it cannot read — it
#           never answers "complete" for an item it did not see.
set -euo pipefail

READY="Ready"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ready)
      [ -n "${2:-}" ] || { echo "usage: groom-rules.sh [--ready <column>|none] < records" >&2; exit 2; }
      READY="$2"
      shift 2
      ;;
    *)
      echo "groom-rules.sh: unknown argument '$1'" >&2
      echo "usage: groom-rules.sh [--ready <column>|none] < records" >&2
      exit 2
      ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "groom-rules.sh: jq is required — nothing verified" >&2
  exit 2
fi

# shellcheck disable=SC2016  # $ready, $l, … are jq variables, not shell ones.
PROGRAM='
def strings_or_empty: type == "array" and all(.[]; type == "string");

def readable:
  type == "object"
  and ((.item | type) == "string" or (.item | type) == "number")
  and ((.item | tostring) != "")
  and (.body | type) == "string"
  and (.sizes | strings_or_empty)
  and (.priorities | strings_or_empty)
  and (.status | type) == "string"
  and (.comments == null or (.comments | strings_or_empty))
  and (.state == "open" or .state == "closed")
  and (.closed_reason | type) == "string";

# A section is filled when its `##` heading has a non-blank line under it
# before the next `#` or `##` heading.
def filled($heading):
  reduce (.body | gsub("\r"; "") | split("\n"))[] as $l ({in: false, ok: false};
    if ($l | test("^#{1,2}\\s")) then .in = ($l | test("^##\\s+" + $heading + "\\s*$"; "i"))
    elif .in and ($l | test("\\S")) then .ok = true
    else . end)
  | .ok;

def exactly_one($axis; $values; $allowed):
  ($values | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != "")) | unique) as $v
  | if ($v | length) == 0 then "\($axis) (none)"
    elif ($v | length) > 1 then "\($axis) (\($v | length) values: \($v | join(", ")))"
    elif any($allowed[]; . == $v[0]) | not then "\($axis) (\($v[0]) is not one of \($allowed | join(" ")))"
    else empty end;

def marked: any(.comments // [] | .[]; sub("^\\s+"; "") | startswith("🤖 specnaut-groom"));

def outcome($ready):
  if $ready == "none" then empty
  elif (.status | ascii_downcase) == ($ready | ascii_downcase) then empty
  elif .state == "closed" and .closed_reason == "not_planned" then empty
  elif marked then empty
  else "outcome (not in \($ready), "
    + (if .comments == null then "comments unreadable on this backend" else "no 🤖 specnaut-groom comment" end)
    + ", not closed as not_planned)"
  end;

[inputs] as $records
| if ($records | length) == 0 then error("no record on stdin") else . end
| ($records | map(select(readable | not)) | first) as $bad
| if $bad != null then error("unreadable record: \($bad | tojson | .[0:200])") else . end
| $records[]
| [ (("Why", "Acceptance criteria", "Out of scope") as $h | if filled($h) then empty else "## \($h)" end),
    exactly_one("size"; .sizes; ["XS", "S", "M", "L", "XL"]),
    exactly_one("priority"; .priorities; ["P0", "P1", "P2", "P3"]),
    outcome($ready) ] as $missing
| select($missing | length > 0)
| "#\(.item): missing \($missing | join("; "))"
'

if ! out="$(jq -n -r --arg ready "$READY" "$PROGRAM")"; then
  echo "groom-rules.sh: could not read the records — nothing verified" >&2
  exit 2
fi

[ -n "$out" ] || exit 0
printf '%s\n' "$out"
exit 1
