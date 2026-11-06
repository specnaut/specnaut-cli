# shellcheck shell=bash
# The one home of what a run of each verb may write: `scope_for`, and the epic
# test a groom's close passes. Derived from the verb, its id and the tracker,
# never from a plan. Sourced, never run, by apply-plan.sh and read-items.sh,
# installed beside it; the plan's vocabulary is `_backlog_plan.sh`.

_SCOPE_DIR=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# scope_for <verb> [<id>] — what a run of <verb> may write, derived here, never
# from a plan: SCOPE_OPS, SCOPE_TARGETS (issue numbers) and SCOPE_REFS (may it
# create and name new items). 2 for a verb not listed, or an id it needs and
# lacks or must not have. ITEMS_READ (the items file's numbers) is set by
# apply-plan.sh; read-items.sh calls this to refuse a verb before any read.
#
#   add [<parent>]   create; then its own new items and the parent the user named
#   edit <id>        {id}
#   estimate <id>    {id}, classification only
#   close <id>       {id}, and its children among the items read once the
#                    executor's own cascade-check.sh <id> exits 0
#   groom            the items read, no create; it closes only an epic whose
#                    cascade check clears (epic_cleared)
#   tech-debt        create only
#   next, status     nothing: a read, whose plan is empty
#   brief <id>       nothing, for {id}
scope_for() {
  local verb=${1:-} id=${2:-} n p
  SCOPE_OPS="" SCOPE_TARGETS="" SCOPE_REFS=false
  case $verb in
    add) SCOPE_OPS="create comment move classify label link" SCOPE_REFS=true SCOPE_TARGETS=$id ;;
    edit) SCOPE_OPS="edit comment move classify label link" SCOPE_TARGETS=$id ;;
    estimate) SCOPE_OPS="classify label comment" SCOPE_TARGETS=$id ;;
    close) SCOPE_OPS="close comment label" SCOPE_TARGETS=$id ;;
    groom) SCOPE_OPS="edit comment move classify label close link" SCOPE_TARGETS=${ITEMS_READ:-} ;;
    tech-debt) SCOPE_OPS="create" SCOPE_REFS=true ;;
    next | status | brief) ;;
    *) return 2 ;;
  esac
  case $verb in
    edit | estimate | close | brief) [ -n "$id" ] || return 2 ;;
    tech-debt | next | status) [ -z "$id" ] || return 2 ;;
  esac
  if [ "$verb" = close ] && [ -n "${ITEMS_READ:-}" ] &&
    bash "$_SCOPE_DIR/cascade-check.sh" "$id" >/dev/null 2>&1; then
    for n in $ITEMS_READ; do
      [ "$n" != "$id" ] || continue
      p=$(bash "$_SCOPE_DIR/parent-of.sh" "$n" 2>/dev/null) || continue
      [ "${p#"${p%%[!0]*}"}" != "$id" ] || SCOPE_TARGETS="$SCOPE_TARGETS $n"
    done
  fi
  return 0
}

# epic_cleared <n> — 0 when <n> has children and its cascade check clears it:
# the only item a groom may close. The check's exit 0 alone also means "no
# children at all"; only its "safe to close" line says it has some.
epic_cleared() {
  local out
  out=$(bash "$_SCOPE_DIR/cascade-check.sh" "$1" 2>/dev/null) || return 1
  case $out in *"safe to close"*) return 0 ;; *) return 1 ;; esac
}
