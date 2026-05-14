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
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

trap 'bash "$SCRIPT_DIR/clean.sh" "${NAME}-semver" >/dev/null 2>&1 || true;
      bash "$SCRIPT_DIR/clean.sh" "${NAME}-date"   >/dev/null 2>&1 || true' EXIT

fails=0
pass() { echo "✓ $1"; }
fail() { echo "❌ $1 — $2"; fails=$((fails + 1)); }

check() {
  local desc="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then pass "$desc"; else fail "$desc" "command: $cmd"; fi
}

run_init() {
  local subname scheme dir
  subname="$1"
  scheme="$2"
  dir="$ROOT/sandbox/${NAME}-${subname}"
  bash "$SCRIPT_DIR/bootstrap-empty.sh" "${NAME}-${subname}" >/dev/null
  (cd "$dir" && deno run --allow-all "$ROOT/src/main.ts" \
    init --here --no-git --ai claude --backlog local --scheme "$scheme" \
    >/dev/null 2>&1)
}

echo "═══ #227  scheme=semver scaffold ═══"
run_init "semver" "semver"
cd "$ROOT/sandbox/${NAME}-semver"

check "phase doc tag-version.md scaffolded" \
  '[ -f .claude/skills/specflow/phases/tag-version.md ]'
check "phase doc release-version.md scaffolded" \
  '[ -f .claude/skills/specflow/phases/release-version.md ]'
check "tag.sh present + executable" \
  '[ -x .specflow/scripts/release/tag.sh ]'
check "release.sh present + executable" \
  '[ -x .specflow/scripts/release/release.sh ]'
check "tag.sh contains SemVer bump logic" \
  'grep -q "v0.1.0" .specflow/scripts/release/tag.sh && grep -q "SemVer validation" .specflow/scripts/release/tag.sh'
check "tag.sh does NOT contain date-scheme logic" \
  '! grep -q "letter suffix exhausted" .specflow/scripts/release/tag.sh'
check "tag.sh does NOT keep BEGIN/END scheme markers (rewrite stripped them)" \
  '! grep -qE "^\s*#\s*(BEGIN|END):\s*scheme=" .specflow/scripts/release/tag.sh'
check "release.sh contains 10-bucket classifier" \
  'grep -q "Features" .specflow/scripts/release/release.sh && grep -q "Bug Fixes" .specflow/scripts/release/release.sh && grep -q "Build & CI" .specflow/scripts/release/release.sh'
check "#228 release-github.sh present + executable" \
  '[ -x .specflow/scripts/release/release-github.sh ]'
check "#228 release-github.sh wraps gh release create" \
  'grep -q "gh release create" .specflow/scripts/release/release-github.sh'
check "#228 release-github.sh detects previous DEPLOYED tag (not by date)" \
  'grep -q "previous DEPLOYED tag" .specflow/scripts/release/release-github.sh && grep -q "gh release list" .specflow/scripts/release/release-github.sh'
check "#228 release-github.sh is idempotent (re-run on existing release exits 0)" \
  'grep -q "already exists" .specflow/scripts/release/release-github.sh'
check "lock records version_scheme: semver" \
  'grep -q "version_scheme: semver" .specflow/installed.lock'
check "specflow SKILL.md references tag-version" \
  'grep -q "tag-version" .claude/skills/specflow/SKILL.md'
check "specflow SKILL.md references release-version" \
  'grep -q "release-version" .claude/skills/specflow/SKILL.md'

cd "$ROOT"

echo
echo "═══ #227  scheme=date scaffold ═══"
run_init "date" "date"
cd "$ROOT/sandbox/${NAME}-date"

check "tag.sh contains date-scheme logic" \
  'grep -q "letter suffix exhausted" .specflow/scripts/release/tag.sh && grep -q "date-based validation" .specflow/scripts/release/tag.sh'
check "tag.sh does NOT contain SemVer bump logic" \
  '! grep -q "v0.1.0" .specflow/scripts/release/tag.sh'
check "tag.sh does NOT keep BEGIN/END scheme markers (rewrite stripped them)" \
  '! grep -qE "^\s*#\s*(BEGIN|END):\s*scheme=" .specflow/scripts/release/tag.sh'
check "lock records version_scheme: date" \
  'grep -q "version_scheme: date" .specflow/installed.lock'
check "release.sh is stack-agnostic across schemes (byte-equal between scaffolds)" \
  'diff -q .specflow/scripts/release/release.sh "$ROOT/sandbox/${NAME}-semver/.specflow/scripts/release/release.sh"'

cd "$ROOT"

echo
if [ "$fails" -eq 0 ]; then
  echo "═══ ALL TAG-RELEASE CHECKS PASSED ═══"
  exit 0
else
  echo "═══ $fails CHECK(S) FAILED ═══"
  exit 1
fi
