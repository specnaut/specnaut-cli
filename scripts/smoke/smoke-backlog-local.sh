#!/usr/bin/env bash
# Exercise the bundled local-backlog scripts end-to-end on a fresh
# scaffold: add → list → move → view → clarify-comment, then verify
# the resulting Markdown files reflect every mutation.
#
# Usage: smoke-backlog-local.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-local.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Wipe the scenario directory on every exit path, so sandbox/ never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

echo "═══ #563  sub-issue enumeration on the local backend ═══"
check "parent-of.sh present + executable (#563)" \
  '[ -x .specnaut/scripts/backlog/parent-of.sh ]'
check "cascade-check.sh present + executable (#563)" \
  '[ -x .specnaut/scripts/backlog/cascade-check.sh ]'
check "both read the parent link add.sh already writes (#563)" \
  'grep -q "\^parent:" .specnaut/scripts/backlog/parent-of.sh &&
   grep -q "_fm" .specnaut/scripts/backlog/cascade-check.sh &&
   grep -q "parent" .specnaut/scripts/backlog/cascade-check.sh'
check "the exit contract matches github's, so callers need no branching (#563 AC1/AC2)" \
  'grep -qF "exit 11" .specnaut/scripts/backlog/cascade-check.sh &&
   grep -qF "exit 12" .specnaut/scripts/backlog/cascade-check.sh &&
   grep -qF "exit 10" .specnaut/scripts/backlog/parent-of.sh'
check "task numbers are read base-10, never octal (#563)" \
  'grep -qF "10#" .specnaut/scripts/backlog/parent-of.sh &&
   grep -qF "10#" .specnaut/scripts/backlog/cascade-check.sh'
check "only FRONTMATTER parent: counts, not a mention in the body (#563)" \
  'grep -qF "inside" .specnaut/scripts/backlog/parent-of.sh'

echo "═══ add ═══"
out=$(bash .specnaut/scripts/backlog/add.sh "First item" "## Why\n\nSmoke test")
echo "$out"
echo "$out" | grep -q "✓ created #001" \
  && pass "add prints '✓ created #001'" \
  || fail "add output" "$out"
[ -f .specnaut/backlog/001-first-item.md ] \
  && pass "001-first-item.md created" \
  || fail "expected file at .specnaut/backlog/001-first-item.md" "missing"

echo
echo "═══ groom-verify (spec 036) ═══"
# A fresh item has no size, no priority and no outcome: the groom check must
# say so and exit 1, never report it complete.
rc=0; out=$(bash .specnaut/scripts/backlog/groom-verify.sh 1 2>&1) || rc=$?  # set -e: never a bare $?
[ "$rc" = 1 ] && echo "$out" | grep -qE "#0*1:" && echo "$out" | grep -qi "size" \
  && pass "groom-verify flags #001 as incomplete (size missing), exit 1" \
  || fail "groom-verify on a fresh item (rc=$rc)" "$out"

echo
echo "═══ list (Backlog) ═══"
out=$(bash .specnaut/scripts/backlog/list.sh)
echo "$out"
echo "$out" | grep -q "#001.*Backlog.*First item" \
  && pass "list shows #001 in Backlog" \
  || fail "list output" "$out"

echo
echo "═══ list filtered by Backlog ═══"
out=$(bash .specnaut/scripts/backlog/list.sh Backlog)
echo "$out" | grep -q "#001" && pass "filter Backlog matches" \
  || fail "filter mismatch" "$out"

echo
echo "═══ move 1 → Ready ═══"
out=$(bash .specnaut/scripts/backlog/move.sh 1 Ready)
echo "$out"
echo "$out" | grep -q "✓ #001 → Ready" \
  && pass "move prints transition" \
  || fail "move output" "$out"
grep -q "^status: Ready$" .specnaut/backlog/001-first-item.md \
  && pass "frontmatter status updated to Ready" \
  || fail "frontmatter not updated" "$(head -7 .specnaut/backlog/001-first-item.md)"

echo
echo "═══ list filtered by Backlog (should be empty) ═══"
out=$(bash .specnaut/scripts/backlog/list.sh Backlog)
[ -z "$out" ] && pass "no Backlog items left" \
  || fail "expected empty list, got" "$out"

echo
echo "═══ list filtered by Ready ═══"
out=$(bash .specnaut/scripts/backlog/list.sh Ready)
echo "$out" | grep -q "#001.*Ready" && pass "Ready filter matches" \
  || fail "Ready filter mismatch" "$out"

echo
echo "═══ view 1 ═══"
out=$(bash .specnaut/scripts/backlog/view.sh 1)
echo "$out" | grep -q "title: First item" && pass "view shows title" \
  || fail "view missing title" "$out"
echo "$out" | grep -q "status: Ready" && pass "view shows current status" \
  || fail "view missing status" "$out"

echo
echo "═══ clarify-comment ═══"
out=$(bash .specnaut/scripts/backlog/clarify-comment.sh 1 "Need scope decision on X")
echo "$out"
echo "$out" | grep -q "✓ added clarification" && pass "clarify prints confirmation" \
  || fail "clarify output" "$out"
grep -q "Need scope decision on X" .specnaut/backlog/001-first-item.md \
  && pass "clarification appended to file" \
  || fail "clarification not in file" "$(tail -10 .specnaut/backlog/001-first-item.md)"

echo
echo "═══ add second item (auto-numbering) ═══"
bash .specnaut/scripts/backlog/add.sh "Second" "" >/dev/null
[ -f .specnaut/backlog/002-second.md ] \
  && pass "002-second.md created (auto-numbered)" \
  || fail "expected 002-second.md" "$(ls .specnaut/backlog/)"

echo
echo "═══ #180  add --parent (sub-task of #001) ═══"
out=$(bash .specnaut/scripts/backlog/add.sh "Subtask of 1" "" --parent 1)
echo "$out"
echo "$out" | grep -q "✓ created #003" \
  && pass "add --parent prints '✓ created #003'" \
  || fail "add --parent output" "$out"
[ -f .specnaut/backlog/003-subtask-of-1.md ] \
  && pass "003-subtask-of-1.md created" \
  || fail "expected 003-subtask-of-1.md" "$(ls .specnaut/backlog/)"
grep -q '^parent: "#001"$' .specnaut/backlog/003-subtask-of-1.md \
  && pass "child frontmatter declares parent: \"#001\"" \
  || fail "parent key missing in child" "$(head -10 .specnaut/backlog/003-subtask-of-1.md)"
grep -q "^## Sub-tasks$" .specnaut/backlog/001-first-item.md \
  && pass "parent body grew a Sub-tasks section" \
  || fail "no Sub-tasks section in parent" "$(tail -10 .specnaut/backlog/001-first-item.md)"
grep -q "#003" .specnaut/backlog/001-first-item.md \
  && pass "parent body cross-links to #003" \
  || fail "parent body missing #003 link" "$(tail -10 .specnaut/backlog/001-first-item.md)"

echo
echo "═══ #180  add --parent refuses unknown parent ═══"
if bash .specnaut/scripts/backlog/add.sh "Orphan" "" --parent 999 2>/dev/null; then
  fail "should have refused parent #999" "(unexpected exit 0)"
else
  pass "refused to create child of non-existent parent #999"
fi

echo
echo "═══ #260  Auto-propagate parent Epic on child move (local) ═══"
[ -x .specnaut/scripts/backlog/propagate-parent-status.sh ] \
  && pass "propagate-parent-status.sh scaffolded executable" \
  || fail "propagate-parent-status.sh missing or not executable" "$(ls -l .specnaut/scripts/backlog/ 2>/dev/null)"
grep -q "propagate-parent-status.sh" .specnaut/scripts/backlog/move.sh \
  && pass "move.sh invokes propagate-parent-status.sh as tail hook" \
  || fail "move.sh tail hook missing" "$(tail -10 .specnaut/scripts/backlog/move.sh)"

# #263 setup: a second sibling child of #001 keeps the #260 single-child assertions below
# meaningful (otherwise child #003 → Done would complete the set and trigger #263's
# all-children-Done promotion).
bash .specnaut/scripts/backlog/add.sh "Second sibling of 1" "" --parent 1 >/dev/null
[ -f .specnaut/backlog/004-second-sibling-of-1.md ] \
  && pass "second sibling child #004 created for #263 multi-child smoke" \
  || fail "second sibling #004 not created" "$(ls .specnaut/backlog/)"

# Parent #001's frontmatter status after each move below, against the expected one.
assert_parent() {
  local got; got=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specnaut/backlog/001-first-item.md)
  [ "$got" = "$1" ] && pass "$2" || fail "$3" "expected '$1', got '$got'"
}
# Baseline: parent #001 back to Backlog, child #003 (sub-task) back to Backlog.
bash .specnaut/scripts/backlog/move.sh 1 Backlog >/dev/null
bash .specnaut/scripts/backlog/move.sh 3 Backlog >/dev/null

# Move child to Ready → parent must stay in Backlog (#260 AC a tightened: Ready
# means "groomed, waiting", not "active work" — only In progress / In review
# / Done promote the parent).
bash .specnaut/scripts/backlog/move.sh 3 "Ready" >/dev/null
assert_parent "Backlog" "parent stays Backlog when child moves to Ready (AC a fidelity)" \
  "parent unexpectedly promoted on child→Ready"

# Move child to In progress → parent should auto-promote.
bash .specnaut/scripts/backlog/move.sh 3 "In progress" >/dev/null
assert_parent "In progress" "parent auto-promoted from Backlog to In progress on child sub-task move" \
  "parent auto-promotion broken"

# #260 regression guard: parent at 'In review' must stay there when a
# child moves to Done WHILE other open siblings still exist. With #263
# in main, this only holds because we created #004 in Backlog above —
# otherwise child #003 → Done would itself complete the set.
bash .specnaut/scripts/backlog/move.sh 1 "In review" >/dev/null
bash .specnaut/scripts/backlog/move.sh 3 "Done" >/dev/null
assert_parent "In review" "parent in 'In review' stays there while #004 still open (AC c regression guard)" \
  "#260 regression guard broken"

echo
echo "═══ #263  Auto-Done propagation when all Epic children Done ═══"
# Static-grep: the Done branch exists in the propagator source.
grep -qE '^[[:space:]]*"Done"\)' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "propagate-parent-status.sh has a NEW_STATUS=Done branch (#263)" \
  || fail "Done branch missing in local propagator" "$(grep -n 'case' .specnaut/scripts/backlog/propagate-parent-status.sh)"
grep -q 'all_done=true' .specnaut/scripts/backlog/propagate-parent-status.sh \
  && pass "propagator computes all_done from sibling frontmatter" \
  || fail "all_done variable missing in local propagator" "$(grep -n 'all_done' .specnaut/scripts/backlog/propagate-parent-status.sh)"

# Behaviour: move the remaining open child #004 to Done.
# State before: #001=In review, #003=Done, #004=Backlog.
# Expected after: #001=Done (auto-promoted), #003=Done, #004=Done.
bash .specnaut/scripts/backlog/move.sh 4 "Done" >/dev/null
assert_parent "Done" "parent auto-advances In review → Done when last open child reaches Done (AC a)" \
  "#263 AC(a) broken"

# AC(b) idempotency: moving a Done child to Done again, with parent already Done,
# must NOT corrupt the parent's status (no-op via *) case in PARENT_STATUS).
bash .specnaut/scripts/backlog/move.sh 4 "Done" >/dev/null
assert_parent "Done" "re-moving a Done child to Done is idempotent on a Done parent (AC b)" \
  "#263 AC(b) idempotency broken"

# AC(c) regression guard: parent manually moved back from Done. The
# propagator must NOT re-promote unless a fresh child→Done transition
# happens AFTER the demotion. The current state has #001=Done,
# #003=Done, #004=Done. Demote #001 to In review, then nudge a child
# through a non-Done state and back to Done; verify the parent state
# at each step.
bash .specnaut/scripts/backlog/move.sh 1 "In review" >/dev/null
# Step 1: parent is at In review with all children at Done. The
# propagator only fires on child moves, so a `move.sh 1 "In review"`
# call should not re-trigger Done propagation by itself.
assert_parent "In review" "manually demoting parent from Done to In review lands (no auto-reversal at rest, AC c)" \
  "#263 AC(c) — manual demotion not respected"

# Step 2: move a Done child OUT of Done (Backlog), then to a non-Done
# state. The propagator only fires on out-of-Backlog and Done transitions;
# moving #004 to Backlog then to In progress exercises the #260 path
# (parent should stay at In review since In review is not in Backlog/Ready).
bash .specnaut/scripts/backlog/move.sh 4 "Backlog" >/dev/null
bash .specnaut/scripts/backlog/move.sh 4 "In progress" >/dev/null
assert_parent "In review" "parent at In review (manually demoted from Done) is not re-promoted on a non-Done child move (AC c)" \
  "#263 AC(c) — child→In progress re-triggers Done propagation"

# Parent at Backlog branch — moving a Done child to Done must not promote a
# Backlog parent (AC a explicitly excludes Backlog). Demote parent, re-run.
bash .specnaut/scripts/backlog/move.sh 1 "Backlog" >/dev/null
bash .specnaut/scripts/backlog/move.sh 4 "Done" >/dev/null
assert_parent "Backlog" "Backlog parent is not auto-advanced even when all children Done (AC a exclusion)" \
  "#263 Backlog parent exclusion broken"

echo "═══ #442  local _config.sh resolves an item path ═══"
# No backlog-config.yml here: _config.sh only gives the local backend the item_url surface the
# others have. It was missing from the first manifest — assert it is scaffolded, not just authored.
[ -f .specnaut/scripts/backlog/_config.sh ] \
  && pass "_config.sh is scaffolded for the local backend" \
  || fail "_config.sh not scaffolded (manifest entry missing?)" "$(ls .specnaut/scripts/backlog/)"
grep -q 'item_url()' .specnaut/scripts/backlog/_config.sh \
  && pass "_config.sh defines item_url (local)" \
  || fail "item_url missing from local _config.sh" "$(grep -n 'item_url' .specnaut/scripts/backlog/_config.sh || true)"
# Shape only — these smokes assert the scaffolded tree, and the runtime
# behaviour of item_url (including the no-match case) is executed by
# tests/templates/backlog_reference_contract_test.ts in the CLI repo.
grep -q '\.specnaut/backlog/' .specnaut/scripts/backlog/_config.sh \
  && pass "local item_url emits a repo-relative task-file path" \
  || fail "local item_url does not emit a backlog path" "$(grep -n 'echo' .specnaut/scripts/backlog/_config.sh || true)"

echo
echo "═══ render-index.sh rebuilds the index from the item files ═══"
# The only local backlog script nothing exercised. It regenerates
# .specnaut/backlog.md from .specnaut/backlog/*.md, grouping by each item's
# `status:` frontmatter — so the check that means anything is whether an item
# moved earlier in this run lands under the right heading, not whether the
# file is executable.
rm -f .specnaut/backlog.md
bash .specnaut/scripts/backlog/render-index.sh . >/dev/null 2>&1 \
  && pass "render-index.sh regenerates a deleted index" \
  || fail "render-index.sh did not regenerate .specnaut/backlog.md" "exit $?"

# Checked against each item's own `status:` frontmatter rather than against a
# column this script moved it to earlier. The first version asserted item 1 was
# under ## Ready because "move 1 → Ready" put it there — and the #260 baseline
# moves it back to Backlog to exercise epic propagation, so the check failed on
# correct behaviour. An assertion that encodes an assumed state instead of the
# invariant breaks whenever an unrelated step is added above it.
grouping_ok=1
grouping_why=""
for item in .specnaut/backlog/*.md; do
  [ -f "$item" ] || continue
  num="$(basename "$item" | cut -d- -f1)"
  want="$(sed -n 's/^status: *//p' "$item" | head -1 | tr -d '"')"
  [ -n "$want" ] || continue
  # The section under the heading that matches this item's status.
  section="$(awk -v h="## $want" '$0==h{f=1;next} /^## /{f=0} f' .specnaut/backlog.md)"
  if ! printf '%s' "$section" | grep -q "#$num"; then
    grouping_ok=0
    grouping_why="$grouping_why item $num declares '$want' but is not under '## $want';"
  fi
  # And under exactly one heading.
  hits="$(grep -c "(backlog/$num-" .specnaut/backlog.md || true)"
  if [ "$hits" != "1" ]; then
    grouping_ok=0
    grouping_why="$grouping_why item $num appears $hits times, expected 1;"
  fi
done
[ "$grouping_ok" = "1" ] \
  && pass "every item is rendered under the column its frontmatter declares, exactly once" \
  || fail "render-index grouping does not match the items' status fields" "$grouping_why"

check "close-shipped.sh is the close: it moves each item to Done and asks no forge (spec 042)" \
  '[ -x .specnaut/scripts/backlog/close-shipped.sh ] && probe_close_shipped "" "" 5 6 && close_shipped_was 0 "$(printf "move 5 Done\nmove 6 Done")" "DONE #5" "DONE #6"'

finish "BACKLOG-LOCAL"
