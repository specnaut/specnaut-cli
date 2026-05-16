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

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SCRIPT_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

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
for phase in specify constitution clarify plan tasks analyze implement merge review checklist groom tag-version release-version; do
  check ".claude/skills/specflow/phases/$phase.md present" \
    "[ -f .claude/skills/specflow/phases/$phase.md ]"
done
# Explicit literal-name assertions for the audit's basename-substring
# coverage scan — the interpolated loop above hides $phase.md from
# `grep -qF`, so each phase needs its filename rendered in the source.
check "phase doc tag-version.md scaffolded (epic #226)" \
  '[ -f .claude/skills/specflow/phases/tag-version.md ]'
check "phase doc release-version.md scaffolded (epic #226)" \
  '[ -f .claude/skills/specflow/phases/release-version.md ]'
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
echo "═══ bundled agents — basename presence (audit gate) ═══"
# Explicit `<name>.md` literals so audit.sh's grep -qF finds each bundled
# agent. The for-loops above iterate on bare agent names (no .md) which the
# audit's basename-matcher cannot see.
for agent_md in code-reviewer.md developer.md devops-sre.md qa-tester.md \
                review-coordinator.md security-auditor.md test-reviewer.md \
                workflow-manager.md; do
  check "agent $agent_md scaffolded" \
    "[ -f .claude/agents/$agent_md ]"
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

echo
echo "═══ #198  ui-ux-designer agent ═══"
check "ui-ux-designer.md present" \
  '[ -f .claude/agents/ui-ux-designer.md ]'
check "ui-ux-designer is manual-dispatch only (disable-model-invocation: true)" \
  'grep -q "disable-model-invocation: true" .claude/agents/ui-ux-designer.md'
check "ui-ux-designer declares the three modes" \
  'grep -q "Discovery interview" .claude/agents/ui-ux-designer.md && grep -q "Edit (DESIGN.md present" .claude/agents/ui-ux-designer.md && grep -q "Audit (explicit" .claude/agents/ui-ux-designer.md'
check "ui-ux-designer ships the canonical DESIGN.md template" \
  'grep -q "Canonical DESIGN.md template" .claude/agents/ui-ux-designer.md && grep -q "Brand identity" .claude/agents/ui-ux-designer.md && grep -q "Color palette" .claude/agents/ui-ux-designer.md'
check "ui-ux-designer fits the Windsurf 12000-char Cascade cap" \
  'deno eval "const s = await Deno.readTextFile(\".claude/agents/ui-ux-designer.md\"); Deno.exit(s.length <= 12000 ? 0 : 1);"'
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
echo "═══ #180  PO doc — epic detection heuristic + cascade-check refs ═══"
check "PO doc documents the epic detection heuristic" \
  'grep -q "Epic detection heuristic" .claude/agents/product-owner.md'
check "PO doc references cascade-check.sh as the close gate" \
  'grep -q "cascade-check.sh" .claude/agents/product-owner.md'
check "PO doc covers GitLab backend epic story (parent::# scoped label)" \
  'grep -q "parent::#" .claude/agents/product-owner.md'

echo
echo "═══ #258  PO Bash allowlist + memory-home directive ═══"
check "PO agent has full Bash allowlist" \
  'grep -q "^tools: Read, Write, Edit, Grep, Glob, Bash$" .claude/agents/product-owner.md'
check "PO agent documents memory home path" \
  'grep -q ".claude/agents/product-owner/memory/MEMORY.md" .claude/agents/product-owner.md'
check "PO agent forbids legacy agent-memory path" \
  'grep -q ".claude/agent-memory/" .claude/agents/product-owner.md && grep -qE "unused|never|not used" .claude/agents/product-owner.md'

echo
echo "═══ #180  SKILL.md — Epics & sub-tasks section ═══"
check "SKILL.md gains an Epics & sub-tasks section" \
  'grep -q "Epics & sub-tasks" .claude/skills/backlog/SKILL.md'
check "SKILL.md describes the --parent flag" \
  'grep -q -- "--parent" .claude/skills/backlog/SKILL.md'
check "SKILL.md describes the cascade-check close gate" \
  'grep -q "cascade-check.sh" .claude/skills/backlog/SKILL.md'

echo
echo "═══ #251  auto-chain — chain mechanics file present ═══"
check "phases/auto-chain.md is bundled into the project" \
  'test -f .claude/skills/specflow/phases/auto-chain.md'
check "auto-chain.md documents STOP #1 and STOP #2" \
  'grep -q "STOP #1" .claude/skills/specflow/phases/auto-chain.md && grep -q "STOP #2" .claude/skills/specflow/phases/auto-chain.md'
check "auto-chain.md documents mid-chain re-entry" \
  'grep -q "Mid-chain re-entry" .claude/skills/specflow/phases/auto-chain.md'
check "router SKILL.md parses --manual flag" \
  'grep -q -- "--manual" .claude/skills/specflow/SKILL.md'
check "router SKILL.md routes to phases/auto-chain.md when chain mode is on" \
  'grep -q "phases/auto-chain.md" .claude/skills/specflow/SKILL.md'
check "router SKILL.md no longer recommends /specflow-auto for end-to-end runs" \
  '! grep -q "use \`/specflow-auto specify" .claude/skills/specflow/SKILL.md'

echo
echo "═══ #182  specflow-auto — deprecation alias ═══"
check "specflow-auto SKILL.md carries the deprecation notice" \
  'grep -q "DEPRECATED" .claude/skills/specflow-auto/SKILL.md'
check "specflow-auto SKILL.md tells users to use /specflow instead" \
  'grep -q "auto-chains by default" .claude/skills/specflow-auto/SKILL.md'

echo
echo "═══ #188  /specflow merge auto-closes the linked backlog issue ═══"
check "create-new-feature.sh exposes --issue flag" \
  'grep -q -- "--issue" .specflow/scripts/bash/create-new-feature.sh'
check "specify.md persists linked_issue into feature.json" \
  'grep -q "linked_issue" .claude/skills/specflow/phases/specify.md'
check "merge.md reads feature.json.linked_issue and closes the loop" \
  'grep -q "linked_issue" .claude/skills/specflow/phases/merge.md'
check "merge.md dispatches the PO for the close comment" \
  'grep -q "product-owner" .claude/skills/specflow/phases/merge.md'

echo
echo "═══ Developer agent doctrine — Domain Model gate (PR #249) ═══"
check "clarify.md enforces the Domain Model exit gate" \
  'grep -q "Domain Model exit gate" .claude/skills/specflow/phases/clarify.md'
check "implement.md halts BLOCKED when the Domain Model is absent" \
  'grep -q "awaiting:product-owner-domain-brief" .claude/skills/specflow/phases/implement.md'

echo
echo "═══ Phase-doc drift fixes — auto-chain default ═══"
check "analyze.md re-run hint mentions --once for one-shot regen" \
  'grep -q "Run /specflow plan --once to regenerate" .claude/skills/specflow/phases/analyze.md'
check "review.md owns STOP #2 (no /specflow-auto handoff)" \
  '! grep -q "hand back to \`/specflow-auto\`" .claude/skills/specflow/phases/review.md'
check "review.md surfaces STOP #2 from phases/auto-chain.md" \
  'grep -q "STOP #2 summary block defined in" .claude/skills/specflow/phases/review.md'

echo
echo "═══ specflow-expert review-upgrade protocol ═══"

check "review-upgrade protocol section present in core agent" \
  'grep -q "^## Review-upgrade protocol" .claude/agents/specflow-expert.md'

check "review-upgrade protocol section present in plugin mirror" \
  "grep -q '^## Review-upgrade protocol' '$ROOT/plugin/agents/specflow-expert.md'"

check "specflow-expert tools include Bash and Agent" \
  "bash -c \"grep -E '^tools:' '$DIR/.claude/agents/specflow-expert.md' | grep -q Bash && grep -E '^tools:' '$DIR/.claude/agents/specflow-expert.md' | grep -q Agent\""

check "core and plugin specflow-expert byte-identical" \
  "cmp -s '$DIR/.claude/agents/specflow-expert.md' '$ROOT/plugin/agents/specflow-expert.md'"

check "vendored snapshot mentions upgrade-pending.json" \
  'grep -q "upgrade-pending.json" .claude/agents/specflow-expert.md'

check "vendored snapshot mentions upgrade-staging" \
  'grep -q "upgrade-staging" .claude/agents/specflow-expert.md'

check "vendored snapshot mentions specflow reconcile" \
  'grep -q "specflow reconcile" .claude/agents/specflow-expert.md'

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
