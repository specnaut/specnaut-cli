#!/usr/bin/env bash
# Verify the GitLab-backend backlog scaffolding ships every script the
# PO + grooming + epic contracts depend on. Tests file presence,
# executable bits, --parent flag wiring, and SKILL.md references — no
# live `glab` calls (the script behavior against a real project is
# covered by integration tests and manual QA).
#
# Usage: smoke-backlog-gitlab.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-gitlab.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog gitlab \
  --backlog-url "https://gitlab.com/example/proj" >/dev/null 2>&1)

cd "$DIR"


echo "═══ backlog backend lock + config ═══"
check "lock records gitlab backend" \
  'grep -q "backlog_backend: gitlab" .specnaut/installed.lock'
check "backlog-config.yml stub present" \
  '[ -f .specnaut/backlog-config.yml ]'

echo
echo "═══ canonical backlog scripts ═══"
# Names carry their `.sh` so the coverage scan can find them. `audit.sh`
# greps each smoke file for a literal basename; a name assembled from a loop
# variable is invisible to it, so this loop covered six scripts while being
# reported as six gaps.
for s in list.sh view.sh add.sh move.sh clarify-comment.sh ensure-labels.sh groom-verify.sh; do
  check "$s present + executable" "[ -x .specnaut/scripts/backlog/$s ]"
done

echo
echo "═══ #180  add.sh --parent flag (scoped-label parent::#NNN) ═══"
check "add.sh parses --parent flag" \
  'grep -q -- "--parent" .specnaut/scripts/backlog/add.sh'
check "add.sh emits parent::#NNN scoped label" \
  'grep -q "parent::#" .specnaut/scripts/backlog/add.sh'

echo
echo "═══ #180  cascade-check.sh present + executable ═══"
check "cascade-check.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/cascade-check.sh ]'

echo
echo "═══ #553  parent-of.sh — the gitlab twin ═══"
check "parent-of.sh present + executable (#553)" \
  '[ -x .specnaut/scripts/backlog/parent-of.sh ]'
check "it reads the parent:: scoped label, gitlab's link (#553)" \
  'grep -qF "parent::#" .specnaut/scripts/backlog/parent-of.sh'
check "no parent and could-not-ask are DIFFERENT exit codes (#553)" \
  'grep -qF "exit 10" .specnaut/scripts/backlog/parent-of.sh &&
   grep -qF "exit 3" .specnaut/scripts/backlog/parent-of.sh'
check "it branches on glab exit status, not on empty stdout (#553)" \
  'grep -qF "api_rc" .specnaut/scripts/backlog/parent-of.sh'
check "cascade-check.sh queries the parent::#NNN scoped label" \
  'grep -q "parent::#" .specnaut/scripts/backlog/cascade-check.sh'
check "cascade-check.sh exits 11 when children block close" \
  'grep -q "exit 11" .specnaut/scripts/backlog/cascade-check.sh'

echo
echo "═══ #202  cascade-check.sh short-circuits on already-closed parent ═══"
check "cascade-check.sh exits 3 when parent does not exist" \
  'grep -q "exit 3" .specnaut/scripts/backlog/cascade-check.sh'
check "cascade-check.sh exits 12 when parent already closed" \
  'grep -q "exit 12" .specnaut/scripts/backlog/cascade-check.sh'
check "cascade-check.sh inspects parent state before children" \
  'grep -q "PARENT_STATE" .specnaut/scripts/backlog/cascade-check.sh'

echo "═══ #442  gitlab _config.sh resolves an item URL ═══"
grep -q 'item_url()' .specnaut/scripts/backlog/_config.sh \
  && pass "_config.sh defines item_url (gitlab)" \
  || fail "item_url missing from gitlab _config.sh" "$(grep -n 'item_url' .specnaut/scripts/backlog/_config.sh || true)"
grep -q 'path_with_namespace' .specnaut/scripts/backlog/_config.sh \
  && pass "gitlab item_url resolves a numeric project_id to a path" \
  || fail "numeric project_id resolution missing" "$(grep -n 'project_id\|PROJECT_ID' .specnaut/scripts/backlog/_config.sh || true)"
grep -q '\[ -n "\$path" \] || return 0' .specnaut/scripts/backlog/_config.sh \
  && pass "gitlab item_url degrades to no link when the lookup fails" \
  || fail "gitlab item_url would emit a URL with an empty path" "$(grep -n 'return 0' .specnaut/scripts/backlog/_config.sh || true)"

echo
echo "═══ #18  board-drift sweep reports and never moves (gitlab) ═══"
check "sweep-closed.sh present + executable" \
  '[ -x .specnaut/scripts/backlog/sweep-closed.sh ]'
# On GitLab the Status:: scoped label IS the column, and it lives on the
# issue — so one issue query answers both halves, with no board to join.
check "gitlab sweep reads the Status:: scoped label as the column" \
  'grep -q "Status::" .specnaut/scripts/backlog/sweep-closed.sh'
check "gitlab sweep never relabels an issue itself" \
  '! grep -qE "PUT|--method PUT" .specnaut/scripts/backlog/sweep-closed.sh'
check "gitlab sweep emits DRIFTED / REOPENED / scanned lines" \
  'grep -q "DRIFTED" .specnaut/scripts/backlog/sweep-closed.sh && grep -q "REOPENED" .specnaut/scripts/backlog/sweep-closed.sh && grep -q "scanned" .specnaut/scripts/backlog/sweep-closed.sh'
check "gitlab sweep treats scanned 0 as a failure, not a quiet run" \
  'grep -q "scanned 0" .specnaut/scripts/backlog/sweep-closed.sh'

finish "BACKLOG-GITLAB"
