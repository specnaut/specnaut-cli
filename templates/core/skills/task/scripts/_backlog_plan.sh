# shellcheck shell=bash disable=SC2034  # PLAN_* are read by the scripts that source this.
# The one home of what a backlog write may say, planned or direct: the product
# owner proposes a plan, a bundled executor (`apply-plan.sh`) checks it here and
# applies it. Sourced, never run, by apply-plan.sh, read-items.sh and each
# backend's add.sh, edit.sh, clarify-comment.sh and label.sh (close.sh posts its
# comment through clarify-comment.sh), installed beside it, once the caller has
# `jq_lf`. Two rules beside this file are not this one: the secret check every
# text meets before it is sent (`text_refusal`, `require_clean_text`), in
# `_clean_text.sh`, which this file sources for its callers; and what a run of
# a verb may write (`scope_for`), in `_backlog_scope.sh`.
#
# A plan is JSON Lines: one object per line, its `op` one of the eight below,
# with exactly these keys (? = optional) and nothing else:
#
#   create    ref?, title, body?, labels?, parent?   a new item
#   edit      target, title?, append?                at least one of the two
#   comment   target, body
#   move      target, status
#   classify  target, axis, value
#   label     target, labels
#   close     target, reason
#   link      target, parent                         target becomes parent's child
#
# The values, checked by PLAN_JQ before anything is written:
#   target, parent  an issue number (a JSON integer), or a `ref` an earlier
#                   create in the same plan named (`@` + [a-z][a-z0-9-]{0,15});
#                   always inside the verb's scope (scope_for). A repository, a
#                   project, a URL or a path is no value any key takes.
#   status          one of the board's own columns, never its terminal one: an
#                   item reaches it through `close`, behind its cascade check.
#                   The backend's board_statuses leaves the terminal column out
#                   (on Cloud, the last by order whatever its name); a column
#                   named Done is refused here too, on every backend
#   axis, value     Priority P0-P3 · Size XS, S, M, L, XL · IssueType Task, Bug, Feature
#                   · StartDate, TargetDate a string YYYY-MM-DD · Estimate a JSON
#                   number 0 to 9999, at most two decimals. A backend without an
#                   axis answers UNSUPPORTED (its PLAN_CANNOT `classify:<axis>`)
#   labels          1 to 10 of the repository's existing labels
#   reason          completed or not_planned
#   title           one line, 1 to 256 characters, every one `inert` (_issue_text.sh)
#   body, append    up to 65536 characters (a comment's body: 16384), inert,
#                   tabs and newlines kept. An edit only appends to a body.
#   @-mentions      in any text, only of the target item's author, case-blind; none
#                   new. What counts as one: `mentions`, CLEAN_TEXT_JQ, _clean_text.sh
# Caps: PLAN_MAX_OPS lines, and one comment per target per run. There is no
# operation for memory, files or raw tracker calls, and no key that is a path:
# the executor writes every body file itself.

PLAN_MAX_OPS=40
_PLAN_DIR=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./_issue_text.sh
. "$_PLAN_DIR/_issue_text.sh"
# shellcheck source=./_clean_text.sh
. "$_PLAN_DIR/_clean_text.sh"

# backlog_fingerprint <root> — the work tree's state at a read, the same text
# for read-items.sh, which records it, and apply-plan.sh, which checks it:
# `git hash-object` of `git status --porcelain`. Fails outside a work tree.
backlog_fingerprint() {
  local porcelain fp
  porcelain=$(cd "$1" && git status --porcelain 2>/dev/null) || return 1
  fp=$(printf '%s' "$porcelain" | (cd "$1" && git hash-object --stdin)) || return 1
  fp=${fp%$'\r'}
  [[ $fp =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || return 1
  printf '%s\n' "$fp"
}

# jq definitions the validator and the local add.sh share; appended to ISSUE_TEXT_JQ.
# shellcheck disable=SC2016  # jq program.
PLAN_DEFS='
  def plan_title: type == "string" and length >= 1 and length <= 256
    and (explode | all(.[]; inert)) and (explode | any(.[]; . != 32));
  def plan_text($max): type == "string" and length >= 1 and length <= $max
    and (explode | all(.[]; inert or . == 9 or . == 10));
'

# The validator, over the plan's raw lines (jq -n -R), given $ops, $targets, $parents, $refs,
# $statuses, $labels, $authors ({n: login}), $cannot ("op" or "op:qualifier") and $max. Out:
# {refused: [[class, path]], unsupported, ops}, each op normalised, its targets strings, its line.
# shellcheck disable=SC2016  # jq program.
PLAN_JQ='
  def schema: {
    create: {ref: "ref?", title: "title", body: "body?", labels: "labels?", parent: "parent?"},
    edit: {target: "target", title: "title?", append: "body?"},
    comment: {target: "target", body: "comment"},
    move: {target: "target", status: "status"},
    classify: {target: "target", axis: "axis", value: "value"},
    label: {target: "target", labels: "labels"},
    close: {target: "target", reason: "reason"},
    link: {target: "target", parent: "parent"} };
  def axes: {Priority: ["P0", "P1", "P2", "P3"], Size: ["XS", "S", "M", "L", "XL"], IssueType: ["Task", "Bug", "Feature"],
    StartDate: "date", TargetDate: "date", Estimate: "number"};
  def axis_value($a): (axes[$a]) as $s
    | if $s == "date" then type == "string" and test("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$")
      elif $s == "number" then type == "number" and . >= 0 and . <= 9999 and (tostring | test("^[0-9]+(\\.[0-9]{1,2})?$"))
      else . as $v | any($s[]; . == $v) end;
  def shown: if type == "string" and test("^[a-z_]{1,32}$") then . else "?" end;
  def number: type == "number" and . == floor and . >= 1 and . <= 9999999999;
  def refname: type == "string" and test("^@[a-z][a-z0-9-]{0,15}$");
  def resolve($v; $st; $in): if ($v | number) then ($v | tostring) as $n
      | (if any($in[]; . == $n) then $n else null end)
    elif $refs and ($v | refname) and any($st.refs[]; . == $v) then $v
    else null end;
  def check($k; $kind; $v; $st; $o):
    if $kind == "target" or $kind == "parent" then (if resolve($v; $st; $targets
      + (if $kind == "parent" then $parents else [] end)) == null then "scope" else null end)
    elif $kind == "ref" then (if ($v | refname) and ($st.refs | index([$v]) == null) and $refs then null else "ref" end)
    elif $kind == "title" then (if $v | plan_title then null else "title" end)
    elif $kind == "body" then (if $v | plan_text(65536) then null else "text" end)
    elif $kind == "comment" then (if $v | plan_text(16384) then null else "text" end)
    elif $kind == "status" then (if ($v | type) == "string" and ($v | ascii_downcase) != "done"
      and any($statuses[]; . == $v) then null else "status" end)
    elif $kind == "axis" then (if ($v | type) == "string" and (axes | has($v)) then null else "axis" end)
    elif $kind == "value" then (if ($o.axis | type) == "string" and (axes | has($o.axis)) and ($v | axis_value($o.axis))
      then null else "value" end)
    elif $kind == "labels" then (if ($v | type) == "array" and ($v | length) >= 1 and ($v | length) <= 10
      and all($v[]; type == "string" and plan_title and (index(",") == null) and (. as $l | any($labels[]; . == $l)))
      then null else "label" end)
    elif $kind == "reason" then (if $v == "completed" or $v == "not_planned" then null else "reason" end)
    else "schema" end;
  def cannot($o): ($o.op) as $op
    | if any($cannot[]; . == $op) then $op
      elif $op == "close" and any($cannot[]; . == "close:" + $o.reason) then $op
      elif $op == "classify" and any($cannot[]; . == "classify:" + $o.axis) then $op
      elif $op == "create" and $o.labels != null and any($cannot[]; . == "create:labels") then $op
      else null end;
  [inputs] as $lines
  | reduce range($lines | length) as $i ({refused: [], unsupported: [], ops: [], refs: [], said: []};
      ($i + 1 | tostring) as $at
      | ($lines[$i] | try fromjson catch null) as $o
      | if ($o | type) != "object" then .refused += [["parse", $at]]
        elif ($o.op | type) != "string" or (schema | has($o.op) | not) then .refused += [["op", "\($at).op"]]
        elif ($ops | index([$o.op]) == null) then .refused += [["scope", "\($at).op"]]
        elif cannot($o) != null then .unsupported += [cannot($o)]
        else schema[$o.op] as $s | . as $st
          | ([$o | keys[] | . as $k | select($k != "op" and ($s | has($k) | not)) | ["unknown-key", "\($at).\(shown)"]]
             + [$s | to_entries[] | .key as $k | select((.value | endswith("?") | not) and ($o | has($k) | not))
                 | ["missing-key", "\($at).\(.key)"]]
             + [$s | to_entries[] | .key as $k | select($o | has($k))
                 | check($k; .value | rtrimstr("?"); $o[$k]; $st; $o) // empty | [., "\($at).\($k)"]]
             + (if $o.op == "edit" and ($o | has("title") or has("append") | not) then [["missing-key", "\($at).append"]] else [] end)
             + [("title", "body", "append") as $k | select($o[$k] | type == "string")
                 | (if $o.op == "create" then [] else [$authors[$o.target | tostring]? // empty | ascii_downcase] end) as $who
                 | select([$o[$k] | mentions[] | select(. as $m | $who | index([$m]) == null)] | length > 0)
                 | ["mention", "\($at).\($k)"]]) as $bad
          | if ($bad | length) > 0 then .refused += $bad
            else ($o
                   | (if has("target") then .target = resolve(.target; $st; $targets) else . end)
                   | (if has("parent") then .parent = resolve(.parent; $st; $targets + $parents) else . end)
                   | .line = ($i + 1)) as $n
              | (if $n.op == "comment" and any(.said[]; . == $n.target)
                 then .refused += [["cap", "\($at).target"]] else . end)
              | .said += (if $n.op == "comment" then [$n.target] else [] end)
              | .refs += (if $n.op == "create" and $n.ref != null then [$n.ref] else [] end)
              | .ops += [$n]
            end
        end)
  | if ($lines | length) > $max then .refused += [["cap", "plan"]] elif ($lines | length) == 0 then .refused += [["parse", "plan"]] else . end
  | {refused, unsupported: (.unsupported | unique), ops}
'

# require_title <title> — the plan's title rule, or a refusal and status 2: the
# local add.sh writes a title into frontmatter, where a second line is a key.
require_title() {
  jq_lf -n -e --arg t "${1-}" "$ISSUE_TEXT_JQ$PLAN_DEFS"' $t | plan_title' >/dev/null 2>&1 && return 0
  printf '%s: a title is one line of 1 to 256 printable characters\n' "${0##*/}" >&2
  return 2
}
