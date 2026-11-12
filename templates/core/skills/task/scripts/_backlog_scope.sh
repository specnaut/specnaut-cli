# shellcheck shell=bash
# The one home of what a run of each verb may write: `scope_for`, and the epic
# test a groom's close passes. Derived from the verb, its id and the tracker,
# never from a plan. Sourced, never run, by apply-plan.sh and read-items.sh,
# installed beside it; the plan's vocabulary is `_backlog_plan.sh`.

_SCOPE_DIR=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# scope_for <verb> [<id>] — what a run of <verb> may write, derived here, never
# from a plan: SCOPE_OPS, SCOPE_TARGETS (issue numbers), SCOPE_PARENTS (numbers
# a `parent` may name beside those) and SCOPE_REFS (may it create and name new
# items). 2 for a verb not listed, or an id it needs and
# lacks or must not have. ITEMS_READ (the items file's numbers) is set by
# apply-plan.sh; read-items.sh calls this to refuse a verb before any read.
#
#   add [<parent>]   create; then its own new items, the parent the user named
#                    only as a `parent`: an add never writes to an existing item
#   edit <id>        {id}; no link, re-parenting is a groom's
#   estimate <id>    {id}, classification only
#   close <id>       {id}, and its children among the items read once the
#                    executor's own cascade-check.sh <id> exits 0: the
#                    numbers its --numbers mode lists, the read's too
#   groom            the items read, no create; it closes only an epic whose
#                    cascade check clears (epic_cleared)
#   tech-debt        create; classify and label only the items it creates
#   next, status     nothing: a read, whose plan is empty
#   brief <id>       nothing, for {id}
scope_for() {
  local verb=${1:-} id=${2:-} n kids
  SCOPE_OPS="" SCOPE_TARGETS="" SCOPE_PARENTS="" SCOPE_REFS=false
  case $verb in
    add) SCOPE_OPS="create comment move classify label link" SCOPE_REFS=true SCOPE_PARENTS=$id ;;
    edit) SCOPE_OPS="edit comment move classify label" SCOPE_TARGETS=$id ;;
    estimate) SCOPE_OPS="classify label comment" SCOPE_TARGETS=$id ;;
    close) SCOPE_OPS="close comment label" SCOPE_TARGETS=$id ;;
    groom) SCOPE_OPS="edit comment move classify label close link" SCOPE_TARGETS=${ITEMS_READ:-} ;;
    tech-debt) SCOPE_OPS="create classify label" SCOPE_REFS=true ;;
    next | status | brief) ;;
    *) return 2 ;;
  esac
  case $verb in
    edit | estimate | close | brief) [ -n "$id" ] || return 2 ;;
    tech-debt | next | status) [ -z "$id" ] || return 2 ;;
  esac
  if [ "$verb" = close ] && [ -n "${ITEMS_READ:-}" ] &&
    bash "$_SCOPE_DIR/cascade-check.sh" "$id" >/dev/null 2>&1 &&
    kids=$(bash "$_SCOPE_DIR/cascade-check.sh" --numbers "$id" 2>/dev/null); then
    for n in $ITEMS_READ; do
      [ "$n" != "$id" ] || continue
      printf '%s\n' "$kids" | tr -d '\r' | grep -qxF "$n" && SCOPE_TARGETS="$SCOPE_TARGETS $n"
    done
  fi
  return 0
}

# epic_cleared <n> — 0 when <n> has children and its cascade check clears it:
# the only item a groom may close. The check's exit 0 alone also means "no
# children at all", so the children are its --numbers list. Never its words:
# on Cloud they name the board's own column, whatever that is called.
epic_cleared() {
  local kids
  bash "$_SCOPE_DIR/cascade-check.sh" "$1" >/dev/null 2>&1 || return 1
  kids=$(bash "$_SCOPE_DIR/cascade-check.sh" --numbers "$1" 2>/dev/null) || return 1
  printf '%s\n' "$kids" | tr -d '\r' | grep -Eq '^[1-9][0-9]{0,9}$'
}
