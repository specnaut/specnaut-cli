#!/usr/bin/env bash
# Verify that every Specflow feature shipped after v0.9 is correctly
# scaffolded into a freshly-init'd Claude project. Walks the bundled
# layout and checks file presence, frontmatter shape, and a few
# canonical content snippets.
#
# Usage: smoke-features.sh <name>
#   <name> is the sandbox scenario name (will be created/wiped).
#
# Exits 0 on full pass, 1 on any failure. Each check prints a single
# line: ✓ pass / ❌ fail.
set -euo pipefail

NAME="${1:?usage: smoke-features.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/sandbox/$NAME"

bash "$SCRIPT_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$ROOT/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"
fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1"; fails=$((fails + 1)); }
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }

echo "═══ #67  specs/ → .specflow/specs/ ═══"
check "no top-level specs/ directory" '[ ! -d specs ]'
check "create-new-feature.sh writes to .specflow/specs" \
  'grep -q "\.specflow/specs" .specflow/scripts/bash/create-new-feature.sh'

echo
echo "═══ #69 + #93  backlog backends + strategy refactor ═══"
check "lock records local backend" 'grep -q "backlog_backend: local" .specflow/installed.lock'
check "backlog SKILL.md present" '[ -f .claude/skills/backlog/SKILL.md ]'
check "SKILL renders local backend section" \
  'grep -q "Backend: local Markdown" .claude/skills/backlog/SKILL.md'
check "github section stripped (local backend)" \
  '! grep -q "Backend: GitHub" .claude/skills/backlog/SKILL.md'
check "gitlab section stripped (local backend)" \
  '! grep -q "Backend: GitLab" .claude/skills/backlog/SKILL.md'
check "no orphan BEGIN markers" \
  '! grep -q "BEGIN: backend=" .claude/skills/backlog/SKILL.md'
check "no orphan END markers" \
  '! grep -q "END: backend=" .claude/skills/backlog/SKILL.md'

echo
echo "═══ #76  commands → skill folders ═══"
check ".claude/commands/ has only 1 file (backlog)" \
  '[ "$(find .claude/commands -maxdepth 1 -type f -name "*.md" | wc -l | tr -d " ")" = "1" ]'
for skill in specify constitution clarify plan tasks analyze implement merge review checklist; do
  check ".claude/skills/specflow.$skill/SKILL.md present" \
    "[ -f .claude/skills/specflow.$skill/SKILL.md ]"
done
check "name: injected on specflow.specify SKILL.md (post-#92)" \
  'head -3 .claude/skills/specflow.specify/SKILL.md | grep -q "name: specflow.specify"'

echo
echo "═══ #75  loop.md + /specflow.groom ═══"
check ".claude/loop.md scaffolded" '[ -f .claude/loop.md ]'
check "specflow.groom skill present" '[ -f .claude/skills/specflow.groom/SKILL.md ]'
check "groom skill has name: (post-#92)" \
  'head -3 .claude/skills/specflow.groom/SKILL.md | grep -q "name: specflow.groom"'

echo
echo "═══ #77  manual-only flags ═══"
for agent in developer devops-sre qa-tester; do
  check "$agent has disable-model-invocation: true" \
    "grep -q 'disable-model-invocation: true' .claude/agents/$agent.md"
done

echo
echo "═══ #78 + #92  dispatch-agent.sh + depth-aware splitter ═══"
check "dispatch-agent.sh executable" '[ -x .claude/scripts/dispatch-agent.sh ]'
check "depth-aware splitter included" \
  'grep -q "split_tools" .claude/scripts/dispatch-agent.sh'

echo
echo "═══ #80  agent memory/ stubs ═══"
for agent in product-owner developer qa-tester devops-sre security-auditor; do
  check "$agent/memory/MEMORY.md present" \
    "[ -f .claude/agents/$agent/memory/MEMORY.md ]"
done

echo
echo "═══ #88  hooks bundled ═══"
check ".claude/settings.json scaffolded" '[ -f .claude/settings.json ]'
check "PreToolUse hook registered" 'grep -q "PreToolUse" .claude/settings.json'
check "SubagentStart hook registered" 'grep -q "SubagentStart" .claude/settings.json'
check "SessionStart hook registered" 'grep -q "SessionStart" .claude/settings.json'
for hook in protect-generated log-subagent check-backlog-prereqs; do
  check "$hook.sh executable" "[ -x .claude/hooks/$hook.sh ]"
done
check ".specflow/logs/ in bundled .gitignore" \
  'grep -q "\.specflow/logs/" .gitignore'

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
