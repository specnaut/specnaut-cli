#!/usr/bin/env bash
# Prove a groom run left every item it processed complete — local backend.
#
# This script FETCHES and NORMALISES; it decides nothing. What "complete" means
# lives in `.specnaut/scripts/bash/groom-rules.sh`, and its header is the rule.
#
# Where each part of the record comes from, in a task file
# (`.specnaut/backlog/NNN-slug.md`):
#   body         everything after the frontmatter
#   sizes        the frontmatter `size:` value, split on commas — so `M, L` is
#                two sizes. `complexity:` is a retired key and is NOT a size.
#   priorities   the frontmatter `priority:` value, split the same way
#   status       the frontmatter `status:` (the column `move.sh` writes)
#   comments     each `## Clarification (…)` section `clarify-comment.sh` appends
#   state, closed_reason
#                CANNOT be read: a task file has no closed state and records no
#                close reason (`Done` is a column). Passed as open / "", so
#                "closed as not_planned" is never an outcome on this backend.
#
# Usage: groom-verify.sh [--ready <column>|none] <number>...
# Output and exit codes: those of groom-rules.sh — plus exit 2 when an item has
# no task file or its frontmatter cannot be read. Nothing is reported complete
# that was not read.
set -euo pipefail

usage() { echo "usage: groom-verify.sh [--ready <column>|none] <number>..." >&2; exit 2; }

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
RULES="$(dirname "$0")/../bash/groom-rules.sh"

READY="Ready"
ITEMS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ready) [ -n "${2:-}" ] || usage; READY="$2"; shift 2 ;;
    -h | --help) usage ;;
    '' | *[!0-9]*) echo "groom-verify.sh: not an item number: '$1'" >&2; usage ;;
    *) ITEMS+=("$1"); shift ;;
  esac
done
[ "${#ITEMS[@]}" -gt 0 ] || usage

# One task file → one record on stdout. Fails (non-zero) on a file it cannot read.
record() {
  local num="$1" padded file
  padded=$(printf '%03d' "$((10#$num))")
  file=""
  for file in "$BACKLOG_DIR/$padded"-*.md; do break; done
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    echo "groom-verify.sh: no backlog item #$padded in $BACKLOG_DIR" >&2
    return 1
  fi
  # shellcheck disable=SC2016  # jq program.
  jq -n -c --arg item "$num" --rawfile text "$file" '
    ($text | gsub("\r"; "") | split("\n")) as $l
    | if $l[0] != "---" then error("no frontmatter") else . end
    | ([range(1; $l | length) | select($l[.] == "---")] | first
       // error("frontmatter never closed")) as $end
    | $l[1:$end] as $fm
    | $l[$end + 1:] as $body
    | def key($k):
        [$fm[] | select(test("^" + $k + ":")) | sub("^" + $k + ":\\s*"; "") | sub("\\s+#.*$"; "")]
        | first // "";
      def values: gsub("[\\[\\]\"'\'']"; "") | [splits("\\s*,\\s*")] | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != ""));
      def clarifications:
        reduce $body[] as $x ({cur: null, out: []};
          if ($x | test("^##\\s+Clarification\\b")) then
            (if .cur != null then .out += [.cur] else . end) | .cur = ""
          elif ($x | test("^#{1,2}\\s")) then
            (if .cur != null then .out += [.cur] else . end) | .cur = null
          elif .cur != null then .cur += ($x + "\n")
          else . end)
        | if .cur != null then .out + [.cur] else .out end
        | map(sub("^\\s+"; ""));
    { item: $item,
      body: ($body | join("\n")),
      sizes: (key("size") | values),
      priorities: (key("priority") | values),
      status: key("status"),
      comments: clarifications,
      state: "open",
      closed_reason: "" }
  ' || { echo "groom-verify.sh: cannot read the frontmatter of $file" >&2; return 1; }
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "groom-verify.sh: #$num not read — nothing verified" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done

rc=0
printf '%s' "$RECORDS" | bash "$RULES" --ready "$READY" || rc=$?
exit "$rc"
