#!/usr/bin/env bash
# The product owner's write plan, applied by the installed executor on every
# backend. read-items.sh writes the items file outside the work tree, then
# apply-plan.sh checks the plan (_apply_plan.sh, with the vocabulary of
# _backlog_plan.sh and the scope of _backlog_scope.sh) and runs the backend's
# own scripts. Each tracker CLI is a stand-in that logs every argv, so a check
# reads what reached the tracker, or what the local files now hold.
#
# Usage: smoke-backlog-plan.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-plan.sh <name>}"
. "$(dirname "$0")/_common.sh"
smoke_require_name "$NAME"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/plan-smoke.XXXXXX")
trap 'rm -rf -- "$WORK"; for b in local github gitlab cloud; do
  bash "$SMOKE_DIR/clean.sh" "$NAME-$b" >/dev/null 2>&1 || true; done' EXIT

# scaffold <backend> <config> [init flags] — an empty project in a git work tree
# on <backend>, its config replaced by <config>; FR, outside the tree, holds the
# stand-ins (FR/bin), their log (FR/calls) and the plans.
scaffold() {
  local b=$1 config=$2
  shift 2
  DIR="$(scenario_dir "$NAME-$b")" FR="$WORK/$b"
  mkdir -p "$FR/bin" "$FR/fake"
  bash "$SMOKE_DIR/bootstrap-empty.sh" "$NAME-$b" >/dev/null
  (cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
    init --here --no-git --ai claude --backlog "$b" "$@" >/dev/null 2>&1)
  cd "$DIR" || exit 1
  [ -z "$config" ] || printf '%s' "$config" >.specnaut/backlog-config.yml
}

# stub <cli> <body> — a stand-in on FR/bin that logs its argv, tab-separated, then runs <body>.
stub() {
  # shellcheck disable=SC2016 # the stand-in expands these, not this shell
  printf '#!/usr/bin/env bash\nprintf %%s %s >>"$FAKE_ROOT/calls"\n%s\n%s\n' "$1" \
    'for a in "$@"; do printf "\t%s" "${a//$'"'"'\n'"'"'/ }" >>"$FAKE_ROOT/calls"; done' \
    'echo >>"$FAKE_ROOT/calls"' >"$FR/bin/$1"
  printf '%s\n' "$2" >>"$FR/bin/$1"
  chmod +x "$FR/bin/$1"
}

# apply "<read-items args>" "<plan lines>" — read-items.sh, then apply-plan.sh
# with the read's verb and id. Sets OUT (apply's stdout), RC, CALLS (apply's
# tracker calls) and ITEMS (the items file, removed by the next apply).
ITEMS=""
apply() {
  local args read id=()
  [ -z "$ITEMS" ] || rm -rf -- "$(dirname "$ITEMS")"
  read -r -a args <<<"$1"
  read=$(PATH="$FR/bin:$PATH" FAKE_ROOT="$FR" \
    bash .specnaut/scripts/backlog/read-items.sh "${args[@]}" 2>&1) || read=""
  ITEMS=$(printf '%s\n' "$read" | sed -n 's/^ITEMS_FILE: //p')
  [ "${args[1]:-}" != --id ] || id=(--id "${args[2]}")
  printf '%s\n' "$2" >"$FR/plan.jsonl"
  : >"$FR/calls"
  RC=0
  OUT=$(PATH="$FR/bin:$PATH" FAKE_ROOT="$FR" bash .specnaut/scripts/backlog/apply-plan.sh \
    "${args[0]}" ${id[@]+"${id[@]}"} "$FR/plan.jsonl" "${ITEMS:-none}" 2>/dev/null) || RC=$?
  # shellcheck disable=SC2034 # read by the checks
  CALLS=$(cat "$FR/calls")
}
# said <exit> <line>... — the last apply exited <exit> and printed exactly these lines.
said() { local want=$1; shift; [ "$RC" = "$want" ] && [ "$OUT" = "$(printf '%s\n' "$@")" ]; }
item() { cat .specnaut/backlog/"$1"-*.md; }

echo "═══ local: edit, classify, link and close through the executor ═══"
scaffold local ""
bash .specnaut/scripts/backlog/add.sh "Epic" "Why." >/dev/null
bash .specnaut/scripts/backlog/add.sh "Child" "Why." >/dev/null
apply "edit --id 1" '{"op":"edit","target":1,"title":"Renamed epic","append":"Added."}
{"op":"classify","target":1,"axis":"Size","value":"M"}'
check "read-items.sh writes the item through item-record.sh: its title a block, its status a line" \
  'grep -qF "field=\"title\"" "$ITEMS" && grep -qx "status: Backlog" "$ITEMS" &&
   case "$ITEMS" in "$PWD"/*) false ;; esac'
check "apply-plan.sh applies both lines; edit.sh renames and appends, set-field.sh sets the size" \
  'said 0 "APPLIED edit 1" "APPLIED classify 1" "$(printf "%s\n" "$OUT" | tail -1)" &&
   item 001 | grep -qx "title: Renamed epic" && item 001 | grep -qx "Added." &&
   item 001 | grep -qx "size: M"'
apply "groom 1 2" '{"op":"link","target":2,"parent":1}'
check "link.sh records the parent on the child and the sub-task on the epic" \
  '[ "$RC" = 0 ] && item 002 | grep -qx "parent: \"#001\"" && item 001 | grep -q "^- #002 — Child$"'
apply "close --id 2" '{"op":"close","target":2,"reason":"completed"}'
check "close.sh closes the child once its cascade check passes" \
  '[ "$RC" = 0 ] && [ "$(printf "%s\n" "$OUT" | head -1)" = "APPLIED close 2" ] &&
   item 002 | grep -qx "status: Done"'
apply "edit --id 1" '{"op":"move","target":1,"status":"Done"}'
check "_backlog_plan.sh: a move to Done is refused, and nothing is written" \
  'said 3 "REFUSED status 1.status" "RECEIPT: none" && ! item 001 | grep -qx "status: Done"'
apply "edit --id 1" '{"op":"comment","target":2,"body":"x"}'
check "_backlog_scope.sh: a target outside the verb's scope is refused" \
  'said 3 "REFUSED scope 1.target" "RECEIPT: none"'
read=$(bash .specnaut/scripts/backlog/read-items.sh edit --id 1)
touch moved-since-the-read
printf '%s\n' '{"op":"comment","target":1,"body":"x"}' >"$FR/plan.jsonl"
RC=0; OUT=$(bash .specnaut/scripts/backlog/apply-plan.sh edit --id 1 "$FR/plan.jsonl" \
  "$(printf '%s\n' "$read" | sed -n 's/^ITEMS_FILE: //p')") || RC=$?
check "_apply_plan.sh refuses a plan read before the tree moved" \
  'said 3 "REFUSED fingerprint header.fingerprint" "RECEIPT: none"'

echo "═══ github: what the executor hands gh ═══"
scaffold github $'repo: "acme/my-app"\nproject_number: 7\n' \
  --backlog-url "https://github.com/orgs/example/projects/1"
stub gh "$(cat "$SMOKE_DIR/_plan_gh_stub.sh")"
printf '%s' '{"fields":[{"id":"F1","name":"Status","type":"ProjectV2SingleSelectField",
  "options":[{"id":"s0","name":"Backlog"},{"id":"s1","name":"Done"}]}]}' >"$FR/fake/fields.json"
printf '%s' '[{"name":"bug"}]' >"$FR/fake/labels.json"
issue() { printf '{"data":{"repository":{"issue":{"title":"%s","body":"Old body","createdAt":"2026-03-04T05:06:07Z","state":"OPEN","stateReason":null,"author":{"login":"someone"},"authorAssociation":"NONE","viewerDidAuthor":false,"labels":{"nodes":[]},"comments":{"nodes":[]},"projectItems":{"nodes":[]}}}}}' "$1" >"$FR/fake/issue-$2.json"; }
issue $'Title\\u001b[31m' 7
issue "Child" 8
apply "edit --id 7" '{"op":"edit","target":7,"title":"New title","append":"More."}
{"op":"label","target":7,"labels":["bug"]}'
check "_issue_text.sh keeps a control character out of the items file" \
  '! grep -q "$(printf "\033")" "$ITEMS" && grep -qF "Title[31m" "$ITEMS"'
check "edit.sh sends the title and the old body + new text as a file; label.sh adds the label" \
  'said 0 "APPLIED edit 7" "APPLIED label 7" "RECEIPT: none" &&
   printf "%s\n" "$CALLS" | grep -qF "$(printf "BODY\tOld body  More.")" &&
   printf "%s\n" "$CALLS" | grep -qF "$(printf "edit\t7\t--repo\tacme/my-app\t--add-label\tbug")"'
apply "groom 7 8" '{"op":"link","target":8,"parent":7}'
check "link.sh posts the child as a sub-issue of the parent" \
  'said 0 "APPLIED link 8" "RECEIPT: none" &&
   printf "%s\n" "$CALLS" | grep -qF "$(printf "POST\trepos/acme/my-app/issues/7/sub_issues")"'
apply "close --id 8" '{"op":"close","target":8,"reason":"not_planned"}'
check "close.sh closes with the plan's reason; item-record.sh read the item first" \
  '[ "$(printf "%s\n" "$OUT" | head -1)" = "APPLIED close 8" ] && grep -qF "item: 8" "$ITEMS" &&
   printf "%s\n" "$CALLS" | grep -qF "$(printf "close\t8\t--repo\tacme/my-app\t--reason\tnot planned")"'

echo "═══ gitlab: what the executor hands glab ═══"
scaffold gitlab $'host: https://gitlab.example.com\nproject_id: acme/my-app\n' \
  --backlog-url "https://gitlab.com/example/proj"
stub glab 'case "$1 $2" in
  "api user") echo "{\"id\":1}" ;;
  "issue view") echo "{\"iid\":4,\"title\":\"T\",\"description\":\"Body\",\"labels\":[],\"state\":\"opened\",\"author\":{\"id\":2,\"username\":\"someone\"}}" ;;
  "api --paginate") echo "[{\"name\":\"bug\"},{\"name\":\"Status::Done\"}]" ;;
  *) echo "[]" ;;
esac'
apply "edit --id 4" '{"op":"edit","target":4,"append":"More."}
{"op":"classify","target":4,"axis":"Priority","value":"P1"}
{"op":"label","target":4,"labels":["bug"]}'
check "edit.sh appends after a blank line; set-field.sh and label.sh set labels; item-record.sh read #4" \
  'said 0 "APPLIED edit 4" "APPLIED classify 4" "APPLIED label 4" "RECEIPT: none" &&
   grep -qF "item: 4" "$ITEMS" &&
   printf "%s\n" "$CALLS" | grep -qF -e "$(printf -- "--description\tBody  More.")" &&
   printf "%s\n" "$CALLS" | grep -qF -e "$(printf -- "--label\tpriority::P1")"'
apply "edit --id 4" '{"op":"label","target":4,"labels":["Status::Done"]}'
check "apply-plan.sh refuses a scoped label the executor sets itself" \
  'said 3 "REFUSED label 1.labels" "RECEIPT: none"'
apply "groom 4 6" '{"op":"link","target":6,"parent":4}'
check "link.sh sets the parent label" \
  'said 0 "APPLIED link 6" "RECEIPT: none" && printf "%s\n" "$CALLS" | grep -qF "parent::#4"'
apply "close --id 6" '{"op":"close","target":6,"reason":"completed"}'
check "close.sh closes the issue once its cascade check passes" \
  '[ "$(printf "%s\n" "$OUT" | head -1)" = "APPLIED close 6" ] &&
   printf "%s\n" "$CALLS" | grep -qF "$(printf "glab\tissue\tclose\t6")"'

echo "═══ cloud: the terminal column, whatever it is called ═══"
scaffold cloud $'backend: cloud\napi_url: "http://127.0.0.1:9"\nproject_key: K\n'
stub specnaut 'echo tok-smoke'
stub curl 'cat >/dev/null
case "$*" in
  *PATCH*) b="{\"ok\":true}" ;;
  *columns*) b="{\"columns\":[{\"id\":\"c1\",\"order\":1,\"name\":\"Shipped\"},{\"id\":\"c0\",\"order\":0,\"name\":\"Ready\"}]}" ;;
  *parentNumber=*) b="{\"tasks\":[]}" ;;
  *) b="{\"task\":{\"number\":3,\"columnId\":\"c0\",\"title\":\"T\",\"body\":\"B\"}}" ;;
esac
printf "%s\n200" "$b"'
apply "edit --id 3" '{"op":"move","target":3,"status":"Shipped"}'
check "apply-plan.sh keeps the terminal column out of a move; item-record.sh read #3" \
  'said 3 "REFUSED status 1.status" "RECEIPT: none" && grep -qF "item: 3" "$ITEMS"'
apply "close --id 3" '{"op":"close","target":3,"reason":"completed"}'
check "a close moves the task into the column the board names last" \
  'said 0 "APPLIED close 3" "RECEIPT: none" && printf "%s\n" "$CALLS" | grep -qF "\"status\": \"Shipped\""'

finish "BACKLOG-PLAN"
