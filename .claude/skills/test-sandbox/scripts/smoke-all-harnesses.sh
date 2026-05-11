#!/usr/bin/env bash
# Pass/fail smoke across all 8 harnesses.
#
# For each harness: bootstrap a fresh empty project, run `specflow init`
# with that harness, and assert the harness-specific output root + the
# installed.lock are present and well-formed. Cleans up its own sandbox
# directories on exit (success OR failure) via a trap.
#
# Usage: smoke-all-harnesses.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-all-harnesses.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESSES=(claude cursor codex gemini windsurf copilot opencode antigravity)

# Per-harness expected output root (relative to project dir). The lock
# declares the same key, which is also asserted. Using a case statement
# instead of `declare -A` so the script works on macOS's stock bash 3.2.
expected_root_for() {
  case "$1" in
    claude)      echo ".claude" ;;
    cursor)      echo ".cursor" ;;
    codex)       echo ".agents" ;;
    gemini)      echo ".gemini" ;;
    windsurf)    echo ".windsurf" ;;
    copilot)     echo ".github/instructions" ;;
    opencode)    echo ".opencode" ;;
    antigravity) echo ".agent" ;;
    *) echo ""; return 1 ;;
  esac
}

# Trap-based cleanup: every sandbox/<name>-<harness> dir we create, plus
# the bootstrap dir if any. Runs on every exit path so a failed assertion
# never leaves orphans behind.
cleanup() {
  for h in "${HARNESSES[@]}"; do
    bash "$SCRIPT_DIR/clean.sh" "$NAME-$h" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1 — $2"; fails=$((fails + 1)); }

for h in "${HARNESSES[@]}"; do
  variant="$NAME-$h"
  bash "$SCRIPT_DIR/bootstrap-empty.sh" "$variant" >/dev/null

  # `init --here` runs against the empty project; backend stays local
  # (zero-config — no `backlog-config.yml` to worry about per harness).
  if ! (cd "$ROOT/sandbox/$variant" && deno run --allow-all "$ROOT/src/main.ts" \
    init --here --no-git --ai "$h" --backlog local >/dev/null 2>&1); then
    fail "$h" "init exited non-zero"
    continue
  fi

  expected="$(expected_root_for "$h")"
  if [ ! -d "$ROOT/sandbox/$variant/$expected" ]; then
    fail "$h" "expected root $expected/ missing"
    continue
  fi

  lock="$ROOT/sandbox/$variant/.specflow/installed.lock"
  if [ ! -f "$lock" ]; then
    fail "$h" ".specflow/installed.lock missing"
    continue
  fi

  if ! grep -q "^harness: $h$" "$lock"; then
    fail "$h" "lock did not declare harness=$h"
    continue
  fi

  pass "$h: scaffold ok ($expected/ + lock declares harness=$h)"
done

# Harness-specific helper files. Each pair (file path + content anchor)
# asserts that the harness scaffolds its "ergonomics" extras on top of
# the generic root + lock. Kept inline (not a loop over harnesses) so
# additions stay obvious in code review.
#
# - Claude: .claude/CLAUDE.md (harness reference) + .claude/loop.md
#   (default prompt for /loop, recurring maintenance).
# - Codex: .codex/AGENTS.md (harness reference) + .codex/goal.md
#   (default prompt for /goal, one-shot long-horizon maintenance,
#   shipped in v1.2.1).
check_helper() {
  local harness="$1" path="$2" anchor="$3"
  local file="$ROOT/sandbox/$NAME-$harness/$path"
  if [ ! -f "$file" ]; then
    fail "$harness helper" "$path missing"
    return
  fi
  if ! grep -q "$anchor" "$file"; then
    fail "$harness helper" "$path missing anchor '$anchor'"
    return
  fi
  pass "$harness helper: $path ok"
}

check_helper claude ".claude/CLAUDE.md" "^# Claude Reference"
check_helper claude ".claude/loop.md"   "^# Project loop prompt"
check_helper codex  ".codex/AGENTS.md"  "^# Codex Reference"
check_helper codex  ".codex/goal.md"    "^# Project goal prompt"

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL 8 HARNESSES PASSED ═══"
  exit 0
else
  echo "═══ $fails HARNESS CHECK(S) FAILED ═══"
  exit 1
fi
