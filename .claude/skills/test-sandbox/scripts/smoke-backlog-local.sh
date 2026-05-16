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
# Baseline: parent #001 back to Backlog, child #003 (sub-task) back to Backlog.
bash .specflow/scripts/backlog/move.sh 1 Backlog >/dev/null
bash .specflow/scripts/backlog/move.sh 3 Backlog >/dev/null

# Move child OUT of Backlog → parent should auto-promote to In progress.
bash .specflow/scripts/backlog/move.sh 3 "In progress" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In progress" ] \
  && pass "parent auto-promoted from Backlog to In progress on child sub-task move" \
  || fail "parent auto-promotion broken" "expected 'In progress', got '$parent_status'"

# Regression guard: manually advance parent to In review, move another child.
bash .specflow/scripts/backlog/move.sh 1 "In review" >/dev/null
bash .specflow/scripts/backlog/move.sh 3 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "parent in 'In review' is NOT pulled back to 'In progress' on child move" \
  || fail "regression guard broken" "expected 'In review', got '$parent_status'"

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL BACKLOG CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
