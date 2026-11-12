# shellcheck shell=bash
# The one body of apply-plan.sh: the bundled executor that applies the product
# owner's write plan. Sourced — never run — by the backend's own apply-plan.sh,
# which sets `here` (its directory), sources its `_config.sh`, and defines:
#
#   PLAN_CANNOT         a JSON array of what the backend cannot do (`label`,
#                       `close:not_planned`, `create:labels`, ...)
#   board_statuses      the board's columns, one per line
#   repo_labels         the repository's labels, one per line
#   create_item <title> <body-file|""> <labels-csv> <parent|"">
#                       prints the new item's number; its status is add.sh's
#   close_item <n> <reason>, CLOSE_IS_MOVE (1: the close moves the card itself)
#   fallback_label <axis> <value>
#                       the label a classification falls back to, or nothing
#   receipt_snapshot    `cksum` lines of the repository files a write can change
#
# Usage: apply-plan.sh <verb> [--id <n>] <plan-file> <items-file>
#
# The plan is checked whole before anything is written (_backlog_plan.sh): its
# verb, id and fingerprint against the items file's header, every line against
# the schema and the verb's scope, every text against `text_refusal`
# (_clean_text.sh), run over the bytes this script then sends. Any refusal
# writes nothing. Free text reaches a backend script only as a file this script
# wrote in its own 0700 directory; every other value as one argument.
#
# stdout holds these lines and no others, then RECEIPT:
#   APPLIED <op> <n>              FAILED <op> <n|@ref> <exit|skipped>
#   FALLBACK classify <n>         (no such field: the label was set instead)
#   REFUSED <class> <field-path>  (a path such as 3.body, never the value)
#   UNSUPPORTED <op>              (this backend cannot do it; nothing written)
#   RECEIPT: <path>... | none     the repository files changed, to stage
# Exit: 0 applied · 2 usage, or a secret scan that could not run · 3 refused,
# nothing written · 4 an operation failed
# shellcheck disable=SC2154  # `here` is the caller's.

# Every failure below is handled where it happens: `set -e` from `_config.sh`
# would end a run between two writes.
set +e
usage() { echo "usage: apply-plan.sh <verb> [--id <n>] <plan-file> <items-file>" >&2; exit 2; }
VERB=${1:-}
[ "$#" -gt 0 ] && shift
ID=""
if [ "${1:-}" = --id ]; then
  [ "$#" -ge 2 ] || usage
  ID=$(require_issue_number "$2") || exit 2
  shift 2
fi
[ "$#" -eq 2 ] || usage
PLAN=$1 ITEMS_FILE=$2
[[ $VERB =~ ^[a-z][a-z-]{0,31}$ ]] || usage

# shellcheck source=./_backlog_plan.sh
. "$here/_backlog_plan.sh" || exit 2
# shellcheck source=./_backlog_scope.sh
. "$here/_backlog_scope.sh" || exit 2

REFUSED=0
refused() { printf 'REFUSED %s %s\n' "$1" "$2"; REFUSED=1; }
stop_if_refused() { [ "$REFUSED" = 0 ] || { echo "RECEIPT: none"; exit 3; }; }

# The items file's header, up to its first blank line: the facts of the read.
[ -f "$PLAN" ] || refused plan-file plan
[ -f "$ITEMS_FILE" ] || refused items-file header
stop_if_refused
HEADER=$(sed -n '1,/^$/p' "$ITEMS_FILE" | tr -d '\r')
hv() { printf '%s\n' "$HEADER" | sed -n "s/^$1: //p" | head -1; }
[ "$(hv specnaut-items)" = 1 ] || refused items-file header
[ "$(hv verb)" = "$VERB" ] || refused verb header.verb
[ "$(hv id)" = "${ID:-none}" ] || refused id header.id
FP=$(backlog_fingerprint "$ROOT") || FP=""
[ -n "$FP" ] && [ "$(hv fingerprint)" = "$FP" ] || refused fingerprint header.fingerprint
NONCE=$(hv nonce)
[[ $NONCE =~ ^[0-9a-f]{32}$ ]] || refused items-file header.nonce
ITEMS_READ=$(hv items)
[[ $ITEMS_READ =~ ^(none|[0-9]+( [0-9]+)*)$ ]] || refused items-file header.items
[ "$ITEMS_READ" != none ] || ITEMS_READ=""
stop_if_refused
scope_for "$VERB" "$ID" || refused verb verb
stop_if_refused

# The board's facts, read only when a plan line needs them. A read that fails
# refuses the plan: an unknown column must not pass for an allowed one.
SEEN=$(jq_lf -R -r 'try fromjson catch null | objects | .op? | strings' "$PLAN" 2>/dev/null | sort -u)
lines_json() { jq_lf -R -s -c 'split("\n") | map(sub("\r$"; "") | select(length > 0))'; }
STATUSES='[]' LABELS='[]'
if printf '%s\n' "$SEEN" | grep -qx move; then
  STATUSES=$(board_statuses | lines_json) || refused unreadable board.status
fi
if printf '%s\n' "$SEEN" | grep -Eqx 'label|create'; then
  LABELS=$(repo_labels | lines_json) || refused unreadable repo.labels
fi
# Each item's author, off its title tag: attributes by name, never by position.
AUTHORS=$(jq_lf -n -R -c --arg nonce "$NONCE" '[inputs | sub("\r$"; "") | select(startswith("<untrusted-issue-text "))
  | [scan("([a-z_]+)=\"([^\"]*)\"") | {(.[0]): .[1]}] | add | select(.nonce == $nonce and .field == "title")
  | select((.item | test("^[1-9][0-9]*$")) and (.author // "" | test("^[A-Za-z0-9._-]+$"))) | {(.item): .author}]
  | add // {}' "$ITEMS_FILE") || refused items-file authors
stop_if_refused
ops_json() { printf '%s' "$1" | jq_lf -R -s -c 'split(" ") | map(select(length > 0))'; }
RESULT=$(jq_lf -n -R -c --argjson ops "$(ops_json "$SCOPE_OPS")" --argjson targets "$(ops_json "$SCOPE_TARGETS")" \
  --argjson parents "$(ops_json "$SCOPE_PARENTS")" --argjson refs "$SCOPE_REFS" --argjson statuses "$STATUSES" \
  --argjson labels "$LABELS" \
  --argjson authors "$AUTHORS" --argjson cannot "$PLAN_CANNOT" --argjson max "$PLAN_MAX_OPS" \
  "$ISSUE_TEXT_JQ$CLEAN_TEXT_JQ$PLAN_DEFS$PLAN_JQ" <"$PLAN") || { refused parse plan; stop_if_refused; }
printf '%s' "$RESULT" | jq_lf -r '.refused[] | "REFUSED \(.[0]) \(.[1])"'
printf '%s' "$RESULT" | jq_lf -r '.unsupported[] | "UNSUPPORTED \(.)"'
[ "$(printf '%s' "$RESULT" | jq_lf '(.refused | length) + (.unsupported | length)')" = 0 ] || REFUSED=1
stop_if_refused

TMP=${TMPDIR:-/tmp}
WORK=$(mktemp -d "${TMP%/}/backlog-plan.XXXXXXXX") || { echo "apply-plan.sh: no temporary directory" >&2; exit 2; }
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"
printf '%s' "$RESULT" | jq_lf -c '.ops[]' >"$WORK/ops.jsonl"

# Every text, written once to the file it is sent from, judged from those bytes.
# A scan that could not run would pass every text: it stops the run.
while IFS= read -r op <&3; do
  at=$(jq_lf -r .line <<<"$op")
  for k in title body append; do
    jq_lf -e --arg k "$k" 'has($k)' <<<"$op" >/dev/null || continue
    jq_lf -j --arg k "$k" '.[$k]' <<<"$op" >"$WORK/$at.$k"
    rc=0
    class=$(text_refusal <"$WORK/$at.$k") || rc=$?
    case $rc in
      0) ;;
      1) refused "${class:-secret}" "$at.$k" ;;
      *) exit 2 ;;
    esac
  done
  if [ "$VERB" = groom ] && [ "$(jq_lf -r .op <<<"$op")" = close ]; then
    epic_cleared "$(jq_lf -r .target <<<"$op")" || refused scope "$at.target"
  fi
done 3<"$WORK/ops.jsonl"
stop_if_refused

shown() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
text() { cat -- "$WORK/$at.$1"; printf x; }
REFS=" " RC=0
resolve() { case $1 in @*) r=${REFS#* "$1"=}; [ "$r" != "$REFS" ] && printf '%s' "${r%% *}" ;; *) printf '%s' "$1" ;; esac; }
report() { if [ "$2" = 0 ]; then echo "APPLIED $1 $3"; else echo "FAILED $1 $3 $2"; RC=4; fi; }
BEFORE=$(receipt_snapshot)
while IFS= read -r op <&3; do
  at=$(jq_lf -r .line <<<"$op")
  o=$(jq_lf -r .op <<<"$op")
  t=$(jq_lf -r '.target // empty' <<<"$op")
  n=$(resolve "$t")
  if [ -n "$t" ] && [ -z "$n" ]; then echo "FAILED $o $t skipped"; RC=4; continue; fi
  rc=0
  case $o in
    create)
      title=$(text title); bf=""; [ ! -f "$WORK/$at.body" ] || bf=$(shown "$WORK/$at.body")
      p=$(resolve "$(jq_lf -r '.parent // empty' <<<"$op")")
      new=$(create_item "${title%x}" "$bf" "$(jq_lf -r '(.labels // []) | join(",")' <<<"$op")" "$p") || rc=$?
      ref=$(jq_lf -r '.ref // empty' <<<"$op")
      if [[ $new =~ ^[1-9][0-9]*$ ]]; then [ -z "$ref" ] || REFS="$REFS$ref=$new "; report create "$rc" "$new"
      else [ "$rc" != 0 ] || rc=1; echo "FAILED create ${ref:-new} $rc"; RC=4; fi ;;
    edit)
      args=("$n")
      if [ -f "$WORK/$at.title" ]; then title=$(text title); args+=(--title "${title%x}"); fi
      [ ! -f "$WORK/$at.append" ] || args+=(--append-file "$(shown "$WORK/$at.append")")
      bash "$here/edit.sh" "${args[@]}" >/dev/null 2>&1 || rc=$?
      report edit "$rc" "$n" ;;
    comment)
      bash "$here/clarify-comment.sh" "$n" --body-file "$(shown "$WORK/$at.body")" >/dev/null 2>&1 || rc=$?
      report comment "$rc" "$n" ;;
    move)
      bash "$here/move.sh" "$n" "$(jq_lf -r .status <<<"$op")" >/dev/null 2>&1 || rc=$?
      report move "$rc" "$n" ;;
    classify)
      axis=$(jq_lf -r .axis <<<"$op") value=$(jq_lf -r .value <<<"$op")
      bash "$here/set-field.sh" "$n" "$axis" "$value" >/dev/null 2>&1 || rc=$?
      lbl=""; [ "$rc" != 10 ] || lbl=$(fallback_label "$axis" "$value")
      if [ -n "$lbl" ] && bash "$here/label.sh" "$n" "$lbl" >/dev/null 2>&1; then echo "FALLBACK classify $n"
      else report classify "$rc" "$n"; fi ;;
    label)
      IFS=, read -r -a labels <<<"$(jq_lf -r '.labels | join(",")' <<<"$op")"
      bash "$here/label.sh" "$n" "${labels[@]}" >/dev/null 2>&1 || rc=$?
      report label "$rc" "$n" ;;
    close)
      bash "$here/cascade-check.sh" "$n" >/dev/null 2>&1 || rc=$?
      [ "$rc" != 0 ] || close_item "$n" "$(jq_lf -r .reason <<<"$op")" >/dev/null 2>&1 || rc=$?
      report close "$rc" "$n"
      if [ "$rc" = 0 ] && [ "$CLOSE_IS_MOVE" != 1 ]; then
        rc=0; bash "$here/move.sh" "$n" Done >/dev/null 2>&1 || rc=$?
        report move "$rc" "$n"
      fi ;;
    link)
      p=$(resolve "$(jq_lf -r .parent <<<"$op")")
      if [ -z "$p" ]; then echo "FAILED link $n skipped"; RC=4; continue; fi
      bash "$here/link.sh" "$n" "$p" >/dev/null 2>&1 || rc=$?
      report link "$rc" "$n" ;;
    *) echo "FAILED $o $n skipped"; RC=4 ;;
  esac
done 3<"$WORK/ops.jsonl"

CHANGED=$(printf '%s\n' "$(receipt_snapshot)" | grep -vxF -f <(printf '%s\n' "$BEFORE") | awk 'NF { print $NF }' | sort -u | tr '\n' ' ')
CHANGED=${CHANGED% }
echo "RECEIPT: ${CHANGED:-none}"
exit "$RC"
