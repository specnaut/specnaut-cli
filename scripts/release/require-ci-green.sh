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
#   no run for this SHA at all            → warn and proceed, after a short
#     wait for one to appear. A repository or ref where `ci` does not run must
#     not be unable to release.
#   the last call failed, no run read     → block. An API error is not an
#     answer: a failed call never replaces the last answer read, and never
#     reads as "no run".
#   still running after the window        → block. The window covers the
#     longest run `ci` can legitimately take, so a run still going past it is
#     stuck, and an unverified commit is not published. Re-run this workflow
#     once `ci` concludes; the tag stays valid.

set -euo pipefail

# The window is `ci`'s longest legitimate run: lint-test's timeout, then the
# cross-smoke job's, which waits for it (both in ci.yml), plus a margin for a
# queued runner. release_ci_gate_test.ts holds it to those two numbers, and
# release.yml's ci-status job to a timeout above it.
WAIT_MINUTES=180
# A run for the SHA appears within seconds of the push. One that has not after
# this long is not coming, and a ref without `ci` must not wait three hours.
APPEAR_MINUTES=10
deadline=$(( SECONDS + WAIT_MINUTES * 60 ))
appear_deadline=$(( SECONDS + APPEAR_MINUTES * 60 ))
status=""
conclusion=""
last_empty=""

while :; do
  # Only an answer moves the state: a failed call keeps the last one read, so an
  # API error at the deadline can never read as "no run" and let a release pass.
  if line="$(
    gh api "repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=1" \
      --jq '.workflow_runs[0] // empty | "\(.status) \(.conclusion // "-")"' 2>/dev/null
  )"; then
    last_empty=""
    if [ -n "$line" ]; then read -r status conclusion <<< "$line"; else last_empty=1; fi
  else
    last_empty=""
  fi

  [ "$status" = "completed" ] && break
  if [ "$SECONDS" -ge "$deadline" ]; then break; fi
  # "No run" only on a poll that answered empty, never across failed calls.
  if [ -n "$last_empty" ] && [ -z "$status" ] && [ "$SECONDS" -ge "$appear_deadline" ]; then break; fi
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

if [ -z "$status" ] && [ -z "$last_empty" ]; then
  echo "::error::Could not read the ci.yml runs for ${SHA}: the last call failed. Refusing to publish an unverified commit. Re-run this workflow — the tag stays valid."
  exit 1
fi

if [ -z "$status" ]; then
  echo "::warning::No ci.yml run found for ${SHA}. The release proceeds, but nothing has verified this commit."
  exit 0
fi

if [ "$status" != "completed" ]; then
  echo "::error::ci.yml on ${SHA} was still ${status} after ${WAIT_MINUTES} minutes. Refusing to publish an unverified commit. Re-run this workflow once ci concludes — the tag stays valid."
  exit 1
fi

if [ "$conclusion" != "success" ]; then
  echo "::error::ci.yml concluded ${conclusion} on ${SHA}. Refusing to publish a release over a failing commit. Fix main, then re-run this workflow — the tag stays valid."
  exit 1
fi

echo "ci.yml is green on ${SHA}"
