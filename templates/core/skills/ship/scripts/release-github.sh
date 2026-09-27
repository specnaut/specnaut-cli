#!/usr/bin/env bash
# Publish a GitHub Release for a tag, using release.sh to generate the body.
#
# The baseline is the **previous DEPLOYED tag** (last tag with a published
# GitHub release attached — a draft does not count), NOT the previous tag by
# date. Tags pushed
# without a release attached are "subsumed" — their commits land in this
# release and the subsumed tag names are listed inline so the operator
# can see what got rolled in. Override with --baseline if needed.
#
# Usage: release-github.sh [--baseline <tag>] [--draft] [--fail-if-exists] [<tag>]
#   <tag>             default: latest tag (git describe --tags --abbrev=0)
#   --baseline        override the auto-detected previous-deployed baseline
#   --draft           create the release as draft instead of publishing
#   --fail-if-exists  refuse to adopt a release that already exists (exit 3)
#
# Output contract — the last stdout line is machine-readable, and states the
# release's ACTUAL state as GitHub reports it, never the flag that was passed:
#   created draft=<true|false> url=<url>   this run created the release
#   exists draft=<true|false> url=<url>    a release was already there
# Exit codes: 0 created or adopted · 1 environment/tag error · 2 usage ·
#             3 already existed and --fail-if-exists was given.
#
# A caller that composes or edits the body afterwards must read `exists` vs
# `created` and `draft=`: adopting a published release as if it were a fresh
# draft edits a live, already-announced release.
set -euo pipefail

TAG=""
EXPLICIT_BASELINE=""
DRAFT=false
FAIL_IF_EXISTS=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline) EXPLICIT_BASELINE="$2"; shift 2 ;;
    --baseline=*) EXPLICIT_BASELINE="${1#--baseline=}"; shift ;;
    --draft) DRAFT=true; shift ;;
    --fail-if-exists) FAIL_IF_EXISTS=true; shift ;;
    --help|-h)
      echo "usage: release-github.sh [--baseline <tag>] [--draft] [--fail-if-exists] [<tag>]"
      exit 0
      ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) TAG="$1"; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Preflight: gh CLI must be installed + authenticated.
if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found on PATH — install from https://cli.github.com/" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh CLI not authenticated — run: gh auth login" >&2
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

# The release's real state, as one `draft=<bool> url=<url>` fragment.
release_state() {
  gh release view "$TAG" --json isDraft,url --jq '"draft=\(.isDraft) url=\(.url)"'
}

# Idempotency: a re-run in a recovery scenario adopts the existing release
# instead of erroring — but says WHAT it adopted. A leftover draft, an
# already-published release and a release this run created all used to exit 0
# with nothing to tell them apart.
if gh release view "$TAG" >/dev/null 2>&1; then
  STATE=$(release_state)
  case "$STATE" in
    draft=true*) echo "release for $TAG already exists as a DRAFT (not published)" ;;
    *)           echo "release for $TAG already exists and is PUBLISHED" ;;
  esac
  echo "exists $STATE"
  [ "$FAIL_IF_EXISTS" = "true" ] && exit 3
  exit 0
fi

# Compute the baseline = previous DEPLOYED tag, and collect subsumed
# tags between the baseline and $TAG. One gh API call (release list)
# rather than per-tag probes.
if [ -n "$EXPLICIT_BASELINE" ]; then
  BASELINE="$EXPLICIT_BASELINE"
  SUBSUMED=""
else
  # --exclude-drafts: `gh release list` includes drafts by default, and a
  # stray draft on an older tag would otherwise become the baseline and move
  # the changelog range, silently.
  RELEASE_TAGS=$(gh release list --exclude-drafts --limit 200 --json tagName --jq '.[].tagName' | tr -d '\r' | tr '\n' ' ')
  BASELINE=""
  SUBSUMED_LIST=""
  SEEN_CURRENT=false
  for t in $(git tag --sort=-creatordate); do
    if [ "$t" = "$TAG" ]; then
      SEEN_CURRENT=true
      continue
    fi
    [ "$SEEN_CURRENT" = "true" ] || continue
    # Match exact tag name in the release-tag set (space-padded to
    # avoid partial-prefix false positives).
    if printf ' %s ' "$RELEASE_TAGS" | grep -q " $t "; then
      BASELINE="$t"
      break
    fi
    SUBSUMED_LIST="${SUBSUMED_LIST}\`$t\`, "
  done
  SUBSUMED="${SUBSUMED_LIST%, }"
fi

# Push the tag if it isn't on origin yet — gh release create needs it
# on the remote, otherwise the release points at a phantom ref.
if ! git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "refs/tags/$TAG$"; then
  if git remote get-url origin >/dev/null 2>&1; then
    git push origin "$TAG"
  else
    echo "no origin remote configured — cannot push tag" >&2
    exit 1
  fi
fi

# Generate the body via the stack-agnostic release.sh
if [ -n "$BASELINE" ]; then
  BODY=$(bash "$SCRIPT_DIR/release.sh" --baseline "$BASELINE" "$TAG")
else
  BODY=$(bash "$SCRIPT_DIR/release.sh" "$TAG")
fi

# Inject the subsumed-tags note above the metadata footer if any
if [ -n "$SUBSUMED" ]; then
  BODY=$(printf '%s\n' "$BODY" \
    | awk -v note="_This release subsumes undeployed tags: $SUBSUMED._" \
        'BEGIN{inserted=0} /^---$/ && !inserted {print note "\n"; inserted=1} {print}')
fi

# Create the release.
GH_ARGS=("$TAG" "--title" "$TAG" "--notes-file" "-")
[ "$DRAFT" = "true" ] && GH_ARGS+=("--draft")
printf '%s' "$BODY" | gh release create "${GH_ARGS[@]}" >/dev/null

# Report what GitHub says happened, not what was asked for. Where publishing a
# release triggers a deploy or a registry publish, "published" printed for a
# draft tells the operator the irreversible step already ran.
STATE=$(release_state)
URL=${STATE#*url=}
case "$STATE" in
  draft=true*) echo "✓ draft release created (not published): $URL" ;;
  *)           echo "✓ published release: $URL" ;;
esac
echo "created $STATE"
