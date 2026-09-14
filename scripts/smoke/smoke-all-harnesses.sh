#!/usr/bin/env bash
# Pass/fail smoke across every supported harness (the list is HARNESSES below,
# and the banner counts it rather than restating a number).
#
# For each harness: bootstrap a fresh empty project, run `specnaut init`
# with that harness, and assert the harness-specific output root + the
# installed.lock are present and well-formed. Cleans up its own sandbox
# directories on exit (success OR failure) via a trap.
#
# Usage: smoke-all-harnesses.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-all-harnesses.sh <name>}"
. "$(dirname "$0")/_common.sh"
HARNESSES=(claude cursor codex windsurf copilot opencode antigravity)

# Per-harness expected output root (relative to project dir). The lock
# declares the same key, which is also asserted. Using a case statement
# instead of `declare -A` so the script works on macOS's stock bash 3.2.
expected_root_for() {
  case "$1" in
    claude)      echo ".claude" ;;
    cursor)      echo ".cursor" ;;
    codex)       echo ".agents" ;;
    windsurf)    echo ".windsurf" ;;
    copilot)     echo ".github/instructions" ;;
    opencode)    echo ".opencode" ;;
    # `.agents`, plural. Singular `.agent` came from community write-ups
    # mistaken for primary sources; corrected against Google's own docs and
    # fixed in the product by `2d4e4cb fix(antigravity)!`. This assertion was
    # never updated, so it had been failing against correct behaviour since.
    antigravity) echo ".agents" ;;
    *) echo ""; return 1 ;;
  esac
}

# Trap-based cleanup: every sandbox/<name>-<harness> dir we create, plus
# the bootstrap dir if any. Runs on every exit path so a failed assertion
# never leaves orphans behind.
cleanup() {
  for h in "${HARNESSES[@]}"; do
    bash "$SMOKE_DIR/clean.sh" "$NAME-$h" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT


for h in "${HARNESSES[@]}"; do
  variant="$NAME-$h"
  bash "$SMOKE_DIR/bootstrap-empty.sh" "$variant" >/dev/null

  # `init --here` runs against the empty project; backend stays local
  # (zero-config — no `backlog-config.yml` to worry about per harness).
  variant_dir="$(scenario_dir "$variant")"
  if ! (cd "$variant_dir" && deno run --allow-all "$CLI/src/main.ts" \
    init --here --no-git --ai "$h" --backlog local >/dev/null 2>&1); then
    fail "$h" "init exited non-zero"
    continue
  fi

  expected="$(expected_root_for "$h")"
  if [ ! -d "$variant_dir/$expected" ]; then
    fail "$h" "expected root $expected/ missing"
    continue
  fi

  lock="$variant_dir/.specnaut/installed.lock"
  if [ ! -f "$lock" ]; then
    fail "$h" ".specnaut/installed.lock missing"
    continue
  fi

  if ! grep -q "^harness: $h$" "$lock"; then
    fail "$h" "lock did not declare harness=$h"
    continue
  fi

  # #551 — a harness-only artefact can only be asserted where that harness is
  # actually installed. smoke-features.sh inits a CLAUDE project, so cursor's
  # rules file could never appear there, and this is the only smoke that inits
  # every harness. It went unasserted because the coverage scan did not collect
  # templates/harness-specific/ at all, so nothing ever reported it missing.
  # Inside the loop on purpose: the EXIT trap removes each variant tree.
  if [ "$h" = "cursor" ]; then
    if [ -f "$variant_dir/.cursor/rules/specify-rules.mdc" ]; then
      pass "cursor: .cursor/rules/specify-rules.mdc scaffolded"
      grep -q "alwaysApply: true" "$variant_dir/.cursor/rules/specify-rules.mdc" \
        && pass "cursor: the rules file applies without being asked for" \
        || fail "cursor: rules file does not set alwaysApply" "a rule nobody loads is not a rule"
    else
      fail "cursor: specify-rules.mdc missing" "$variant_dir/.cursor/rules/"
    fi
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
  # Declared and assigned separately: `local x="$(cmd)"` makes the local
  # builtin swallow the substitution's exit status, so a rejected scenario
  # name would be masked here rather than aborting.
  local dir file
  dir="$(scenario_dir "$NAME-$harness")"
  file="$dir/$path"
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

# cli#599. `spawn_agent` resolves a child's model as: explicit spawn value →
# the `[agents]` default → the PARENT session's value. A dispatch that names no
# role takes the last link, so this reference has to tell the reader to pass
# `agent_type=`. Asserted on the codex render because the file is
# harness-selected — `.specnaut/harness-tools.md` holds the claude mapping on a
# claude init, and the codex text exists nowhere in that tree.
check_helper codex  ".specnaut/harness-tools.md"  "agent_type="

# The harness count stays COUNTED, not spelled: the literal once said 8
# while the array held 7. finish() owns the banner shape (R4); the number
# in the label is still computed from the array itself.
finish "ALL-HARNESSES (${#HARNESSES[@]} harnesses)"
