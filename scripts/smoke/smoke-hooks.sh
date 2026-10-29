#!/usr/bin/env bash
# Check that the bundled hooks are installed and registered on Claude Code and
# Codex, then fire each Claude hook with a synthetic stdin payload and verify
# the side effects and exit codes: the guard (protect-generated) refuses with
# exit 2, the observers (log-subagent, check-backlog-prereqs) always exit 0.
#
# Usage: smoke-hooks.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-hooks.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
# A repository of its own: the guards resolve the project through
# `git rev-parse --show-toplevel`, and sandbox/ sits inside this one — without
# it every path is read relative to the CLI checkout and nothing matches.
(cd "$DIR" && git init -q && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

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
  .specnaut/hooks/guard-merge.sh .specnaut/hooks/guard-release.sh \
  .specnaut/hooks/guard-dispatch-model.sh .specnaut/hooks/approve-on-prompt.sh; do
  check "$hook executable" "[ -x $hook ]"
done
for support in .specnaut/hooks/_guard.sh .specnaut/hooks/_approval.sh \
  .specnaut/hooks/_command.sh .specnaut/hooks/_git.sh .specnaut/hooks/_simple.sh \
  .specnaut/hooks/_agents.txt .specnaut/hooks/release-commands.txt .specnaut/hooks/SHA256SUMS; do
  check "$support installed" "[ -f $support ]"
done
# cli#679: a CRLF checkout would change every hash SHA256SUMS pins.
check ".specnaut/hooks/.gitattributes keeps git from converting the hooks" \
  'grep -qxF "* -text" .specnaut/hooks/.gitattributes'
check "check-backlog-prereqs.sh executable" '[ -x .claude/hooks/check-backlog-prereqs.sh ]'
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
# Inside the scenario tree, so the EXIT trap above removes it too.
CODEX_DIR="$DIR/codex-probe"
mkdir -p "$CODEX_DIR"
(cd "$CODEX_DIR" && git init -q && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai codex --backlog local >/dev/null 2>&1)
check ".codex/hooks.json scaffolded" '[ -f codex-probe/.codex/hooks.json ]'
check "Bash guard registered once on Codex" \
  'jq -e "[.hooks.PreToolUse[] | select(.matcher == \"Bash\") | .hooks[].command | select(test(\"guard-merge\\\\.sh\"))] | length == 1" codex-probe/.codex/hooks.json'
check "status ledger registered on Codex SubagentStart (FR-011)" \
  'jq -e "[.hooks.SubagentStart[].hooks[].command | select(test(\"log-subagent\\\\.sh\"))] | length == 1" codex-probe/.codex/hooks.json'
check "guard-merge.sh executable on Codex" '[ -x codex-probe/.specnaut/hooks/guard-merge.sh ]'
check "installed hooks match their SHA256SUMS" \
  '(cd codex-probe/.specnaut/hooks && { sha256sum -c --status SHA256SUMS 2>/dev/null || shasum -a 256 -c --status SHA256SUMS; })'
# The registered command end to end — the SHA256SUMS pin included — on a
# harmless command: a pin that no longer matches the folder exits 2 here.
codex_bash=$(jq -r '[.hooks.PreToolUse[] | select(.matcher == "Bash") | .hooks[].command | select(test("guard-merge\\.sh"))][0]' codex-probe/.codex/hooks.json)
out=$(cd "$CODEX_DIR" && jq -cn --arg cwd "$CODEX_DIR" \
  '{session_id: "s", turn_id: "t", cwd: $cwd, hook_event_name: "PreToolUse", permission_mode: "default", tool_name: "Bash", tool_input: {command: "git status"}}' \
  | bash -c "$codex_bash" 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=0" && pass "the registered Codex Bash guard allows git status" \
  || fail "the registered Codex Bash guard did not allow git status" "$out"

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
echo "═══ check-backlog-prereqs.sh (local backend) ═══"

# Capturing the status inside the substitution appends an `ec=N` line, so the
# hook's OWN output is everything except that last line. Asserting silence
# against the raw capture would compare against a string that is never empty.
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")
hook_out="$(printf '%s' "$out" | sed '$d')"
echo "$out" | grep -q "ec=0" && pass "exit 0 on local backend" \
  || fail "non-zero exit" "$out"
[ -z "$hook_out" ] && pass "silent on local backend (no warn)" \
  || fail "unexpected output on local backend" "$hook_out"

echo
echo "═══ check-backlog-prereqs.sh (github backend, gh present) ═══"
# Patch the lock to simulate the github backend
sed -i.bak 's/backlog_backend: local/backlog_backend: github/' \
  .specnaut/installed.lock
# #550: assert the fixture APPLIED. A sed whose pattern matches nothing exits
# 0 and changes nothing, so if the lock ever spells the key differently every
# assertion below runs against the LOCAL backend and passes — a whole section
# exercising the wrong branch, reported as green.
if ! grep -q "backlog_backend: github" .specnaut/installed.lock; then
  fail "the github-backend fixture did not apply" \
       "lock still reads: $(grep backlog_backend .specnaut/installed.lock || echo '<no backlog_backend key>')"
  # Not a bare `fail`: every assertion below is about the github branch, and
  # running them against the local one produces green results that mean
  # nothing. Stop here through the suite's own contract.
  mv .specnaut/installed.lock.bak .specnaut/installed.lock
  finish "HOOKS"
fi
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")

# The disjunction the old comment shrugged at ("Either is OK") is queryable, so
# it is asserted instead of echoed. Both sides are exercised HERE, while the
# lock still says github — the hook only consults gh on that backend, so after
# the restore below either branch would pass for the wrong reason.
#
# The warning text is copied from the hook, not paraphrased. The first version
# of this check grepped "gh CLI not found", which the hook never prints: on a
# machine where gh IS present the grep could not match, the `||` branch ran,
# and the assertion passed unconditionally. A constant-true assertion, inside
# the fix for constant-true assertions.
GH_WARN="is not on PATH"
if echo "$out" | grep -qF "$GH_WARN"; then
  fail "warned about a missing gh" "gh is on PATH here; $out"
else
  pass "no missing-gh warning when gh is on PATH"
fi

# /usr/bin:/bin hides a Homebrew gh but NOT ubuntu-latest's, which ships at
# /usr/bin/gh — so on CI a correct hook would have turned this red, and a red
# assertion on correct code is how assertions get deleted to unblock a push.
# Build a PATH guaranteed not to contain gh.
nogh_bin="$(mktemp -d)"
# bash is symlinked too: `PATH=x cmd` resolves cmd through x, so leaving it out
# made the run fail with "bash: command not found" rather than exercising the
# hook.
for _t in bash awk cat env; do
  _p="$(command -v "$_t" 2>/dev/null)" && ln -sf "$_p" "$nogh_bin/$_t"
done
if PATH="$nogh_bin" command -v gh >/dev/null 2>&1; then
  fail "the gh-absent fixture still finds gh" "the absent branch cannot be exercised"
fi
out_nogh=$(echo "{}" | PATH="$nogh_bin" bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")
# Not `rm -rf`: smoke-toolbox.sh's static sweep requires every deleting path be
# built through scenario_dir, and this one is a mktemp outside the sandbox. The
# directory holds only symlinks, so removing them and rmdir'ing is exact — and
# it keeps the sweep's rule intact instead of carving an exception into it.
rm -f "$nogh_bin"/*
rmdir "$nogh_bin"
if echo "$out_nogh" | grep -qF "$GH_WARN"; then
  pass "and warns when gh is genuinely off PATH"
else
  fail "no warning with gh off PATH" "$out_nogh"
fi
echo "$out_nogh" | grep -q "ec=0" \
  && pass "a missing gh is a warning, not a failure" \
  || fail "the hook failed instead of warning" "$out_nogh"

mv .specnaut/installed.lock.bak .specnaut/installed.lock
echo "$out" | grep -q "ec=0" && pass "exit 0 on github backend" \
  || fail "non-zero exit" "$out"

echo
echo "═══ no lock present (e.g. uninitialised project) ═══"
# Moved aside INSIDE the scenario tree, not into /tmp. The EXIT trap at the
# top of this file already removes that tree, so an abort between the two
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
