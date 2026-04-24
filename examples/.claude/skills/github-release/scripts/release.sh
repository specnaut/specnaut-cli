#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# GitHub Release — Verify build, create release, trigger deploy
# ------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

PROJECT="miximodel"
REGION="europe-west1"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/${PROJECT}/${PROJECT}"
MAX_WAIT=900  # 15 minutes
POLL_INTERVAL=30

# --- 1. Resolve tag ---
git fetch --tags --quiet

if [ -n "${1:-}" ]; then
  TAG="$1"
  if ! git tag --list | grep -qx "$TAG"; then
    echo -e "${RED}ERROR: Tag '$TAG' not found.${RESET}" >&2
    exit 1
  fi
else
  TAG=$(git tag --sort=-creatordate | head -1)
  if [ -z "$TAG" ]; then
    echo -e "${RED}ERROR: No tags found.${RESET}" >&2
    exit 1
  fi
fi

COMMIT_SHA=$(git rev-parse --short "$TAG")
COMMIT_MSG=$(git log -1 --format='%s' "$TAG")

echo ""
echo -e "${BOLD}GitHub Release${RESET}"
echo -e "Tag:    ${BLUE}${TAG}${RESET}"
echo -e "Commit: ${COMMIT_SHA} — ${COMMIT_MSG}"
echo ""

# --- 2. Check if release already exists ---
EXISTING=$(gh release view "$TAG" --json url --jq '.url' 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  echo -e "${YELLOW}A release already exists for ${TAG}:${RESET}"
  echo -e "  ${EXISTING}"
  echo ""
  echo -e "Deploy workflow: $(gh run list --workflow=deploy.yml --limit 1 --json url --jq '.[0].url' 2>/dev/null || echo 'N/A')"
  exit 0
fi

# --- 3. Check Cloud Build status ---
echo -e "${BLUE}Checking Cloud Build for tag ${TAG}...${RESET}"

WAITED=0
while true; do
  # Find builds matching this tag
  BUILD_INFO=$(gcloud builds list \
    --project="$PROJECT" \
    --region="$REGION" \
    --filter="substitutions.TAG_NAME='${TAG}'" \
    --limit=1 \
    --format="csv[no-heading](id,status)" 2>/dev/null || true)

  if [ -z "$BUILD_INFO" ]; then
    # Try global region (some triggers don't set region)
    BUILD_INFO=$(gcloud builds list \
      --project="$PROJECT" \
      --filter="substitutions.TAG_NAME='${TAG}'" \
      --limit=1 \
      --format="csv[no-heading](id,status)" 2>/dev/null || true)
  fi

  if [ -z "$BUILD_INFO" ]; then
    echo -e "${YELLOW}No Cloud Build found for tag ${TAG}.${RESET}"
    echo -e "The build may not have triggered yet, or uses a different substitution."
    echo -e "Checking Artifact Registry directly..."
    break
  fi

  BUILD_ID=$(echo "$BUILD_INFO" | cut -d',' -f1)
  BUILD_STATUS=$(echo "$BUILD_INFO" | cut -d',' -f2)

  case "$BUILD_STATUS" in
    SUCCESS)
      echo -e "${GREEN}Cloud Build ${BUILD_ID}: SUCCESS${RESET}"
      break
      ;;
    FAILURE|TIMEOUT|CANCELLED|EXPIRED|INTERNAL_ERROR)
      echo -e "${RED}Cloud Build ${BUILD_ID}: ${BUILD_STATUS}${RESET}"
      echo ""
      echo -e "${RED}Cannot create release — build failed.${RESET}"
      echo -e "View logs: gcloud builds log ${BUILD_ID} --project=${PROJECT} --region=${REGION}"
      exit 1
      ;;
    WORKING|QUEUED)
      if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        echo -e "${RED}Timeout: Cloud Build still running after ${MAX_WAIT}s.${RESET}"
        echo -e "Check manually: gcloud builds describe ${BUILD_ID} --project=${PROJECT} --region=${REGION}"
        exit 1
      fi
      echo -e "${YELLOW}Cloud Build ${BUILD_ID}: ${BUILD_STATUS} (waiting ${POLL_INTERVAL}s...)${RESET}"
      sleep "$POLL_INTERVAL"
      WAITED=$((WAITED + POLL_INTERVAL))
      ;;
    *)
      echo -e "${YELLOW}Cloud Build ${BUILD_ID}: Unknown status '${BUILD_STATUS}'${RESET}"
      break
      ;;
  esac
done

# --- 4. Verify image in Artifact Registry ---
echo ""
echo -e "${BLUE}Verifying image in Artifact Registry...${RESET}"

IMAGE="${REGISTRY}:${TAG}"
if gcloud artifacts docker images describe "$IMAGE" --project="$PROJECT" 2>/dev/null; then
  echo -e "${GREEN}Image verified: ${IMAGE}${RESET}"
else
  echo -e "${RED}ERROR: Image not found: ${IMAGE}${RESET}"
  echo -e "Cloud Build may still be pushing. Wait and retry."
  exit 1
fi

# --- 5. Generate release notes ---
echo ""
PREV_TAG=$(git tag --sort=-creatordate | sed -n '2p' || true)

if [ -n "$PREV_TAG" ]; then
  NOTES=$(git log --oneline "${PREV_TAG}..${TAG}" | sed 's/^/- /')
  NOTES_HEADER="Changes since ${PREV_TAG}:"
else
  NOTES=$(git log --oneline -10 "$TAG" | sed 's/^/- /')
  NOTES_HEADER="Recent changes:"
fi

echo -e "${BOLD}Release Notes:${RESET}"
echo "$NOTES_HEADER"
echo "$NOTES"
echo ""

# --- 6. Confirm ---
echo -e "${BOLD}Ready to create GitHub Release for ${TAG}${RESET}"
read -r -p "Proceed? (Y/n) " CONFIRM
CONFIRM=${CONFIRM:-Y}
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# --- 7. Create release ---
echo ""
echo -e "${BLUE}Creating GitHub Release...${RESET}"

RELEASE_BODY="## ${TAG}

${NOTES_HEADER}

${NOTES}

---
Image: \`${IMAGE}\`
Commit: \`${COMMIT_SHA}\`"

gh release create "$TAG" \
  --title "$TAG" \
  --notes "$RELEASE_BODY" \
  --verify-tag

RELEASE_URL=$(gh release view "$TAG" --json url --jq '.url')
echo ""
echo -e "${GREEN}${BOLD}Release created: ${RELEASE_URL}${RESET}"

# --- 8. Show deploy workflow ---
echo ""
echo -e "${BLUE}The deploy.yml workflow should trigger shortly.${RESET}"
echo -e "Monitor: gh run list --workflow=deploy.yml --limit 1"
echo -e "Watch:   gh run watch"

# Wait a moment for the workflow to appear
sleep 5
DEPLOY_RUN=$(gh run list --workflow=deploy.yml --limit 1 --json url,status --jq '.[0] | "\(.status) — \(.url)"' 2>/dev/null || true)
if [ -n "$DEPLOY_RUN" ]; then
  echo -e "Deploy:  ${DEPLOY_RUN}"
fi
