#!/usr/bin/env bash
# Check the merge phase as scaffolded into a fresh Claude project on the local
# backend: merge.md, merge-close.md, epic-fixups.md and the gate docs, and the
# scripts they call (land-feature, fold-fixups, epic-status, remove-spec,
# close-shipped). Moved out of smoke-features.sh by spec 042, which had grown
# past its size ceiling.
#
# Usage: smoke-merge.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-merge.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# One trap for both trees: a second `trap … EXIT` would replace this one.
# "$NAME-repos" is _merge_fixtures.sh's scratch-repo tree, made once it is
# sourced below.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME-repos" >/dev/null 2>&1; bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

# --- The merge scripts, run (cli#711) ------------------------------------
# A script that exists is asserted by running it, never by how its source is
# spelled: a refactor that keeps the behaviour keeps the check green, and one
# that breaks it fails here even when the text survived. Each scenario is a
# subshell on a scratch clone of a bare origin, holding this scaffold's
# scripts, with no global or system git config. A check that still greps a
# phase doc guards instruction no script runs; the line above it says so, and
# where a test already runs the script's half, it names that test (cli#716).
SCAFFOLD=$PWD
. "$SMOKE_DIR/_merge_fixtures.sh"

echo "═══ merge phase — close, remove, fold, land ═══"
# #560 — an epic merge closes N children AND the epic, and moves N+1 cards.
# Close first: a Done card over an open issue is REOPENED drift. close-shipped.sh
# moves no such card (exit 20) — close_shipped_test, smoke-backlog-github.sh;
# cascade-check.sh holds an epic's close on its children —
# cascade_check_fails_open_test. On --backlog local the move IS the close.
check "companion doc merge-close.md scaffolded (#560)" \
  '[ -f .claude/skills/task/phases/merge-close.md ]'
# Instruction only: which doc the agent loads after a push — no script reads it.
check "merge.md routes to it after a push (#560)" \
  'grep -qF "phases/merge-close.md" .claude/skills/task/phases/merge.md'
# The report is built from close-shipped.sh's lines: one per item, and no count.
check "close-shipped.sh moves each number once, in the order given, and reports one line per item (#560 AC1, AC5)" \
  'probe_close_shipped "" "" 51 52 50 && close_shipped_was 0 "$(printf "move 51 Done\nmove 52 Done\nmove 50 Done")" &&
   [ "$CS_OUT" = "$(printf "DONE #51\nDONE #52\nDONE #50")" ]'
# Instruction only: the order the agent runs `gh issue close` and close-shipped.sh
# in, on both paths. `!e`/`!c`/`!m` keep the FIRST of each; a missing marker
# fails, so a renamed command must re-state its order (#588).
check "the procedure enumerates, closes, then moves — standalone and epic alike (#588 AC4)" \
  'awk "/^## The procedure/{s=1; next} /^## /{s=0}
        s && /Epic: the children are/ && !e {e=NR}
        s && /gh issue close <n>/ && !c {c=NR}
        s && /close-shipped\.sh <n>/ && !m {m=NR}
        END{exit !(e && c && m && e < c && c < m)}" \
     .claude/skills/task/phases/merge-close.md'
# --backlog local installs the local copy, where the move IS the close. A forge
# copy here (it calls cascade-check.sh) is the installer picking the wrong one.
check "the installed close-shipped.sh is the local copy: the move is the close, no forge asked (spec 042)" \
  'probe_close_shipped "" "" 5 6 && close_shipped_was 0 "$(printf "move 5 Done\nmove 6 Done")" "DONE #5" "DONE #6"'
# Instruction only: the agent asks cascade-check.sh before a forge close; its
# verdicts are cascade_check_fails_open_test's, and on local the step is skipped.
check "cascade-check still gates the parent close (#560 AC2)" \
  'grep -qF "cascade-check.sh <n>" .claude/skills/task/phases/merge-close.md &&
   grep -qF "only exit 0 authorises the close" .claude/skills/task/phases/merge-close.md'
# The CHILD lines are the branch's commits, read back by epic-status.sh after
# the base moved on — and past a tag named like the base.
check "children are enumerated from the branch, not from memory (#560)" \
  '(m_repo && git tag main HEAD && git switch -q -c epic && m_commit a "feat(T01): a (#51)" "Epic: #50" &&
    m_commit b "feat(T02): b (#52)" "Epic: #50" && git switch -q main && m_commit l "chore: base moves" && git tag -f main HEAD~1 >/dev/null &&
    git switch -q epic && out=$(bash .specnaut/scripts/bash/epic-status.sh 2>/dev/null) &&
    [ "$(cut -d" " -f1-3 <<<"$out" | tr "\n" ,)" = "CHILD T01 #51,CHILD T02 #52,EPIC #50," ])'
# #677 — epic-status.sh reads <base>..HEAD, empty once land-feature.sh has
# fast-forwarded the base (14; 16 when feature.json names an epic — both
# epic_status_test's). Instruction only: the order the agent calls the two in.
check "the epic is read before the landing, and the close never re-reads it (#677)" \
  'P=.claude/skills/task/phases;
   r=$(grep -nF "bash .specnaut/scripts/bash/epic-status.sh" "$P/merge.md" | head -1 | cut -d: -f1);
   l=$(grep -nF "bash .specnaut/scripts/bash/land-feature.sh" "$P/merge.md" | head -1 | cut -d: -f1);
   [ -n "$r" ] && [ -n "$l" ] && [ "$r" -lt "$l" ] &&
   ! grep -qF "bash .specnaut/scripts/bash/epic-status.sh" "$P/merge-close.md"'
# Instruction only: merge-close.md is loaded only after a push — no script routes it.
check "nothing closes when the merge did not push (#560 AC6)" \
  'grep -qF "only when the push" .claude/skills/task/phases/merge-close.md'

# #587 — a shipped feature's spec directory is removed at the merge. The code
# is the authority afterwards; the plan is already in git history, which is
# what makes the removal lossless. Each check below guards a condition whose
# loss turns a cleanup into data destruction or into a silent no-op. Spec 042
# moved the conditions into remove-spec.sh, so they are asserted there.
check "the standalone path removes the spec directory (#587 AC1)" \
  '(m_shipped && bash .specnaut/scripts/bash/remove-spec.sh 007-x >/dev/null 2>&1 &&
    [ ! -e .specnaut/specs/007-x ] && [ ! -e .specnaut/feature.json ])'
# The load-bearing one. Without the history check the step deletes the only
# copy of a plan that never got its plan-time commit.
check "the removal refuses a directory git has never seen (#587 AC2)" \
  '(m_shipped .specnaut/specs/009-new && mkdir -p .specnaut/specs/009-new && echo mine >.specnaut/specs/009-new/plan.md &&
    out=$(bash .specnaut/scripts/bash/remove-spec.sh 009-new 2>&1); rc=$?;
    [ "$rc" = 22 ] && grep -qF "the only copy" <<<"$out" && [ "$(cat .specnaut/specs/009-new/plan.md)" = mine ])'
# The push is the one authorisation: the close rides it, and the removal rides
# the close. Prose wraps, so newlines are flattened first — through a
# here-string, never a pipe: `grep -q` exits early, and under `pipefail` that
# decides on the writer's SIGPIPE instead of the content (#550).
# Instruction only: when the agent may run the removal, and that it asks nobody.
check "one authorisation covers the close AND the removal, with no second prompt (#587 AC3)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/merge-close.md)";
   grep -qF "The push was the authorisation" <<<"$flat" &&
   grep -qF "Never run it before the close succeeded" <<<"$flat"'
check "the removal is its own commit, not folded into the merge (#587 AC4)" \
  '(m_shipped && head=$(git rev-parse HEAD) && bash .specnaut/scripts/bash/remove-spec.sh 007-x >/dev/null 2>&1 &&
    [ "$(git rev-parse HEAD~1)" = "$head" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] &&
    [ "$(git log -1 --format=%s)" = "chore(7): remove the spec directory for the shipped feature" ])'
# An epic is one tree: a per-child removal hits one directory N times. The
# script takes exactly one argument, the landed branch, never a child id.
check "an epic removes one directory once: the script takes one branch, never a child list (#587 AC5)" \
  '(m_shipped && bash .specnaut/scripts/bash/remove-spec.sh 007-x 008-y >/dev/null 2>&1; [ $? = 2 ] &&
    [ -f .specnaut/specs/007-x/plan.md ])'
# feature.json NAMES the removed directory, and common.sh never checks that
# the name still resolves: get_feature_paths returns the deleted path with
# exit 0 and no warning, its branch-contradiction guard skipped off a feature
# branch. Measured, not reasoned. The removal must take it along.
check "the removal takes feature.json with it, not just the directory (#587)" \
  '(m_shipped && bash .specnaut/scripts/bash/remove-spec.sh 007-x >/dev/null 2>&1 &&
    git show --name-status --format= HEAD | grep -qx "D	.specnaut/feature.json")'
check "a skip is reported, never silent: exit 22 and the reason (#587 AC6)" \
  '(m_shipped && git switch -q -c elsewhere &&
    out=$(bash .specnaut/scripts/bash/remove-spec.sh 007-x 2>&1); [ $? = 22 ] &&
    grep -qF "remove-spec: skipped — HEAD is not main" <<<"$out")'
# orphan-specs.md walks the same directories and must NOT delete, and says why
# that does not contradict the phase that does — or one of the two reads as a bug.
# Instruction only: orphan detection is an agent procedure; no script walks the specs.
check "orphan detection stays read-only, and says why that is not a contradiction (#587 AC8)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/orphan-specs.md)";
   grep -qF "never delete or modify spec files" <<<"$flat" &&
   grep -qF "removed — by \`phases/merge-close.md\`" <<<"$flat"'
# Instruction only: a claim the agent would act on, in the same procedure.
check "the false retention claim is gone from orphan-specs.md (#587 AC7)" \
  '! grep -qF "historical records" .claude/skills/task/phases/orphan-specs.md'
# Instruction only: a rule of the same procedure, kept through the reword.
check "the legacy spec.md rule survives the reword (#587 AC9)" \
  'grep -qF "Has \`spec.md\` but no \`plan.md\`" .claude/skills/task/phases/orphan-specs.md'

# #559 — a fixup folds into ITS OWN child, and the fold is verified here
# rather than borrowed from squash-by-scope, which governs the other path and
# since #558 lives in another file entirely. AC 7 is the load-bearing one.
check "companion doc epic-fixups.md scaffolded (#559)" \
  '[ -f .claude/skills/task/phases/epic-fixups.md ]'
# Instruction only: which doc the agent loads on the epic path.
check "merge.md folds fixups before merging an epic (#559)" \
  'grep -qF "phases/epic-fixups.md" .claude/skills/task/phases/merge.md'
# Instruction only: how the agent writes a fixup; the next check folds one written so.
check "a fixup is written against its own child, not matched afterwards (#559)" \
  'grep -qF "git commit --fixup=" .claude/skills/task/phases/epic-fixups.md'
# Spec 042 moved the fold's checks into fold-fixups.sh. The tree is compared
# with the one recorded BEFORE the fold (PRE), never with the result itself.
check "the fold folds the fixup into its own child and keeps the tree (#559 AC5)" \
  '(m_epic && tree=$(git rev-parse "HEAD^{tree}") && bash .specnaut/scripts/bash/fold-fixups.sh >/dev/null 2>&1 &&
    [ "$(git rev-parse "HEAD^{tree}")" = "$tree" ] && [ "$(git show HEAD~1:a)" = fixed ] &&
    [ "$(git log --format=%s refs/heads/main..HEAD | grep -c "fixup!")" = 0 ])'
# The fold's checks are its own: fold-fixups.sh exits 10, 11 and 12 (below,
# and fold_fixups_test). Instruction only: the doc must not send the epic to
# merge-squash.md, whose rules govern the other path (the inheritance AC 7 rules out).
check "and it says so for THIS procedure, not by inheritance (#559 AC7)" \
  '! grep -qF "merge-squash" .claude/skills/task/phases/epic-fixups.md'
check "the fold refuses a dirty worktree (#559 AC6)" \
  '(m_epic && echo stray >stray.txt && bash .specnaut/scripts/bash/fold-fixups.sh >/dev/null 2>&1; [ $? = 11 ])'
check "a surviving fixup! is a finding named by its sha, not something to fold by eye (#559)" \
  '(m_epic && m_commit c "fixup! no such child" && out=$(bash .specnaut/scripts/bash/fold-fixups.sh 2>&1); [ $? = 12 ] &&
    sha=$(sed -n "s/^FIXUP //p" <<<"$out") && [ "$(git log -1 --format=%s "$sha")" = "fixup! no such child" ])'
# The fold compares tree ids, so a `diff` exit 2 cannot pass for "they differ":
# --verify against the PRE a stopped fold recorded is the path that reads them.
check "the fold verifies by tree id, and --verify takes only the PRE it recorded (#559)" \
  '(m_epic && bash .specnaut/scripts/bash/fold-fixups.sh --verify "$(git rev-parse HEAD)" >/dev/null 2>&1; [ $? = 2 ])'

# Spec 042 — the merge mechanics live in five scripts. Each doc calls its
# script; the absence halves keep a second, inline spelling of it out.
for s in land-feature fold-fixups epic-status remove-spec; do
  check "$s.sh scaffolded + executable (spec 042)" \
    "[ -x .specnaut/scripts/bash/$s.sh ]"
done
check "close-shipped.sh scaffolded + executable (spec 042)" \
  '[ -x .specnaut/scripts/backlog/close-shipped.sh ]'
# Spec 048 — the landing scripts hold `merge: manual` themselves: merge-hold.sh
# asks the hooks' reader, merge-approved.sh, for this session's `merge` stamp.
# Run on a copy of the scaffold set to manual, its stamps kept in the tree.
HOLD="$DIR/hold-probe"
mkdir -p "$HOLD" && cp -R .specnaut "$HOLD/" && echo "merge: manual" >"$HOLD/.specnaut/workflow.yml"
hold() { (cd "$HOLD" && XDG_STATE_HOME="$HOLD/state" CLAUDE_CODE_SESSION_ID=s1 bash .specnaut/scripts/bash/merge-hold.sh); }
check "merge-hold.sh scaffolded + executable; outside a hooked session it lets the landing run (spec 048)" \
  '[ -x .specnaut/scripts/bash/merge-hold.sh ] && [ -x .specnaut/hooks/merge-approved.sh ] &&
   [ "$(env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID bash "$HOLD/.specnaut/scripts/bash/merge-hold.sh")" = "merge-hold: run" ]'
check "under manual, a session the user did not approve is held: exit 13, and the line names merge (spec 048)" \
  'err=$(hold 2>&1 >/dev/null); [ $? = 13 ] && grep -qF "reply \`merge\`" <<<"$err"'
check "the user's merge, stamped by approve-on-prompt.sh, releases it (spec 048)" \
  'jq -cn --arg cwd "$HOLD" "{session_id: \"s1\", cwd: \$cwd, permission_mode: \"default\", hook_event_name: \"UserPromptSubmit\", prompt: \"merge\"}" |
     (cd "$HOLD" && XDG_STATE_HOME="$HOLD/state" bash .specnaut/hooks/approve-on-prompt.sh claude) &&
   [ "$(hold 2>/dev/null)" = "merge-hold: run" ]'
# Instruction only: which script the doc tells the agent to land with, and no inline copy.
check "merge.md lands through land-feature.sh, not inline git (spec 042)" \
  'grep -qF "bash .specnaut/scripts/bash/land-feature.sh" .claude/skills/task/phases/merge.md &&
   ! grep -qE "git merge --ff-only|git branch -d" .claude/skills/task/phases/merge.md'
# Instruction only: which script the doc tells the agent to fold with, and no inline copy.
check "epic-fixups.md folds through fold-fixups.sh, not an inline rebase (spec 042)" \
  'grep -qF "bash .specnaut/scripts/bash/fold-fixups.sh" .claude/skills/task/phases/epic-fixups.md &&
   ! grep -qF "GIT_SEQUENCE_EDITOR" .claude/skills/task/phases/epic-fixups.md'
# Instruction only: which scripts the doc tells the agent to settle with, and no inline copy.
check "merge-close.md settles through close-shipped.sh and remove-spec.sh (spec 042)" \
  'P=.claude/skills/task/phases;
   grep -qF "bash .specnaut/scripts/backlog/close-shipped.sh" "$P/merge-close.md" &&
   grep -qF "bash .specnaut/scripts/bash/remove-spec.sh" "$P/merge-close.md" &&
   ! grep -qE "git rm -r|move\.sh <|sweep-closed\.sh --passes" "$P/merge-close.md"'
# Instruction only: which script the loop doc tells the agent to resume from.
check "epic-loop.md resumes from epic-status.sh (spec 042)" \
  'grep -qF "bash .specnaut/scripts/bash/epic-status.sh" .claude/skills/task/phases/epic-loop.md'
# A step number goes stale when its target is renumbered, as spec 042 did. A
# cited step must be the one that does the thing; citing none is fine.
# Instruction only: a cross-reference between two docs the agent reads.
check "a phase that cites another phase's step names the step that does it (spec 042)" \
  'P=.claude/skills/task/phases;
   oref=$(grep -oE "merge-close\.md\` step [0-9]+" "$P/orphan-specs.md" | grep -oE "[0-9]+$" || true);
   mref=$(grep -oE "merge\.md\` at its step [0-9]+" "$P/merge-close.md" | grep -oE "[0-9]+$" || true);
   { [ -z "$oref" ] || grep -qE "^$oref\. \*\*Remove the spec directory" "$P/merge-close.md"; } &&
   { [ -z "$mref" ] || grep -qE "^$mref\. \*\*Settle the card" "$P/merge.md"; }'

# #557 — merge.md routes by history rule, and the epic path does not squash.
# The branch decides the rule: epic-status.sh is 0 on an epic branch, and 14
# on the plain branch after it, though feature.json still links the epic.
check "epic-status.sh: 0 on the epic branch, 14 on the plain branch after it (#557)" \
  '(m_repo && git switch -q -c epic && m_commit a "feat(T01): a (#51)" "Epic: #50" &&
    bash .specnaut/scripts/bash/epic-status.sh >/dev/null 2>&1 &&
    git switch -q main && git merge -q --ff-only epic && git switch -q -c 007-x && m_commit f "docs: the second half" &&
    printf "{\"feature_directory\": \".specnaut/specs/007-x\", \"linked_issue\": 50}\n" >.specnaut/feature.json &&
    { err=$(bash .specnaut/scripts/bash/epic-status.sh 2>&1 >/dev/null); [ $? = 14 ] && printf "%s" "$err" | grep -qF "not an epic branch"; })'
# Instruction only: the squash is the agent's, and so is not running it.
check "merge.md says an epic branch is NOT squashed (#557)" \
  'grep -qF "an epic**: do **not** squash" .claude/skills/task/phases/merge.md'
# Spec 042 cut the sentence from merge.md; the rule is the loop's, and lives
# in epic-loop.md: one merge for the epic, one checkpoint at its last child.
# Instruction only: when the agent stops to ask — no script sees a prompt.
check "one merge decision for the whole epic, not one per child (#557)" \
  'grep -qF "one commit per child, one merge" .claude/skills/task/phases/epic-loop.md &&
   grep -qF "The last child'"'"'s review is the one checkpoint" .claude/skills/task/phases/epic-loop.md'
# Instruction only: what the agent does with a red tier; run-gate.sh only reports it.
check "merge.md says a failing full tier is repaired, not escalated (#557)" \
  'grep -qF "then the tier re-run — never escalated" .claude/skills/task/phases/merge.md'
# Instruction only: a sentence's scope, read by the agent and by nothing else.
check "merge-squash.md no longer reads as an absolute over both paths (#557)" \
  'grep -qF "not \"either kind of branch\"" .claude/skills/task/phases/merge-squash.md'
check "companion doc quality-gates.md scaffolded (#555)" \
  '[ -f .claude/skills/task/phases/quality-gates.md ]'
check "gates.yml scaffolded with both tiers declared empty (#555)" \
  '[ -f .specnaut/gates.yml ] &&
   grep -qE "^fast_gate:" .specnaut/gates.yml &&
   grep -qE "^full_gate:" .specnaut/gates.yml'
check "workflow.yml scaffolded with merge: auto as the default" \
  '[ -f .specnaut/workflow.yml ] && grep -qE "^merge: auto$" .specnaut/workflow.yml'
check "run-gate.sh scaffolded + executable (#555)" \
  '[ -x .specnaut/scripts/bash/run-gate.sh ]'
check "merge-mode.sh, base-branch.sh, groom-rules.sh scaffolded; merge-mode reads the default as auto (spec 036)" \
  '[ -x .specnaut/scripts/bash/base-branch.sh ] && [ -x .specnaut/scripts/bash/groom-rules.sh ] &&
   [ "$(bash .specnaut/scripts/bash/merge-mode.sh 2>/dev/null)" = auto ]'
check "run-gate.ps1 twin scaffolded (#555)" \
  '[ -f .specnaut/scripts/powershell/run-gate.ps1 ]'
# Instruction only: which doc the agent reads next; no script chains them.
check "an epic reaches the fast tier: implement -> epic-loop -> run-gate (#555)" \
  'P=.claude/skills/task/phases;
   grep -qF "phases/epic-loop.md" "$P/implement.md" &&
   grep -qF "run-gate.sh fast" "$P/epic-loop.md" &&
   grep -qF "phases/quality-gates.md" "$P/epic-loop.md"'
# Instruction only: how often the agent runs a tier; run-gate.sh runs once per call.
check "merge.md runs the full tier once, never per child (#555)" \
  'grep -qF "Run the full gate tier once" .claude/skills/task/phases/merge.md &&
   grep -qF "run-gate.sh full" .claude/skills/task/phases/merge.md'
# Instruction only: the same rule, in the doc the epic loop loads.
check "quality-gates.md states the full tier runs once, before the merge (#555)" \
  'grep -qF "never per child" .claude/skills/task/phases/quality-gates.md'
check "an undeclared tier degrades rather than failing: exit 0, and it says nothing ran (#555)" \
  'out=$(bash .specnaut/scripts/bash/run-gate.sh full 2>&1) && grep -qF "full_gate in gates.yml is empty, so nothing ran" <<<"$out" &&
   out=$(bash .specnaut/scripts/bash/run-gate.sh fast 2>&1) && grep -qF "fast_gate in gates.yml is empty, so nothing ran" <<<"$out"'
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
       .claude/skills/task/phases/quality-gates.md'

finish "MERGE"
