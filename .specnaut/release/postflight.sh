#!/usr/bin/env bash
# Specnaut CLI release postflight. Verifies the GitHub Release shipped end-to-end.
# Invoked AFTER the tag has been pushed and release.yml has been triggered.
# Usage: postflight.sh <tag>
set -euo pipefail

TAG="${1:?usage: postflight.sh <tag>}"
REPO="specnaut/specnaut-cli"

echo "▶ finding release.yml run for $TAG"
# release.yml is push-tag-triggered; the GitHub Actions API can take 5-30s to
# register a new run, so poll with retries before giving up. Search up to 20
# entries so back-to-back releases don't push our run off the page. The
# substitution is wrapped with `|| true` so transient gh failures (auth
# blip, rate limit during the post-release surge) don't kill the loop —
# they just count as "not found yet" and we retry.
run_id=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  run_id="$(gh run list --workflow release.yml --limit 20 --json databaseId,headBranch --jq ".[] | select(.headBranch == \"$TAG\") | .databaseId" 2>/dev/null | head -1 || true)"
  [ -n "$run_id" ] && break
  echo "  waiting for release.yml run to appear ($i/10)…"
  sleep 15
done
[ -n "$run_id" ] || { echo "❌ no release.yml run found for $TAG after 150s of polling"; exit 1; }
echo "  run id: $run_id"

echo "▶ watching release.yml until completion"
gh run watch "$run_id" --exit-status

echo "▶ verifying GitHub Release exists with assets"
asset_count="$(gh api "repos/$REPO/releases/tags/$TAG" --jq '.assets | length')"
[ "$asset_count" -ge 10 ] || { echo "❌ release has $asset_count assets (expected ≥10: 5 binaries + 5 checksums)"; exit 1; }

echo "▶ verifying Homebrew tap formula bumped to ${TAG#v}"
# Match the exact commit-message template used by scripts/bump-tap-formula.ts
# instead of a bare version glob — catches both message-template drift and
# tag-not-bumped cases. Soft-warn (don't exit), since the bump can land slightly
# after the release.yml run completes. We track the soft-warn so the final
# status differentiates "all green" from "release shipped but tap unverified".
homebrew_warned=0
formula_msg="$(gh api repos/mkrlabs/homebrew-tap/commits/main --jq '.commit.message' | head -1)"
expected_prefix="chore: bump specnaut to ${TAG#v}"
if [[ "$formula_msg" != "$expected_prefix"* ]]; then
  echo "⚠ Homebrew formula tip message != '$expected_prefix*': '$formula_msg'"
  homebrew_warned=1
fi

echo "▶ refreshing local binary"
specnaut self-update
local_version="$(specnaut --version | awk '{print $2}')"
[ "v$local_version" = "$TAG" ] || { echo "❌ local binary at v$local_version, expected $TAG"; exit 1; }

if [ "$homebrew_warned" -eq 1 ]; then
  echo "✅ release shipped — $TAG is live (⚠ tap bump unverified, re-check in ~60s)"
else
  echo "✅ postflight passed — $TAG is live"
fi
