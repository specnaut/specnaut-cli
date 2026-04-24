#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# GCP Status — Check Artifact Registry, Cloud Build, Cloud Run
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
SERVICE="miximodel"

COMMAND="${1:-all}"

show_images() {
  echo -e "${BOLD}Docker Images (Artifact Registry)${RESET}"
  echo -e "${BLUE}Registry: ${REGISTRY}${RESET}"
  echo ""
  gcloud artifacts docker images list "$REGISTRY" \
    --project="$PROJECT" \
    --sort-by="~UPDATE_TIME" \
    --limit=10 \
    --format="table(package,tags,updateTime.date('%Y-%m-%d %H:%M'))" 2>/dev/null || \
    echo -e "${RED}Failed to list images. Check gcloud auth.${RESET}"
}

show_builds() {
  echo -e "${BOLD}Recent Cloud Builds${RESET}"
  echo ""
  gcloud builds list \
    --project="$PROJECT" \
    --region="$REGION" \
    --limit=10 \
    --format="table(id.segment(-1):label=BUILD_ID,status,substitutions.TAG_NAME:label=TAG,createTime.date('%Y-%m-%d %H:%M'):label=CREATED,duration(end=finishTime,start=createTime).duration():label=DURATION)" 2>/dev/null || \
    # Try without region
    gcloud builds list \
      --project="$PROJECT" \
      --limit=10 \
      --format="table(id.segment(-1):label=BUILD_ID,status,substitutions.TAG_NAME:label=TAG,createTime.date('%Y-%m-%d %H:%M'):label=CREATED)" 2>/dev/null || \
      echo -e "${RED}Failed to list builds. Check gcloud auth.${RESET}"
}

show_service() {
  echo -e "${BOLD}Cloud Run Service${RESET}"
  echo ""
  gcloud run services describe "$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --format="table(status.url,status.conditions[0].status:label=READY,spec.template.spec.containers[0].image:label=IMAGE,metadata.annotations['run.googleapis.com/lastModifier']:label=LAST_MODIFIED_BY)" 2>/dev/null || \
    echo -e "${RED}Failed to describe service. Check gcloud auth.${RESET}"

  echo ""
  echo -e "${BOLD}Cloud Run Revisions (last 5)${RESET}"
  echo ""
  gcloud run revisions list \
    --service="$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --limit=5 \
    --format="table(metadata.name,status.conditions[0].status:label=READY,spec.containers[0].image:label=IMAGE,metadata.creationTimestamp.date('%Y-%m-%d %H:%M'):label=CREATED)" 2>/dev/null || true
}

show_job() {
  echo -e "${BOLD}Migration Job${RESET}"
  echo ""
  gcloud run jobs describe "${SERVICE}-migrate-db" \
    --project="$PROJECT" \
    --region="$REGION" \
    --format="table(metadata.name,spec.template.spec.template.spec.containers[0].image:label=IMAGE)" 2>/dev/null || \
    echo -e "${YELLOW}Migration job not found or not accessible.${RESET}"

  echo ""
  echo -e "${BOLD}Recent Job Executions${RESET}"
  echo ""
  gcloud run jobs executions list \
    --job="${SERVICE}-migrate-db" \
    --project="$PROJECT" \
    --region="$REGION" \
    --limit=5 \
    --format="table(metadata.name,status.conditions[0].type:label=STATUS,status.conditions[0].status:label=RESULT,metadata.creationTimestamp.date('%Y-%m-%d %H:%M'):label=CREATED)" 2>/dev/null || true
}

case "$COMMAND" in
  images)
    show_images
    ;;
  builds)
    show_builds
    ;;
  service)
    show_service
    ;;
  job)
    show_job
    ;;
  all)
    show_images
    echo ""
    echo "─────────────────────────────────────"
    echo ""
    show_builds
    echo ""
    echo "─────────────────────────────────────"
    echo ""
    show_service
    echo ""
    echo "─────────────────────────────────────"
    echo ""
    show_job
    ;;
  *)
    echo "Usage: $0 [images|builds|service|job|all]"
    echo ""
    echo "  images   — List recent Docker images in Artifact Registry"
    echo "  builds   — Show recent Cloud Build history"
    echo "  service  — Show Cloud Run service status and revisions"
    echo "  job      — Show migration job status and recent executions"
    echo "  all      — Show everything (default)"
    exit 1
    ;;
esac
