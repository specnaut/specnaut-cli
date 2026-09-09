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
check "backlog SKILL.md present" '[ -f .claude/skills/board/SKILL.md ]'
check "SKILL renders local backend section" \
  'grep -q "Backend: local Markdown" .claude/skills/board/SKILL.md'
check "github section stripped (local backend)" \
  '! grep -q "Backend: GitHub" .claude/skills/board/SKILL.md'
check "gitlab section stripped (local backend)" \
  '! grep -q "Backend: GitLab" .claude/skills/board/SKILL.md'
check "no orphan BEGIN markers" \
  '! grep -q "BEGIN: backend=" .claude/skills/board/SKILL.md'
check "no orphan END markers" \
  '! grep -q "END: backend=" .claude/skills/board/SKILL.md'

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
for phase in plan plan-audits tasks implement review merge merge-squash epic-commits quality-gates epic-fixups merge-close epic-loop constitution tag-version release-version; do
  check ".claude/skills/specnaut/phases/$phase.md present" \
    "[ -f .claude/skills/specnaut/phases/$phase.md ]"
done
# Explicit literal-name assertions for the audit's basename-substring
# coverage scan — the interpolated loop above hides $phase.md from
# `grep -qF`, so each phase needs its filename rendered in the source.
check "phase doc plan.md scaffolded" \
  '[ -f .claude/skills/specnaut/phases/plan.md ]'
check "phase doc plan-audits.md scaffolded (#456)" \
  '[ -f .claude/skills/specnaut/phases/plan-audits.md ]'
check "plan-audits.md dispatches BOTH auditors (#456)" \
  'grep -q "architect-expert" .claude/skills/specnaut/phases/plan-audits.md && grep -q "security-expert" .claude/skills/specnaut/phases/plan-audits.md'
# Companion docs, named literally for the audit's basename scan — the
# interpolated loop above hides them from `grep -qF`. Both exist because
# their host phase ran out of room under the 12,000-character Windsurf cap:
# merge.md was at 11,960 (#558), implement.md at 11,377 (#556).
check "companion doc merge-squash.md scaffolded (#558)" \
  '[ -f .claude/skills/specnaut/phases/merge-squash.md ]'
check "merge.md routes to it rather than carrying the rules (#558)" \
  'grep -qF "phases/merge-squash.md" .claude/skills/specnaut/phases/merge.md'
check "merge-squash.md kept the rule that makes a squash safe (#558)" \
  'grep -qF "byte-identical" .claude/skills/specnaut/phases/merge-squash.md'
check "companion doc epic-commits.md scaffolded (#556)" \
  '[ -f .claude/skills/specnaut/phases/epic-commits.md ]'
# #554 consolidated implement.md's two epic pointers into one, so the route
# to the commit format is now implement -> epic-loop -> epic-commits. Asserted
# as the whole CHAIN rather than one hop: a broken middle link would leave the
# original one-hop check green while nothing reached the format at all.
check "an epic reaches the commit format: implement -> epic-loop -> epic-commits (#556)" \
  'P=.claude/skills/specnaut/phases;
   grep -qF "phases/epic-loop.md" "$P/implement.md" &&
   grep -qF "phases/epic-commits.md" "$P/epic-loop.md" &&
   [ -f "$P/epic-commits.md" ]'
check "epic-commits.md carries the Epic trailer and the width-agnostic parse (#556)" \
  'grep -qF "Epic: #" .claude/skills/specnaut/phases/epic-commits.md &&
   grep -qF "T(\\d+)" .claude/skills/specnaut/phases/epic-commits.md'
check "epic-commits.md names no test tool (constitution: stack-agnostic)" \
  '! grep -qiE "jest|vitest|playwright|pytest|rspec|junit" .claude/skills/specnaut/phases/epic-commits.md'
# #554 — the loop itself. Four phase docs learned that an epic is one unit,
# and the loop's rules live in one companion so the four cannot drift.
check "companion doc epic-loop.md scaffolded (#554)" \
  '[ -f .claude/skills/specnaut/phases/epic-loop.md ]'
check "implement.md runs an epic as a loop (#554)" \
  'grep -qF "phases/epic-loop.md" .claude/skills/specnaut/phases/implement.md'
check "plan.md makes an epic ONE plan with ONE stop (#554 AC9/AC10)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/plan.md)";
   grep -qF "An epic is one plan" <<<"$flat" && grep -qF "not one per" <<<"$flat"'
check "tasks.md makes an epic ONE tasks.md (#554 AC8)" \
  'grep -qF "An epic is one" .claude/skills/specnaut/phases/tasks.md'
check "review.md stops only on the LAST child (#554 AC12/AC13)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/review.md)";
   grep -qF "does not stop the run" <<<"$flat" &&
   grep -qF "last child" <<<"$flat"'
check "the loop iterates sub-issues, not tasks.md entries (#554 AC8/D3)" \
  'grep -qF "Board sub-issues, one per commit" .claude/skills/specnaut/phases/epic-loop.md'
check "it re-reads the child list each iteration (#554 AC11/D5)" \
  'grep -qF "added mid-flight" .claude/skills/specnaut/phases/epic-loop.md'
check "resume reads commits, never issue state (#554 AC16/AC17)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/epic-loop.md)";
   grep -qF "no state file" <<<"$flat" &&
   grep -qF "not use issue state as a progress signal" <<<"$flat"'
check "a child's card goes In progress then In review, never Done here (#554 AC15/D17)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/epic-loop.md)";
   grep -qF "Move its card to In review" <<<"$flat" &&
   grep -qF "it is not Done" <<<"$flat"'
check "the loop never returns to the user between children (#554 AC3)" \
  'grep -qF "does not return to the user between children" .claude/skills/specnaut/phases/epic-loop.md'
check "the two T counters are named as different counters (#554 AC18)" \
  'grep -qF "not the same counter" .claude/skills/specnaut/phases/epic-loop.md'

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

# #560 — an epic merge closes N children AND the epic, and moves N+1 cards.
# The order is derived, not chosen: sweep-closed.sh reports a Done card whose
# issue is open as REOPENED, so moving the card first manufactures the exact
# state an existing tool is built to flag.
check "companion doc merge-close.md scaffolded (#560)" \
  '[ -f .claude/skills/specnaut/phases/merge-close.md ]'
check "merge.md routes to it after a push (#560)" \
  'grep -qF "phases/merge-close.md" .claude/skills/specnaut/phases/merge.md'
check "the epic path closes every child AND the epic (#560 AC1)" \
  'grep -qF "N children" .claude/skills/specnaut/phases/merge-close.md'
# The three checks below were one check, and it certified a file that broke
# the rule it is named for. It flattened merge-close.md and grepped for the
# rule sentence plus "REOPENED" — both of which live in the ordering section.
# The standalone path moved the card and only then closed the issue, a few
# dozen lines away, and this check passed on it for as long as it existed
# (#588). Presence of a rule is not conformance to it, and a check that reads
# only prose cannot tell the two apart. So: one check that the rule is stated
# and argued, and one per path that the two operations appear in that order.
check "the ordering rule is stated once, and says why (#560 AC4)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/merge-close.md)";
   grep -qF "close the issue first, then move the card" <<<"$flat" &&
   grep -qF "REOPENED" <<<"$flat"'
# The standalone path names both operations as commands, so its order is
# readable structurally: the line that closes must precede the line that moves,
# within that section only. `!c` / `!m` keep the FIRST of each, so a later
# mention in prose cannot rescue a wrong order. A missing marker fails too — a
# renamed command must re-state its order, not silently stop being checked.
check "the STANDALONE path closes before it moves, in that order (#588 AC4)" \
  'awk "/^## Standalone/{s=1} /^## An epic/{s=0}
        s && /gh issue close <linked_issue>/ && !c {c=NR}
        s && /move\.sh <linked_issue> Done/ && !m {m=NR}
        END{exit !(c && m && c < m)}" \
     .claude/skills/specnaut/phases/merge-close.md'
# The epic path issues no literal commands — it states the order in prose, so
# the order IS the sentence. Reversing the procedure means rewriting this
# phrase, which is what makes a phrase match binding here and not elsewhere.
check "the EPIC path closes before it moves, in that order (#588 AC4)" \
  'grep -qF "close the issue with a reason, then move its card" \
     <<<"$(tr "\n" " " < .claude/skills/specnaut/phases/merge-close.md)"'
check "cascade-check still gates the parent close (#560 AC2)" \
  'grep -qF "cascade-check.sh <epic>" .claude/skills/specnaut/phases/merge-close.md'
check "children are enumerated from the branch, not from memory (#560)" \
  'grep -qF "did not ship" .claude/skills/specnaut/phases/merge-close.md'
check "the report names every item, not a count (#560 AC5)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/merge-close.md)";
   grep -qF "One line per issue closed" <<<"$flat" &&
   grep -qF "could not move and why" <<<"$flat"'
check "nothing closes when the merge did not push (#560 AC6)" \
  'grep -qF "only when the push" .claude/skills/specnaut/phases/merge-close.md'

# #587 — a shipped feature's spec directory is removed at the merge. The code
# is the authority afterwards; the plan is already in git history, which is
# what makes the removal lossless. Each check below guards a condition whose
# loss turns a cleanup into data destruction or into a silent no-op.
check "the standalone path removes the spec directory (#587 AC1)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/merge-close.md)";
   grep -qF "Remove the feature'"'"'s spec directory" <<<"$flat" &&
   grep -qF "feature_directory" <<<"$flat"'
# The load-bearing one. Without the history check the step deletes the only
# copy of a plan that never got its plan-time commit.
check "the removal refuses a directory git has never seen (#587 AC2)" \
  'grep -qF "git log --all --oneline" .claude/skills/specnaut/phases/merge-close.md'
check "one yes authorises the close AND the removal, with no second prompt (#587 AC3)" \
  'grep -qF "One \`yes\` authorises" \
     <<<"$(tr "\n" " " < .claude/skills/specnaut/phases/merge-close.md)"'
check "the removal is its own commit, not folded into the merge (#587 AC4)" \
  'grep -qF "remove the spec directory for the shipped feature" .claude/skills/specnaut/phases/merge-close.md'
# An epic is one branch over one tree: a per-child removal would aim at the
# same directory N times and strand the children still to be closed.
check "an epic removes one directory once, never per child (#587 AC5)" \
  'grep -qF "Never per child" .claude/skills/specnaut/phases/merge-close.md'
# feature.json NAMES the removed directory, and common.sh never checks that
# the name still resolves: get_feature_paths returns the deleted path with
# exit 0 and no warning, its branch-contradiction guard skipped off a feature
# branch. Measured, not reasoned. The removal must take it along.
check "the removal takes feature.json with it, not just the directory (#587)" \
  'grep -qF "git rm -r --quiet \"<feature_directory>\" .specnaut/feature.json" \
     .claude/skills/specnaut/phases/merge-close.md'
check "a skip is reported, never silent (#587 AC6)" \
  'grep -qF "Report the removal, or the reason there wasn" .claude/skills/specnaut/phases/merge-close.md'
# auto-chain.md walks the same directories and must NOT delete. Its read-only
# line survives verbatim; what it gained is why it does not contradict the
# phase that does delete — without that, the next reader reads one of the two
# as a bug.
check "orphan detection stays read-only, and says why that is not a contradiction (#587 AC8)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/auto-chain.md)";
   grep -qF "never delete or modify spec files" <<<"$flat" &&
   grep -qF "merge-close.md\` step 8" <<<"$flat"'
check "the false retention claim is gone from auto-chain.md (#587 AC7)" \
  '! grep -qF "historical records" .claude/skills/specnaut/phases/auto-chain.md'
check "the legacy spec.md rule survives the reword (#587 AC9)" \
  'grep -qF "Has \`spec.md\` but no \`plan.md\`" .claude/skills/specnaut/phases/auto-chain.md'

# #559 — a fixup folds into ITS OWN child, and the fold is verified here
# rather than borrowed from squash-by-scope, which governs the other path and
# since #558 lives in another file entirely. AC 7 is the load-bearing one.
check "companion doc epic-fixups.md scaffolded (#559)" \
  '[ -f .claude/skills/specnaut/phases/epic-fixups.md ]'
check "merge.md folds fixups before merging an epic (#559)" \
  'grep -qF "phases/epic-fixups.md" .claude/skills/specnaut/phases/merge.md'
check "a fixup is written against its own child, not matched afterwards (#559)" \
  'grep -qF "git commit --fixup=" .claude/skills/specnaut/phases/epic-fixups.md'
check "the fold verifies the tree did not move (#559 AC5)" \
  'grep -qF "byte-identical" .claude/skills/specnaut/phases/epic-fixups.md'
# Prose wraps. A phrase that reads as one sentence is several lines in the
# file, and a line-based grep misses it — three assertions today have failed
# for exactly that, on this ticket and on #557 and #561 before it. Newlines
# are flattened first, through a here-string rather than a pipe: `grep -q`
# exits early, and under `pipefail` that SIGPIPEs the producer and decides
# the assertion on the writer's death instead of the content (#550).
check "and it says so for THIS procedure, not by inheritance (#559 AC7)" \
  'grep -qF "does not reach here" <<<"$(tr "\n" " " < .claude/skills/specnaut/phases/epic-fixups.md)"'
check "the fold verifies the worktree is empty afterwards (#559 AC6)" \
  'grep -qF "git status --short" .claude/skills/specnaut/phases/epic-fixups.md'
check "a surviving fixup! is a finding, not something to fold by eye (#559)" \
  'grep -qF "folding it by" .claude/skills/specnaut/phases/epic-fixups.md'
check "the fold does not read diff exit 2 as \"they differ\" (#559)" \
  'flat="$(tr "\n" " " < .claude/skills/specnaut/phases/epic-fixups.md)";
   grep -qF "is not \"they differ\"" <<<"$flat" &&
   grep -qF "check for exit" <<<"$flat"'

# #557 — merge.md routes by history rule, and the epic path does not squash.
# Each of these is a sentence a later edit would plausibly "simplify" away.
check "merge.md asks the BRANCH which rule applies, not the board (#557)" \
  'grep -qF "Epic: #" .claude/skills/specnaut/phases/merge.md &&
   grep -qF "log <base>..HEAD" .claude/skills/specnaut/phases/merge.md'
check "merge.md says an epic branch is NOT squashed (#557)" \
  'grep -qF "The epic branch is not squashed" .claude/skills/specnaut/phases/merge.md'
check "merge.md keeps one merge decision for the whole epic (#557)" \
  'grep -qF "not one per child" .claude/skills/specnaut/phases/merge.md'
check "merge.md says a failing full tier is repaired, not escalated (#557)" \
  'grep -qF "hand the epic back" .claude/skills/specnaut/phases/merge.md'
check "merge-squash.md no longer reads as an absolute over both paths (#557)" \
  'grep -qF "not \"either kind of branch\"" .claude/skills/specnaut/phases/merge-squash.md'
check "companion doc quality-gates.md scaffolded (#555)" \
  '[ -f .claude/skills/specnaut/phases/quality-gates.md ]'
check "gates.yml scaffolded with both tiers declared empty (#555)" \
  '[ -f .specnaut/gates.yml ] &&
   grep -qE "^fast_gate:" .specnaut/gates.yml &&
   grep -qE "^full_gate:" .specnaut/gates.yml'
check "run-gate.sh scaffolded + executable (#555)" \
  '[ -x .specnaut/scripts/bash/run-gate.sh ]'
check "run-gate.ps1 twin scaffolded (#555)" \
  '[ -f .specnaut/scripts/powershell/run-gate.ps1 ]'
check "an epic reaches the fast tier: implement -> epic-loop -> run-gate (#555)" \
  'P=.claude/skills/specnaut/phases;
   grep -qF "phases/epic-loop.md" "$P/implement.md" &&
   grep -qF "run-gate.sh fast" "$P/epic-loop.md" &&
   grep -qF "phases/quality-gates.md" "$P/epic-loop.md"'
check "merge.md runs the full tier once, never per child (#555)" \
  'grep -qF "run-gate.sh full" .claude/skills/specnaut/phases/merge.md &&
   grep -qF "Never per child" .claude/skills/specnaut/phases/merge.md'
check "quality-gates.md states the full tier runs once, before the merge (#555)" \
  'grep -qF "never per child" .claude/skills/specnaut/phases/quality-gates.md'
check "an undeclared tier degrades rather than failing (#555)" \
  'grep -qF "is not a failure" .claude/skills/specnaut/phases/quality-gates.md'
# AC 2, asserted as a sweep over the whole mechanism rather than one file.
# Specnaut is stack-agnostic; a tool name in ANY of these surfaces ends that,
# and a check on one file would pass while the name sat in another.
# NEVER `exit` inside a check expression. `check` runs `eval "$2"` in the
# CURRENT shell, so an `exit` terminates the whole smoke script — and the
# first draft of this very assertion ended with `exit 0`, which left the run
# finishing silently at code 0 with every later check unrun and no closing
# banner. A fail-open guard, written inside the ticket about guards.
# grep takes several files, so no loop is needed here at all.
check "no surface of the gate mechanism names a test tool (#555 AC2)" \
  '! grep -qiE "jest|vitest|playwright|cypress|pytest|rspec|junit|mocha|karma|nightwatch|testcafe|phpunit|xunit|nunit" \
       .specnaut/gates.yml \
       .specnaut/scripts/bash/run-gate.sh \
       .specnaut/scripts/powershell/run-gate.ps1 \
       .claude/skills/specnaut/phases/quality-gates.md'
check "phase doc constitution.md scaffolded" \
  '[ -f .claude/skills/specnaut/phases/constitution.md ]'
check "removed phases do NOT scaffold (#455)" \
  '! ls .claude/skills/specnaut/phases/ | grep -qE "^(brainstorm|specify|clarify|analyze|checklist|list-skills|lite-heuristic)\.md$"'
check "phase doc tasks.md scaffolded" \
  '[ -f .claude/skills/specnaut/phases/tasks.md ]'
check "phase doc tag-version.md scaffolded (epic #226)" \
  '[ -f .claude/skills/specnaut/phases/tag-version.md ]'
check "phase doc release-version.md scaffolded (epic #226)" \
  '[ -f .claude/skills/specnaut/phases/release-version.md ]'
check "phase doc audit-security.md scaffolded (Epic #302, #303)" \
  '[ -f .claude/skills/specnaut/phases/audit-security.md ]'
check "audit-security phase doc declares read-only contract" \
  'grep -q "Read-only contract" .claude/skills/specnaut/phases/audit-security.md'
check "audit-security phase doc dispatches the security-expert agent" \
  'grep -q "security-expert" .claude/skills/specnaut/phases/audit-security.md'
check "audit-security phase doc parses --severity flag" \
  'grep -q "\-\-severity" .claude/skills/specnaut/phases/audit-security.md'
check "router phase index lists audit security" \
  'grep -q "audit security" .claude/skills/specnaut/SKILL.md'
check "phase doc audit-performance.md scaffolded (Epic #302, #304)" \
  '[ -f .claude/skills/specnaut/phases/audit-performance.md ]'
check "audit-performance phase doc dispatches the performance-expert agent" \
  'grep -q "performance-expert" .claude/skills/specnaut/phases/audit-performance.md'
check "audit-performance phase doc declares read-only contract" \
  'grep -q "Read-only contract" .claude/skills/specnaut/phases/audit-performance.md'
check "performance-expert agent bundled (Epic #302, #304)" \
  '[ -f .claude/agents/performance-expert.md ]'
check "performance-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/performance-expert.md'
check "performance-expert agent covers N+1 axis" \
  'grep -q "N+1" .claude/agents/performance-expert.md'
check "performance-expert agent enforces read-only Bash allow-list" \
  'grep -q "Read-only contract" .claude/agents/performance-expert.md'
check "router phase index lists audit performance" \
  'grep -q "audit performance" .claude/skills/specnaut/SKILL.md'
check "phase doc audit-accessibility.md scaffolded (Epic #302, #305)" \
  '[ -f .claude/skills/specnaut/phases/audit-accessibility.md ]'
check "audit-accessibility phase doc dispatches the accessibility-expert agent" \
  'grep -q "accessibility-expert" .claude/skills/specnaut/phases/audit-accessibility.md'
check "audit-accessibility phase documents FE-surface gate" \
  'grep -q "no FE surface detected" .claude/skills/specnaut/phases/audit-accessibility.md'
check "accessibility-expert agent bundled (Epic #302, #305)" \
  '[ -f .claude/agents/accessibility-expert.md ]'
check "accessibility-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/accessibility-expert.md'
check "accessibility-expert agent covers WCAG 2.1 AA" \
  'grep -q "WCAG 2.1 AA" .claude/agents/accessibility-expert.md'
check "accessibility-expert agent implements FE-surface gate" \
  'grep -q "Front-end surface detection" .claude/agents/accessibility-expert.md'
check "router phase index lists audit accessibility" \
  'grep -q "audit accessibility" .claude/skills/specnaut/SKILL.md'
check "phase doc audit-architecture.md scaffolded (Epic #320, #321)" \
  '[ -f .claude/skills/specnaut/phases/audit-architecture.md ]'
check "audit-architecture phase doc dispatches the architect-expert agent" \
  'grep -q "architect-expert" .claude/skills/specnaut/phases/audit-architecture.md'
check "audit-architecture phase doc declares read-only contract" \
  'grep -q "Read-only contract" .claude/skills/specnaut/phases/audit-architecture.md'
check "architect-expert agent bundled (Epic #320, #321)" \
  '[ -f .claude/agents/architect-expert.md ]'
check "architect-expert agent declares disable-model-invocation" \
  'grep -q "disable-model-invocation: true" .claude/agents/architect-expert.md'
check "architect-expert agent covers hex-layer violations axis" \
  'grep -q "[Hh]ex-layer" .claude/agents/architect-expert.md'
check "architect-expert agent enforces read-only Bash allow-list" \
  'grep -q "Read-only contract" .claude/agents/architect-expert.md'
check "router phase index lists audit architecture" \
  'grep -q "audit architecture" .claude/skills/specnaut/SKILL.md'
check "phase doc audit-dependencies.md scaffolded (Epic #320, #322)" \
  '[ -f .claude/skills/specnaut/phases/audit-dependencies.md ]'
check "audit-dependencies phase doc dispatches the dependency-expert agent" \
  'grep -q "dependency-expert" .claude/skills/specnaut/phases/audit-dependencies.md'
check "audit-dependencies phase doc declares read-only contract" \
  'grep -q "Read-only contract" .claude/skills/specnaut/phases/audit-dependencies.md'
check "audit-dependencies phase doc bans live advisory tooling" \
  'grep -q "npm audit\|cargo audit\|pip-audit" .claude/skills/specnaut/phases/audit-dependencies.md'
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

check "router phase index lists audit dependencies" \
  'grep -q "audit dependencies" .claude/skills/specnaut/SKILL.md'
check "name: specnaut on the router SKILL.md" \
  'head -3 .claude/skills/specnaut/SKILL.md | grep -q "name: specnaut"'
check "disable-model-invocation NOT set on the router (Skill-tool chaining must work)" \
  '! grep -q "disable-model-invocation: true" .claude/skills/specnaut/SKILL.md'
check "specnaut-review alias no longer scaffolds (retired)" \
  '[ ! -e .claude/skills/specnaut-review/SKILL.md ]'

echo
echo "═══ #271  writing-plans skill (Epic #270 / A1) ═══"
check "writing-plans skill scaffolded" \
  '[ -f .claude/skills/writing-plans/SKILL.md ]'
check "writing-plans frontmatter declares name: writing-plans" \
  'head -5 .claude/skills/writing-plans/SKILL.md | grep -q "name: writing-plans"'
check "writing-plans description targets plan-related trigger phrases" \
  'head -10 .claude/skills/writing-plans/SKILL.md | grep -q "plan this"'
check "writing-plans save path documented as docs/specnaut/plans/" \
  'grep -q "docs/specnaut/plans" .claude/skills/writing-plans/SKILL.md'
check "writing-plans enforces zero-placeholder discipline" \
  'grep -qF "No placeholders" .claude/skills/writing-plans/SKILL.md'
check "writing-plans credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/writing-plans/SKILL.md'

echo
echo "═══ #273  requesting-code-review skill (Epic #270 / A3) ═══"
check "requesting-code-review skill scaffolded" \
  '[ -f .claude/skills/requesting-code-review/SKILL.md ]'
check "requesting-code-review frontmatter declares name" \
  'head -5 .claude/skills/requesting-code-review/SKILL.md | grep -q "name: requesting-code-review"'
check "requesting-code-review description targets review-related triggers" \
  'head -10 .claude/skills/requesting-code-review/SKILL.md | grep -q "review this"'
check "requesting-code-review documents code-reviewer agent dispatch" \
  'grep -q "subagent_type: code-reviewer\|subagent_type=\"code-reviewer\"" .claude/skills/requesting-code-review/SKILL.md'
check "requesting-code-review embeds canonical reviewer prompt template" \
  'grep -qF "Critical (Must Fix)" .claude/skills/requesting-code-review/SKILL.md'
check "requesting-code-review documents two-stage review pattern" \
  'grep -q "Two-stage review\|two-stage review" .claude/skills/requesting-code-review/SKILL.md'
check "requesting-code-review credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/requesting-code-review/SKILL.md'

echo
echo "═══ #282  using-specnaut bootstrap skill (Epic #270 / B6) ═══"
check "using-specnaut skill scaffolded" \
  '[ -f .claude/skills/using-specnaut/SKILL.md ]'
check "using-specnaut frontmatter declares name" \
  'head -5 .claude/skills/using-specnaut/SKILL.md | grep -q "name: using-specnaut"'
check "using-specnaut describes SessionStart auto-injection" \
  'head -10 .claude/skills/using-specnaut/SKILL.md | grep -q "SessionStart hook"'
check "using-specnaut lists writing-plans skill in registry" \
  'grep -q "writing-plans" .claude/skills/using-specnaut/SKILL.md'
check "using-specnaut lists requesting-code-review skill in registry" \
  'grep -q "requesting-code-review" .claude/skills/using-specnaut/SKILL.md'
check "using-specnaut lists product-owner agent + backlog mutation rule" \
  'grep -q "product-owner" .claude/skills/using-specnaut/SKILL.md'
check "using-specnaut lists devops-sre agent + release advisory rule" \
  'grep -q "devops-sre" .claude/skills/using-specnaut/SKILL.md'
# Matched on the suffix, not a full filename: the skill names these as a brace
# expansion (`references/{claude,codex,…}-tools.md`), so a literal
# `references/claude-tools.md` never appears and the old assertion could not see
# a pointer that was right there.
check "using-specnaut points at per-harness tool-mapping references" \
  'grep -q -- "-tools.md" .claude/skills/using-specnaut/SKILL.md'
check "using-specnaut credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/using-specnaut/SKILL.md'

echo
echo "═══ #272  subagent-driven-development skill (Epic #270 / A2) ═══"
check "subagent-driven-development skill scaffolded" \
  '[ -f .claude/skills/subagent-driven-development/SKILL.md ]'
check "subagent-driven-development frontmatter declares name" \
  'head -5 .claude/skills/subagent-driven-development/SKILL.md | grep -q "name: subagent-driven-development"'
check "subagent-driven-development describes two-stage review pattern" \
  'grep -q "two-stage review\|Two-stage review" .claude/skills/subagent-driven-development/SKILL.md'
check "subagent-driven-development documents developer agent dispatch" \
  'grep -q "subagent_type: \"developer\"" .claude/skills/subagent-driven-development/SKILL.md'
check "subagent-driven-development documents code-reviewer agent dispatch" \
  'grep -q "subagent_type: \"code-reviewer\"" .claude/skills/subagent-driven-development/SKILL.md'
check "subagent-driven-development handles all 4 status codes" \
  'grep -q "DONE_WITH_CONCERNS" .claude/skills/subagent-driven-development/SKILL.md && grep -q "NEEDS_CONTEXT" .claude/skills/subagent-driven-development/SKILL.md && grep -q "BLOCKED" .claude/skills/subagent-driven-development/SKILL.md'
check "subagent-driven-development covers model selection guidance" \
  'grep -q "Model selection" .claude/skills/subagent-driven-development/SKILL.md'
check "subagent-driven-development credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/subagent-driven-development/SKILL.md'

echo
echo "═══ #274  executing-plans skill (Epic #270 / A4) ═══"
check "executing-plans skill scaffolded" \
  '[ -f .claude/skills/executing-plans/SKILL.md ]'
check "executing-plans frontmatter declares name" \
  'head -5 .claude/skills/executing-plans/SKILL.md | grep -q "name: executing-plans"'
check "executing-plans describes checkpoint pauses between tasks" \
  'grep -q "checkpoint" .claude/skills/executing-plans/SKILL.md'
check "executing-plans cross-references subagent-driven-development alternative" \
  'grep -q "subagent-driven-development" .claude/skills/executing-plans/SKILL.md'
check "executing-plans documents self-review at task boundaries" \
  'grep -q "self-review\|Self-review" .claude/skills/executing-plans/SKILL.md'
check "executing-plans references pre-commit gate awareness" \
  'grep -q "pre-commit\|Pre-commit" .claude/skills/executing-plans/SKILL.md'
check "executing-plans credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/executing-plans/SKILL.md'

echo
echo "═══ #275  verification-before-completion skill (Epic #270 / A5) ═══"
check "verification-before-completion skill scaffolded" \
  '[ -f .claude/skills/verification-before-completion/SKILL.md ]'
check "verification-before-completion frontmatter declares name" \
  'head -5 .claude/skills/verification-before-completion/SKILL.md | grep -q "name: verification-before-completion"'
# v4.0.0 split this skill: five checks that hold in any project, then the
# Specnaut-maintainer gates below them. The old assertion required
# `deno fmt --check` in the general half — the exact line that was removed
# because it prescribes a toolchain to projects that do not have it.
check "verification-before-completion keeps its general checks toolchain-agnostic" \
  '! grep -q "deno fmt --check" .claude/skills/verification-before-completion/SKILL.md'
check "verification-before-completion still carries the maintainer gates" \
  'grep -q "audit.sh" .claude/skills/verification-before-completion/SKILL.md && grep -q "Specnaut bundle source" .claude/skills/verification-before-completion/SKILL.md'
check "verification-before-completion references plugin sync test" \
  'grep -q "plugin_sync_test" .claude/skills/verification-before-completion/SKILL.md'
check "verification-before-completion references Windsurf cap" \
  'grep -q "windsurf_harness_test\|Windsurf 12000-char" .claude/skills/verification-before-completion/SKILL.md'
check "verification-before-completion documents report shape with evidence" \
  'grep -q "Verification:" .claude/skills/verification-before-completion/SKILL.md'
check "verification-before-completion credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/verification-before-completion/SKILL.md'

echo
echo "═══ #276  brainstorming skill (Epic #270 / A6) ═══"
check "brainstorming skill scaffolded" \
  '[ -f .claude/skills/brainstorming/SKILL.md ]'
check "brainstorming frontmatter declares name" \
  'head -5 .claude/skills/brainstorming/SKILL.md | grep -q "name: brainstorming"'
# INVERTED by #575, deliberately. This asserted that `brainstorming` states the
# one-question-at-a-time rule ITSELF. It now must not: the rule has exactly one
# author, and every other surface points at it. Asserting the pointer is the same
# guarantee for the user and a stronger one for the tree — the old form was
# satisfied by any of the six copies that used to exist.
check "brainstorming points at the response-style contract for how to ask" \
  'grep -q "response-style-contract" .claude/skills/brainstorming/SKILL.md \
   && ! grep -qi "one at a time" .claude/skills/brainstorming/SKILL.md'
check "brainstorming hands off to writing-plans" \
  'grep -q "hand off to .writing-plans.\|writing-plans" .claude/skills/brainstorming/SKILL.md'
check "brainstorming documents coexistence with the spec flow" \
  'grep -q "/specnaut plan" .claude/skills/brainstorming/SKILL.md'
check "brainstorming enforces the no-implementation-before-design rule" \
  'grep -q "No implementation, no plan\|approval before handing off" .claude/skills/brainstorming/SKILL.md'
check "brainstorming credits obra/superpowers attribution" \
  'grep -q "obra/superpowers" .claude/skills/brainstorming/SKILL.md'

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
check "groom ships beside the board skill, not as a router phase" \
  '[ -f .claude/skills/board/groom.md ] && [ ! -e .claude/skills/specnaut/phases/groom.md ]'

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
                review-coordinator.md security-expert.md test-reviewer.md \
                workflow-manager.md; do
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
check "specnaut-guide agent body fits Windsurf 12000-char Cascade cap" \
  'deno eval --no-config "const s = await Deno.readTextFile(\".claude/agents/specnaut-guide.md\"); Deno.exit(s.length <= 12000 ? 0 : 1);"'
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
check "ui-ux-designer fits the Windsurf 12000-char Cascade cap" \
  'deno eval --no-config "const s = await Deno.readTextFile(\".claude/agents/ui-ux-designer.md\"); Deno.exit(s.length <= 12000 ? 0 : 1);"'
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

echo
echo "═══ #88  hooks bundled ═══"
check ".claude/settings.json scaffolded" '[ -f .claude/settings.json ]'
check "PreToolUse hook registered" 'grep -q "PreToolUse" .claude/settings.json'
check "SubagentStart hook registered" 'grep -q "SubagentStart" .claude/settings.json'
check "SessionStart hook registered" 'grep -q "SessionStart" .claude/settings.json'
for hook in protect-generated log-subagent check-backlog-prereqs; do
  check "$hook.sh executable" "[ -x .claude/hooks/$hook.sh ]"
done
check ".specnaut/logs/ in bundled .gitignore" \
  'grep -q "\.specnaut/logs/" .gitignore'

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
echo "═══ #180  SKILL.md — Epics & sub-tasks section ═══"
check "SKILL.md gains an Epics & sub-tasks section" \
  'grep -q "Epics & sub-tasks" .claude/skills/board/SKILL.md'
check "SKILL.md describes the --parent flag" \
  'grep -q -- "--parent" .claude/skills/board/SKILL.md'
check "SKILL.md describes the cascade-check close gate" \
  'grep -q "cascade-check.sh" .claude/skills/board/SKILL.md'

echo
echo "═══ #251  auto-chain — chain mechanics file present ═══"
check "phases/auto-chain.md is bundled into the project" \
  'test -f .claude/skills/specnaut/phases/auto-chain.md'
# #455 dropped the `#` and renamed the re-entry section. Asserting the
# invariant the doc exists to state — there are exactly two stops — rather than
# a punctuation mark.
check "auto-chain.md documents exactly two stops" \
  'grep -q "STOP 1" .claude/skills/specnaut/phases/auto-chain.md && grep -q "STOP 2" .claude/skills/specnaut/phases/auto-chain.md && grep -qi "EXACTLY TWO stops" .claude/skills/specnaut/phases/auto-chain.md'
check "auto-chain.md documents re-entry without a flag" \
  'grep -qi "Re-entry" .claude/skills/specnaut/phases/auto-chain.md'
check "router SKILL.md parses --manual flag" \
  'grep -q -- "--manual" .claude/skills/specnaut/SKILL.md'
check "router SKILL.md routes to phases/auto-chain.md when chain mode is on" \
  'grep -q "phases/auto-chain.md" .claude/skills/specnaut/SKILL.md'
check "router SKILL.md no longer recommends /specnaut-auto for end-to-end runs" \
  '! grep -q "use \`/specnaut-auto specify" .claude/skills/specnaut/SKILL.md'
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
  'grep -q "linked_issue" .claude/skills/specnaut/phases/plan.md'
# Both re-anchored by #560: the close block moved to the merge-close
# companion, so this is where feature.json is read and the PO is dispatched.
# merge.md keeps a routing assertion instead — a companion nobody loads is a
# deletion, and that is the half the move created.
check "the close step reads feature.json.linked_issue and closes the loop" \
  'grep -q "linked_issue" .claude/skills/specnaut/phases/merge-close.md'
check "the close step dispatches the PO for the close comment" \
  'grep -q "product-owner" .claude/skills/specnaut/phases/merge-close.md'
check "merge.md routes to the close step rather than carrying it" \
  'grep -qF "phases/merge-close.md" .claude/skills/specnaut/phases/merge.md &&
   ! grep -q "product-owner" .claude/skills/specnaut/phases/merge.md'

echo
echo "═══ Developer agent doctrine — Domain Model gate (PR #249) ═══"
check "plan.md carries the domain model in its technical context (#457)" \
  'grep -q "Domain model\|domain model" .claude/skills/specnaut/phases/plan.md'
check "implement.md halts BLOCKED when the Domain Model is absent" \
  'grep -q "awaiting:product-owner-domain-brief" .claude/skills/specnaut/phases/implement.md'

echo
echo "═══ Phase-doc drift fixes — auto-chain default ═══"
check "auto-chain.md infers re-entry from artefacts, with no flag (#455)" \
  'grep -q "Re-entry, without a flag" .claude/skills/specnaut/phases/auto-chain.md'
check "review.md owns STOP #2 (no /specnaut-auto handoff)" \
  '! grep -q "hand back to \`/specnaut-auto\`" .claude/skills/specnaut/phases/review.md'
check "review.md surfaces STOP #2 from phases/auto-chain.md" \
  'grep -q "STOP #2 summary block defined in" .claude/skills/specnaut/phases/review.md'

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
check "router SKILL.md keeps --manual as the only chain flag" \
  'grep -q -- "--manual" .claude/skills/specnaut/SKILL.md && ! grep -qE -- "--lite|--full|--once|--continue" .claude/skills/specnaut/SKILL.md'
check "auto-chain.md no longer carries a lite-chain shape" \
  '! grep -qE "Lite chain|workflow_shape|CHAIN_SHAPE" .claude/skills/specnaut/phases/auto-chain.md'
check "auto-chain.md states the chain has exactly two stops (#458)" \
  'grep -q "EXACTLY TWO stops" .claude/skills/specnaut/phases/auto-chain.md'
check "auto-chain.md refuses the stalling excuses (#458)" \
  'grep -q "real code gets written" .claude/skills/specnaut/phases/auto-chain.md'
check "scaffolded AGENTS.md carries the two-stop rule (#458)" \
  'grep -q "exactly two stops" AGENTS.md'
check "the two-stop section is fenced so upgrade can deliver it (#466)" \
  'grep -q -- "<!-- --- Specnaut: chain-stops --- -->" AGENTS.md && grep -q -- "<!-- --- End Specnaut: chain-stops --- -->" AGENTS.md'

echo "═══ #442  Backlog references name the item, not just its number ═══"
# Repointed off the retired command shim (#533), which the board skill
# replaced. The absence check was passing vacuously against the missing file —
# `! grep` on a path that does not exist succeeds.
check "the board skill exists to be checked at all" \
  '[ -f .claude/skills/board/SKILL.md ]'
check "the board skill points at the backlog-reference-contract" \
  'grep -q "backlog-reference-contract" .claude/skills/board/SKILL.md'
check "the board skill does not restate the rule (single canonical copy)" \
  '! grep -q "Never a number alone" .claude/skills/board/SKILL.md'
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
            performance-expert security-expert test-reviewer review-coordinator; do
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
  'grep -q "Required seats, so the word is not left" .claude/agents/review-coordinator.md'
check "a skipped seat is distinguished from a missing one" \
  'grep -q "skipped seat is not a missing one" .claude/agents/review-coordinator.md'
# A SWEEP, not a case. The contract gained two fields and six of the eight
# seats kept describing the old block — an honest review would then have
# counted six seats as not-reporting. Third instance in two days of an
# enumeration stopping one short, so this counts every seat rather than
# naming the ones that were wrong at the time.
check "every review seat names the seat-count fields, not just the ones fixed" \
  'n=0; for a in .claude/agents/*expert.md .claude/agents/code-reviewer.md .claude/agents/test-reviewer.md .claude/agents/review-coordinator.md; do grep -q "REVIEW_VERDICT" "$a" || continue; grep -q "SEATS_EXPECTED" "$a" || n=$((n+1)); done; [ "$n" -eq 0 ]'
check "a stale seat block does not fail an honest gate" \
  'grep -q "counts as .*one" .claude/agents/review-coordinator.md'
check "the coordinator's own restatement carries the third trigger too" \
  'grep -qF "SEATS_REPORTED < SEATS_EXPECTED" .claude/agents/review-coordinator.md'
check "the coordinator may not present its own checking as a seat report" \
  'grep -qF "Coordinator verification is not a seat report" .claude/agents/review-coordinator.md'
# AC4 — the option deliberately NOT taken. Without an assertion, deleting the
# refusal is invisible and an automatic retry creeps back in.
check "no automatic re-dispatch: zero findings stays a legitimate result" \
  'grep -q "zero findings can be a" .claude/agents/review-coordinator.md'
# The consumer of the gate. Without this the coordinator can say fail and the
# chain still reaches the merge prompt.
check "the review phase stops the run when a seat did not report" \
  'grep -qF "SEATS_REPORTED <" .claude/skills/specnaut/phases/review.md'
check "and re-dispatching narrower is allowed, repeating the brief is not" \
  'grep -qF "Repeating the same brief is not" .claude/skills/specnaut/phases/review.md'

echo "═══ #547  the thirteen skills nothing asserted on ═══"
# These shipped covered by an audit that could not fail: every skill's file
# is named SKILL.md, so its basename identified nothing. Each assertion below
# names what the skill PROMISES — a presence check would satisfy the coverage
# token and close none of the hole, which is this feature's own defect coming
# back through the door marked done.

# --- the five per-axis audits share a scope contract ---------------------
# `body` strips the frontmatter: everything below the second `---`. Without it
# the scope assertion is satisfied by the `argument-hint:` line alone, so all
# five skills could be truncated to five lines with every check still green —
# found in review, and it is the exact failure this feature exists to prevent.
body() { awk 'BEGIN{c=0} /^---$/{c++; next} c>=2' "$1"; }
for axis in a11y arch dep perf sec; do
  check "$axis-audit scaffolded" \
    "[ -f .claude/skills/$axis-audit/SKILL.md ]"
  check "$axis-audit frontmatter declares its own name" \
    "head -5 .claude/skills/$axis-audit/SKILL.md | grep -q 'name: $axis-audit'"
  check "$axis-audit documents all three scopes in its body, not just its frontmatter" \
    "body .claude/skills/$axis-audit/SKILL.md > /tmp/_ax.txt && grep -q -- '--path' /tmp/_ax.txt && grep -q -- '--range' /tmp/_ax.txt && grep -q -- '--diff' /tmp/_ax.txt"
  check "$axis-audit dispatches one expert and never a team" \
    "grep -q 'never a team, never' .claude/skills/$axis-audit/SKILL.md"
done
# Literal paths for the coverage token (024-R1) — the loop above interpolates
# $axis and so is invisible to it, the same reason the phase block at the top
# of this file spells its filenames out.
check "a11y-audit .claude/skills/a11y-audit/SKILL.md audits against WCAG 2.1 AA" \
  'body .claude/skills/a11y-audit/SKILL.md | grep -q "WCAG 2.1 AA"'
check "arch-audit .claude/skills/arch-audit/SKILL.md names hex-layer drift" \
  'body .claude/skills/arch-audit/SKILL.md | grep -q "hex-layer"'
check "dep-audit .claude/skills/dep-audit/SKILL.md names typosquats" \
  'body .claude/skills/dep-audit/SKILL.md | grep -q "typosquats"'
check "perf-audit .claude/skills/perf-audit/SKILL.md names N+1 queries" \
  'body .claude/skills/perf-audit/SKILL.md | grep -qF "N+1"'
check "sec-audit .claude/skills/sec-audit/SKILL.md names SSRF" \
  'body .claude/skills/sec-audit/SKILL.md | grep -q "SSRF"'

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
# The heading level IS the form — a scaffolded project whose contract and
# constitution disagree on it has a documented opt-out that does nothing.
check "mobile-first-contract and the constitution agree on the declaration heading" \
  'grep -q "### Target surface" .claude/skills/mobile-first-contract/SKILL.md \
     && grep -q "### Target surface" .specnaut/memory/constitution.md'
check "the scaffolded constitution does not ship a live opt-out declaration" \
  '! grep -q "This project targets" .specnaut/memory/constitution.md'
check "constitution-template.md carries Front-end patterns pointing at the contract" \
  'grep -q "mobile-first-contract" .specnaut/templates/constitution-template.md'
check "constitution-template.md does not reproduce the declaration sentence" \
  '! grep -q "This project targets" .specnaut/templates/constitution-template.md'
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

# --- the three that share nothing with each other ------------------------
check "code-audit .claude/skills/code-audit/SKILL.md runs its seats in parallel" \
  'grep -q "parallel" .claude/skills/code-audit/SKILL.md'
# `grep -q -- "--last"` was satisfied by `--lastN`, so it pinned nothing —
# found by mutating the template and watching this assertion stay green.
check "code-audit scopes by commit count with --last <n>" \
  'grep -qF -- "--last <n>" .claude/skills/code-audit/SKILL.md'
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
