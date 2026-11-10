#!/usr/bin/env bash
# The release ci gate: the `ci-status` job of release.yml runs this file, and
# tests/scripts/release_ci_gate_test.ts runs it against a stubbed `gh`. Needs
# GH_TOKEN, REPO and SHA; writes GITHUB_STEP_SUMMARY.
#
# The tag is what publishes, and nothing here used to ask whether the commit
# it points at is green.
#
# `ci.yml` runs the suite on three OSes on every push to `main`; this workflow
# runs none of it. So a tag pushed over a red `main` compiled, checksummed and
# published a Release, entirely green, with a known-failing commit inside it.
# The only thing standing in the way was `.specnaut/release/preflight.sh` — a
# script an operator runs locally and can skip, and which cannot be consulted
# from here. Observed on the v4.2.2 attempt: `main` was red on Windows and the
# tag pipeline would not have noticed.
#
# `ci` on this SHA starts at the same moment as this workflow — the release
# commit is pushed to `main` immediately before the tag — so the job WAITS
# rather than reading a conclusion that does not exist yet. What it does with
# each outcome is the whole design:
#
#   concluded failure/cancelled/timed_out → block. The tag survives a failed
#     workflow, so the fix is to repair `main` and re-run this run; nothing
#     needs deleting and re-tagging.
#   concluded success                     → proceed.
#   no run for this SHA at all            → warn and proceed. A repository or
#     ref where `ci` does not run must not be unable to release.
#   still running after the window        → warn and proceed. Blocking a
#     release on a stuck runner trades one failure mode for a worse one; the
#     window is set well past `ci`'s historical duration so this is rare and
#     worth reading when it happens.

set -euo pipefail

# 25 minutes at 20s. `ci` has historically concluded in 8-11 minutes,
# the Windows cross-smoke job being the long pole.
deadline=$(( SECONDS + 25 * 60 ))
status=""
conclusion=""

while :; do
  # `--jq` on an empty result yields an empty string, not an error.
  read -r status conclusion <<< "$(
    gh api "repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=1" \
      --jq '.workflow_runs[0] | "\(.status) \(.conclusion // "-")"' 2>/dev/null || true
  )"

  [ "$status" = "completed" ] && break
  if [ "$SECONDS" -ge "$deadline" ]; then break; fi
  sleep 20
done

{
  echo "### CI status on the tagged commit"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| Commit | \`${SHA}\` |"
  echo "| ci run status | \`${status:-none}\` |"
  echo "| ci run conclusion | \`${conclusion:--}\` |"
} >> "$GITHUB_STEP_SUMMARY"

if [ -z "$status" ]; then
  echo "::warning::No ci.yml run found for ${SHA}. The release proceeds, but nothing has verified this commit."
  exit 0
fi

if [ "$status" != "completed" ]; then
  echo "::warning::ci.yml on ${SHA} was still ${status} after the wait window. The release proceeds unverified — check the run before announcing it."
  exit 0
fi

if [ "$conclusion" != "success" ]; then
  echo "::error::ci.yml concluded ${conclusion} on ${SHA}. Refusing to publish a release over a failing commit. Fix main, then re-run this workflow — the tag stays valid."
  exit 1
fi

echo "ci.yml is green on ${SHA}"
