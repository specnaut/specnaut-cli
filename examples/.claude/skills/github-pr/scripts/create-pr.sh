#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# GitHub PR — Create Pull Request with Preview Environment
# Usage: bash .claude/skills/github-pr/scripts/create-pr.sh
# ------------------------------------------------------------------

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

# 1. Validate branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then
  echo -e "${RED}ERROR: Cannot create a PR from main.${RESET}"
  exit 1
fi

# Extract feature number from branch name (e.g., 172-implement-pulumi → 172)
FEATURE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+' || echo "")

echo -e "${BOLD}Creating PR for branch: ${BLUE}${BRANCH}${RESET}"
echo ""

# 2. Check if PR already exists
EXISTING_PR=$(gh pr list --head "$BRANCH" --json number,url --jq '.[0].url // empty' 2>/dev/null)
if [ -n "$EXISTING_PR" ]; then
  echo -e "${GREEN}PR already exists: ${EXISTING_PR}${RESET}"
  exit 0
fi

# 3. Ensure branch is pushed
echo "Pushing branch to origin..."
git push -u origin "$BRANCH" --no-verify 2>/dev/null || true

# 4. Gather context
COMMITS=$(git log --oneline HEAD --not main)
COMMIT_COUNT=$(echo "$COMMITS" | wc -l | tr -d ' ')
FILES_CHANGED=$(git diff --stat main | tail -1)

# Try to read spec title
SPEC_TITLE=""
SPEC_DIR=$(find specs -maxdepth 1 -type d -name "${FEATURE_NUM}-*" 2>/dev/null | head -1)
if [ -n "$SPEC_DIR" ] && [ -f "${SPEC_DIR}/spec.md" ]; then
  SPEC_TITLE=$(head -1 "${SPEC_DIR}/spec.md" | sed 's/^# Feature Specification: //')
fi

# 5. Build PR title
if [ -n "$FEATURE_NUM" ]; then
  if [ -n "$SPEC_TITLE" ]; then
    PR_TITLE="feat(${FEATURE_NUM}): ${SPEC_TITLE}"
  else
    # Use first commit message
    FIRST_MSG=$(echo "$COMMITS" | tail -1 | sed 's/^[a-f0-9]* //')
    PR_TITLE="${FIRST_MSG}"
  fi
else
  PR_TITLE=$(echo "$COMMITS" | tail -1 | sed 's/^[a-f0-9]* //')
fi

# Truncate title to 70 chars
PR_TITLE=$(echo "$PR_TITLE" | cut -c1-70)

# 6. Build PR body
SUMMARY=$(echo "$COMMITS" | sed 's/^[a-f0-9]* /- /')

PR_BODY=$(cat <<EOF
## Summary

${SUMMARY}

## Preview

Once CI passes, a preview environment will be deployed automatically:
- Cloud Run service: \`miximodel-pr-${FEATURE_NUM}\`
- Database: \`miximodel_pr_${FEATURE_NUM}\` on shared Cloud SQL
- Preview URL will be commented on this PR

## Changes

\`\`\`
${FILES_CHANGED}
\`\`\`

## Test Plan
- [ ] Preview environment loads correctly
- [ ] Key features work as expected
- [ ] No console errors

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)

# 7. Show preview
echo -e "${BOLD}PR Preview:${RESET}"
echo -e "  Title:   ${GREEN}${PR_TITLE}${RESET}"
echo -e "  Commits: ${COMMIT_COUNT}"
echo -e "  ${FILES_CHANGED}"
echo ""

# 8. Create PR
echo "Creating pull request..."
PR_URL=$(gh pr create --title "$PR_TITLE" --body "$PR_BODY" 2>&1)

echo ""
echo -e "${GREEN}${BOLD}PR created: ${PR_URL}${RESET}"

# 9. Extract PR number and show expected resources
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
echo ""
echo -e "${BOLD}Expected GCP Resources (after CI passes):${RESET}"
echo -e "  Cloud Run:  miximodel-pr-${PR_NUMBER} (europe-west1)"
echo -e "  Database:   miximodel_pr_${PR_NUMBER} on miximodel-db"
echo -e "  Image:      europe-west1-docker.pkg.dev/miximodel/miximodel/miximodel:pr-${PR_NUMBER}"
echo ""
echo -e "These resources will be ${RED}automatically cleaned up${RESET} when the PR is closed."
