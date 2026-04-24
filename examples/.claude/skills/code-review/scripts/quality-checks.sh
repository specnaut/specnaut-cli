#!/usr/bin/env bash
#
# quality-checks.sh — Run all project quality gates in sequence.
# Stops at the first failure with a clear error message.
#
# Usage:
#   .claude/skills/code-review/scripts/quality-checks.sh
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

passed=0
failed=0
total=4

step() {
  local num="$1"
  local label="$2"
  shift 2
  echo ""
  echo -e "${BLUE}${BOLD}[$num/$total] $label${RESET}"
  echo -e "${BLUE}→ $*${RESET}"
  echo ""

  if "$@"; then
    echo -e "${GREEN}✔ $label passed${RESET}"
    passed=$((passed + 1))
  else
    echo ""
    echo -e "${RED}✖ $label FAILED (exit code $?)${RESET}"
    failed=$((failed + 1))
    echo ""
    echo -e "${RED}${BOLD}Stopping. Fix the errors above and re-run.${RESET}"
    echo -e "  Passed: $passed / $total"
    echo -e "  Failed: $failed"
    exit 1
  fi
}

echo ""
echo -e "${BOLD}══════════════════════════════════════${RESET}"
echo -e "${BOLD}  Quality Checks — Pre-commit / Push  ${RESET}"
echo -e "${BOLD}══════════════════════════════════════${RESET}"

step 1 "Format (Prettier)"   npm run format
step 2 "Lint (ESLint)"       npm run lint
step 3 "TypeCheck (tsc)"     npm run typecheck
step 4 "Tests (Japa)"        node ace test

echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  All $total checks passed ✔${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo ""
