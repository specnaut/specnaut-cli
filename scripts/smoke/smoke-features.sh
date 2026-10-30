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

# Wipe the scenario directory on every exit path, success or failure.
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
echo "═══ #78 + #92  dispatch-agent.sh + depth-aware splitter ═══"
check "dispatch-agent.sh executable" '[ -x .claude/scripts/dispatch-agent.sh ]'
check "depth-aware splitter included" \
  'grep -q "split_tools" .claude/scripts/dispatch-agent.sh'

echo
echo "═══ #158  semantic labels reference doc ═══"
check ".specnaut/LABELS.md scaffolded (always-on, regardless of backend)" \
  '[ -f .specnaut/LABELS.md ]'
check "LABELS.md lists the canonical 7-label palette" \
  'grep -q "security" .specnaut/LABELS.md && grep -q "refactor" .specnaut/LABELS.md && grep -q "tech-debt" .specnaut/LABELS.md'

# #88 (hooks bundled, settings.json registrations) lives in smoke-hooks.sh, which owns hooks.
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
  'grep -q "surface the verdict summary and follow \`phases/auto-chain.md\`" .claude/skills/task/phases/review.md && ! grep -q "invoke it on \"yes\"" .claude/skills/task/phases/review.md'

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
check "scaffolded AGENTS.md carries the stop rule, and not the excuse table (#458, cli#679)" 'grep -q "runs on autopilot after the plan" AGENTS.md && ! grep -q "| The excuse |" AGENTS.md'
check "the chain-stops section is fenced so upgrade can deliver it (#466)" \
  'grep -q -- "<!-- --- Specnaut: chain-stops --- -->" AGENTS.md && grep -q -- "<!-- --- End Specnaut: chain-stops --- -->" AGENTS.md'

finish "FEATURES"
