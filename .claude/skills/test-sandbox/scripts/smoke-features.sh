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
echo "═══ v1.0.0  consolidated specflow router ═══"
check ".claude/commands/ has 2 files (backlog + specflow)" \
  '[ "$(find .claude/commands -maxdepth 1 -type f -name "*.md" | wc -l | tr -d " ")" = "2" ]'
check ".claude/commands/specflow.md present (slash-command shim, post-F3)" \
  '[ -f .claude/commands/specflow.md ]'
check "router .claude/skills/specflow/SKILL.md present" \
  '[ -f .claude/skills/specflow/SKILL.md ]'
for phase in specify constitution clarify plan tasks analyze implement merge review checklist groom; do
  check ".claude/skills/specflow/phases/$phase.md present" \
    "[ -f .claude/skills/specflow/phases/$phase.md ]"
done
check "name: specflow on the router SKILL.md" \
  'head -3 .claude/skills/specflow/SKILL.md | grep -q "name: specflow"'
check "disable-model-invocation NOT set on the router (Skill-tool chaining must work)" \
  '! grep -q "disable-model-invocation: true" .claude/skills/specflow/SKILL.md'
check "specflow-review auto-invoke alias present" \
  '[ -f .claude/skills/specflow-review/SKILL.md ]'

echo
echo "═══ #75  loop.md + groom phase ═══"
check ".claude/loop.md scaffolded" '[ -f .claude/loop.md ]'
check "groom phase doc present" \
  '[ -f .claude/skills/specflow/phases/groom.md ]'

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
echo "═══ #164  specflow-expert agent ═══"
check "specflow-expert agent present" \
  '[ -f .claude/agents/specflow-expert.md ]'
check "specflow-expert is auto-triggerable (no disable-model-invocation: true)" \
  '! grep -q "disable-model-invocation: true" .claude/agents/specflow-expert.md'
check "specflow-expert grants WebFetch" \
  'grep -q "WebFetch" .claude/agents/specflow-expert.md'
check "specflow-expert agent body fits Windsurf 12000-char Cascade cap" \
  'deno eval "const s = await Deno.readTextFile(\".claude/agents/specflow-expert.md\"); Deno.exit(s.length <= 12000 ? 0 : 1);"'
check "vendored knowledge snapshot present" \
  'grep -q "## Vendored knowledge snapshot" .claude/agents/specflow-expert.md'
check "live fetch protocol present" \
  'grep -q "## Live fetch protocol" .claude/agents/specflow-expert.md'

echo
echo "═══ #168  version check protocol (proactive upgrade nudge) ═══"
check "version check protocol section present" \
  'grep -q "## Version check protocol" .claude/agents/specflow-expert.md'
check "agent references the /version.json endpoint" \
  'grep -q "specflow.makerlabs.dev/version.json" .claude/agents/specflow-expert.md'
check "agent reads templates_version from installed.lock" \
  'grep -q "templates_version" .claude/agents/specflow-expert.md'

echo
echo "═══ #172 + #174  bug-report protocol + from:specflow-expert label ═══"
check "bug-report protocol section present" \
  'grep -q "## Bug report protocol" .claude/agents/specflow-expert.md'
check "issues/new URL pre-fill present" \
  'grep -q "github.com/mkrlabs/specflow/issues/new" .claude/agents/specflow-expert.md'
check "URL pre-fill auto-applies the from:specflow-expert label (#174)" \
  'grep -q "from%3Aspecflow-expert" .claude/agents/specflow-expert.md'
check "scrubbing patterns documented (ghp_/sk-ant-/AKIA)" \
  'grep -q "ghp_" .claude/agents/specflow-expert.md && grep -q "sk-ant-" .claude/agents/specflow-expert.md && grep -q "AKIA" .claude/agents/specflow-expert.md'
check "3000-char URL fallback rule documented" \
  'grep -q "3000" .claude/agents/specflow-expert.md'

echo
echo "═══ #158  semantic labels reference doc ═══"
check ".specflow/LABELS.md scaffolded (always-on, regardless of backend)" \
  '[ -f .specflow/LABELS.md ]'
check "LABELS.md lists the canonical 7-label palette" \
  'grep -q "security" .specflow/LABELS.md && grep -q "refactor" .specflow/LABELS.md && grep -q "tech-debt" .specflow/LABELS.md'

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
