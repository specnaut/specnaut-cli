#!/usr/bin/env bash
# Verify the tag-release pack scaffolds correctly on a fresh init and
# that the scheme rewrite produces the right artifact per choice.
#
# Tests two paths:
#   1. init --scheme semver  → tag.sh contains semver bump logic, no date logic
#   2. init --scheme date    → tag.sh contains date logic, no semver logic
# Then sanity-checks the stack-agnostic release.sh + the two phase docs.
#
# Usage: smoke-tag-release.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-tag-release.sh <name>}"
. "$(dirname "$0")/_common.sh"

trap 'bash "$SMOKE_DIR/clean.sh" "${NAME}-semver" >/dev/null 2>&1 || true;
      bash "$SMOKE_DIR/clean.sh" "${NAME}-date"   >/dev/null 2>&1 || true' EXIT



run_init() {
  local subname scheme dir
  subname="$1"
  scheme="$2"
  dir="$(scenario_dir "${NAME}-${subname}")"
  bash "$SMOKE_DIR/bootstrap-empty.sh" "${NAME}-${subname}" >/dev/null
  (cd "$dir" && deno run --allow-all "$CLI/src/main.ts" \
    init --here --no-git --ai claude --backlog local --scheme "$scheme" \
    >/dev/null 2>&1)
}

echo "═══ #227  scheme=semver scaffold ═══"
run_init "semver" "semver"
cd "$(scenario_dir "${NAME}-semver")"

check "/ship skill scaffolded" \
  '[ -f .claude/skills/ship/SKILL.md ]'
check "ship doc tag.md scaffolded" \
  '[ -f .claude/skills/ship/phases/tag.md ]'
check "ship doc release.md scaffolded" \
  '[ -f .claude/skills/ship/phases/release.md ]'
check "tag.sh present + executable" \
  '[ -x .specnaut/scripts/release/tag.sh ]'
check "release.sh present + executable" \
  '[ -x .specnaut/scripts/release/release.sh ]'
check "tag.sh contains SemVer bump logic" \
  'grep -q "v0.1.0" .specnaut/scripts/release/tag.sh && grep -q "SemVer validation" .specnaut/scripts/release/tag.sh'
check "tag.sh does NOT contain date-scheme logic" \
  '! grep -q "letter suffix exhausted" .specnaut/scripts/release/tag.sh'
check "tag.sh does NOT keep BEGIN/END scheme markers (rewrite stripped them)" \
  '! grep -qE "^\s*#\s*(BEGIN|END):\s*scheme=" .specnaut/scripts/release/tag.sh'
check "release.sh contains 10-bucket classifier" \
  'grep -q "Features" .specnaut/scripts/release/release.sh && grep -q "Bug Fixes" .specnaut/scripts/release/release.sh && grep -q "Build & CI" .specnaut/scripts/release/release.sh'
check "#228 release-github.sh present + executable" \
  '[ -x .specnaut/scripts/release/release-github.sh ]'
check "#228 release-github.sh wraps gh release create" \
  'grep -q "gh release create" .specnaut/scripts/release/release-github.sh'
check "#228 release-github.sh detects previous DEPLOYED tag (not by date)" \
  'grep -q "previous DEPLOYED tag" .specnaut/scripts/release/release-github.sh && grep -q "gh release list" .specnaut/scripts/release/release-github.sh'
check "#228 release-github.sh is idempotent (re-run on existing release exits 0)" \
  'grep -q "already exists" .specnaut/scripts/release/release-github.sh'
check "#229 release-gitlab.sh present + executable" \
  '[ -x .specnaut/scripts/release/release-gitlab.sh ]'
check "#229 release-gitlab.sh wraps glab release create" \
  'grep -q "glab release create" .specnaut/scripts/release/release-gitlab.sh'
check "#229 release-gitlab.sh queries projects/:id/releases for baseline detection" \
  'grep -q "projects/:id/releases" .specnaut/scripts/release/release-gitlab.sh'
check "#229 release-gitlab.sh is idempotent (re-run on existing release exits 0)" \
  'grep -q "already exists" .specnaut/scripts/release/release-gitlab.sh'
check "#230 release-local.sh present + executable" \
  '[ -x .specnaut/scripts/release/release-local.sh ]'
check "#230 release-local.sh writes RELEASE_NOTES_<tag>.md by default" \
  'grep -q "RELEASE_NOTES_" .specnaut/scripts/release/release-local.sh'
check "#230 release-local.sh accepts --out flag" \
  'grep -q -- "--out" .specnaut/scripts/release/release-local.sh'
check "#230 release-local.sh makes NO remote API calls" \
  '! grep -E "(gh|glab) (api|release create)" .specnaut/scripts/release/release-local.sh'
check "lock records version_scheme: semver" \
  'grep -q "version_scheme: semver" .specnaut/installed.lock'
# INVERTED by spec 033. These two used to assert that the /specnaut router
# REFERENCES tag-version and release-version. It must now reference neither:
# release concerns moved to /ship, and a router still advertising a phase it no
# longer owns is the defect this migration exists to remove.
# Precise on purpose. The router MUST still name the retired phases — that is
# FR-004, the retirement notice, and whoever arrives typing them is following an
# instruction written before the split. What it must no longer do is ADVERTISE
# them: no phase-index row, no argument-hint, no trigger phrase. An earlier
# version of this check grepped for the bare names and so contradicted the
# requirement it was meant to protect.
check "specnaut SKILL.md no longer advertises the retired phases" \
  '! grep -qE "^\| .(tag-version|release-version). \|" .claude/skills/specnaut/SKILL.md && ! grep -q "argument-hint:.*tag-version" .claude/skills/specnaut/SKILL.md'
check "specnaut SKILL.md retires them explicitly rather than dropping them" \
  'grep -q "RETIRED, not unknown" .claude/skills/specnaut/SKILL.md'
check "specnaut SKILL.md names /ship as the new address" \
  'grep -q "/ship" .claude/skills/specnaut/SKILL.md'
check "ship SKILL.md offers the three paths" \
  'grep -q "Tag only" .claude/skills/ship/SKILL.md && grep -q "Release an existing tag" .claude/skills/ship/SKILL.md'

cd "$CLI"

echo
echo "═══ #227  scheme=date scaffold ═══"
run_init "date" "date"
cd "$(scenario_dir "${NAME}-date")"

check "tag.sh contains date-scheme logic" \
  'grep -q "letter suffix exhausted" .specnaut/scripts/release/tag.sh && grep -q "date-based validation" .specnaut/scripts/release/tag.sh'
check "tag.sh does NOT contain SemVer bump logic" \
  '! grep -q "v0.1.0" .specnaut/scripts/release/tag.sh'
check "tag.sh does NOT keep BEGIN/END scheme markers (rewrite stripped them)" \
  '! grep -qE "^\s*#\s*(BEGIN|END):\s*scheme=" .specnaut/scripts/release/tag.sh'
check "lock records version_scheme: date" \
  'grep -q "version_scheme: date" .specnaut/installed.lock'
check "release.sh is stack-agnostic across schemes (byte-equal between scaffolds)" \
  'diff -q .specnaut/scripts/release/release.sh "$(scenario_dir "${NAME}-semver")/.specnaut/scripts/release/release.sh"'

cd "$CLI"

finish "TAG-RELEASE"
