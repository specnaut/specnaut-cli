#!/usr/bin/env bash
# Verify the Specnaut Cloud backend's backlog scaffolding ships every script
# the PO + grooming + epic contracts depend on. File presence, executable
# bits, and the contracts each script declares — no live API calls (behaviour
# against a real board is integration territory).
#
# #563 created this file. The cloud backend had NO smoke at all and no glob in
# audit.sh's SURFACES map, so every script it ships was asserted on by nothing
# — the audit's own coverage scan could not see the gap because no glob
# claimed the directory. That is the same shape as the defects this suite
# exists to find: not a missing guard, a guard blind to part of its surface.
#
# Usage: smoke-backlog-cloud.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-cloud.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog cloud >/dev/null 2>&1)

cd "$DIR"

echo "═══ backlog backend lock + config ═══"
check "lock records cloud backend" \
  'grep -q "backlog_backend: cloud" .specnaut/installed.lock'
check "backlog-config.yml stub present" \
  '[ -f .specnaut/backlog-config.yml ]'
check "credentials are NOT written into the config" \
  '! grep -qiE "token|secret|password|api_key" .specnaut/backlog-config.yml'

echo
echo "═══ the scripts the PO contract depends on ═══"
for s in _config.sh add.sh clarify-comment.sh columns.sh list.sh move.sh reconcile.sh view.sh groom-verify.sh; do
  check "$s scaffolded" "[ -f .specnaut/scripts/backlog/$s ]"
done
check "_config.sh reads api_url + project_key, not a stored credential" \
  'grep -q "project_key" .specnaut/scripts/backlog/_config.sh &&
   ! grep -qE "^[A-Z_]*TOKEN=[\"'\'']?[A-Za-z0-9]" .specnaut/scripts/backlog/_config.sh'

echo
echo "═══ #563  sub-task enumeration on the cloud backend ═══"
check "parent-of.sh scaffolded (#563)" \
  '[ -f .specnaut/scripts/backlog/parent-of.sh ]'
check "cascade-check.sh scaffolded (#563 AC1)" \
  '[ -f .specnaut/scripts/backlog/cascade-check.sh ]'
check "add.sh accepts --parent, like the other backends (#563 AC3)" \
  'grep -qF -- "--parent" .specnaut/scripts/backlog/add.sh &&
   grep -qF "parentNumber" .specnaut/scripts/backlog/add.sh'
check "the exit contract matches github's, so callers need no branching (#563)" \
  'grep -qF "exit 10" .specnaut/scripts/backlog/parent-of.sh &&
   grep -qF "exit 11" .specnaut/scripts/backlog/cascade-check.sh &&
   grep -qF "exit 12" .specnaut/scripts/backlog/cascade-check.sh'
# Kevin's ruling: the terminal column is the last by order, and the script
# NAMES it on every run. The naming is the whole safety of the convention —
# a board that grew a column after its done column would otherwise stop
# gating in silence.
check "the terminal column is the last by order (#563)" \
  'grep -qF "sort_by(.order) | last" .specnaut/scripts/backlog/cascade-check.sh'
check "and the script SAYS which column it used (#563)" \
  'grep -qF "terminal column:" .specnaut/scripts/backlog/cascade-check.sh'
check "both branch on curl exit status, not on empty output (#563)" \
  'grep -qF "rc=0" .specnaut/scripts/backlog/parent-of.sh &&
   grep -qF "rc=0" .specnaut/scripts/backlog/cascade-check.sh'
# Constitution § I. The only bridge is the versioned public HTTP contract;
# an internal identifier of the hosted half must never appear here.
check "no internal identifier of the hosted board appears (#563 AC6)" \
  '! grep -qE "parentId|convex|_creationTime" .specnaut/scripts/backlog/parent-of.sh &&
   ! grep -qE "parentId|convex|_creationTime" .specnaut/scripts/backlog/cascade-check.sh &&
   ! grep -qE "parentId|convex|_creationTime" .specnaut/scripts/backlog/add.sh'


echo "═══ spec 042  close-shipped.sh — the move is the close ═══"
check "close-shipped.sh present + executable, its shared body _close_shipped.sh beside it (spec 042, cli#711)" \
  '[ -x .specnaut/scripts/backlog/close-shipped.sh ] && [ -f .specnaut/scripts/backlog/_close_shipped.sh ]'
check "close-shipped.sh moves each item to Done, in order, and asks no forge (spec 042)" \
  'probe_close_shipped "" "" 5 6 && close_shipped_was 0 "$(printf "move 5 Done\nmove 6 Done")" "DONE #5" "DONE #6"'

finish "BACKLOG-CLOUD"
