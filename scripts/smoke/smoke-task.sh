#!/usr/bin/env bash
# Check the /task skill on a freshly-init'd Claude project (spec 037): the
# pipeline phases scaffold at their /task address and nowhere else, /specnaut
# keeps only the framework's verbs, and the audit verb replaced the six audit
# skills it absorbed. Split out of smoke-features.sh, which was over its size
# ceiling when spec 037 had to add to it.
#
# Usage: smoke-task.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-task.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-vite.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)

cd "$DIR"

echo "═══ spec 037  the pipeline phases live under /task ═══"
# Spec 037 moved the pipeline phases under /task; /specnaut keeps only the
# framework's own verbs. Both halves are asserted, and so is the absence at
# the old address — a copy left behind is a second router reading stale rules.
for phase in plan implement review merge merge-squash epic-commits quality-gates epic-fixups merge-close epic-loop constitution audit remote-gates orphan-specs; do
  check ".claude/skills/task/phases/$phase.md present" \
    "[ -f .claude/skills/task/phases/$phase.md ]"
  check ".claude/skills/specnaut/phases/$phase.md is gone (spec 037)" \
    "[ ! -e .claude/skills/specnaut/phases/$phase.md ]"
done
for phase in doc list upgrade; do
  check ".claude/skills/specnaut/phases/$phase.md present" \
    "[ -f .claude/skills/specnaut/phases/$phase.md ]"
done

echo
echo "═══ spec 037  /task audit replaced the audit skills ═══"
# The five per-axis skills were folded into one verb doc. Each axis is now a
# flag bound to its expert by ONE row of audit.md's axis table — asserted per
# row, so swapping two agents goes red — and the axis's subject lives in that
# expert's own file, which audit.md deliberately does not copy.
for axis in a11y arch dep perf sec; do
  check "$axis-audit is no longer scaffolded as its own skill (spec 037)" \
    "[ ! -e .claude/skills/$axis-audit ]"
done
check "audit.md offers every scope form on its usage line" \
  'u="$(grep -E "^/task audit " .claude/skills/task/phases/audit.md)" &&
   grep -qF -- "--path <subtree>" <<<"$u" && grep -qF -- "--range <a>..<b>" <<<"$u" &&
   grep -qF -- "--diff" <<<"$u" && grep -qF -- "--last <n>" <<<"$u"'
check "audit.md runs one expert per named axis, never a team" \
  'grep -qF "only those seats run." .claude/skills/task/phases/audit.md'
while read -r flag agent subject; do
  check "audit.md binds $flag to $agent" \
    'grep -F -- "| \`$flag\` |" .claude/skills/task/phases/audit.md | grep -qF "| \`$agent\` |"'
  check "$agent carries the $flag subject itself ($subject)" \
    'grep -qF -- "$subject" .claude/agents/$agent.md'
done <<'EOF'
--a11y accessibility-expert WCAG 2.1 AA
--archi architect-expert hex-layer
--deps dependency-expert typosquat
--perf performance-expert N+1
--security security-expert SSRF
EOF
# `/code-audit` became `/task audit` with no axis flag.
check "code-audit is no longer scaffolded as its own skill (spec 037)" \
  '[ ! -e .claude/skills/code-audit ]'
check "audit .claude/skills/task/phases/audit.md runs its seats in parallel, in one message" \
  'grep -qF "IN PARALLEL (one message)" .claude/skills/task/phases/audit.md &&
   grep -qF "all in the same message" .claude/skills/task/phases/audit.md'
# `grep -q -- "--last"` was satisfied by `--lastN`, so it pinned nothing —
# found by mutating the template and watching this assertion stay green.
check "audit.md scopes by commit count with --last <n>" \
  'grep -qF -- "--last <n>" .claude/skills/task/phases/audit.md'
# The script moved with its skill: it installs to scripts/audit/, executable,
# and the doc runs it from there — not from the old scripts/code-audit/.
check "collect-audit-scope.sh installs executable where audit.md runs it" \
  '[ -x .specnaut/scripts/audit/collect-audit-scope.sh ] &&
   grep -qF ".specnaut/scripts/audit/collect-audit-scope.sh" .claude/skills/task/phases/audit.md &&
   [ ! -e .specnaut/scripts/code-audit ]'

finish "TASK"
