#!/usr/bin/env bash
# Check the impact-aware gates on a freshly-init'd Claude project (#725):
# run-gate.sh behind --base, gate-impact.sh and its modules scaffolded, the
# merge phase's instructions for the full tier, and a declaration with an
# invented adapter run end to end. Split out of smoke-gates.sh, which was over
# its size target.
#
# Usage: smoke-impact-gates.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-impact-gates.sh <name>}"
. "$(dirname "$0")/_common.sh"
# A repository of its own: the gates list files through git.
smoke_scaffold "$NAME" repo
# The merge.md copies the anchoring check must refuse: inside .git/, so they are
# outside the work tree the gates read and wiped with the scenario.
FIXTURE=.git/smoke-merge-ask.md FIXTURE_FULL=.git/smoke-merge-full.md
smoke_commit "scaffold"
BASE="$(git rev-parse HEAD)"

echo "═══ #725  impact-aware gates: run-gate.sh behind a flag, on a real scaffold ═══"
GATE=.specnaut/scripts/bash/run-gate.sh
for script in gate-impact.sh _gate_candidate.sh _gate_impact_read.sh _gate_impact_adapter.sh _gate_impact_graph.sh _gate_evidence.sh _gate_selected.sh _gate_sandbox.sh; do
  check "$script scaffolded + executable" "[ -x .specnaut/scripts/bash/$script ]"
done
for script in gate-impact.ps1 base-branch.ps1 _gate_candidate.ps1 _gate_impact_read.ps1 _gate_impact_adapter.ps1 _gate_impact_graph.ps1 _gate_evidence.ps1 _gate_selected.ps1; do
  check "$script twin scaffolded" "[ -f .specnaut/scripts/powershell/$script ]"
done
check "the declaration is the project's: init writes no .specnaut/impact.json" '[ ! -e .specnaut/impact.json ]'
# Instruction only: an untrusted review runs the gate as review-untrusted.md writes it.
check "review-untrusted.md runs the gate in a sandbox, review-gates.md says so" \
  'grep -qF -- "--evidence \"\$LOGS\" --sandbox" .claude/skills/task/phases/review-untrusted.md &&
   grep -qF "every command below runs in a sandbox" .claude/skills/task/phases/review-gates.md'
check "quality-gates.md documents the declaration and its exits" \
  'grep -qF ".specnaut/impact.json" .claude/skills/task/phases/quality-gates.md &&
   grep -qF "SPECNAUT_AFFECTED_OWNERS" .claude/skills/task/phases/quality-gates.md'
# Instruction only: what the merge passes is what the agent runs; no script reads merge.md.
check "merge.md passes the merge-base, and says what 3 and 4 mean there" \
  'grep -qF "run-gate.sh full --base \"\$(git merge-base HEAD <base>)\"" .claude/skills/task/phases/merge.md &&
   grep -qF "say which commands left it" .claude/skills/task/phases/merge.md &&
   grep -qF "With \`removed: none\`, everything was omitted: run it bare" .claude/skills/task/phases/merge.md &&
   grep -qF "neither is ever reported as the full gate" .claude/skills/task/phases/merge.md'
# Instruction only (cli#769): the epic exit runs the same full tier as the standalone
# one, and that tier's first step is the gates.yml check with its one-time ask.
MERGE=.claude/skills/task/phases/merge.md
M=$(tr '\n' ' ' <"$MERGE" | tr -s ' ')
has() { case $M in *"$1"*) ;; *) return 1 ;; esac; }
# shellcheck disable=SC2034 # read by the check below, through eval
TIER='run the full tier (**The full tier**, below)' EPIC='**Exit 0 — an epic**: do **not** squash: '
check "merge.md takes the epic path, like the standalone one, through the full tier" \
  'has "$EPIC$TIER" && has "**Exit 14 — standalone**: $TIER"'
FULL='**The full tier** — exits 0 and 14 only, before the landing. Run the full gate tier once, but first: if '
ASK='ask once: *"This branch changes `.specnaut/gates.yml`.'
# The gates.yml check and its ask, read inside the full-tier block of merge.md
# at $1 and nowhere else: the block runs from its bold lead-in to the next line
# not indented under it, the next numbered step (cli#777).
asks_in_full_tier() {
  local t
  t=$(awk '/^ +\*\*The full tier\*\* /{on=1} on && /^[^ ]/{exit} on' "$1" | tr '\n' ' ' | tr -s ' ')
  case $t in *"$FULL\`git diff --quiet \"\$(git merge-base HEAD <base>)\" HEAD -- .specnaut/gates.yml\`"*) ;; *) return 1 ;; esac
  case $t in *"$ASK"*) ;; *) return 1 ;; esac
}
check "merge.md's full-tier block holds the gates.yml check and its one-time ask" \
  'asks_in_full_tier "$MERGE"'
# The same text with the ask moved past the block: the whole file still holds it.
sed 's/ask once: \*"This branch changes/ask: *"This branch changes/' "$MERGE" >"$FIXTURE"
printf '\n%s Yes runs the branch list."*\n' "$ASK" >>"$FIXTURE"
check "a merge.md whose ask sits outside the full-tier block fails that check" \
  'grep -qF "$ASK" "$FIXTURE" && ! asks_in_full_tier "$FIXTURE"'
# The same text with the gates.yml check moved past the block (cli#786).
sed 's/first: if `git diff --quiet/first: if `git diff --stat/' "$MERGE" >"$FIXTURE_FULL"
printf '\n%s`git diff --quiet "$(git merge-base HEAD <base>)" HEAD -- .specnaut/gates.yml` exits.\n' \
  "$FULL" >>"$FIXTURE_FULL"
check "a merge.md whose gates.yml check sits outside the full-tier block fails that check" \
  'grep -qF "$FULL\`git diff --quiet" "$FIXTURE_FULL" && ! asks_in_full_tier "$FIXTURE_FULL"'
out=$(bash "$GATE" fast --base "$BASE" 2>&1; echo "ec=$?")
bare=$(bash "$GATE" fast 2>&1; echo "ec=$?")
[ "$out" = "$bare" ] && pass "with no declaration the flag is the bare run, to the byte" \
  || fail "a flag with no declaration changed the run" "$out"

# An invented adapter: two owners, read from a file in the tree it describes.
mkdir -p apps/one apps/two tools
echo one >apps/one/a.txt
echo two >apps/two/a.txt
cat >tools/graph.sh <<'ADAPTER'
#!/usr/bin/env bash
printf '{"schema":1,"commit":"%s","complete":true,"owners":[{"id":"one","roots":["apps/one/"],"depends_on":[]},{"id":"two","roots":["apps/two/"],"depends_on":["one"]}]}\n' "$SPECNAUT_IMPACT_COMMIT" >"$SPECNAUT_IMPACT_OUT"
ADAPTER
cat >.specnaut/impact.json <<'DECLARATION'
{ "schema": 1, "adapter": { "command": "bash tools/graph.sh", "files": ["tools/graph.sh"] },
  "scoped_tiers": ["fast"], "full_on": [], "inert": [".specnaut/specs/"],
  "checks": [{ "gate": "echo whole-suite", "scoped": "echo scoped-to \"$SPECNAUT_AFFECTED_OWNERS\"" }] }
DECLARATION
printf 'fast_gate:\n  - echo whole-suite\nfull_gate:\n  - echo whole-suite\n' >.specnaut/gates.yml
git config init.defaultBranch "$(git symbolic-ref --short HEAD)"
smoke_commit "opt in"
START="$(git rev-parse HEAD)"
git switch -q -c feature

echo changed >apps/two/a.txt
smoke_commit "change the dependent"
out=$(bash "$GATE" fast --base "$START" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=0" && echo "$out" | grep -qx "scope: owners two" && echo "$out" | grep -qx "scoped-to two"; then
  pass "a change runs its owner's scoped command, with the owners in the variable"
else
  fail "the scoped command did not run for its owner" "$out"
fi
echo changed >apps/one/a.txt
smoke_commit "change what it depends on"
out=$(bash "$GATE" fast --base "$START" 2>&1; echo "ec=$?")
echo "$out" | grep -qx "scoped-to one two" && pass "a change reaches its reverse dependents" \
  || fail "the closure did not reach the dependent" "$out"
out=$(bash "$GATE" full --base "$START" 2>&1; echo "ec=$?")
if echo "$out" | grep -qx "whole-suite" && echo "$out" | grep -qx "fallback: tier-not-scoped: full"; then
  pass "a tier outside scoped_tiers runs whole, and names why"
else
  fail "an unscoped tier did not run whole" "$out"
fi
echo stray >stray.txt
smoke_commit "a path no owner holds"
out=$(bash "$GATE" fast --base "$START" 2>&1; echo "ec=$?")
if echo "$out" | grep -qx "whole-suite" && echo "$out" | grep -qx "fallback: unowned: stray.txt"; then
  pass "an unowned path widens to the whole tier, and names why"
else
  fail "an unowned path did not widen" "$out"
fi
out=$(bash "$GATE" fast --base "$(git rev-parse HEAD)" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=4" && echo "$out" | grep -qx "scope: none"; then
  pass "every command omitted is exit 4, never a pass"
else
  fail "a run that checked nothing did not exit 4" "$out"
fi
printf 'fast_gate:\nfull_gate:\n  - echo whole-suite\n' >.specnaut/gates.yml
smoke_commit "empty the tier"
out=$(bash "$GATE" fast --base "$START" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=4" && echo "$out" | grep -qx "removed: echo whole-suite"; then
  pass "a tier emptied on the branch is exit 4, and names what left it"
else
  fail "an emptied tier did not exit 4 naming the command" "$out"
fi
echo dirt >dirt.txt
out=$(bash "$GATE" fast --base "$START" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=3" && echo "$out" | grep -q "candidate: refused (dirty-tree"; then
  pass "a dirty tree is refused, exit 3"
else
  fail "a dirty tree was not refused" "$out"
fi
rm dirt.txt
[ "$(git worktree list | wc -l | tr -d ' ')" = 1 ] && pass "no temporary worktree stayed behind" \
  || fail "a temporary worktree stayed behind" "$(git worktree list)"

finish "IMPACT GATES"
