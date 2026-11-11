#!/usr/bin/env bash
# Check the project-owned gates on a freshly-init'd Claude project (spec 038):
# init bootstraps the constitution at docs/constitution.md, the size ratchet
# reads its limits from .specnaut/size-limits.yml through _config.sh, and the
# import-boundary gate reads .specnaut/boundaries.yml. Each gate is run, not
# grepped: a skip, a violation and a clean pass each have their own exit code,
# and each is asserted. Split out of smoke-features.sh, which was over its size
# ceiling when spec 038 had to add to it.
#
# Usage: smoke-gates.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-gates.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
# A repository of its own: both gates list files through git, and sandbox/
# sits inside this checkout — without it they would read the CLI's history.
(cd "$DIR" && git init -q && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"
# Commits need an identity; a CI runner has none configured.
commit() { git add -A && git -c user.name=smoke -c user.email=smoke@example.invalid commit -qm "$1"; }
commit "scaffold"
BASE="$(git rev-parse HEAD)"

echo "═══ spec 038  the constitution is project-owned, at docs/constitution.md ═══"
check "init bootstraps docs/constitution.md" '[ -s docs/constitution.md ]'
check "and writes no .specnaut/memory/constitution.md" '[ ! -e .specnaut/memory/constitution.md ]'
check "size limits: the bootstrap constitution carries no size table (spec 038)" \
  '! grep -qi "^## Size limits" docs/constitution.md'
check "size limits: the one rule and the defaults are scaffolded (#645)" \
  'grep -q "^## Where the numbers come from" .specnaut/memory/size-limits.md && grep -q "^| file | 200 | 500 |" .specnaut/memory/size-limits.md'

echo
echo "═══ #651 + spec 038  size-ratchet.sh reads .specnaut/size-limits.yml (_config.sh) ═══"
RATCHET=.specnaut/scripts/bash/size-ratchet.sh
check "size-ratchet.sh scaffolded + executable, run by the quality gates (#651)" \
  '[ -x $RATCHET ] && grep -qF "size-ratchet.sh --since" .claude/skills/task/phases/quality-gates.md'
check "_config.sh, the one reader of the gate configs, installed beside it" \
  '[ -f .specnaut/scripts/bash/_config.sh ]'
echo "- one more principle" >>docs/constitution.md
commit "grow the constitution"
# With no config the defaults apply, and the bootstrap constitution sits well
# inside them — so a red run below is the config's doing, not the file's.
out=$(bash "$RATCHET" --since "$BASE" 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=0" && pass "the ratchet passes the grown constitution on the defaults" \
  || fail "the ratchet refused the constitution on the defaults" "$out"
printf 'constitution:\n  target: 1\n  ceiling: 2\n' >.specnaut/size-limits.yml
out=$(bash "$RATCHET" --since "$BASE" 2>&1; echo "ec=$?")
# "source: config" is printed only when _config.sh read the unit from the file.
if echo "$out" | grep -q "ec=1" && echo "$out" | grep -q "docs/constitution.md:.*source: config"; then
  pass "a lowered constitution ceiling in size-limits.yml fails the ratchet"
else
  fail "the ratchet did not apply the configured constitution ceiling" "$out"
fi
printf 'constitution:\n  target: {}\n' >.specnaut/size-limits.yml
out=$(bash "$RATCHET" --since "$BASE" 2>&1; echo "ec=$?")
echo "$out" | grep -q "ec=2" && pass "an unreadable size-limits.yml stops the ratchet (exit 2), never a pass" \
  || fail "the ratchet ran on an unreadable config" "$out"
rm .specnaut/size-limits.yml

echo
echo "═══ spec 038  boundary-check.sh holds the domain free of what it forbids ═══"
BOUNDARY=.specnaut/scripts/bash/boundary-check.sh
check "boundary-check.sh scaffolded + executable" '[ -x $BOUNDARY ]'
out=$(bash "$BOUNDARY" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=4" && echo "$out" | grep -q "skipped — no .specnaut/boundaries.yml"; then
  pass "with no boundaries.yml the gate is skipped (exit 4), not passed"
else
  fail "boundary-check.sh did not report a skip with no config" "$out"
fi
printf 'domain:\n  - src/domain\nforbid:\n  - import .*express\n' >.specnaut/boundaries.yml
mkdir -p src/domain
echo 'import express from "express";' >src/domain/order.ts
commit "a domain file that imports a framework"
out=$(bash "$BOUNDARY" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=1" && echo "$out" | grep -qF "src/domain/order.ts:1: import .*express"; then
  pass "a tracked domain file matching a forbid: pattern fails the gate (exit 1)"
else
  fail "boundary-check.sh missed a forbidden import" "$out"
fi
echo 'export interface Order { id: string }' >src/domain/order.ts
commit "the domain file no longer imports it"
out=$(bash "$BOUNDARY" 2>&1; echo "ec=$?")
[ "$(echo "$out" | tail -1)" = "ec=0" ] && pass "a clean domain passes the gate (exit 0)" \
  || fail "boundary-check.sh refused a clean domain" "$out"

echo
echo "═══ #725  impact-aware gates: run-gate.sh behind a flag, on a real scaffold ═══"
GATE=.specnaut/scripts/bash/run-gate.sh
for script in gate-impact.sh _gate_candidate.sh _gate_impact_read.sh _gate_impact_adapter.sh _gate_impact_graph.sh _gate_evidence.sh; do
  check "$script scaffolded + executable" "[ -x .specnaut/scripts/bash/$script ]"
done
for script in gate-impact.ps1 base-branch.ps1 _gate_candidate.ps1 _gate_impact_read.ps1 _gate_impact_adapter.ps1 _gate_impact_graph.ps1 _gate_evidence.ps1; do
  check "$script twin scaffolded" "[ -f .specnaut/scripts/powershell/$script ]"
done
check "the declaration is the project's: init writes no .specnaut/impact.json" '[ ! -e .specnaut/impact.json ]'
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
M=$(tr '\n' ' ' <.claude/skills/task/phases/merge.md | tr -s ' ')
has() { case $M in *"$1"*) ;; *) return 1 ;; esac; }
# shellcheck disable=SC2034 # read by the check below, through eval
TIER='run the full tier (**The full tier**, below)' EPIC='**Exit 0 — an epic**: do **not** squash: ' \
  FULL='**The full tier** — exits 0 and 14 only, before the landing. Run the full gate tier once, but first: if '
check "merge.md takes the epic path, like the standalone one, through the gates.yml ask" \
  'has "$EPIC$TIER" && has "**Exit 14 — standalone**: $TIER" &&
   has "$FULL\`git diff --quiet \"\$(git merge-base HEAD <base>)\" HEAD -- .specnaut/gates.yml\`" &&
   has "ask once: *\"This branch changes \`.specnaut/gates.yml\`."'
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
commit "opt in"
START="$(git rev-parse HEAD)"
git switch -q -c feature

echo changed >apps/two/a.txt
commit "change the dependent"
out=$(bash "$GATE" fast --base "$START" 2>&1; echo "ec=$?")
if echo "$out" | grep -q "ec=0" && echo "$out" | grep -qx "scope: owners two" && echo "$out" | grep -qx "scoped-to two"; then
  pass "a change runs its owner's scoped command, with the owners in the variable"
else
  fail "the scoped command did not run for its owner" "$out"
fi
echo changed >apps/one/a.txt
commit "change what it depends on"
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
commit "a path no owner holds"
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
commit "empty the tier"
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

echo "═══ the git library the phases read the seats' data through ═══"
check "git-read.sh installs beside its library and _scope_globs.sh; the scope script has copies" \
  '[ -x .specnaut/scripts/bash/git-read.sh ] && [ -f .specnaut/scripts/bash/_git_untrusted.sh ] &&
   cmp -s .specnaut/scripts/bash/_git_untrusted.sh .specnaut/scripts/audit/_git_untrusted.sh &&
   cmp -s .specnaut/scripts/bash/_scope_globs.sh .specnaut/scripts/audit/_scope_globs.sh'
check "the installed git-read refuses an option where a revision belongs, before git runs" \
  'r=0; bash .specnaut/scripts/bash/git-read.sh names --output=smoke-out HEAD 2>/dev/null || r=$?;
   [ "$r" = 2 ] && [ ! -e smoke-out ]'

finish "GATES"
