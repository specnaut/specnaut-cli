#!/usr/bin/env bash
# Local-only release flow: generate categorized release notes for a tag
# and write them to a Markdown file in the current directory. No remote
# API calls. No tag pushing. Use when the project has no GitHub/GitLab
# remote — or when you just want a Markdown artifact you can paste into
# any release UI or attach to a deploy email.
#
# Usage: release-local.sh [--baseline <tag>] [--out <path>] [<tag>]
#   <tag>           default: latest tag (git describe --tags --abbrev=0)
#   --baseline      override the auto-detected baseline (default: previous
#                   tag by date — there is no "deployed" notion for local)
#   --out           output path (default: RELEASE_NOTES_<tag>.md)
set -euo pipefail

TAG=""
BASELINE=""
OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    --baseline=*) BASELINE="${1#--baseline=}"; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --out=*) OUT="${1#--out=}"; shift ;;
    --help|-h)
      echo "usage: release-local.sh [--baseline <tag>] [--out <path>] [<tag>]"
      exit 0
      ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) TAG="$1"; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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

# Compose release.sh args
ARGS=()
[ -n "$BASELINE" ] && ARGS+=(--baseline "$BASELINE")
ARGS+=("$TAG")

BODY=$(bash "$SCRIPT_DIR/release.sh" "${ARGS[@]}")

if [ -z "$OUT" ]; then
  OUT="RELEASE_NOTES_${TAG}.md"
fi

printf '%s\n' "$BODY" > "$OUT"

LINES=$(wc -l < "$OUT" | tr -d ' ')
echo "✓ wrote $OUT ($LINES lines)"
echo "  paste contents into your release UI, attach to a deploy email,"
echo "  or pipe to a custom publisher"
