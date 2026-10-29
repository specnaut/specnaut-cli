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

trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

echo "═══ merge phase — close, remove, fold, land ═══"
# #560 — an epic merge closes N children AND the epic, and moves N+1 cards.
# The order is derived, not chosen: sweep-closed.sh reports a Done card whose
# issue is open as REOPENED, so moving the card first manufactures the exact
# state an existing tool is built to flag.
check "companion doc merge-close.md scaffolded (#560)" \
  '[ -f .claude/skills/task/phases/merge-close.md ]'
check "merge.md routes to it after a push (#560)" \
  'grep -qF "phases/merge-close.md" .claude/skills/task/phases/merge.md'
check "the epic path closes every child AND the epic (#560 AC1)" \
  'grep -qF "Children first, the epic last." .claude/skills/task/phases/merge-close.md'
# #588: one prose check here certified a file whose standalone path moved the
# card before closing. Presence of a rule is not conformance, so the order is
# also read structurally. Since spec 042 both paths share one procedure, and
# close-shipped.sh refuses to move a card over an open issue.
check "the ordering rule is stated once, and says why (#560 AC4)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/merge-close.md)";
   grep -qF "close the issue first, then move the card" <<<"$flat" &&
   grep -qF "REOPENED" <<<"$flat" &&
   grep -qF "it moves no card whose issue is not confirmed closed" <<<"$flat"'
# The close line must precede the move line, within the procedure. `!c`/`!m`
# keep the FIRST of each; a missing marker fails, so a renamed command must
# re-state its order rather than silently stop being checked.
check "the STANDALONE path closes before it moves, in that order (#588 AC4)" \
  'awk "/^## The procedure/{s=1; next} /^## /{s=0}
        s && /gh issue close <n>/ && !c {c=NR}
        s && /close-shipped\.sh <n>/ && !m {m=NR}
        END{exit !(c && m && c < m)}" \
     .claude/skills/task/phases/merge-close.md'
# The epic enters the same procedure at step 1: enumerate, close, then move.
check "the EPIC path closes before it moves, in that order (#588 AC4)" \
  'awk "/^## The procedure/{s=1; next} /^## /{s=0}
        s && /Epic: the children are/ && !e {e=NR}
        s && /gh issue close <n>/ && !c {c=NR}
        s && /close-shipped\.sh <n>/ && !m {m=NR}
        END{exit !(e && c && m && e < c && c < m)}" \
     .claude/skills/task/phases/merge-close.md &&
   grep -qF "Children first, the epic last." .claude/skills/task/phases/merge-close.md'
# --backlog local installs the local copy, where the move IS the close. A forge
# copy here (it calls cascade-check.sh) is the installer picking the wrong one.
check "the installed close-shipped.sh is the local copy: the move is the close (spec 042)" \
  'grep -qF "the local copy" .specnaut/scripts/backlog/close-shipped.sh &&
   grep -qF "bash \"\$here/move.sh\" \"\$n\" Done" .specnaut/scripts/backlog/close-shipped.sh &&
   ! grep -qF "cascade-check.sh" .specnaut/scripts/backlog/close-shipped.sh'
check "cascade-check still gates the parent close (#560 AC2)" \
  'grep -qF "cascade-check.sh <n>" .claude/skills/task/phases/merge-close.md &&
   grep -qF "only exit 0 authorises the close" .claude/skills/task/phases/merge-close.md'
check "children are enumerated from the branch, not from memory (#560)" \
  'grep -qF "did not ship" .claude/skills/task/phases/merge-close.md &&
   grep -qF "bash .specnaut/scripts/bash/epic-status.sh" .claude/skills/task/phases/merge-close.md'
check "the report names every item, not a count (#560 AC5)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/merge-close.md)";
   grep -qF "Not a count: one line per issue closed" <<<"$flat" &&
   grep -qF "could not be settled and why" <<<"$flat"'
check "nothing closes when the merge did not push (#560 AC6)" \
  'grep -qF "only when the push" .claude/skills/task/phases/merge-close.md'

# #587 — a shipped feature's spec directory is removed at the merge. The code
# is the authority afterwards; the plan is already in git history, which is
# what makes the removal lossless. Each check below guards a condition whose
# loss turns a cleanup into data destruction or into a silent no-op. Spec 042
# moved the conditions into remove-spec.sh, so they are asserted there.
check "the standalone path removes the spec directory (#587 AC1)" \
  'grep -qF "Remove the spec directory" .claude/skills/task/phases/merge-close.md &&
   grep -qF "bash .specnaut/scripts/bash/remove-spec.sh" .claude/skills/task/phases/merge-close.md &&
   grep -qF "\"feature_directory\"" .specnaut/scripts/bash/remove-spec.sh'
# The load-bearing one. Without the history check the step deletes the only
# copy of a plan that never got its plan-time commit.
check "the removal refuses a directory git has never seen (#587 AC2)" \
  'grep -qF "git log --all --oneline -1 -- \"\$dir\"" .specnaut/scripts/bash/remove-spec.sh &&
   grep -qF "would destroy the only copy" .specnaut/scripts/bash/remove-spec.sh'
# The push is the one authorisation: the close rides it, and the removal rides
# the close — never one without the other.
check "one authorisation covers the close AND the removal, with no second prompt (#587 AC3)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/merge-close.md)";
   grep -qF "The push was the authorisation" <<<"$flat" &&
   grep -qF "Never run it before the close succeeded" <<<"$flat" &&
   grep -qF "authorised a removal then" <<<"$flat"'
check "the removal is its own commit, not folded into the merge (#587 AC4)" \
  'grep -qF "remove the spec directory for the shipped feature" .specnaut/scripts/bash/remove-spec.sh'
# An epic is one tree: a per-child removal hits one directory N times. The
# script takes exactly one argument, the landed branch, never a child id.
check "an epic removes one directory once, never per child (#587 AC5)" \
  'grep -qF "once, for the whole epic too" .claude/skills/task/phases/merge-close.md &&
   grep -qF "usage: remove-spec.sh <landed-branch>\"" .specnaut/scripts/bash/remove-spec.sh &&
   grep -qF "[ \$# -ne 1 ]" .specnaut/scripts/bash/remove-spec.sh'
# feature.json NAMES the removed directory, and common.sh never checks that
# the name still resolves: get_feature_paths returns the deleted path with
# exit 0 and no warning, its branch-contradiction guard skipped off a feature
# branch. Measured, not reasoned. The removal must take it along.
check "the removal takes feature.json with it, not just the directory (#587)" \
  'grep -qF "git rm -r --quiet -- \"\$dir\" .specnaut/feature.json" \
     .specnaut/scripts/bash/remove-spec.sh'
check "a skip is reported, never silent (#587 AC6)" \
  'grep -qF "report it, never silently" .claude/skills/task/phases/merge-close.md &&
   grep -qF "remove-spec: skipped — " .specnaut/scripts/bash/remove-spec.sh'
# orphan-specs.md walks the same directories and must NOT delete. Its read-only
# line survives verbatim; what it gained is why it does not contradict the
# phase that does delete — without that, the next reader reads one of the two
# as a bug.
check "orphan detection stays read-only, and says why that is not a contradiction (#587 AC8)" \
  'flat="$(tr "\n" " " < .claude/skills/task/phases/orphan-specs.md)";
   grep -qF "never delete or modify spec files" <<<"$flat" &&
   grep -qF "removed — by \`phases/merge-close.md\`" <<<"$flat"'
check "the false retention claim is gone from orphan-specs.md (#587 AC7)" \
  '! grep -qF "historical records" .claude/skills/task/phases/orphan-specs.md'
check "the legacy spec.md rule survives the reword (#587 AC9)" \
  'grep -qF "Has \`spec.md\` but no \`plan.md\`" .claude/skills/task/phases/orphan-specs.md'

# #559 — a fixup folds into ITS OWN child, and the fold is verified here
# rather than borrowed from squash-by-scope, which governs the other path and
# since #558 lives in another file entirely. AC 7 is the load-bearing one.
check "companion doc epic-fixups.md scaffolded (#559)" \
  '[ -f .claude/skills/task/phases/epic-fixups.md ]'
check "merge.md folds fixups before merging an epic (#559)" \
  'grep -qF "phases/epic-fixups.md" .claude/skills/task/phases/merge.md'
check "a fixup is written against its own child, not matched afterwards (#559)" \
  'grep -qF "git commit --fixup=" .claude/skills/task/phases/epic-fixups.md'
# Spec 042 moved the fold's checks into fold-fixups.sh. The tree is compared
# with the one recorded BEFORE the fold (PRE), never with the result itself.
check "the fold verifies the tree did not move (#559 AC5)" \
  'grep -qF "the tree moved during the fold" .specnaut/scripts/bash/fold-fixups.sh &&
   grep -qF "\$pre^{tree}" .specnaut/scripts/bash/fold-fixups.sh'
# Prose wraps. A phrase that reads as one sentence is several lines in the
# file, and a line-based grep misses it — three assertions today have failed
# for exactly that, on this ticket and on #557 and #561 before it. Newlines
# are flattened first, through a here-string rather than a pipe: `grep -q`
# exits early, and under `pipefail` that SIGPIPEs the producer and decides
# the assertion on the writer's death instead of the content (#550).
# The doc names its own checks; a reference to merge-squash here would be the
# inheritance AC 7 rules out.
check "and it says so for THIS procedure, not by inheritance (#559 AC7)" \
  'grep -qF "runs three checks" <<<"$(tr "\n" " " < .claude/skills/task/phases/epic-fixups.md)" &&
   ! grep -qF "merge-squash" .claude/skills/task/phases/epic-fixups.md'
check "the fold verifies the worktree is empty afterwards (#559 AC6)" \
  'grep -qF "the worktree is not clean after the fold" .specnaut/scripts/bash/fold-fixups.sh'
check "a surviving fixup! is a finding, not something to fold by eye (#559)" \
  'grep -qF "a fixup! survived" .specnaut/scripts/bash/fold-fixups.sh &&
   grep -qF "attribute it by sha" .claude/skills/task/phases/epic-fixups.md'
# The fold no longer diffs — it compares tree ids — so the hazard is held
# absent: a `diff` reintroduced here brings it back.
check "the fold does not read diff exit 2 as \"they differ\" (#559)" \
  '! grep -qw "diff" .specnaut/scripts/bash/fold-fixups.sh &&
   grep -qF "HEAD^{tree}" .specnaut/scripts/bash/fold-fixups.sh'

# Spec 042 — the merge mechanics live in five scripts. Each doc calls its
# script; the absence halves keep a second, inline spelling of it out.
for s in land-feature fold-fixups epic-status remove-spec; do
  check "$s.sh scaffolded + executable (spec 042)" \
    "[ -x .specnaut/scripts/bash/$s.sh ]"
done
check "close-shipped.sh scaffolded + executable (spec 042)" \
  '[ -x .specnaut/scripts/backlog/close-shipped.sh ]'
check "merge.md lands through land-feature.sh, not inline git (spec 042)" \
  'grep -qF "bash .specnaut/scripts/bash/land-feature.sh" .claude/skills/task/phases/merge.md &&
   ! grep -qE "git merge --ff-only|git branch -d" .claude/skills/task/phases/merge.md'
check "epic-fixups.md folds through fold-fixups.sh, not an inline rebase (spec 042)" \
  'grep -qF "bash .specnaut/scripts/bash/fold-fixups.sh" .claude/skills/task/phases/epic-fixups.md &&
   ! grep -qF "GIT_SEQUENCE_EDITOR" .claude/skills/task/phases/epic-fixups.md'
check "merge-close.md settles through close-shipped.sh and remove-spec.sh (spec 042)" \
  'P=.claude/skills/task/phases;
   grep -qF "bash .specnaut/scripts/backlog/close-shipped.sh" "$P/merge-close.md" &&
   grep -qF "bash .specnaut/scripts/bash/remove-spec.sh" "$P/merge-close.md" &&
   ! grep -qE "git rm -r|move\.sh <|sweep-closed\.sh --passes" "$P/merge-close.md"'
check "epic-loop.md resumes from epic-status.sh (spec 042)" \
  'grep -qF "bash .specnaut/scripts/bash/epic-status.sh" .claude/skills/task/phases/epic-loop.md'
# A step number goes stale when its target is renumbered, as spec 042 did. A
# cited step must be the one that does the thing; citing none is fine.
check "a phase that cites another phase's step names the step that does it (spec 042)" \
  'P=.claude/skills/task/phases;
   oref=$(grep -oE "merge-close\.md\` step [0-9]+" "$P/orphan-specs.md" | grep -oE "[0-9]+$" || true);
   mref=$(grep -oE "merge\.md\` at its step [0-9]+" "$P/merge-close.md" | grep -oE "[0-9]+$" || true);
   { [ -z "$oref" ] || grep -qE "^$oref\. \*\*Remove the spec directory" "$P/merge-close.md"; } &&
   { [ -z "$mref" ] || grep -qE "^$mref\. \*\*Close what shipped" "$P/merge.md"; }'

# #557 — merge.md routes by history rule, and the epic path does not squash.
# Each of these is a sentence a later edit would plausibly "simplify" away.
check "merge.md asks the BRANCH which rule applies, not the board (#557)" \
  'grep -qF "Epic: #" .claude/skills/task/phases/merge.md &&
   grep -qF "log <base>..HEAD" .claude/skills/task/phases/merge.md'
check "merge.md says an epic branch is NOT squashed (#557)" \
  'grep -qF "an epic**: do **not** squash" .claude/skills/task/phases/merge.md'
# Spec 042 cut the sentence from merge.md; the rule is the loop's, and lives
# in epic-loop.md: one merge for the epic, one checkpoint at its last child.
check "one merge decision for the whole epic, not one per child (#557)" \
  'grep -qF "one commit per child, one merge" .claude/skills/task/phases/epic-loop.md &&
   grep -qF "The last child'"'"'s review is the one checkpoint" .claude/skills/task/phases/epic-loop.md'
check "merge.md says a failing full tier is repaired, not escalated (#557)" \
  'grep -qF "then the tier re-run — never escalated" .claude/skills/task/phases/merge.md'
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
check "an epic reaches the fast tier: implement -> epic-loop -> run-gate (#555)" \
  'P=.claude/skills/task/phases;
   grep -qF "phases/epic-loop.md" "$P/implement.md" &&
   grep -qF "run-gate.sh fast" "$P/epic-loop.md" &&
   grep -qF "phases/quality-gates.md" "$P/epic-loop.md"'
check "merge.md runs the full tier once, never per child (#555)" \
  'grep -qF "Run the full gate tier once" .claude/skills/task/phases/merge.md &&
   grep -qF "run-gate.sh full" .claude/skills/task/phases/merge.md'
check "quality-gates.md states the full tier runs once, before the merge (#555)" \
  'grep -qF "never per child" .claude/skills/task/phases/quality-gates.md'
check "an undeclared tier degrades rather than failing (#555)" \
  'grep -qF "is not a failure" .claude/skills/task/phases/quality-gates.md'
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
