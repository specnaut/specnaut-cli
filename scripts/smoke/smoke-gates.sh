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
  'grep -q "^## Where the numbers come from" .specnaut/memory/size-limits.md && grep -q "^| file | 300 | 500 |" .specnaut/memory/size-limits.md'

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

finish "GATES"
