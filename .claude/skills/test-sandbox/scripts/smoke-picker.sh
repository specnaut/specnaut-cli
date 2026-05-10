#!/usr/bin/env bash
# Drive the interactive arrow-key picker over a real PTY so
# `Deno.stdin.isTerminal()` returns true and the TUI code path runs.
# Sends arrow-down + enter sequences to verify navigation + selection
# render correctly and the resulting init landed the right harness +
# backlog backend.
#
# Usage: smoke-picker.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-picker.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/sandbox/$NAME"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SCRIPT_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SCRIPT_DIR/bootstrap-empty.sh" "$NAME" >/dev/null

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 not on PATH — needed to allocate a PTY for this test"
  exit 1
fi

# Python driver: forks a PTY-attached child running specflow init,
# scripts arrow-down/enter keystrokes, captures all output.
out="$(PROJECT_DIR="$DIR" MAIN_TS="$ROOT/src/main.ts" python3 - <<'PYEOF'
import os, pty, select, sys, time

PROJECT_DIR = os.environ["PROJECT_DIR"]
MAIN_TS = os.environ["MAIN_TS"]
ARGS = ["deno", "run", "--allow-all", MAIN_TS, "init", "--here", "--no-git"]
# 2× down + enter (codex harness), 1× down + enter (github backend),
# enter to skip the kanban URL prompt (added in #147).
SCRIPT = [
    (0.5, b"\x1b[B"),
    (0.2, b"\x1b[B"),
    (0.3, b"\r"),
    (0.5, b"\x1b[B"),
    (0.3, b"\r"),
    (0.5, b"\r"),
]

os.chdir(PROJECT_DIR)
pid, fd = pty.fork()
if pid == 0:
    os.execvp(ARGS[0], ARGS)

captured = bytearray()
deadline = time.time() + 25.0
script = list(SCRIPT)
next_at = time.time() + (script[0][0] if script else 0)
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        captured.extend(chunk)
    if script and time.time() >= next_at:
        _, payload = script.pop(0)
        os.write(fd, payload)
        if script:
            next_at = time.time() + script[0][0]
    try:
        done_pid, _status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        break
    if done_pid == pid:
        break

os.close(fd)
sys.stdout.buffer.write(bytes(captured))
PYEOF
)"

fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1 — $2"; fails=$((fails + 1)); }

echo "$out" | grep -q "Choose your AI harness" \
  && pass "harness picker prompt rendered" \
  || fail "harness prompt missing" "$out"

echo "$out" | grep -q "❯ Codex CLI" \
  && pass "highlight reached Codex CLI after 2 arrow-downs" \
  || fail "❯ never reached Codex CLI" "$out"

echo "$out" | grep -q "Choose your backlog backend" \
  && pass "backlog picker prompt rendered" \
  || fail "backlog prompt missing" "$out"

echo "$out" | grep -q "❯ GitHub Issues" \
  && pass "highlight reached GitHub backend after arrow-down" \
  || fail "❯ never reached GitHub backend" "$out"

echo "$out" | grep -q "Open the project in Codex CLI" \
  && pass "init resolved harness = Codex CLI (selected harness honored)" \
  || fail "init did not pick Codex CLI" "$out"

[ -f "$DIR/.specflow/backlog-config.yml" ] \
  && pass "backlog-config.yml written (github backend honored)" \
  || fail "backlog-config.yml missing" "$(ls "$DIR/.specflow" 2>&1 || echo none)"

[ -f "$DIR/.specflow/installed.lock" ] \
  && pass "installed.lock written" \
  || fail "installed.lock missing" "$(ls "$DIR/.specflow" 2>&1 || echo none)"

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL PICKER CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
