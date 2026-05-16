#!/usr/bin/env bash
# Exercise the bundled local-backlog scripts end-to-end on a fresh
# scaffold: add → list → move → view → clarify-comment, then verify
# the resulting Markdown files reflect every mutation.
#
# Usage: smoke-backlog-local.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-local.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/sandbox/$NAME"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SCRIPT_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SCRIPT_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$ROOT/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"
fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1 — $2"; fails=$((fails + 1)); }

echo "═══ add ═══"
out=$(bash .specflow/scripts/backlog/add.sh "First item" "## Why\n\nSmoke test")
echo "$out"
echo "$out" | grep -q "✓ created #001" \
  && pass "add prints '✓ created #001'" \
  || fail "add output" "$out"
[ -f .specflow/backlog/001-first-item.md ] \
  && pass "001-first-item.md created" \
  || fail "expected file at .specflow/backlog/001-first-item.md" "missing"

echo
echo "═══ list (Backlog) ═══"
out=$(bash .specflow/scripts/backlog/list.sh)
echo "$out"
echo "$out" | grep -q "#001.*Backlog.*First item" \
  && pass "list shows #001 in Backlog" \
  || fail "list output" "$out"

echo
echo "═══ list filtered by Backlog ═══"
out=$(bash .specflow/scripts/backlog/list.sh Backlog)
echo "$out" | grep -q "#001" && pass "filter Backlog matches" \
  || fail "filter mismatch" "$out"

echo
echo "═══ move 1 → Ready ═══"
out=$(bash .specflow/scripts/backlog/move.sh 1 Ready)
echo "$out"
echo "$out" | grep -q "✓ #001 → Ready" \
  && pass "move prints transition" \
  || fail "move output" "$out"
grep -q "^status: Ready$" .specflow/backlog/001-first-item.md \
  && pass "frontmatter status updated to Ready" \
  || fail "frontmatter not updated" "$(head -7 .specflow/backlog/001-first-item.md)"

echo
echo "═══ list filtered by Backlog (should be empty) ═══"
out=$(bash .specflow/scripts/backlog/list.sh Backlog)
[ -z "$out" ] && pass "no Backlog items left" \
  || fail "expected empty list, got" "$out"

echo
echo "═══ list filtered by Ready ═══"
out=$(bash .specflow/scripts/backlog/list.sh Ready)
echo "$out" | grep -q "#001.*Ready" && pass "Ready filter matches" \
  || fail "Ready filter mismatch" "$out"

echo
echo "═══ view 1 ═══"
out=$(bash .specflow/scripts/backlog/view.sh 1)
echo "$out" | grep -q "title: First item" && pass "view shows title" \
  || fail "view missing title" "$out"
echo "$out" | grep -q "status: Ready" && pass "view shows current status" \
  || fail "view missing status" "$out"

echo
echo "═══ clarify-comment ═══"
out=$(bash .specflow/scripts/backlog/clarify-comment.sh 1 "Need scope decision on X")
echo "$out"
echo "$out" | grep -q "✓ added clarification" && pass "clarify prints confirmation" \
  || fail "clarify output" "$out"
grep -q "Need scope decision on X" .specflow/backlog/001-first-item.md \
  && pass "clarification appended to file" \
  || fail "clarification not in file" "$(tail -10 .specflow/backlog/001-first-item.md)"

echo
echo "═══ add second item (auto-numbering) ═══"
bash .specflow/scripts/backlog/add.sh "Second" "" >/dev/null
[ -f .specflow/backlog/002-second.md ] \
  && pass "002-second.md created (auto-numbered)" \
  || fail "expected 002-second.md" "$(ls .specflow/backlog/)"

echo
echo "═══ #180  add --parent (sub-task of #001) ═══"
out=$(bash .specflow/scripts/backlog/add.sh "Subtask of 1" "" --parent 1)
echo "$out"
echo "$out" | grep -q "✓ created #003" \
  && pass "add --parent prints '✓ created #003'" \
  || fail "add --parent output" "$out"
[ -f .specflow/backlog/003-subtask-of-1.md ] \
  && pass "003-subtask-of-1.md created" \
  || fail "expected 003-subtask-of-1.md" "$(ls .specflow/backlog/)"
grep -q '^parent: "#001"$' .specflow/backlog/003-subtask-of-1.md \
  && pass "child frontmatter declares parent: \"#001\"" \
  || fail "parent key missing in child" "$(head -10 .specflow/backlog/003-subtask-of-1.md)"
grep -q "^## Sub-tasks$" .specflow/backlog/001-first-item.md \
  && pass "parent body grew a Sub-tasks section" \
  || fail "no Sub-tasks section in parent" "$(tail -10 .specflow/backlog/001-first-item.md)"
grep -q "#003" .specflow/backlog/001-first-item.md \
  && pass "parent body cross-links to #003" \
  || fail "parent body missing #003 link" "$(tail -10 .specflow/backlog/001-first-item.md)"

echo
echo "═══ #180  add --parent refuses unknown parent ═══"
if bash .specflow/scripts/backlog/add.sh "Orphan" "" --parent 999 2>/dev/null; then
  fail "should have refused parent #999" "(unexpected exit 0)"
else
  pass "refused to create child of non-existent parent #999"
fi

echo
echo "═══ #260  Auto-propagate parent Epic on child move (local) ═══"
[ -x .specflow/scripts/backlog/propagate-parent-status.sh ] \
  && pass "propagate-parent-status.sh scaffolded executable" \
  || fail "propagate-parent-status.sh missing or not executable" "$(ls -l .specflow/scripts/backlog/ 2>/dev/null)"
grep -q "propagate-parent-status.sh" .specflow/scripts/backlog/move.sh \
  && pass "move.sh invokes propagate-parent-status.sh as tail hook" \
  || fail "move.sh tail hook missing" "$(tail -10 .specflow/scripts/backlog/move.sh)"

# #263 setup: create a second sibling child of #001 so the original
# #260 single-child assertions below stay meaningful (otherwise child
# #003 → Done would itself complete the set and trigger #263's
# all-children-Done promotion).
bash .specflow/scripts/backlog/add.sh "Second sibling of 1" "" --parent 1 >/dev/null
[ -f .specflow/backlog/004-second-sibling-of-1.md ] \
  && pass "second sibling child #004 created for #263 multi-child smoke" \
  || fail "second sibling #004 not created" "$(ls .specflow/backlog/)"

# Baseline: parent #001 back to Backlog, child #003 (sub-task) back to Backlog.
bash .specflow/scripts/backlog/move.sh 1 Backlog >/dev/null
bash .specflow/scripts/backlog/move.sh 3 Backlog >/dev/null

# Move child OUT of Backlog → parent should auto-promote to In progress.
bash .specflow/scripts/backlog/move.sh 3 "In progress" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In progress" ] \
  && pass "parent auto-promoted from Backlog to In progress on child sub-task move" \
  || fail "parent auto-promotion broken" "expected 'In progress', got '$parent_status'"

# #260 regression guard: parent at 'In review' must stay there when a
# child moves to Done WHILE other open siblings still exist. With #263
# in main, this only holds because we created #004 in Backlog above —
# otherwise child #003 → Done would itself complete the set.
bash .specflow/scripts/backlog/move.sh 1 "In review" >/dev/null
bash .specflow/scripts/backlog/move.sh 3 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "parent in 'In review' stays there while #004 still open (AC c regression guard)" \
  || fail "#260 regression guard broken" "expected 'In review', got '$parent_status'"

echo
echo "═══ #263  Auto-Done propagation when all Epic children Done ═══"
# Static-grep: the Done branch exists in the propagator source.
grep -qE '^[[:space:]]*"Done"\)' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "propagate-parent-status.sh has a NEW_STATUS=Done branch (#263)" \
  || fail "Done branch missing in local propagator" "$(grep -n 'case' .specflow/scripts/backlog/propagate-parent-status.sh)"
grep -q 'all_done=true' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "propagator computes all_done from sibling frontmatter" \
  || fail "all_done variable missing in local propagator" "$(grep -n 'all_done' .specflow/scripts/backlog/propagate-parent-status.sh)"

# Behaviour: move the remaining open child #004 to Done.
# State before: #001=In review, #003=Done, #004=Backlog.
# Expected after: #001=Done (auto-promoted), #003=Done, #004=Done.
bash .specflow/scripts/backlog/move.sh 4 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "Done" ] \
  && pass "parent auto-advances In review → Done when last open child reaches Done (AC a)" \
  || fail "#263 AC(a) broken" "expected 'Done', got '$parent_status'"

# AC(b) idempotency: moving a Done child to Done again, with parent already Done,
# must NOT corrupt the parent's status (no-op via *) case in PARENT_STATUS).
bash .specflow/scripts/backlog/move.sh 4 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "Done" ] \
  && pass "re-moving a Done child to Done is idempotent on a Done parent (AC b)" \
  || fail "#263 AC(b) idempotency broken" "expected 'Done', got '$parent_status'"

# AC(c) regression guard: parent manually moved back from Done. The
# propagator must NOT re-promote unless a fresh child→Done transition
# happens AFTER the demotion. The current state has #001=Done,
# #003=Done, #004=Done. Demote #001 to In review, then nudge a child
# through a non-Done state and back to Done; verify the parent state
# at each step.
bash .specflow/scripts/backlog/move.sh 1 "In review" >/dev/null
# Step 1: parent is at In review with all children at Done. The
# propagator only fires on child moves, so a `move.sh 1 "In review"`
# call should not re-trigger Done propagation by itself.
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "manually demoting parent from Done to In review lands (no auto-reversal at rest, AC c)" \
  || fail "#263 AC(c) — manual demotion not respected" "expected 'In review', got '$parent_status'"

# Step 2: move a Done child OUT of Done (Backlog), then to a non-Done
# state. The propagator only fires on out-of-Backlog and Done transitions;
# moving #004 to Backlog then to In progress exercises the #260 path
# (parent should stay at In review since In review is not in Backlog/Ready).
bash .specflow/scripts/backlog/move.sh 4 "Backlog" >/dev/null
bash .specflow/scripts/backlog/move.sh 4 "In progress" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "parent at In review (manually demoted from Done) is not re-promoted on a non-Done child move (AC c)" \
  || fail "#263 AC(c) — child→In progress re-triggers Done propagation" "expected 'In review', got '$parent_status'"

# Parent at Backlog branch — moving a Done child to Done must not promote a
# Backlog parent (AC a explicitly excludes Backlog). Demote parent, re-run.
bash .specflow/scripts/backlog/move.sh 1 "Backlog" >/dev/null
bash .specflow/scripts/backlog/move.sh 4 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "Backlog" ] \
  && pass "Backlog parent is not auto-advanced even when all children Done (AC a exclusion)" \
  || fail "#263 Backlog parent exclusion broken" "expected 'Backlog', got '$parent_status'"

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL BACKLOG CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
