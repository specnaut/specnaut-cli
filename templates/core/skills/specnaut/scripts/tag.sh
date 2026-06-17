#!/usr/bin/env bash
# Create an annotated git tag using the project's versioning scheme.
#
# The scheme is baked at scaffold time — the `# BEGIN: scheme=X` blocks
# below are stripped by the Specnaut bundler so only the chosen scheme's
# logic ships on disk. To change schemes after init, re-run
# `specnaut init` and pick the other option.
#
# Usage: tag.sh [--no-push] [--bump <major|minor|patch>] [<commit-sha>]
set -euo pipefail

NO_PUSH=false
BUMP="patch"
COMMIT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-push) NO_PUSH=true; shift ;;
    --bump) BUMP="$2"; shift 2 ;;
    --bump=*) BUMP="${1#--bump=}"; shift ;;
    --help|-h)
      echo "usage: tag.sh [--no-push] [--bump <major|minor|patch>] [<commit-sha>]"
      exit 0
      ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) COMMIT="$1"; shift ;;
  esac
done

COMMIT="${COMMIT:-HEAD}"
COMMIT_SHA=$(git rev-parse "$COMMIT")
git fetch --tags --quiet 2>/dev/null || true

# BEGIN: scheme=semver
# SemVer scheme: vMAJOR.MINOR.PATCH. The --bump flag picks the bump
# direction (default patch). When no tag exists yet, start at v0.1.0.
LATEST=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1 || true)
if [ -z "$LATEST" ]; then
  NEW="v0.1.0"
  echo "no previous semver tag — starting at $NEW"
else
  raw="${LATEST#v}"
  IFS='.' read -r MAJOR MINOR PATCH <<<"$raw"
  case "$BUMP" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
    *) echo "invalid --bump '$BUMP' (expected major|minor|patch)" >&2; exit 2 ;;
  esac
  NEW="v${MAJOR}.${MINOR}.${PATCH}"
fi

if ! printf '%s' "$NEW" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "computed tag '$NEW' failed SemVer validation" >&2
  exit 1
fi
# END: scheme=semver

# BEGIN: scheme=date
# Date-based scheme: vYY.M.D[a-z]. No leading zeros on month/day; letter
# suffix increments for same-day re-tags (a..z; 26th tag in one day
# aborts — wait for tomorrow or tag manually).
YY=$(date +%y)
M=$((10#$(date +%m)))
D=$((10#$(date +%d)))
PREFIX="v${YY}.${M}.${D}"

LATEST_LETTER=$(git tag --list "${PREFIX}[a-z]" | sed -E "s|^${PREFIX}||" | sort | tail -n1 || true)
if [ -z "$LATEST_LETTER" ]; then
  NEW="${PREFIX}a"
elif [ "$LATEST_LETTER" = "z" ]; then
  echo "letter suffix exhausted (z) for $PREFIX — wait for tomorrow or tag manually" >&2
  exit 1
else
  NEXT_LETTER=$(printf '%s' "$LATEST_LETTER" | tr 'a-y' 'b-z')
  NEW="${PREFIX}${NEXT_LETTER}"
fi

if ! printf '%s' "$NEW" | grep -qE '^v[0-9]{2}\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])[a-z]$'; then
  echo "computed tag '$NEW' failed date-based validation" >&2
  exit 1
fi
# END: scheme=date

if git rev-parse "$NEW" >/dev/null 2>&1; then
  echo "tag '$NEW' already exists — refusing to clobber" >&2
  exit 1
fi

SUBJECT=$(git log -1 --format=%s "$COMMIT_SHA")
echo "creating annotated tag $NEW on $COMMIT_SHA"
echo "  subject: $SUBJECT"
git tag -a "$NEW" -m "Release $NEW

$SUBJECT" "$COMMIT_SHA"

if [ "$NO_PUSH" = "true" ]; then
  echo "✓ tagged $NEW (local only — --no-push)"
elif git remote get-url origin >/dev/null 2>&1; then
  git push origin "$NEW"
  echo "✓ tagged $NEW and pushed to origin"
else
  echo "✓ tagged $NEW (no origin configured — tag is local-only)"
fi
