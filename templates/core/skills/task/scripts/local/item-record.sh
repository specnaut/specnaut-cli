#!/usr/bin/env bash
# One record per item, as JSON Lines — local backend. The one read both
# `groom-verify.sh` (through groom-rules.sh) and `read-items.sh` use.
#
# This script READS and NORMALISES; it decides nothing. Where each part of the
# record comes from, in a task file (`.specnaut/backlog/NNN-slug.md`):
#   item         the number, as a string, zero padding dropped
#   title        the frontmatter `title:`, verbatim
#   created      the frontmatter `created:`, verbatim; null without one
#   body         everything after the frontmatter
#   author, association, by_viewer
#                CANNOT be read: a task file names no author. null.
#   sizes        the frontmatter `size:` value, split on commas — so `M, L` is
#                two sizes. `complexity:` is a retired key and is NOT a size.
#   priorities   the frontmatter `priority:` value, split the same way
#   status       the frontmatter `status:` (the column `move.sh` writes)
#   comments     each `## Clarification (…)` section `clarify-comment.sh`
#                appends, as { body, author, association, by_viewer } with no
#                author known
#   state, closed_reason
#                CANNOT be read: a task file has no closed state and records no
#                close reason (`Done` is a column). Passed as open / "".
#
# Usage: item-record.sh <number>...
# Output: one JSON object per line, in the order given — or nothing at all:
# exit 2 when an argument is not a number, an item has no task file, or its
# frontmatter cannot be read.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -gt 0 ] || { echo "usage: item-record.sh <number>..." >&2; exit 2; }
ITEMS=()
for a in "$@"; do
  n=$(require_issue_number "$a") || exit 2
  ITEMS+=("$n")
done

# One task file → one record on stdout. Fails (non-zero) on a file it cannot read.
record() {
  local num="$1" padded file
  padded=$(printf '%03d' "$((10#$num))")
  file=""
  for file in "$BACKLOG_DIR/$padded"-*.md; do break; done
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    echo "item-record.sh: no backlog item #$padded in $BACKLOG_DIR" >&2
    return 1
  fi
  # shellcheck disable=SC2016  # jq program.
  jq_lf -n -c --arg item "$num" --rawfile text "$file" '
    ($text | gsub("\r"; "") | split("\n")) as $l
    | if $l[0] != "---" then error("no frontmatter") else . end
    | ([range(1; $l | length) | select($l[.] == "---")] | first
       // error("frontmatter never closed")) as $end
    | $l[1:$end] as $fm
    | $l[$end + 1:] as $body
    | def raw($k): [$fm[] | select(startswith($k + ":")) | .[($k | length) + 1:] | sub("^\\s+"; "")] | first;
      def key($k): (raw($k) // "") | sub("\\s+#.*$"; "");
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
      def nobody: { author: null, association: null, by_viewer: null };
    { item: $item,
      title: (raw("title") // ""),
      created: raw("created"),
      body: ($body | join("\n")) }
    + nobody
    + { sizes: (key("size") | values),
        priorities: (key("priority") | values),
        status: key("status"),
        comments: [clarifications[] | { body: . } + nobody],
        state: "open",
        closed_reason: "" }
  ' || { echo "item-record.sh: cannot read the frontmatter of $file" >&2; return 1; }
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "item-record.sh: #$num not read" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done
printf '%s' "$RECORDS"
