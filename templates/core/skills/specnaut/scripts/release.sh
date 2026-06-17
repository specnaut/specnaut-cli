#!/usr/bin/env bash
# Generate categorized release notes for commits in <baseline>..<tag>.
#
# Stack-agnostic: emits the release-body Markdown to stdout. Per-backend
# wrappers (release-github.sh, release-gitlab.sh) consume this output
# and POST it to the respective Releases API.
#
# Usage: release.sh [--baseline <tag>] [<tag>]
#   <tag>           default: latest tag (git describe --tags --abbrev=0)
#   --baseline      default: previous tag chronologically before <tag>;
#                   per-backend wrappers override this to "previous
#                   tag that has a published release attached" so commits
#                   landed under undeployed tags are not silently skipped.
set -euo pipefail

BASELINE=""
TAG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    --baseline=*) BASELINE="${1#--baseline=}"; shift ;;
    --help|-h)
      echo "usage: release.sh [--baseline <tag>] [<tag>]"
      echo
      echo "  Emits categorized release-note Markdown to stdout for"
      echo "  commits in <baseline>..<tag>. Default tag = latest tag."
      echo "  Default baseline = previous tag chronologically."
      exit 0
      ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) TAG="$1"; shift ;;
  esac
done

git fetch --tags --quiet 2>/dev/null || true

if [ -z "$TAG" ]; then
  TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
  if [ -z "$TAG" ]; then
    echo "no tags found in this repository — create one first with tag.sh" >&2
    exit 1
  fi
fi

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag '$TAG' not found" >&2
  exit 1
fi

if [ -z "$BASELINE" ]; then
  BASELINE=$(git tag --sort=-creatordate \
    | awk -v cur="$TAG" 'BEGIN{found=0} $0==cur{found=1;next} found==1{print;exit}')
fi

if [ -n "$BASELINE" ] && ! git rev-parse "$BASELINE" >/dev/null 2>&1; then
  echo "baseline tag '$BASELINE' not found" >&2
  exit 1
fi

if [ -z "$BASELINE" ]; then
  RANGE_LABEL="_Initial release — all commits up to \`$TAG\`._"
  COMMITS=$(git log --format='%h %s' "$TAG")
else
  RANGE_LABEL="_Changes from \`$BASELINE\` to \`$TAG\`._"
  COMMITS=$(git log --format='%h %s' "$BASELINE..$TAG")
fi

classify() {
  # Conventional Commits prefix matching. The `!` breaking-change marker
  # does not change the bucket — `feat!:` is still Features.
  case "$1" in
    feat:*|feat\(*\)*:*|feat!:*|feat\(*\)!:*) printf 'Features' ;;
    fix:*|fix\(*\)*:*|fix!:*|fix\(*\)!:*) printf 'Bug Fixes' ;;
    perf:*|perf\(*\)*:*|perf!:*|perf\(*\)!:*) printf 'Performance' ;;
    refactor:*|refactor\(*\)*:*|refactor!:*|refactor\(*\)!:*) printf 'Refactors' ;;
    docs:*|docs\(*\)*:*|docs!:*|docs\(*\)!:*) printf 'Documentation' ;;
    test:*|test\(*\)*:*|test!:*|test\(*\)!:*) printf 'Tests' ;;
    build:*|build\(*\)*:*|build!:*|build\(*\)!:*|ci:*|ci\(*\)*:*|ci!:*|ci\(*\)!:*) printf 'Build & CI' ;;
    chore:*|chore\(*\)*:*|chore!:*|chore\(*\)!:*) printf 'Chores' ;;
    style:*|style\(*\)*:*|style!:*|style\(*\)!:*) printf 'Style' ;;
    *) printf 'Other' ;;
  esac
}

BUCKET_FEATURES=""
BUCKET_FIXES=""
BUCKET_PERF=""
BUCKET_REFACTORS=""
BUCKET_DOCS=""
BUCKET_TESTS=""
BUCKET_BUILD=""
BUCKET_CHORES=""
BUCKET_STYLE=""
BUCKET_OTHER=""

while IFS= read -r line; do
  [ -z "$line" ] && continue
  sha="${line%% *}"
  subject="${line#* }"
  bucket=$(classify "$subject")
  entry="- ${sha} ${subject}"
  case "$bucket" in
    Features) BUCKET_FEATURES+="${entry}"$'\n' ;;
    "Bug Fixes") BUCKET_FIXES+="${entry}"$'\n' ;;
    Performance) BUCKET_PERF+="${entry}"$'\n' ;;
    Refactors) BUCKET_REFACTORS+="${entry}"$'\n' ;;
    Documentation) BUCKET_DOCS+="${entry}"$'\n' ;;
    Tests) BUCKET_TESTS+="${entry}"$'\n' ;;
    "Build & CI") BUCKET_BUILD+="${entry}"$'\n' ;;
    Chores) BUCKET_CHORES+="${entry}"$'\n' ;;
    Style) BUCKET_STYLE+="${entry}"$'\n' ;;
    *) BUCKET_OTHER+="${entry}"$'\n' ;;
  esac
done <<<"$COMMITS"

emit_bucket() {
  local label="$1"
  local content="$2"
  [ -z "$content" ] && return
  printf '### %s\n\n%s\n' "$label" "$content"
}

TAG_COMMIT=$(git rev-parse "$TAG^{}" 2>/dev/null || git rev-parse "$TAG")
TAG_SHORT=$(git rev-parse --short "$TAG_COMMIT")

printf '## What'\''s changed in %s\n\n' "$TAG"
printf '%s\n\n' "$RANGE_LABEL"
emit_bucket "Features" "$BUCKET_FEATURES"
emit_bucket "Bug Fixes" "$BUCKET_FIXES"
emit_bucket "Performance" "$BUCKET_PERF"
emit_bucket "Refactors" "$BUCKET_REFACTORS"
emit_bucket "Documentation" "$BUCKET_DOCS"
emit_bucket "Tests" "$BUCKET_TESTS"
emit_bucket "Build & CI" "$BUCKET_BUILD"
emit_bucket "Chores" "$BUCKET_CHORES"
emit_bucket "Style" "$BUCKET_STYLE"
emit_bucket "Other" "$BUCKET_OTHER"

printf -- '---\nCommit: `%s`\n' "$TAG_SHORT"
