#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Git Tag — Date-Based Release Tagging
# Format: vYY.M.D[a-z]  (no leading zeros on month/day)
# Regex:  ^v\d{2}\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])[a-z]$
# ------------------------------------------------------------------

TAG_REGEX='^v[0-9]{2}\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])[a-z]$'

# Optional: pass a commit SHA as first argument (defaults to HEAD)
COMMIT="${1:-HEAD}"

# Resolve script directory for sibling skill references
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUALITY_SCRIPT="${SCRIPT_DIR}/../../code-review/scripts/quality-checks.sh"

# 0. Run quality gates (format, lint, typecheck, tests)
echo "Running quality checks before tagging..."
echo ""
if [ -x "$QUALITY_SCRIPT" ]; then
  bash "$QUALITY_SCRIPT"
else
  echo "ERROR: Quality checks script not found at ${QUALITY_SCRIPT}" >&2
  exit 1
fi

echo ""
echo "Quality gates passed. Proceeding with tag creation..."
echo ""

# 1. Fetch remote tags
git fetch --tags --quiet

# 2. Compute today's prefix
YEAR=$(date +%y)
MONTH=$(date +%-m)
DAY=$(date +%-d)
PREFIX="v${YEAR}.${MONTH}.${DAY}"

# 3. Find the last letter used today
LAST_LETTER=$(git tag --list "${PREFIX}*" \
  | { grep -E "${TAG_REGEX}" || true; } \
  | sed "s/^${PREFIX}//" \
  | sort \
  | tail -1)

# 4. Increment
if [ -z "$LAST_LETTER" ]; then
  NEXT_LETTER="a"
else
  NEXT_LETTER=$(echo "$LAST_LETTER" | tr 'a-y' 'b-z')
  if [ "$NEXT_LETTER" = "$LAST_LETTER" ]; then
    echo "ERROR: Reached letter 'z' — no more tags available for today." >&2
    exit 1
  fi
fi

NEW_TAG="${PREFIX}${NEXT_LETTER}"

# 5. Validate against regex
if ! echo "$NEW_TAG" | grep -qE "$TAG_REGEX"; then
  echo "ERROR: Generated tag '${NEW_TAG}' does not match required regex." >&2
  exit 1
fi

# 6. Resolve commit info
COMMIT_SHA=$(git rev-parse --short "$COMMIT")
COMMIT_MSG=$(git log -1 --format='%s' "$COMMIT")

# 7. Output summary
echo "Tag:    ${NEW_TAG}"
echo "Commit: ${COMMIT_SHA} — ${COMMIT_MSG}"
echo ""

# 8. Create annotated tag and push (tag only, --no-verify to skip
#    pre-push hook since quality gates already passed in step 0)
git tag -a "$NEW_TAG" -m "Release ${NEW_TAG}" "$COMMIT"
git push --no-verify origin "$NEW_TAG"

echo ""
echo "Pushed ${NEW_TAG} to origin."

# 9. Show GitHub release URL if applicable
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
if [[ "$REMOTE_URL" =~ github\.com[:/](.+)/(.+?)(\.git)?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
  echo "GitHub: https://github.com/${OWNER}/${REPO}/releases/tag/${NEW_TAG}"
fi
