#!/usr/bin/env bash
# Check the bundled agents as scaffolded into a fresh Claude project on the local
# backend: the expert seats and the reference material they are gated on, the
# specnaut-guide and product-owner doctrine, the memory stubs, and the agents
# that are retired. Moved out of smoke-features.sh by #703, which had grown
# past its size ceiling.
#
# Usage: smoke-agents.sh <name>
#   <name> is the sandbox scenario name (will be created/wiped).
set -euo pipefail

NAME="${1:?usage: smoke-agents.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Wipe the scenario directory on every exit path, success or failure.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

echo "═══ Epic #302 + #320  the expert seats and their grounding ═══"
check "performance-expert agent bundled (Epic #302, #304)" \
  '[ -f .claude/agents/performance-expert.md ]'
check "performance-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/performance-expert.md'
check "performance-expert agent covers N+1 axis" \
  'grep -q "N+1" .claude/agents/performance-expert.md'
check "performance-expert agent enforces read-only Bash allow-list" \
  'grep -q "Read-only contract" .claude/agents/performance-expert.md'
check "accessibility-expert agent bundled (Epic #302, #305)" \
  '[ -f .claude/agents/accessibility-expert.md ]'
check "accessibility-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/accessibility-expert.md'
check "accessibility-expert agent covers WCAG 2.1 AA" \
  'grep -q "WCAG 2.1 AA" .claude/agents/accessibility-expert.md'
check "accessibility-expert agent implements FE-surface gate" \
  'grep -q "Front-end surface detection" .claude/agents/accessibility-expert.md'
check "architect-expert agent bundled (Epic #320, #321)" \
  '[ -f .claude/agents/architect-expert.md ]'
check "architect-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/architect-expert.md'
check "architect-expert agent covers hex-layer violations axis" \
  'grep -q "[Hh]ex-layer" .claude/agents/architect-expert.md'
check "architect-expert agent enforces read-only Bash allow-list" \
  'grep -q "Read-only contract" .claude/agents/architect-expert.md'
check "dependency-expert agent bundled (Epic #320, #322)" \
  '[ -f .claude/agents/dependency-expert.md ]'
check "dependency-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/dependency-expert.md'
check "dependency-expert agent covers multi-manifest detection" \
  'grep -q "package.json" .claude/agents/dependency-expert.md && grep -q "pyproject.toml" .claude/agents/dependency-expert.md && grep -q "Cargo.toml" .claude/agents/dependency-expert.md'
check "dependency-expert agent documents the SPDX license allowlist" \
  'grep -q "MIT, Apache-2.0" .claude/agents/dependency-expert.md'
check "dependency-expert agent supports project-side allowlist override" \
  'grep -q ".specnaut/license-allowlist.txt" .claude/agents/dependency-expert.md'
# --- expert grounding: the catalogues and the four mechanisms -----------------
# A seat that names a standard and carries nothing to read judges from memory.
# These assert the reference material actually lands in a scaffolded project,
# and that each seat is gated on it — an optional lookup does not happen.
check "security knowledge base scaffolded" \
  '[ -f .specnaut/memory/security/00-triage.md ]'
check "architecture catalogue scaffolded" \
  '[ -f .specnaut/memory/architecture/README.md ]'
# Spec 041 folded tasks into implement: the extract-first rule lives there now.
check "size limits: plan-template gates on Files touched, implement extracts first (#647, #648)" \
  'grep -q "^### Files touched" .specnaut/templates/plan-template.md && grep -qF "**Extract before you grow**" .claude/skills/task/phases/implement.md'
check "a11y catalogue scaffolded" \
  '[ -f .specnaut/memory/a11y/00-triage.md ] && [ -f .specnaut/memory/a11y/README.md ]'
check "a11y catalogue ships every surface leaf" \
  '[ "$(ls .specnaut/memory/a11y/*.md | wc -l | tr -d " ")" = "12" ]'
check "a11y catalogue reproduces no W3C text and says so" \
  'grep -q "No W3C text is reproduced here" .specnaut/memory/a11y/README.md'
# Ten surface leaves carry it; README and 00-triage deliberately do not —
# the triage file IS the generic version of that gate.
check "every a11y leaf carries the section that kills a wrong finding" \
  '[ "$(grep -l "When it is NOT a finding" .specnaut/memory/a11y/*.md | wc -l | tr -d " ")" = "10" ]'
for seat in architect-expert security-expert accessibility-expert dependency-expert performance-expert; do
  check "$seat is gated on a mandatory Step 0" \
    "grep -q '^## Step 0' .claude/agents/$seat.md"
  check "$seat declares which sources it read" \
    "grep -q 'State which sources you read\|State which leaves you read\|State which files you read' .claude/agents/$seat.md"
  check "$seat downgrades what it cannot cite" \
    "grep -q 'Downgrade what you cannot cite\|downgrade it yourself' .claude/agents/$seat.md"
  check "$seat degrades cleanly as a standalone plugin" \
    "grep -q 'standalone plugin' .claude/agents/$seat.md"
done
check "dependency-expert points at the supply-chain domain file rather than duplicating it" \
  'grep -q "memory/security/06-supply-chain-and-integrity.md" .claude/agents/dependency-expert.md'
check "performance-expert carries the measure gate instead of a catalogue" \
  'grep -q "did you measure" .claude/agents/performance-expert.md && [ ! -d .specnaut/memory/performance ]'

echo
echo "═══ #77  manual-only flags ═══"
check "developer has disable-model-invocation: true" "grep -q 'disable-model-invocation: true' .claude/agents/developer.md"
for agent in devops-sre qa-tester workflow-manager; do # #678: never dispatched
  check "retired agent $agent is not scaffolded" "[ ! -e .claude/agents/$agent.md ] && [ ! -e .claude/agents/$agent ]"
done

echo
echo "═══ #80  agent memory/ stubs ═══"
for agent in product-owner developer security-expert; do
  check "$agent/memory/MEMORY.md present" "[ -f .claude/agents/$agent/memory/MEMORY.md ]"
done

echo
echo "═══ bundled agents — basename presence (audit gate) ═══"
# Explicit `<name>.md` literals so audit.sh's grep -qF finds each bundled
# agent. The for-loops above iterate on bare agent names (no .md) which the
# audit's basename-matcher cannot see.
for agent_md in code-reviewer.md developer.md security-expert.md; do
  check "agent $agent_md scaffolded" "[ -f .claude/agents/$agent_md ]"
done

echo
echo "═══ #164  specnaut-guide agent ═══"
check "specnaut-guide agent present" \
  '[ -f .claude/agents/specnaut-guide.md ]'
check "specnaut-guide is auto-triggerable (no disable-model-invocation: true)" \
  '! grep -q "disable-model-invocation: true" .claude/agents/specnaut-guide.md'
check "specnaut-guide grants WebFetch" \
  'grep -q "WebFetch" .claude/agents/specnaut-guide.md'
check "vendored knowledge snapshot present" \
  'grep -q "## Vendored knowledge snapshot" .claude/agents/specnaut-guide.md'
check "live fetch protocol present" \
  'grep -q "## Live fetch protocol" .claude/agents/specnaut-guide.md'

echo
echo "═══ #198 → #678  /design skill (was the ui-ux-designer agent) ═══"
check "the ui-ux-designer agent is retired" \
  '[ ! -e .claude/agents/ui-ux-designer.md ]'
check "/design is user-invoked only (disable-model-invocation: true)" \
  'grep -q "disable-model-invocation: true" .claude/skills/design/SKILL.md'
check "/design declares the three modes" \
  'grep -q "## Mode 1 — Discovery" .claude/skills/design/SKILL.md && grep -q "## Mode 2 — Edit" .claude/skills/design/SKILL.md && grep -q "## Mode 3 — Audit" .claude/skills/design/SKILL.md'
check "/design writes from the shipped DESIGN.md template" \
  'grep -q ".specnaut/templates/design-template.md" .claude/skills/design/SKILL.md && grep -q "Brand identity" .specnaut/templates/design-template.md && grep -q "Color palette" .specnaut/templates/design-template.md'

echo
echo "═══ #168  version check protocol (proactive upgrade nudge) ═══"
check "version check protocol section present" \
  'grep -q "## Version check protocol" .claude/agents/specnaut-guide.md'
check "agent references the /version.json endpoint" \
  'grep -q "specnaut.com/version.json" .claude/agents/specnaut-guide.md'
check "agent reads templates_version from installed.lock" \
  'grep -q "templates_version" .claude/agents/specnaut-guide.md'

echo
echo "═══ #172 + #174  bug-report protocol + from:specnaut-expert label ═══"
check "bug-report protocol section present" \
  'grep -q "## Bug report protocol" .claude/agents/specnaut-guide.md'
check "issues/new URL pre-fill present" \
  'grep -q "github.com/specnaut/specnaut-cli/issues/new" .claude/agents/specnaut-guide.md'
check "URL pre-fill auto-applies the from:specnaut-guide label (#174)" \
  'grep -q "from%3Aspecnaut-guide" .claude/agents/specnaut-guide.md'
check "scrubbing patterns documented (ghp_/sk-ant-/AKIA)" \
  'grep -q "ghp_" .claude/agents/specnaut-guide.md && grep -q "sk-ant-" .claude/agents/specnaut-guide.md && grep -q "AKIA" .claude/agents/specnaut-guide.md'
check "3000-char URL fallback rule documented" \
  'grep -q "3000" .claude/agents/specnaut-guide.md'

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
# Harness-neutral since #656: the memory is named relative to the agent file,
# which resolves on Claude Code and names nothing that is absent elsewhere.
check "PO agent documents memory home path" \
  'grep -q "product-owner/memory/MEMORY.md" .claude/agents/product-owner.md &&
   [ -f .claude/agents/product-owner/memory/MEMORY.md ]'
check "PO agent forbids legacy agent-memory path" \
  'grep -qF "**Never** write to an" .claude/agents/product-owner.md &&
   grep -qF "\`agent-memory/\` folder" .claude/agents/product-owner.md'

echo
echo "═══ specnaut-guide review-upgrade protocol ═══"

check "review-upgrade protocol section present in core agent" \
  'grep -q "^## Review-upgrade protocol" .claude/agents/specnaut-guide.md'

check "review-upgrade protocol section present in plugin mirror" \
  "grep -q '^## Review-upgrade protocol' '$CLI/plugin/agents/specnaut-guide.md'"

check "specnaut-guide tools include Bash and Agent" \
  "bash -c \"grep -E '^tools:' '$DIR/.claude/agents/specnaut-guide.md' | grep -q Bash && grep -E '^tools:' '$DIR/.claude/agents/specnaut-guide.md' | grep -q Agent\""

check "core and plugin specnaut-guide byte-identical" \
  "cmp -s '$DIR/.claude/agents/specnaut-guide.md' '$CLI/plugin/agents/specnaut-guide.md'"

check "vendored snapshot mentions upgrade-pending.json" \
  'grep -q "upgrade-pending.json" .claude/agents/specnaut-guide.md'

check "vendored snapshot mentions upgrade-staging" \
  'grep -q "upgrade-staging" .claude/agents/specnaut-guide.md'

check "vendored snapshot mentions specnaut reconcile" \
  'grep -q "specnaut reconcile" .claude/agents/specnaut-guide.md'

finish "AGENTS"
