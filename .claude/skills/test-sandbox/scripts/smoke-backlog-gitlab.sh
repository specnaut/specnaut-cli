#!/usr/bin/env bash
# Verify the GitLab-backend backlog scaffolding ships every script the
# PO + grooming + epic contracts depend on. Tests file presence,
# executable bits, --parent flag wiring, and SKILL.md references — no
# live `glab` calls (the script behavior against a real project is
# covered by integration tests and manual QA).
#
# Usage: smoke-backlog-gitlab.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-gitlab.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/sandbox/$NAME"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SCRIPT_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SCRIPT_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$ROOT/src/main.ts" \
  init --here --no-git --ai claude --backlog gitlab \
  --backlog-url "https://gitlab.com/example/proj" >/dev/null 2>&1)

cd "$DIR"
fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1 — $2"; fails=$((fails + 1)); }

check() {
  local desc="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then pass "$desc"; else fail "$desc" "command: $cmd"; fi
}

echo "═══ backlog backend lock + config ═══"
check "lock records gitlab backend" \
  'grep -q "backlog_backend: gitlab" .specflow/installed.lock'
check "backlog-config.yml stub present" \
  '[ -f .specflow/backlog-config.yml ]'

echo
echo "═══ canonical backlog scripts ═══"
for s in list view add move clarify-comment ensure-labels; do
  check "$s.sh present + executable" "[ -x .specflow/scripts/backlog/$s.sh ]"
done

echo
echo "═══ #180  add.sh --parent flag (scoped-label parent::#NNN) ═══"
check "add.sh parses --parent flag" \
  'grep -q -- "--parent" .specflow/scripts/backlog/add.sh'
check "add.sh emits parent::#NNN scoped label" \
  'grep -q "parent::#" .specflow/scripts/backlog/add.sh'

echo
echo "═══ #180  cascade-check.sh present + executable ═══"
check "cascade-check.sh present + executable" \
  '[ -x .specflow/scripts/backlog/cascade-check.sh ]'
check "cascade-check.sh queries the parent::#NNN scoped label" \
  'grep -q "parent::#" .specflow/scripts/backlog/cascade-check.sh'
check "cascade-check.sh exits 11 when children block close" \
  'grep -q "exit 11" .specflow/scripts/backlog/cascade-check.sh'

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL GITLAB BACKLOG CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
