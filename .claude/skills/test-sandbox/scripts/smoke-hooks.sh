#!/usr/bin/env bash
# Fire each bundled Claude hook with a synthetic stdin payload, verify
# the side effects, and confirm exit codes are 0 (soft warn-only).
#
# Usage: smoke-hooks.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-hooks.sh <name>}"
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

echo "═══ protect-generated.sh ═══"

# Lock edit → soft warn, exit 0
out=$(echo '{"tool_input":{"file_path":"/x/.specflow/installed.lock"}}' \
  | bash .claude/hooks/protect-generated.sh 2>&1)
ec=$?
[ "$ec" = "0" ] && pass "exit code 0 on lock edit (soft warn)" \
  || fail "non-zero exit on lock edit" "ec=$ec"
echo "$out" | grep -q "warn:" \
  && pass "warning emitted on lock edit" \
  || fail "missing warning text" "$out"

# Unrelated file → silent, exit 0
out=$(echo '{"tool_input":{"file_path":"/x/random.txt"}}' \
  | bash .claude/hooks/protect-generated.sh 2>&1)
[ -z "$out" ] && pass "silent on unrelated file" \
  || fail "unexpected output on unrelated file" "$out"

# Empty stdin → silent, exit 0
out=$(echo "" | bash .claude/hooks/protect-generated.sh 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=0" \
  && pass "exit 0 on empty stdin" \
  || fail "non-zero exit on empty stdin" "$out"

echo
echo "═══ log-subagent.sh ═══"

rm -f .specflow/logs/agents.jsonl
echo '{"session_id":"sess-A","subagent_name":"product-owner"}' \
  | bash .claude/hooks/log-subagent.sh start
[ -f .specflow/logs/agents.jsonl ] \
  && pass "agents.jsonl created" \
  || fail "log file not created" "$(ls .specflow/logs/ 2>&1 || echo none)"

line=$(cat .specflow/logs/agents.jsonl)
echo "$line" | grep -q '"event":"start"' \
  && pass 'event field = "start"' \
  || fail "wrong event field" "$line"
echo "$line" | grep -q '"agent":"product-owner"' \
  && pass "agent field extracted" \
  || fail "agent field missing" "$line"
echo "$line" | grep -q '"session":"sess-A"' \
  && pass "session field extracted" \
  || fail "session field missing" "$line"

# Second event appends
echo '{"session_id":"sess-A","subagent_name":"product-owner"}' \
  | bash .claude/hooks/log-subagent.sh stop
count=$(wc -l < .specflow/logs/agents.jsonl | tr -d ' ')
[ "$count" = "2" ] && pass "stop event appended (2 lines total)" \
  || fail "expected 2 lines, got $count" "$(cat .specflow/logs/agents.jsonl)"

# Missing payload fields → "unknown" defaults
echo '{}' | bash .claude/hooks/log-subagent.sh start
last=$(tail -1 .specflow/logs/agents.jsonl)
echo "$last" | grep -q '"agent":"unknown"' \
  && pass "agent defaults to 'unknown' when missing" \
  || fail "did not default to 'unknown'" "$last"

echo
echo "═══ check-backlog-prereqs.sh (local backend) ═══"

out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1)
ec=$?
[ "$ec" = "0" ] && pass "exit 0 on local backend" \
  || fail "non-zero exit" "ec=$ec"
[ -z "$out" ] && pass "silent on local backend (no warn)" \
  || fail "unexpected output on local backend" "$out"

echo
echo "═══ check-backlog-prereqs.sh (github backend, gh present) ═══"
# Patch the lock to simulate the github backend
sed -i.bak 's/backlog_backend: local/backlog_backend: github/' \
  .specflow/installed.lock
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1)
ec=$?
mv .specflow/installed.lock.bak .specflow/installed.lock
[ "$ec" = "0" ] && pass "exit 0 on github backend" \
  || fail "non-zero exit" "ec=$ec"
# If gh is installed + auth'd, no warning. If not, warning. Either is OK
# as long as exit 0 and no crash.
echo "(github-backend output: $(echo "$out" | head -1))"

echo
echo "═══ no lock present (e.g. uninitialised project) ═══"
mv .specflow/installed.lock /tmp/spec-lock-backup-$$
out=$(echo '{"tool_input":{"file_path":"/x/.specflow/installed.lock"}}' \
  | bash .claude/hooks/protect-generated.sh 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=0" \
  && pass "protect-generated exits 0 with no lock" \
  || fail "protect-generated crashed" "$out"
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=0" \
  && pass "check-backlog-prereqs exits 0 with no lock" \
  || fail "check-backlog-prereqs crashed" "$out"
mv /tmp/spec-lock-backup-$$ .specflow/installed.lock

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL HOOK CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
