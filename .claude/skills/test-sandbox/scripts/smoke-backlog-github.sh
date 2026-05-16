#!/usr/bin/env bash
# Verify the GitHub-backend backlog scaffolding ships every script the
# PO + grooming contracts depend on. Tests file presence, executable
# bits, and SKILL.md references — no live `gh` calls (the actual
# script behavior against a real repo is covered by integration tests
# and manual QA).
#
# Usage: smoke-backlog-github.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-github.sh <name>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/sandbox/$NAME"

# Trap-based cleanup: wipe the scenario directory on every exit path
# (success OR failure) so the sandbox/ tree never accumulates orphans.
trap 'bash "$SCRIPT_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SCRIPT_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$ROOT/src/main.ts" \
  init --here --no-git --ai claude --backlog github \
  --backlog-url "https://github.com/orgs/example/projects/1" >/dev/null 2>&1)

cd "$DIR"
fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1 — $2"; fails=$((fails + 1)); }

check() {
  local desc="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then pass "$desc"; else fail "$desc" "command: $cmd"; fi
}

echo "═══ #69 + #93  backlog backend lock + config ═══"
check "lock records github backend" \
  'grep -q "backlog_backend: github" .specflow/installed.lock'
check "backlog-config.yml stub present" \
  '[ -f .specflow/backlog-config.yml ]'

echo
echo "═══ #69  github backend SKILL.md ═══"
check "SKILL renders github backend section" \
  'grep -q "Backend: GitHub" .claude/skills/backlog/SKILL.md'
check "local backend section stripped (github backend)" \
  '! grep -q "Backend: local Markdown" .claude/skills/backlog/SKILL.md'
check "no orphan BEGIN markers" \
  '! grep -q "BEGIN: backend=" .claude/skills/backlog/SKILL.md'

echo
echo "═══ canonical backlog scripts (5 originals) ═══"
for s in list view add move clarify-comment; do
  check "$s.sh present + executable" "[ -x .specflow/scripts/backlog/$s.sh ]"
done

echo
echo "═══ #157 + #161  native Project V2 fields (set-field/detect-fields) ═══"
check "detect-fields.sh present + executable" \
  '[ -x .specflow/scripts/backlog/detect-fields.sh ]'
check "set-field.sh present + executable" \
  '[ -x .specflow/scripts/backlog/set-field.sh ]'
check "SKILL.md mentions detect-fields.sh (#161)" \
  'grep -q "detect-fields.sh" .claude/skills/backlog/SKILL.md'
check "SKILL.md mentions set-field.sh (#161)" \
  'grep -q "set-field.sh" .claude/skills/backlog/SKILL.md'
check "SKILL.md documents set-field exit code 11 fallback contract" \
  'grep -q "10/11/12" .claude/skills/backlog/SKILL.md'

echo
echo "═══ #158  semantic labels bootstrap (ensure-labels.sh) ═══"
check "ensure-labels.sh present + executable" \
  '[ -x .specflow/scripts/backlog/ensure-labels.sh ]'
check "ensure-labels.sh seeds the canonical 7-label palette in full" \
  'for lbl in security refactor docs tech-debt dx performance dependency; do
     grep -q "ensure_label \"$lbl\"" .specflow/scripts/backlog/ensure-labels.sh || exit 1;
   done'
check "ensure-labels.sh seeds zero priority:*/size:* labels (#194)" \
  '! grep -E "ensure_label \"(priority|size):" .specflow/scripts/backlog/ensure-labels.sh'
check "ensure-labels.sh idempotent (skips already-present labels)" \
  'grep -q "already present" .specflow/scripts/backlog/ensure-labels.sh'
check "ensure-labels.sh verifies the GitHub default '"'"'bug'"'"' label" \
  'grep -qF "bug" .specflow/scripts/backlog/ensure-labels.sh'
check "SKILL.md mentions ensure-labels.sh (#158)" \
  'grep -q "ensure-labels.sh" .claude/skills/backlog/SKILL.md'
check "SKILL.md states fields are the source of truth (#194)" \
  'grep -q "fields are the source of truth" .claude/skills/backlog/SKILL.md'

echo
echo "═══ #157  Priority/Size native fields documented in SKILL.md ═══"
check "SKILL.md describes Priority/Size field-first contract" \
  'grep -q "Priority" .claude/skills/backlog/SKILL.md && grep -q "Size" .claude/skills/backlog/SKILL.md'

echo
echo "═══ #180  add.sh --parent flag (sub-issues API wiring) ═══"
check "add.sh parses --parent flag" \
  'grep -q -- "--parent" .specflow/scripts/backlog/add.sh'
check "add.sh references the sub_issues REST endpoint" \
  'grep -q "sub_issues" .specflow/scripts/backlog/add.sh'

echo
echo "═══ #180  cascade-check.sh present + executable ═══"
check "cascade-check.sh present + executable" \
  '[ -x .specflow/scripts/backlog/cascade-check.sh ]'
check "cascade-check.sh queries sub_issues for open children" \
  'grep -q "sub_issues" .specflow/scripts/backlog/cascade-check.sh'
check "cascade-check.sh exits 11 when children block close" \
  'grep -q "exit 11" .specflow/scripts/backlog/cascade-check.sh'

echo
echo "═══ #202  cascade-check.sh short-circuits on already-closed parent ═══"
check "cascade-check.sh exits 12 when parent already closed" \
  'grep -q "exit 12" .specflow/scripts/backlog/cascade-check.sh'
check "cascade-check.sh inspects parent state before children" \
  'grep -q "PARENT_STATE" .specflow/scripts/backlog/cascade-check.sh'

echo
echo "═══ #222  REST/CLI first; raw graphql only for ProjectV2 mutations ═══"
check "list.sh reads via gh issue list --json projectItems (REST-ish CLI)" \
  'grep -q "gh issue list" .specflow/scripts/backlog/list.sh && grep -q "projectItems" .specflow/scripts/backlog/list.sh'
check "list.sh does NOT use bulky gh api graphql for the read path" \
  '! grep -q "gh api graphql" .specflow/scripts/backlog/list.sh'
check "move.sh keeps targeted gh api graphql for item-ID lookup" \
  'grep -q "gh api graphql" .specflow/scripts/backlog/move.sh && grep -q "projectItems(first:5)" .specflow/scripts/backlog/move.sh'
check "move.sh mutation uses gh project item-edit (CLI wrapper)" \
  'grep -q "gh project item-edit" .specflow/scripts/backlog/move.sh'

echo
echo "═══ #260  Auto-propagate parent Epic on child move (github) ═══"
check "propagate-parent-status.sh present + executable" \
  '[ -x .specflow/scripts/backlog/propagate-parent-status.sh ]'
check "move.sh invokes propagate-parent-status.sh as tail hook" \
  'grep -q "propagate-parent-status.sh" .specflow/scripts/backlog/move.sh'
check "propagator resolves parent via GraphQL Issue.parent" \
  'grep -q "parent { number }" .specflow/scripts/backlog/propagate-parent-status.sh'
check "propagator promotes only Backlog/Ready parents" \
  'grep -qE "\"Backlog\"\|\"Ready\"" .specflow/scripts/backlog/propagate-parent-status.sh'
check "propagator carries the SPECFLOW_INTERNAL_PROPAGATION recursion guard" \
  'grep -q "SPECFLOW_INTERNAL_PROPAGATION" .specflow/scripts/backlog/propagate-parent-status.sh'

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL GITHUB BACKLOG CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
