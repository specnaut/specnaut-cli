#!/usr/bin/env bash
# Publish a GitLab Release for a tag, using release.sh to generate the body.
#
# Mirrors release-github.sh: baseline = previous DEPLOYED tag (the most
# recent tag with a published GitLab release attached), NOT the previous
# tag by date. Tags pushed without a release are "subsumed" — their
# commits land in this release and the subsumed tag names appear inline
# in the body.
#
# Usage: release-gitlab.sh [--baseline <tag>] [<tag>]
#   <tag>        default: latest tag (git describe --tags --abbrev=0)
#   --baseline   override the auto-detected previous-deployed baseline
set -euo pipefail

TAG=""
EXPLICIT_BASELINE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline) EXPLICIT_BASELINE="$2"; shift 2 ;;
    --baseline=*) EXPLICIT_BASELINE="${1#--baseline=}"; shift ;;
    --help|-h)
      echo "usage: release-gitlab.sh [--baseline <tag>] [<tag>]"
      exit 0
      ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) TAG="$1"; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Preflight: glab CLI must be installed + authenticated.
if ! command -v glab >/dev/null 2>&1; then
  echo "glab CLI not found on PATH — install from https://gitlab.com/gitlab-org/cli" >&2
  exit 1
fi
if ! glab auth status >/dev/null 2>&1; then
  echo "glab CLI not authenticated — run: glab auth login" >&2
  exit 1
fi

git fetch --tags --quiet 2>/dev/null || true

if [ -z "$TAG" ]; then
  TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
  if [ -z "$TAG" ]; then
    echo "no tags found — create one first with tag.sh" >&2
    exit 1
  fi
fi

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag '$TAG' not found locally" >&2
  exit 1
fi

# Idempotency: skip if a release already exists for $TAG.
if glab release view "$TAG" >/dev/null 2>&1; then
  echo "release for $TAG already exists on GitLab"
  exit 0
fi

# Compute baseline = previous DEPLOYED tag. Uses glab's project release
# API (stable across glab versions). Errors are swallowed → empty
# RELEASE_TAGS → graceful fallback to release.sh's default (previous
# tag by date).
if [ -n "$EXPLICIT_BASELINE" ]; then
  BASELINE="$EXPLICIT_BASELINE"
  SUBSUMED=""
else
  RELEASE_TAGS=$(glab api 'projects/:id/releases?per_page=100' 2>/dev/null \
    | jq -r '.[].tag_name' 2>/dev/null \
    | tr '\n' ' ' || true)
  BASELINE=""
  SUBSUMED_LIST=""
  SEEN_CURRENT=false
  for t in $(git tag --sort=-creatordate); do
    if [ "$t" = "$TAG" ]; then
      SEEN_CURRENT=true
      continue
    fi
    [ "$SEEN_CURRENT" = "true" ] || continue
    if printf ' %s ' "$RELEASE_TAGS" | grep -q " $t "; then
      BASELINE="$t"
      break
    fi
    SUBSUMED_LIST="${SUBSUMED_LIST}\`$t\`, "
  done
  SUBSUMED="${SUBSUMED_LIST%, }"
fi

# Push the tag if it isn't on origin yet — GitLab's Releases API needs
# the tag on the remote, otherwise the release points at a phantom ref.
if ! git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "refs/tags/$TAG$"; then
  if git remote get-url origin >/dev/null 2>&1; then
    git push origin "$TAG"
  else
    echo "no origin remote configured — cannot push tag" >&2
    exit 1
  fi
fi

# Generate body via stack-agnostic release.sh
if [ -n "$BASELINE" ]; then
  BODY=$(bash "$SCRIPT_DIR/release.sh" --baseline "$BASELINE" "$TAG")
else
  BODY=$(bash "$SCRIPT_DIR/release.sh" "$TAG")
fi

if [ -n "$SUBSUMED" ]; then
  BODY=$(printf '%s\n' "$BODY" \
    | awk -v note="_This release subsumes undeployed tags: $SUBSUMED._" \
        'BEGIN{inserted=0} /^---$/ && !inserted {print note "\n"; inserted=1} {print}')
fi

# Write the body to a tempfile so `--notes-file` consumes it verbatim
# (avoids shell-escaping pitfalls with `--notes "$BODY"`).
NOTES_FILE=$(mktemp)
trap 'rm -f "$NOTES_FILE"' EXIT
printf '%s' "$BODY" > "$NOTES_FILE"

glab release create "$TAG" --name "$TAG" --notes-file "$NOTES_FILE"
echo "✓ published GitLab release for $TAG"
