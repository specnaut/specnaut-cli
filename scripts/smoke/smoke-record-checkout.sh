#!/usr/bin/env bash
# Fire the scaffolded SessionStart hook .claude/hooks/record-checkout.sh as
# Claude Code fires it, a SessionStart payload on stdin: it is registered and
# executable; with no `specnaut` on PATH it exits 0, prints nothing and records
# nothing; with the CLI from source on PATH it exits 0 with nothing on stdout,
# writes the record under the git directory and exports nothing through
# CLAUDE_ENV_FILE: a check finds the record by the session id alone. Its own
# script: smoke-hooks.sh is at its size limit.
#
# Usage: smoke-record-checkout.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-record-checkout.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)
cd "$DIR"

echo "=== record-checkout.sh (SessionStart: the checkout a session started on) ==="
check "record-checkout.sh executable" '[ -x .claude/hooks/record-checkout.sh ]'
check "record-checkout.sh registered on SessionStart" \
  'jq -e "[.hooks.SessionStart[].hooks[].command] | any(test(\"record-checkout.sh\"))" .claude/settings.json >/dev/null'
git -c user.name=smoke -c user.email=smoke@example.com -c commit.gpgsign=false \
  commit -q --allow-empty -m "session start" >/dev/null
env_file="$PWD/.smoke-claude-env"
payload='{"session_id":"smoke-session","source":"startup","hook_event_name":"SessionStart"}'
record="$(git rev-parse --absolute-git-dir)/specnaut/session/smoke-session.json"

# A PATH holding no specnaut: the hook records nothing and still exits 0, silent.
bin="$(mktemp -d)"
for _t in bash env; do
  _p="$(command -v "$_t" 2>/dev/null)" && ln -sf "$_p" "$bin/$_t"
done
out=$(echo "$payload" | PATH="$bin" CLAUDE_ENV_FILE="$env_file" \
  bash .claude/hooks/record-checkout.sh 2>&1; echo "ec=$?")
[ "$out" = "ec=0" ] && pass "no specnaut on PATH: exit 0, nothing printed" \
  || fail "the hook failed or spoke without specnaut" "$out"
[ ! -e "$record" ] && pass "and no record is taken" || fail "a record appeared" "$record"

# The CLI from source, as `specnaut` on PATH: the hook takes the record.
cat > "$bin/specnaut" <<SHIM
#!/usr/bin/env bash
exec deno run --allow-all "$CLI/src/main.ts" "\$@"
SHIM
chmod +x "$bin/specnaut"
stdout=$(echo "$payload" | PATH="$bin:$PATH" CLAUDE_ENV_FILE="$env_file" \
  CLAUDE_PROJECT_DIR="$PWD" bash .claude/hooks/record-checkout.sh 2>/dev/null; echo "ec=$?")
# Not `rm -rf`: the folder is a mktemp outside the sandbox, holding only the
# links and the shim made above (smoke-toolbox.sh's sweep rule).
rm -f "$bin"/*
rmdir "$bin"
[ "$stdout" = "ec=0" ] && pass "specnaut on PATH: exit 0, nothing on stdout" \
  || fail "the hook failed or printed to the session's context" "$stdout"
[ -f "$record" ] && pass "the record is taken in the git directory" \
  || fail "no record at the git directory" "$record"
[ ! -s "$env_file" ] && pass "nothing is exported to the session through CLAUDE_ENV_FILE" \
  || fail "CLAUDE_ENV_FILE was written" "$(cat "$env_file" 2>/dev/null)"

finish "RECORD-CHECKOUT"
