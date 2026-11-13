#!/usr/bin/env bash
# Check that the bundled hooks are installed and registered: on Claude Code,
# every hook script and its support files, executable where they run, the
# Specnaut marketplace pinned to a release with the cockpit mod enabled, and
# no registration naming a script that is missing; on Codex, the status ledger
# registered and the installed hooks matching their SHA256SUMS. Then fire the
# hooks with a synthetic stdin payload and check their exit codes and side
# effects: review-gate lets a command that never mentions a review through,
# silent; protect-generated refuses an edit to the lock with exit 2, even once
# the lock is gone, and fails closed on an empty payload; log-subagent appends
# one line per event, `unknown` for a missing field. check-backlog-prereqs is
# fired here only with no lock; its own checks are in smoke-backlog-prereqs.sh,
# the session's record in smoke-record-checkout.sh.
#
# Usage: smoke-hooks.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-hooks.sh <name>}"
. "$(dirname "$0")/_common.sh"
# A repository of its own: the guards resolve the project through
# `git rev-parse --show-toplevel`.
smoke_scaffold "$NAME" repo

echo "═══ #88 + spec 036  hooks bundled and registered (Claude) ═══"
check ".claude/settings.json scaffolded" '[ -f .claude/settings.json ]'
check "PreToolUse hook registered" 'grep -q "PreToolUse" .claude/settings.json'
check "SubagentStart hook registered" 'grep -q "SubagentStart" .claude/settings.json'
check "SessionStart hook registered" 'grep -q "SessionStart" .claude/settings.json'
# cli#642: Claude Code offers the cockpit mod when the project is trusted.
check "Specnaut marketplace declared, pinned to a release" \
  'jq -e ".extraKnownMarketplaces[\"specnaut-marketplace\"].source | .repo == \"specnaut/specnaut-cli\" and (.ref | startswith(\"v\"))" .claude/settings.json >/dev/null'
check "cockpit mod enabled" \
  'jq -e ".enabledPlugins[\"specnaut-cockpit@specnaut-marketplace\"] == true" .claude/settings.json >/dev/null'
# Spelled out, not looped: audit.sh counts a path as covered only where it is written.
for hook in .specnaut/hooks/protect-generated.sh .specnaut/hooks/log-subagent.sh \
  .specnaut/hooks/guard-dispatch-model.sh; do
  check "$hook executable" "[ -x $hook ]"
done
for support in .specnaut/hooks/_guard.sh .specnaut/hooks/_paths.sh \
  .specnaut/hooks/_agents.txt .specnaut/hooks/SHA256SUMS; do
  check "$support installed" "[ -f $support ]"
done
# cli#679: a CRLF checkout would change every hash SHA256SUMS pins.
check ".specnaut/hooks/.gitattributes keeps git from converting the hooks" \
  'grep -qxF "* -text" .specnaut/hooks/.gitattributes'
check "check-backlog-prereqs.sh executable" '[ -x .claude/hooks/check-backlog-prereqs.sh ]'
# The checkout gate before each shell command: registered on Bash, and a command
# that never mentions a review is let through without starting the binary.
check "review-gate.sh executable" '[ -x .claude/hooks/review-gate.sh ]'
check "review-gate.sh registered on PreToolUse for Bash" \
  'jq -e "[.hooks.PreToolUse[] | select(.matcher == \"Bash\") | .hooks[].command | select(test(\"review-gate\\\\.sh\"))] | length == 1" .claude/settings.json >/dev/null'
out=$(echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | bash .claude/hooks/review-gate.sh 2>&1; echo "ec=$?")
[ "$out" = "ec=0" ] && pass "review-gate.sh lets a command with no review through, silent" \
  || fail "review-gate.sh stopped or spoke on an unrelated command" "$out"
# The review lock before every tool call: registered on every tool, and with no
# lock held a call is let through without starting the binary.
check "review-lock.sh executable" '[ -x .claude/hooks/review-lock.sh ]'
check "review-lock.sh registered on PreToolUse for every tool" \
  'jq -e "[.hooks.PreToolUse[] | select(.matcher == \"*\") | .hooks[].command | select(test(\"review-lock\\\\.sh\"))] | length == 1" .claude/settings.json >/dev/null'
out=$(echo '{"session_id":"s","tool_name":"Bash","tool_input":{"command":"ls"}}' | bash .claude/hooks/review-lock.sh 2>&1; echo "ec=$?")
[ "$out" = "ec=0" ] && pass "review-lock.sh lets a call through with no lock held, silent" \
  || fail "review-lock.sh stopped or spoke with no lock held" "$out"
check "retired protect-generated copy not scaffolded" '[ ! -e .claude/hooks/protect-generated.sh ]'
check "retired log-subagent copy not scaffolded" '[ ! -e .claude/hooks/log-subagent.sh ]'
# Every script a registration runs exists: a moved hook left registered at its
# old path fails on every tool call.
missing=""
for script in $(jq -r '.hooks[][].hooks[].command' .claude/settings.json \
  | grep -oE '\.(specnaut|claude)/hooks/[A-Za-z0-9_-]+\.sh' | sort -u); do
  [ -f "$script" ] || missing="$missing $script"
done
[ -z "$missing" ] && pass "every registered Claude hook script exists" \
  || fail "registered hook scripts missing" "$missing"
check ".specnaut/logs/ in bundled .gitignore" \
  'grep -q "\.specnaut/logs/" .gitignore'

echo
echo "═══ spec 036  hooks registered (Codex) ═══"
# Inside the scenario tree, so the EXIT trap smoke_scaffold set removes it too.
CODEX_DIR="$DIR/codex-probe"
mkdir -p "$CODEX_DIR"
(cd "$CODEX_DIR" && git init -q && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai codex --backlog local >/dev/null 2>&1)
check ".codex/hooks.json scaffolded" '[ -f codex-probe/.codex/hooks.json ]'
check "status ledger registered on Codex SubagentStart (FR-011)" \
  'jq -e "[.hooks.SubagentStart[].hooks[].command | select(test(\"log-subagent\\\\.sh\"))] | length == 1" codex-probe/.codex/hooks.json'
check "protect-generated.sh executable on Codex" '[ -x codex-probe/.specnaut/hooks/protect-generated.sh ]'
check "installed hooks match their SHA256SUMS" \
  '(cd codex-probe/.specnaut/hooks && { sha256sum -c --status SHA256SUMS 2>/dev/null || shasum -a 256 -c --status SHA256SUMS; })'

echo

echo "═══ protect-generated.sh ═══"

# A Claude Edit payload aimed at <path> in this project. Built with jq: the
# scenario path is interpolated, and a hand-quoted JSON string breaks on it.
PROTECT=.specnaut/hooks/protect-generated.sh
edit_payload() {
  jq -cn --arg cwd "$PWD" --arg f "$1" \
    '{cwd: $cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: {file_path: $f}}'
}

# Lock edit → refused, exit 2 (spec 036: it used to warn and let the edit through).
# `ec=$?` on its own line is unreachable under `set -e`: a non-zero hook makes
# the ASSIGNMENT non-zero, errexit fires, and the script dies before $? is read
# — so ec was always 0 by the time the assertion ran. Capturing the status
# inside the substitution is the idiom this file already uses below.
out=$(edit_payload "$PWD/.specnaut/installed.lock" | bash "$PROTECT" claude 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=2" && pass "exit code 2 on lock edit (refused)" \
  || fail "lock edit not refused" "$out"
echo "$out" | grep -q "installed.lock is generated" \
  && pass "explanation emitted on lock edit" \
  || fail "missing explanation text" "$out"

# Unrelated file → silent, exit 0
out=$(edit_payload "$PWD/random.txt" | bash "$PROTECT" claude 2>&1; echo "ec=$?")
[ "$out" = "ec=0" ] && pass "silent exit 0 on unrelated file" \
  || fail "unexpected output on unrelated file" "$out"

# Empty stdin → refused: a guard that cannot read its payload must not allow.
out=$(echo "" | bash "$PROTECT" claude 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=2" \
  && pass "exit 2 on empty stdin (fails closed)" \
  || fail "empty stdin did not fail closed" "$out"

echo
echo "═══ log-subagent.sh ═══"

rm -f .specnaut/logs/agents.jsonl
echo '{"session_id":"sess-A","subagent_name":"product-owner"}' \
  | bash .specnaut/hooks/log-subagent.sh start
[ -f .specnaut/logs/agents.jsonl ] \
  && pass "agents.jsonl created" \
  || fail "log file not created" "$(ls .specnaut/logs/ 2>&1 || echo none)"

line=$(cat .specnaut/logs/agents.jsonl)
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
  | bash .specnaut/hooks/log-subagent.sh stop
count=$(wc -l < .specnaut/logs/agents.jsonl | tr -d ' ')
[ "$count" = "2" ] && pass "stop event appended (2 lines total)" \
  || fail "expected 2 lines, got $count" "$(cat .specnaut/logs/agents.jsonl)"

# Missing payload fields → "unknown" defaults
echo '{}' | bash .specnaut/hooks/log-subagent.sh start
last=$(tail -1 .specnaut/logs/agents.jsonl)
echo "$last" | grep -q '"agent":"unknown"' \
  && pass "agent defaults to 'unknown' when missing" \
  || fail "did not default to 'unknown'" "$last"

echo
echo "═══ no lock present (e.g. uninitialised project) ═══"
# Moved aside INSIDE the scenario tree, not into /tmp. The EXIT trap smoke_scaffold
# set already removes that tree, so an abort between the two
# moves leaks nothing — and no second trap is added, because bash replaces
# rather than appends and that would silently drop the cleanup.
# /tmp/spec-lock-backup-$$ was also PID-predictable in a world-writable
# directory: across filesystems `mv` degrades to copy+unlink and follows a
# destination symlink.
mv .specnaut/installed.lock .installed.lock.aside
# Identity, not existence: re-creating the lock by hand is the same edit.
out=$(edit_payload "$PWD/.specnaut/installed.lock" | bash "$PROTECT" claude 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=2" \
  && pass "protect-generated refuses re-creating a missing lock" \
  || fail "protect-generated let a missing lock be re-created" "$out"
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=0" \
  && pass "check-backlog-prereqs exits 0 with no lock" \
  || fail "check-backlog-prereqs crashed" "$out"
mv .installed.lock.aside .specnaut/installed.lock

finish "HOOKS"
