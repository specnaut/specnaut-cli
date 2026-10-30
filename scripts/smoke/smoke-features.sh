#!/usr/bin/env bash
# Verify that every Specnaut feature shipped after v0.9 is correctly
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
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

echo "═══ #67  specs/ → .specnaut/specs/ ═══"
check "no top-level specs/ directory" '[ ! -d specs ]'
check "create-new-feature.sh writes to .specnaut/specs" \
  'grep -q "\.specnaut/specs" .specnaut/scripts/bash/create-new-feature.sh'
check "common.sh resolves FEATURE_SPEC to plan.md (#457)" \
  'grep -q "plan.md" .specnaut/scripts/bash/common.sh'
check "common.sh no longer exports the deleted artefact paths (#457)" \
  '! grep -qE "RESEARCH=|DATA_MODEL=|QUICKSTART=|CONTRACTS_DIR=" .specnaut/scripts/bash/common.sh'
check "check-prerequisites.sh no longer lists deleted artefacts (#457)" \
  '! grep -qE "research\.md|data-model\.md|quickstart\.md" .specnaut/scripts/bash/check-prerequisites.sh'
check "common.ps1 resolves FEATURE_SPEC to plan.md (#457)" \
  'grep -q "plan.md" .specnaut/scripts/powershell/common.ps1'
check "check-prerequisites.ps1 no longer lists deleted artefacts (#457)" \
  '! grep -qE "research\.md|data-model\.md|quickstart\.md" .specnaut/scripts/powershell/check-prerequisites.ps1'
check "create-new-feature.ps1 scaffolds from plan-template (#457)" \
  'grep -q "plan-template" .specnaut/scripts/powershell/create-new-feature.ps1'

echo
echo "═══ #69 + #93  backlog backends + strategy refactor ═══"
check "lock records local backend" 'grep -q "backlog_backend: local" .specnaut/installed.lock'
# Spec 037: the backlog skill is `/task`. Its router is SKILL.md; the
# per-backend sections moved to backlog.md, and both are backend-filtered.
check "backlog SKILL.md present" '[ -f .claude/skills/task/SKILL.md ] && [ -f .claude/skills/task/backlog.md ]'
check "the /board skill is not scaffolded (spec 037)" '[ ! -e .claude/skills/board ]'
check "backlog.md renders local backend section" \
  'grep -q "Backend: local Markdown" .claude/skills/task/backlog.md'
check "github section stripped (local backend)" \
  '! grep -q "Backend: GitHub" .claude/skills/task/SKILL.md .claude/skills/task/backlog.md'
check "gitlab section stripped (local backend)" \
  '! grep -q "Backend: GitLab" .claude/skills/task/SKILL.md .claude/skills/task/backlog.md'
check "no orphan BEGIN markers" \
  '! grep -q "BEGIN: backend=" .claude/skills/task/SKILL.md .claude/skills/task/backlog.md'
check "no orphan END markers" \
  '! grep -q "END: backend=" .claude/skills/task/SKILL.md .claude/skills/task/backlog.md'

echo
echo "═══ v1.0.0  consolidated specnaut router ═══"
# #533 retired both command shims: the skills register their own names from
# frontmatter, and the directory is never created. Asserted absent rather than
# counted — a count of zero and a directory that was never made are different
# states, and only one of them is what ships.
check ".claude/commands/ is not created at all (#533)" \
  '[ ! -e .claude/commands ]'
check "router .claude/skills/specnaut/SKILL.md present" \
  '[ -f .claude/skills/specnaut/SKILL.md ]'
# Explicit literal-name assertions for the audit's basename-substring
# coverage scan — smoke-task.sh's interpolated phase loop hides $phase.md
# from `grep -qF`, so each phase needs its filename rendered in the source.
check "phase doc plan.md scaffolded" \
  '[ -f .claude/skills/task/phases/plan.md ]'
check "plan-audits.md is folded into plan.md, not scaffolded (spec 041)" \
  '[ ! -e .claude/skills/task/phases/plan-audits.md ]'
check "plan.md dispatches BOTH auditors on every plan (#456, spec 041)" \
  'grep -q "architect-expert" .claude/skills/task/phases/plan.md && grep -q "security-expert" .claude/skills/task/phases/plan.md'
# Companion docs, named literally for the audit's basename scan — the
# interpolated loop above hides them from `grep -qF`. Both exist because
# their host phase ran out of room under a since-removed harness's
# 12,000-character cap — the split stands on its own:
# merge.md was at 11,960 (#558), implement.md at 11,377 (#556).
check "companion doc merge-squash.md scaffolded (#558)" \
  '[ -f .claude/skills/task/phases/merge-squash.md ]'
check "merge.md routes to it rather than carrying the rules (#558)" \
  'grep -qF "phases/merge-squash.md" .claude/skills/task/phases/merge.md'
check "merge-squash.md kept the rule that makes a squash safe (#558)" \
  'grep -qF "byte-identical" .claude/skills/task/phases/merge-squash.md'
# Spec 041: the remote-gate contract is loaded on demand by the chain.
check "companion doc remote-gates.md scaffolded, and loaded by auto-chain.md (spec 041)" \
  '[ -f .claude/skills/task/phases/remote-gates.md ] &&
   grep -qF "phases/remote-gates.md" .claude/skills/task/phases/auto-chain.md'
check "companion doc epic-commits.md scaffolded (#556)" \
  '[ -f .claude/skills/task/phases/epic-commits.md ]'
# #554 consolidated implement.md's two epic pointers into one, so the route
# to the commit format is now implement -> epic-loop -> epic-commits. Asserted
# as the whole CHAIN rather than one hop: a broken middle link would leave the
# original one-hop check green while nothing reached the format at all.
check "an epic reaches the commit format: implement -> epic-loop -> epic-commits (#556)" \
  'P=.claude/skills/task/phases;
   grep -qF "phases/epic-loop.md" "$P/implement.md" &&
   grep -qF "phases/epic-commits.md" "$P/epic-loop.md" &&
   [ -f "$P/epic-commits.md" ]'
check "epic-commits.md carries the Epic trailer and the width-agnostic parse (#556)" \
  'grep -qF "Epic: #" .claude/skills/task/phases/epic-commits.md &&
   grep -qF "T(\\d+)" .claude/skills/task/phases/epic-commits.md'
check "epic-commits.md names no test tool (constitution: stack-agnostic)" \
  '! grep -qiE "jest|vitest|playwright|pytest|rspec|junit" .claude/skills/task/phases/epic-commits.md'
# #554 — the loop itself. Four phase docs learned that an epic is one unit,
# and the loop's rules live in one companion so the four cannot drift.
check "companion doc epic-loop.md scaffolded (#554)" \
  '[ -f .claude/skills/task/phases/epic-loop.md ]'
check "implement.md runs an epic as a loop (#554)" \
  'grep -qF "phases/epic-loop.md" .claude/skills/task/phases/implement.md'
check "plan.md makes an epic ONE plan with ONE stop (#554 AC9/AC10)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/plan.md)";
   grep -qF "An epic is one plan" <<<"$flat" && grep -qF "one table, one stop" <<<"$flat"'
check "review.md stops only on the LAST child (#554 AC12/AC13)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/review.md)";
   grep -qF "does not stop the run" <<<"$flat" &&
   grep -qF "last child" <<<"$flat"'
check "the loop iterates sub-issues, not tasks.md entries (#554 AC8/D3)" \
  'grep -qF "Board sub-issues, one per commit" .claude/skills/task/phases/epic-loop.md'
check "it re-reads the child list each iteration (#554 AC11/D5)" \
  'grep -qF "added mid-flight" .claude/skills/task/phases/epic-loop.md'
check "resume reads commits, never issue state (#554 AC16/AC17)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/epic-loop.md)";
   grep -qF "no state file" <<<"$flat" &&
   grep -qF "not use issue state as a progress signal" <<<"$flat"'
check "a child's card goes In progress then In review, never Done here (#554 AC15/D17)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/epic-loop.md)";
   grep -qF "Move its card to In review" <<<"$flat" &&
   grep -qF "it is not Done" <<<"$flat"'
check "the loop never returns to the user between children (#554 AC3)" \
  'grep -qF "does not return to the user between children" .claude/skills/task/phases/epic-loop.md'

# #553 — one branch per epic. Both twins, and the two degradation outcomes
# that AC 14 requires to be distinguishable: a missing install is fixable
# here, a backend with no enumerator is a capability gap with a ticket.
check "create-new-feature.sh detects an epic from the board link (#553)" \
  'grep -qF "parent-of.sh" .specnaut/scripts/bash/create-new-feature.sh'
check "the PowerShell twin does too (#553 AC5)" \
  'grep -qF "parent-of.sh" .specnaut/scripts/powershell/create-new-feature.ps1'
# #563 AC 4 retired this. #553 needed a branch telling "this backend ships no
# enumerator" from "no script installed", because two backends could not
# answer. All four can now, so the branch is REMOVED rather than left standing
# unreachable — an unreachable branch is a second shape of the same rule. The
# assertion is inverted to hold that: it must be gone from both twins.
check "the cannot-enumerate branch is gone, not unreachable (#563 AC4)" \
  '! grep -qF "ships no sub-issue enumerator" .specnaut/scripts/bash/create-new-feature.sh &&
   ! grep -qF "ships no sub-issue enumerator" .specnaut/scripts/powershell/create-new-feature.ps1'
check "a missing install is reported separately (#553 AC12)" \
  'grep -qF "epic detection did NOT run" .specnaut/scripts/bash/create-new-feature.sh'
check "the epic branch is found via feature.json, not by parsing a name (#553 AC6/D2)" \
  'grep -qF "feature.json" .specnaut/scripts/bash/create-new-feature.sh &&
   ! grep -qE "epic[-_]|EPIC_PREFIX" .specnaut/scripts/bash/create-new-feature.sh'
check "the EPIC card moves, never the child's (#553 AC9/AC10)" \
  'grep -qF "was NOT moved" .specnaut/scripts/bash/create-new-feature.sh'
check "no new flag was introduced (#553 AC7/D1)" \
  '! grep -qE -- "--epic" .specnaut/scripts/bash/create-new-feature.sh'

check "phase doc constitution.md scaffolded" \
  '[ -f .claude/skills/task/phases/constitution.md ]'
check "phase doc upgrade.md scaffolded, and routed by the router" \
  '[ -f .claude/skills/specnaut/phases/upgrade.md ] && grep -q "phases/upgrade.md" .claude/skills/specnaut/SKILL.md'
check "removed phases do NOT scaffold (#455)" \
  '! ls .claude/skills/specnaut/phases/ .claude/skills/task/phases/ | grep -qE "^(brainstorm|specify|clarify|analyze|checklist|list-skills|lite-heuristic)\.md$"'
check "tasks.md is folded into implement, not scaffolded (spec 041)" \
  '[ ! -e .claude/skills/task/phases/tasks.md ]'
check "phase doc audit.md scaffolded, and routed by the /task router (spec 037)" \
  '[ -f .claude/skills/task/phases/audit.md ] && grep -qF "phases/audit.md" .claude/skills/task/SKILL.md'
check "phase doc doc.md scaffolded, and routed by the /specnaut router (spec 037)" \
  '[ -f .claude/skills/specnaut/phases/doc.md ] && grep -qF "phases/doc.md" .claude/skills/specnaut/SKILL.md'
check "phase doc list.md scaffolded, and routed by the /specnaut router (spec 037)" \
  '[ -f .claude/skills/specnaut/phases/list.md ] && grep -qF "phases/list.md" .claude/skills/specnaut/SKILL.md'
# Spec 033 moved these two out of /specnaut and into /ship. The assertions
# follow the documents rather than the router: they are still scaffolded, at a
# different owner's address, and a check left pointing at the old path would
# report a correct migration as a regression.
check "/ship skill scaffolded" \
  '[ -f .claude/skills/ship/SKILL.md ]'
check "ship doc tag.md scaffolded (was specnaut/phases/tag-version.md)" \
  '[ -f .claude/skills/ship/phases/tag.md ]'
check "ship doc release.md scaffolded (was specnaut/phases/release-version.md)" \
  '[ -f .claude/skills/ship/phases/release.md ]'
check "the retired addresses are gone, not duplicated" \
  '[ ! -f .claude/skills/specnaut/phases/tag-version.md ] && [ ! -f .claude/skills/specnaut/phases/release-version.md ] &&
   [ ! -f .claude/skills/task/phases/tag-version.md ] && [ ! -f .claude/skills/task/phases/release-version.md ]'
check "the retired audit phases are not scaffolded (spec 034)" \
  '[ -z "$(ls .claude/skills/specnaut/phases/audit-*.md .claude/skills/task/phases/audit-*.md 2>/dev/null)" ]'
# Spec 037 folded the audit phase and all six audit skills into `/task audit`.
# Each retired address must map to its own flag — a table that sent all five
# axes to the bare verb would pass a check that only looked for the names.
check "the router answers the retired audit phase with /task audit (spec 034, 037)" \
  'grep -qF "| \`/specnaut audit\` (any axis or spelling) | \`/task audit\`" .claude/skills/specnaut/SKILL.md &&
   grep -qF "| \`/code-audit\` | \`/task audit\` |" .claude/skills/specnaut/SKILL.md'
while read -r old flag; do
  check "the router maps the retired /$old to /task audit $flag (spec 037)" \
    'grep -qF "| \`/$old\` | \`/task audit $flag\` |" .claude/skills/specnaut/SKILL.md'
done <<'EOF'
sec-audit --security
arch-audit --archi
perf-audit --perf
a11y-audit --a11y
dep-audit --deps
EOF
check "the retired workflow skills are not scaffolded (spec 034)" \
  '[ -z "$(ls -d .claude/skills/{brainstorming,writing-plans,executing-plans,subagent-driven-development,requesting-code-review,verification-before-completion,using-specnaut} 2>/dev/null)" ] && [ ! -f .specnaut/harness-tools.md ]'
check "AGENTS.md carries the per-harness dispatch rule (spec 034, cli#599)" \
  'grep -q "agent_type=" AGENTS.md && grep -q "subagent_type" AGENTS.md'
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

check "name: specnaut on the router SKILL.md" \
  'head -3 .claude/skills/specnaut/SKILL.md | grep -q "name: specnaut"'
check "disable-model-invocation NOT set on the router (Skill-tool chaining must work)" \
  '! grep -q "disable-model-invocation: true" .claude/skills/specnaut/SKILL.md'
check "specnaut-review alias no longer scaffolds (retired)" \
  '[ ! -e .claude/skills/specnaut-review/SKILL.md ]'


echo
echo "═══ #75  loop.md + groom phase ═══"

# NOTE: #277 (Codex plugin adapter / Epic #270 B1) wires
# .codex-plugin/plugin.json + scripts/sync-to-codex-plugin.sh in the
# Specnaut repo itself, NOT in scaffolded user projects. The smoke
# below runs against a scaffolded sandbox where those files don't
# land — so no init-time smoke assertion is appropriate. The unit
# tests in tests/scripts/bump_version_test.ts cover the version
# lockstep for .codex-plugin/plugin.json. Static-grep verification
# of the adapter files lives directly in CI's release.yml pre-flight
# (Plugin pre-flight step).
check ".claude/loop.md scaffolded" '[ -f .claude/loop.md ]'
check "groom ships beside the /task router, not as a phase" \
  '[ -f .claude/skills/task/groom.md ] && [ ! -e .claude/skills/task/phases/groom.md ]'

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
for agent in product-owner developer qa-tester devops-sre security-expert; do
  check "$agent/memory/MEMORY.md present" \
    "[ -f .claude/agents/$agent/memory/MEMORY.md ]"
done

echo
echo "═══ bundled agents — basename presence (audit gate) ═══"
# Explicit `<name>.md` literals so audit.sh's grep -qF finds each bundled
# agent. The for-loops above iterate on bare agent names (no .md) which the
# audit's basename-matcher cannot see.
for agent_md in code-reviewer.md developer.md devops-sre.md qa-tester.md \
                security-expert.md workflow-manager.md; do
  check "agent $agent_md scaffolded" \
    "[ -f .claude/agents/$agent_md ]"
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
check "live fetch protocol present" \
  'grep -q "## Live fetch protocol" .claude/agents/specnaut-guide.md'

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
echo "═══ #158  semantic labels reference doc ═══"
check ".specnaut/LABELS.md scaffolded (always-on, regardless of backend)" \
  '[ -f .specnaut/LABELS.md ]'
check "LABELS.md lists the canonical 7-label palette" \
  'grep -q "security" .specnaut/LABELS.md && grep -q "refactor" .specnaut/LABELS.md && grep -q "tech-debt" .specnaut/LABELS.md'

# #88 (hooks bundled, settings.json registrations) lives in smoke-hooks.sh, which owns hooks.
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
echo "═══ #260  Auto-propagate parent Epic status (local backend scaffold) ═══"
check "propagate-parent-status.sh scaffolded into local backend" \
  '[ -x .specnaut/scripts/backlog/propagate-parent-status.sh ]'
check "local move.sh invokes the propagator as a tail hook" \
  'grep -q "propagate-parent-status.sh" .specnaut/scripts/backlog/move.sh'
check "propagator promotes only Backlog/Ready parents (regression guard)" \
  'grep -qE "\"Backlog\"\|\"Ready\"" .specnaut/scripts/backlog/propagate-parent-status.sh'
check "propagator carries the SPECNAUT_INTERNAL_PROPAGATION recursion guard" \
  'grep -q "SPECNAUT_INTERNAL_PROPAGATION" .specnaut/scripts/backlog/propagate-parent-status.sh'

echo
echo "═══ #180  backlog.md — Epics & sub-tasks section ═══"
check "backlog.md gains an Epics & sub-tasks section" \
  'grep -q "Epics & sub-tasks" .claude/skills/task/backlog.md'
check "backlog.md describes the --parent flag" \
  'grep -q -- "--parent" .claude/skills/task/backlog.md'
check "backlog.md describes the cascade-check close gate" \
  'grep -q "cascade-check.sh" .claude/skills/task/backlog.md'

echo
echo "═══ #251  auto-chain — chain mechanics file present ═══"
check "phases/auto-chain.md is bundled into the project" \
  'test -f .claude/skills/task/phases/auto-chain.md'
# #455 dropped the `#` and renamed the re-entry section. Asserting the
# invariant the doc exists to state — one stop by default, the second only
# under `merge: manual` — rather than a punctuation mark.
check "auto-chain.md documents the plan stop and the opt-in second stop" \
  'grep -q "STOP 1" .claude/skills/task/phases/auto-chain.md && grep -q "STOP 2" .claude/skills/task/phases/auto-chain.md && grep -q "There is ONE stop" .claude/skills/task/phases/auto-chain.md'
check "auto-chain.md documents re-entry without a flag" \
  'grep -qi "Re-entry" .claude/skills/task/phases/auto-chain.md'
check "the /task router parses --manual flag" \
  'grep -q -- "--manual" .claude/skills/task/SKILL.md'
check "the /task router routes to phases/auto-chain.md when chain mode is on" \
  'grep -q "phases/auto-chain.md" .claude/skills/task/SKILL.md'
check "the /task router no longer recommends /specnaut-auto for end-to-end runs" \
  '! grep -q "use \`/specnaut-auto specify" .claude/skills/task/SKILL.md'
check "specnaut-auto skill is removed (auto-chain is the /specnaut default)" \
  '! test -d .claude/skills/specnaut-auto'

echo
echo "═══ #188  /specnaut merge auto-closes the linked backlog issue ═══"
# specnaut-monorepo#25 — the chain used to hold exactly ONE board write, at
# merge, so a card could sit in the intake column through a whole
# implementation. These pin the other end of it.
# #546 AC9 — two coverage gaps that predate #547 (measured at exactly two
# before it). Each names something the script promises, not that its file
# exists: #547 established that a presence check satisfies the coverage token
# and closes none of the hole.
# No inner single quotes in any pattern: a `\'` inside a single-quoted `check`
# expression does not escape, it terminates the string — which silently turned
# the first version of these into something that could not fail.
# Anchored to the WRITE and the case arm, not to tokens. The first version
# grepped "IMPL_PLAN" and "--json", which match this script's own help text and
# its JSON output keys — replacing the copy with `touch` would have left every
# assertion green while shipping an empty plan.md to every user.
# #549: this file was reported covered by an assertion whose subject was a
# different README entirely.
check "the status ledger README documents the JSONL it describes" \
  'grep -q "agents.jsonl" .specnaut/logs/README.md'
check "and names the skill that reads it" \
  'grep -q "status-audit" .specnaut/logs/README.md'

check "setup-plan.sh copies the template onto IMPL_PLAN" \
  'grep -qE "cp .+TEMPLATE.+IMPL_PLAN" .specnaut/scripts/bash/setup-plan.sh'
check "setup-plan.sh resolves the template by name, not a hardcoded path" \
  'grep -qE "resolve_template .plan-template." .specnaut/scripts/bash/setup-plan.sh'
check "setup-plan.sh parses --json as an argument, not only in its help text" \
  'grep -qE "^[[:space:]]*--json\)" .specnaut/scripts/bash/setup-plan.sh'
check "setup-plan.ps1 copies the template too (twins stay in step)" \
  'grep -qE "Copy-Item .+template .+IMPL_PLAN" .specnaut/scripts/powershell/setup-plan.ps1'
check "setup-plan.ps1 resolves the same template by name" \
  'grep -qF "Resolve-Template -TemplateName" .specnaut/scripts/powershell/setup-plan.ps1'

check "create-new-feature.sh moves the linked item to In progress" \
  'grep -q "In progress" .specnaut/scripts/bash/create-new-feature.sh'
check "create-new-feature.sh reports when nothing was moved" \
  'grep -q "no backlog item was moved" .specnaut/scripts/bash/create-new-feature.sh'
check "create-new-feature.sh never fails the run over a board write" \
  'grep -q "the board was NOT updated" .specnaut/scripts/bash/create-new-feature.sh'
check "create-new-feature.ps1 moves the linked item too (twins stay in step)" \
  'grep -q "In progress" .specnaut/scripts/powershell/create-new-feature.ps1'
check "create-new-feature.ps1 says so when no bash is available to run the helper" \
  'grep -q "bash-only and no bash was found" .specnaut/scripts/powershell/create-new-feature.ps1'
check "create-new-feature.sh exposes --issue flag" \
  'grep -q -- "--issue" .specnaut/scripts/bash/create-new-feature.sh'
check "plan.md persists linked_issue into feature.json" \
  'grep -q "linked_issue" .claude/skills/task/phases/plan.md'
# Both re-anchored by #560: the close block moved to the merge-close
# companion, so this is where feature.json is read and the PO is dispatched.
# merge.md keeps a routing assertion instead — a companion nobody loads is a
# deletion, and that is the half the move created.
check "the close step reads feature.json.linked_issue and closes the loop" \
  'grep -q "linked_issue" .claude/skills/task/phases/merge-close.md'
check "the close step dispatches the PO for the close comment" \
  'grep -q "product-owner" .claude/skills/task/phases/merge-close.md'
check "merge.md routes to the close step rather than carrying it" \
  'grep -qF "phases/merge-close.md" .claude/skills/task/phases/merge.md &&
   ! grep -q "product-owner" .claude/skills/task/phases/merge.md'

echo
echo "═══ Developer agent doctrine — Domain Model gate (PR #249) ═══"
check "plan.md carries the domain model in its technical context (#457)" \
  'grep -q "Domain model\|domain model" .claude/skills/task/phases/plan.md'
check "implement.md holds the plan's decision table binding (spec 041)" \
  'grep -qF "The decision table is binding" .claude/skills/task/phases/implement.md'

echo
echo "═══ Phase-doc drift fixes — auto-chain default ═══"
check "auto-chain.md infers re-entry from artefacts, with no flag (#455)" \
  'grep -q "Re-entry, without a flag" .claude/skills/task/phases/auto-chain.md'
check "review.md owns STOP #2 (no /specnaut-auto handoff)" \
  '! grep -q "hand back to \`/specnaut-auto\`" .claude/skills/task/phases/review.md'
check "review.md surfaces the verdict summary from phases/auto-chain.md and follows the merge mode" \
  'grep -q "verdict summary defined in" .claude/skills/task/phases/review.md && grep -q "merge mode" .claude/skills/task/phases/review.md'

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

echo
echo "═══ #455  the lite chain and its flags are gone ═══"
# Spec 041 gave plan a --full argument; it shapes the plan, it is not a chain flag.
check "the /task router keeps --manual as the only chain flag" \
  'grep -q -- "--manual" .claude/skills/task/SKILL.md && ! grep -qE -- "--lite|--once|--continue" .claude/skills/task/SKILL.md &&
   ! grep -qE -- "\[--full\] <verb>|--full\]? *<verb>" .claude/skills/task/SKILL.md'
check "auto-chain.md no longer carries a lite-chain shape" \
  '! grep -qE "Lite chain|workflow_shape|CHAIN_SHAPE" .claude/skills/task/phases/auto-chain.md'
check "auto-chain.md states autopilot is the default (#458)" \
  'grep -q "Autopilot is the default" .claude/skills/task/phases/auto-chain.md'
check "auto-chain.md refuses the stalling excuses (#458)" \
  'grep -q "real code gets written" .claude/skills/task/phases/auto-chain.md'
check "scaffolded AGENTS.md carries the stop rule (#458)" \
  'grep -q "runs on autopilot after the plan" AGENTS.md'
check "the chain-stops section is fenced so upgrade can deliver it (#466)" \
  'grep -q -- "<!-- --- Specnaut: chain-stops --- -->" AGENTS.md && grep -q -- "<!-- --- End Specnaut: chain-stops --- -->" AGENTS.md'

echo "═══ #442  Backlog references name the item, not just its number ═══"
# Repointed off the retired command shim (#533), which the board skill
# replaced. The absence check was passing vacuously against the missing file —
# `! grep` on a path that does not exist succeeds.
check "the backlog skill exists to be checked at all" \
  '[ -f .claude/skills/task/SKILL.md ] && [ -f .claude/skills/task/backlog.md ]'
check "the backlog skill points at the backlog-reference-contract" \
  'grep -q "backlog-reference-contract" .claude/skills/task/SKILL.md'
check "the backlog skill does not restate the rule (single canonical copy)" \
  '! grep -q "Never a number alone" .claude/skills/task/SKILL.md .claude/skills/task/backlog.md'
# The negative alone made deleting the rule from the product turn the suite
# GREENER. A rule asserted only by its absence elsewhere is not asserted.
check "and the rule itself exists where it is supposed to live" \
  'grep -q "Never a number alone" .claude/skills/backlog-reference-contract/SKILL.md'

echo
echo "═══ #551  the harness-specific tree the scan never looked at ═══"
# Three of the twelve files under templates/harness-specific/ had no assertion
# at all — they were invisible because the diff pathspec never collected that
# tree, so nothing ever reported them missing.
check "the security-guidance context file scaffolds" \
  '[ -f .claude/claude-security-guidance.md ]'
check "and states that it sharpens the checklist rather than replacing it" \
  'grep -q "it cannot switch parts of it" .claude/claude-security-guidance.md'
check "the per-edit pattern file scaffolds" \
  '[ -f .claude/security-patterns.yaml ]'
check "and promises deterministic matching, with no model call" \
  'grep -q "no model call" .claude/security-patterns.yaml'
check "and fires each rule once per file per session, not on every edit" \
  'grep -q "once per" .claude/security-patterns.yaml'

echo
echo "═══ #612 / cli#680  the context file is AGENTS.md, and points only at what was scaffolded ═══"
check_context_file local
check "AGENTS.md carries the backlog section, rendered for its backend (cli#680)" \
  'grep -q -- "<!-- --- Specnaut: backlog --- -->" AGENTS.md && grep -q "\.specnaut/backlog\.md" AGENTS.md && ! grep -q "backend=" AGENTS.md'
check "AGENTS.md carries the optional-integrations section (cli#680)" \
  'grep -q -- "<!-- --- Specnaut: optional-integrations --- -->" AGENTS.md'

echo
echo "═══ #23  a silent review seat fails the gate ═══"
# The not-run state has ONE representation and it is arithmetic: a prose note
# beside an all-zero block reads as clean to whatever sums it. Every assertion
# here anchors on a behavioural sentence, never on a heading — deleting the
# rule beneath a heading used to leave two of these green.
check "the seat caps Step 0 so the budget reaches the files" \
  'grep -q "at most four reads in Step 0" .claude/agents/security-expert.md'
# monorepo#28 re-anchored this. It used to pin the literal
# `no findings — checks performed:`, which existed on ONE seat — the per-agent
# convention that made a coordinator-side check impossible to write. The shape
# now lives in the contract as `EVIDENCE`, so the assertion sweeps every seat
# instead of naming the one that happened to have it.
check "a clean verdict has a shape of its own, on every seat" \
  'for a in accessibility-expert architect-expert code-reviewer dependency-expert \
            performance-expert security-expert; do
     grep -qF "EVIDENCE" ".claude/agents/$a.md" || exit 1
   done'
check "the contract, not an agent, defines what a clean verdict names" \
  'grep -qF "EVIDENCE" .claude/skills/review-findings-contract/SKILL.md'
check "and it states the limit the check leaves behind" \
  'grep -qF "did it look at all" .claude/skills/review-findings-contract/SKILL.md'
check "and could-not-look is reported as a COUNT, not only as prose" \
  'grep -qF "SEATS_REPORTED: 0" .claude/agents/security-expert.md'
check "the seat is forbidden from saying NOT RUN without the count" \
  'grep -q "Never emit the words .NOT RUN. without" .claude/agents/security-expert.md'
check "the contract can express that nobody looked" \
  'grep -q "SEATS_EXPECTED" .claude/skills/review-findings-contract/SKILL.md && grep -q "SEATS_REPORTED" .claude/skills/review-findings-contract/SKILL.md'
check "and a missing seat fails by arithmetic, not by interpretation" \
  'grep -qF "SEATS_REPORTED < SEATS_EXPECTED" .claude/skills/review-findings-contract/SKILL.md'
check "which seats are required is defined, not left to judgement" \
  'grep -q "Required seats, so the word is not left" .claude/skills/task/phases/review-seats.md'
check "a skipped seat is distinguished from a missing one" \
  'grep -q "skipped seat is not a missing one" .claude/skills/task/phases/review-seats.md'
# A SWEEP, not a case. The contract gained two fields and six of the eight
# seats kept describing the old block — an honest review would then have
# counted six seats as not-reporting. Third instance in two days of an
# enumeration stopping one short, so this counts every seat rather than
# naming the ones that were wrong at the time.
check "every review seat names the seat-count fields, not just the ones fixed" \
  'n=0; for a in .claude/agents/*expert.md .claude/agents/code-reviewer.md; do grep -q "REVIEW_VERDICT" "$a" || continue; grep -q "SEATS_EXPECTED" "$a" || n=$((n+1)); done; [ "$n" -eq 0 ]'
check "a stale seat block does not fail an honest gate" \
  'grep -q "counts as .*one" .claude/skills/task/phases/review-seats.md'
check "the aggregation's own restatement carries the third trigger too" \
  'grep -qF "SEATS_REPORTED < SEATS_EXPECTED" .claude/skills/task/phases/review-seats.md'
check "the review may not present its own checking as a seat report" \
  'grep -qF "Your own verification is not a seat report" .claude/skills/task/phases/review-seats.md'
# AC4 — the option deliberately NOT taken. Without an assertion, deleting the
# refusal is invisible and an automatic retry creeps back in.
check "no automatic re-dispatch: zero findings stays a legitimate result" \
  'grep -q "zero findings can be a" .claude/skills/task/phases/review-seats.md'
# The consumer of the gate. Without this the aggregation can say fail and the
# chain still reaches the merge prompt.
check "the review phase stops the run when a seat did not report" \
  'grep -qF "SEATS_REPORTED <" .claude/skills/task/phases/review.md'
check "and re-dispatching narrower is allowed, repeating the brief is not" \
  'grep -qF "Repeating the same brief is not" .claude/skills/task/phases/review.md'
# #678 — the coordinator's fan-out moved into the review phase itself.
check "the review fans its seats out by name under the concurrency cap" \
  'grep -qF "in flight, and never more than the harness" .claude/skills/task/phases/review.md && grep -qF "collect-audit-scope.sh --range" .claude/skills/task/phases/review.md'
check "a seat brief carries data, never the diff's own text" \
  'grep -qF "never diff hunks or commit message bodies" .claude/skills/task/phases/review-seats.md'
check "and only a seat's last REVIEW SUMMARY block counts" \
  'grep -qF "Only the last \`REVIEW SUMMARY\` block" .claude/skills/task/phases/review-seats.md'

echo "═══ #547  the thirteen skills nothing asserted on ═══"
# These shipped covered by an audit that could not fail: every skill's file
# is named SKILL.md, so its basename identified nothing. Each assertion below
# names what the skill PROMISES — a presence check would satisfy the coverage
# token and close none of the hole, which is this feature's own defect coming
# back through the door marked done.

# --- the five output contracts define a named machine-readable block -----
check "workflow-contract .claude/skills/workflow-contract/SKILL.md is not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/workflow-contract/SKILL.md'
check "workflow-contract defines the WORKFLOW STATUS block and its DONE_CRITERIA_MET key" \
  'grep -q "WORKFLOW STATUS" .claude/skills/workflow-contract/SKILL.md && grep -q "DONE_CRITERIA_MET:" .claude/skills/workflow-contract/SKILL.md'
# #562 — three sections split out of seats that had no duplication left to
# reclaim. Each must ship, be preloaded rather than user-invoked, and still
# carry the sentence it was split out to protect.
check "alert-triage-contract ships and is preloaded, not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/alert-triage-contract/SKILL.md'
check "alert-triage-contract keeps the constrained Bash allowlist intact" \
  'tr "\n" " " < .claude/skills/alert-triage-contract/SKILL.md | grep -qF "granted ONLY for the \`gh api\` calls listed below"'
check "security-expert preloads alert-triage-contract" \
  'grep -q "^skills:.*alert-triage-contract" .claude/agents/security-expert.md'
check "backlog-frontmatter ships and is preloaded, not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/backlog-frontmatter/SKILL.md'
check "product-owner preloads backlog-frontmatter" \
  'grep -q "^skills:.*backlog-frontmatter" .claude/agents/product-owner.md'
check "specnaut-facts ships and is preloaded, not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/specnaut-facts/SKILL.md'
check "specnaut-guide preloads specnaut-facts" \
  'grep -q "^skills:.*specnaut-facts" .claude/agents/specnaut-guide.md'

check "review-findings-contract .claude/skills/review-findings-contract/SKILL.md is not user-invocable" \
  'grep -q "user-invocable: false" .claude/skills/review-findings-contract/SKILL.md'
check "review-findings-contract requires a verdict and a CRITICAL count" \
  'grep -q "REVIEW_VERDICT:" .claude/skills/review-findings-contract/SKILL.md && grep -q "CRITICAL_COUNT:" .claude/skills/review-findings-contract/SKILL.md'
check "qa-report-contract .claude/skills/qa-report-contract/SKILL.md requires a verdict and a bug count" \
  'grep -q "QA_VERDICT:" .claude/skills/qa-report-contract/SKILL.md && grep -q "BUGS_FOUND:" .claude/skills/qa-report-contract/SKILL.md'
check "handoff-protocol .claude/skills/handoff-protocol/SKILL.md carries a payload and its open risks" \
  'grep -q "PAYLOAD:" .claude/skills/handoff-protocol/SKILL.md && grep -q "OPEN_RISKS:" .claude/skills/handoff-protocol/SKILL.md'
# "number, title" matched only the frontmatter description, so the entire
# Format and Rules body was deletable with this green. Anchored on the
# canonical rendering instead.
check "backlog-reference-contract .claude/skills/backlog-reference-contract/SKILL.md defines the canonical rendering" \
  'grep -qF "[#<number> — <title>](<url>)" .claude/skills/backlog-reference-contract/SKILL.md'

# --- #576: mobile-first is the assumed default ------------------------------
# The contract ships as one file and is reached by pointer. What the smoke can
# see that the unit suite cannot is the SCAFFOLDED result: the file a user
# actually receives, at the path their harness puts it.
check "mobile-first-contract .claude/skills/mobile-first-contract/SKILL.md ships" \
  'test -f .claude/skills/mobile-first-contract/SKILL.md'
check "mobile-first-contract states the default and its opt-out" \
  'grep -q "A default, not a mandate" .claude/skills/mobile-first-contract/SKILL.md'
# The opt-out is the project's to declare, never shipped: the scaffolded
# constitution at docs/constitution.md carries no live declaration. `test -f`
# first, or a missing file would pass the negative grep.
check "the scaffolded constitution does not ship a live opt-out declaration" \
  'test -f docs/constitution.md && ! grep -q "This project targets" docs/constitution.md'
check "AGENTS.md carries the ui-defaults managed section" \
  'grep -q "Specnaut: ui-defaults" AGENTS.md'
check "the ui-defaults block points at the contract" \
  'grep -q "mobile-first-contract" AGENTS.md'

# --- #575 · the response-style contract ------------------------------------
check "response-style-contract .claude/skills/response-style-contract/SKILL.md ships" \
  'test -f .claude/skills/response-style-contract/SKILL.md'
check "response-style-contract is preloaded, never invocable" \
  'grep -q "user-invocable: false" .claude/skills/response-style-contract/SKILL.md'
check "response-style-contract carries the four badge rows" \
  'test "$(grep -cE "^\| (🟢|🔵|🟠|🔴) \|" .claude/skills/response-style-contract/SKILL.md)" = 4'
check "response-style-contract states the badge rule, not just the palette" \
  'grep -q "A badge describes the state at the time of reading" .claude/skills/response-style-contract/SKILL.md'
check "response-style-contract grants no tools in its frontmatter" \
  '! sed -n "2,/^---$/p" .claude/skills/response-style-contract/SKILL.md | grep -qE "^(tools|allowed-tools|permissionMode):"'
check "AGENTS.md carries the response-style managed section" \
  'grep -q "Specnaut: response-style" AGENTS.md'
check "the response-style block points at the contract rather than restating it" \
  'grep -q "response-style-contract" AGENTS.md \
   && ! grep -q "A badge describes the state at the time of reading" AGENTS.md'
check "the always-on context file carries the response-style pointer" \
  'grep -q "response-style-contract" .claude/CLAUDE.md'
check "plan-template.md ships and states WHERE questions are asked, not how" \
  'test -f .specnaut/templates/plan-template.md \
   && grep -q "Asked at the stop that ends the plan phase" .specnaut/templates/plan-template.md \
   && ! grep -qi "one at a time" .specnaut/templates/plan-template.md'
# Case-INSENSITIVE, and matching the phrase rather than one word order. The
# first version of this check was `-E "one question at a time"` with no `-i`,
# over a corpus whose only spelling is "ONE at a time" — so it grepped an empty
# file list and passed every run without reading anything.
check "the selection rule is pointed at, not restated, in the scaffolded skills" \
  '! grep -rliE "one at a time" .claude/skills/ --include="*.md" \
     | grep -v response-style-contract \
     | xargs -r grep -liE "question|ask" \
     | xargs -r grep -Li "response-style-contract" \
     | grep -q .'
check "backlog-reference-contract bans a bare number" \
  'grep -q "bare .#42. is opaque" .claude/skills/backlog-reference-contract/SKILL.md'

# --- #611 · phase addenda -------------------------------------------------
check "AGENTS.md carries the phase-addenda managed section" \
  'grep -q "Specnaut: phase-addenda" AGENTS.md'
check "the /specnaut router reads the specnaut addendum" \
  'grep -qF ".specnaut/addenda/specnaut/<verb>.md" .claude/skills/specnaut/SKILL.md'
check "the /task router reads the task addendum, audit included (spec 037)" \
  'grep -qF ".specnaut/addenda/task/<verb>.md" .claude/skills/task/SKILL.md &&
   grep -qF "\`merge\`, \`audit\`, \`constitution\`" .claude/skills/task/SKILL.md'
check "the /ship router reads the ship addendum" \
  'grep -qF ".specnaut/addenda/ship/<phase>.md" .claude/skills/ship/SKILL.md'
check "init scaffolds no addenda tree — the seam is opt-in by file" \
  'test ! -e .specnaut/addenda'

# --- the two that share nothing with each other --------------------------
check "status-audit .claude/skills/status-audit/SKILL.md reads the agent ledger" \
  'grep -q ".specnaut/logs/agents.jsonl" .claude/skills/status-audit/SKILL.md'
# alias-example is deliberately NOT bundled — verified by scaffolding: 21
# skills land and it is not among them, and the bundle contains its name zero
# times while every shipped skill appears at least once. It is a source-only
# reference showing the alias_of + overlays frontmatter convention, meant to
# be copied. A runtime assertion about it could only ever be false, so its
# coverage is carried by a reasoned allowlist entry instead (022-R13).
check "alias-example .claude/skills/alias-example/SKILL.md is source-only and does NOT scaffold" \
  '[ ! -e .claude/skills/alias-example ]'

finish "FEATURES"
