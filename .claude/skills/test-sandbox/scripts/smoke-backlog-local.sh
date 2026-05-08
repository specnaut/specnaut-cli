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
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL BACKLOG CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
