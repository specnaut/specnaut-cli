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
# Soft-warn, not exit. Under `set -e` a red job used to terminate postflight on
# this line — before the asset assertion, the tap check, the marketplace check,
# and above all the docs-site dispatch that refreshes specnaut.com/version.json.
# The bundled specnaut-guide agent reads that file to tell users whether they
# are behind, so a failure in a LATER, reversible publish step silently cost the
# version feed and the tool then told everyone they were up to date.
#
# Everything below runs after the release has already been published, which is
# why the rest of this script warns rather than aborts. This line is the one
# that did not, and #523 added a new way for the job to go red after publish,
# which made the cascade reachable. The failure still reaches the final status —
# this is about ordering, not about hiding it.
run_failed=0
gh run watch "$run_id" --exit-status || run_failed=1
[ "$run_failed" -eq 1 ] && echo "⚠ release.yml run $run_id ended red — verifying what shipped anyway"

echo "▶ verifying GitHub Release exists with assets"
asset_count="$(gh api "repos/$REPO/releases/tags/$TAG" --jq '.assets | length')"
[ "$asset_count" -ge 11 ] || { echo "❌ release has $asset_count assets (expected ≥11: 5 binaries + 5 checksums + 1 attestation bundle)"; exit 1; }

# The two packaging channels PULL from this repository's public Releases API;
# nothing is pushed to them, and neither this repo nor they hold a credential
# for the other. Their own cron would pick this release up within the interval —
# dispatching here just removes the wait, using the operator's `gh` auth rather
# than a secret stored in a public repository.
#
# A dispatch exits 0 the moment GitHub ACCEPTS the request. That is not
# evidence of anything, which is why each dispatch is followed by reading the
# published artefact back.
# Both channels resolve exclusively through `releases/latest`. Nothing so far
# has checked that it points at THIS tag: `asset_count` above reads
# `releases/tags/$TAG`, which is true of a draft or a prerelease too. If latest
# still names the previous version, both syncs read it, print "already at
# <old> — nothing to do", and exit 0 GREEN having published nothing. A channel
# that ran and found nothing is indistinguishable from one that worked, so the
# check has to happen here, before they are asked to run at all.
echo "▶ verifying releases/latest points at $TAG"
latest="$(gh api "repos/$REPO/releases/latest" --jq '.tag_name' 2>/dev/null || echo "")"
[ "$latest" = "$TAG" ] || {
  echo "❌ releases/latest is '${latest:-<unreadable>}', not $TAG — both packaging"
  echo "   syncs would no-op green. Mark $TAG as latest, then re-run this script."
  exit 1
}

# Dispatched through the REST endpoint, not `gh workflow run`. That command
# resolves the repository's default branch over GraphQL first, so it fails
# whenever the GraphQL quota is spent even though the dispatch itself is a
# REST call against a separate, usually untouched budget. That is not
# hypothetical: the v4.0.1 release hit it with graphql at 0/5000 and core at
# 4952/5000, and all three dispatches failed on a limit that did not apply to
# the work being asked for.
#
# Failures print their reason. The previous version discarded stderr, so a
# spent quota, a missing `workflow` scope and a 404 were the same message.
echo "▶ dispatching the packaging syncs (they pull; nothing is pushed to them)"
for target in homebrew-tap specnaut-marketplace; do
  dispatch_err="$(gh api -X POST \
    "repos/specnaut/$target/actions/workflows/sync-from-cli.yml/dispatches" \
    -f ref=main 2>&1 >/dev/null)"
  if [ -z "$dispatch_err" ]; then
    echo "  dispatched $target"
  else
    echo "  ⚠ could not dispatch $target — its cron will pick this up within the hour"
    echo "    $(printf '%s' "$dispatch_err" | head -1)"
  fi
done

echo "▶ verifying Homebrew tap formula bumped to ${TAG#v}"
# Read the formula itself, not a commit message. The message was the tell while
# a script here wrote it; now the tap writes its own, so the only thing that
# actually matters is what the published file declares. Soft-warn: the sync is
# asynchronous by design, and the release has already shipped by this point.
homebrew_warned=0
# 12 attempts, not 6: every recorded run of this sync so far took the "already
# at <version> — nothing to do" early exit, so the real bump path — one API read,
# four asset downloads, a rewrite, a commit and a push — has never been timed.
# 50s of sleep would have reported a warning on a completely healthy first run.
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  formula="$(gh api repos/specnaut/homebrew-tap/contents/Formula/specnaut.rb \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || true)"
  case "$formula" in
    *"version \"${TAG#v}\""*) break ;;
  esac
  [ "$attempt" -eq 12 ] && homebrew_warned=1 || sleep 10
done
if [ "$homebrew_warned" -eq 1 ]; then
  echo "⚠ tap formula does not declare ${TAG#v} yet — its sync runs on an hourly cron"
fi

# The docs site derives `version.json` from the latest CLI release at *build*
# time, and it only builds on a push to its own repo or on a nightly cron. So
# every release left the site announcing the previous version for up to a day
# — and `version.json` is exactly what the `specnaut-guide` agent reads to
# answer "am I up to date?". It answered "yes" to users who were not.
#
# Soft-warn, never fail: the release itself has already shipped by this point,
# and a docs rebuild that did not fire is a stale page, not a broken binary.
docs_warned=0
echo "▶ refreshing the docs site (version.json tracks the latest release)"
# REST, for the same reason as the two syncs above — `gh workflow run` needs
# GraphQL to resolve the default branch and dies with the quota rather than
# with the dispatch.
dispatch_err="$(gh api -X POST \
  repos/specnaut/specnaut-web/actions/workflows/pages.yml/dispatches \
  -f ref=main 2>&1 >/dev/null)" && dispatch_ok=1 || dispatch_ok=0
if [ "$dispatch_ok" -eq 1 ]; then
  # A dispatch exits 0 the moment GitHub *accepts* the request; it never
  # observes the resulting run. Dispatching therefore proves only that we have
  # permission. Poll the artefact itself — version.json is the thing the
  # `specnaut-guide` agent reads to answer "am I up to date?", so it is the
  # signal that matters, and checking it beats watching the job.
  echo "  dispatched specnaut-web pages.yml — waiting for version.json"
  published=""
  for _ in $(seq 1 18); do
    sleep 5
    published="$(curl -fsSL https://specnaut.com/version.json 2>/dev/null | grep -o '"version"[^,}]*' | grep -o '[0-9][^"]*' || true)"
    [ "$published" = "${TAG#v}" ] && break
  done
  if [ "$published" = "${TAG#v}" ]; then
    echo "  specnaut.com/version.json now reports ${TAG#v}"
  else
    echo "⚠ specnaut.com/version.json still reports '${published:-unreachable}' after 90s."
    echo "  The rebuild was dispatched; it may still be running, or it failed."
    docs_warned=1
  fi
else
  echo "⚠ could not dispatch specnaut-web pages.yml: ${dispatch_err:-no error output}"
  echo "  specnaut.com/version.json will report the previous version until the"
  echo "  nightly rebuild."
  docs_warned=1
fi

# Verify the marketplace catalog by reading the PUBLISHED file, not by trusting
# the sync step's exit code. That step reported `success` on every release from
# 2026-05-22 to 2026-08-21 while publishing nothing: its jq selector matched no
# entry, the tree stayed clean, and it took its "already up to date" branch.
#
# SOFT-WARN, not a hard failure: by this point the tag is pushed, the binaries
# are published and the Homebrew formula is bumped. A stale catalog means one
# distribution channel is behind — worth shouting about, not worth reporting the
# whole release as failed. The hard gate lives in the sync script itself, which
# now exits non-zero when it cannot prove it published.
marketplace_warned=0
echo "▶ verifying the marketplace catalog was published"
# Its own retry loop. This read used to be single-shot, and the only slack it
# had was however long the docs poll above happened to spend — which collapses
# to nothing when that poll's dispatch fails fast. A verification whose timing
# budget is an accident of an unrelated step's failure mode is not one.
catalog_version=""
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  catalog_version="$(gh api repos/specnaut/specnaut-marketplace/contents/.claude-plugin/marketplace.json \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null \
    | jq -r '.plugins[] | select(.name=="specnaut-plugin") | .version' 2>/dev/null || true)"
  [ "$catalog_version" = "${TAG#v}" ] && break
  [ "$attempt" -eq 12 ] || sleep 10
done
if [ "$catalog_version" = "${TAG#v}" ]; then
  echo "  catalog lists ${TAG#v}"
else
  echo "⚠ marketplace catalog lists '${catalog_version:-unreadable}', expected ${TAG#v}."
  echo "  Claude Code / Copilot CLI marketplace users are on the previous version."
  marketplace_warned=1
fi

# Soft-warn, like the two above. A self-update failure says the *operator's*
# binary is stale — `.specnaut/release/README.md` documents exactly that case,
# where the installed binary predates a fix to self-update itself. That is a
# different page at 3am from "the release is broken", and letting `set -e` abort
# here would throw away the tap and docs verdicts already computed.
selfupdate_warned=0
echo "▶ refreshing local binary"
if specnaut self-update; then
  local_version="$(specnaut --version | awk '{print $2}')"
  if [ "v$local_version" != "$TAG" ]; then
    echo "⚠ local binary at v$local_version, expected $TAG"
    selfupdate_warned=1
  fi
else
  echo "⚠ specnaut self-update failed — your local binary is not $TAG."
  echo "  This does not affect the published release; reinstall to catch up."
  selfupdate_warned=1
fi

# The attestation bundle is the one asset whose CONTENT decides whether users
# can update at all. `asset_count` above proves it was uploaded; it passes just
# as happily on an empty file or on a bundle carrying another tag's identity —
# and every installed binary would then refuse this release, discovered by users
# rather than here. So read the published bundle back and check the identity it
# actually carries, the same way `self-update` will.
#
# Soft-warn, like every other check below the publish line: the release already
# exists by now, and the operator's next move is a patch either way.
attestation_warned=0
bundle_tmp="$(mktemp -d)"
if gh release download "$TAG" --repo "$REPO" \
     --pattern "specnaut.attestation.sigstore.json" --dir "$bundle_tmp" >/dev/null 2>&1; then
  bundle_san="$(
    jq -r '.verificationMaterial.certificate.rawBytes // empty' \
      "$bundle_tmp/specnaut.attestation.sigstore.json" 2>/dev/null |
      base64 -d 2>/dev/null |
      openssl x509 -inform DER -noout -text 2>/dev/null |
      grep -o 'URI:[^ ,]*' || true
  )"
  # One bundle covers every platform, so "it exists" is not the question — the
  # question is whether the statement lists all of them. A glob that silently
  # matched fewer files would still publish a valid, correctly-signed bundle,
  # and the platforms it omitted would fail to update with an honest
  # `digest-mismatch` nobody could explain from here.
  bundle_subjects="$(
    jq -r '.dsseEnvelope.payload // empty' \
      "$bundle_tmp/specnaut.attestation.sigstore.json" 2>/dev/null |
      base64 -d 2>/dev/null |
      jq '.subject | length' 2>/dev/null || true
  )"
  # Derived from the compiler's own target list rather than written down again.
  # This script already carries the asset floor as a literal; a second hard-coded
  # count of the same thing is a second place for it to go stale.
  # `outName: "` with the quote, not `outName:` — the bare form also matches the
  # `type Target` declaration on line 8 and reports one target more than exist.
  # Same pattern `release_assets_gate_test.ts` uses to read this list.
  expected_subjects="$(grep -c 'outName: "' scripts/build.ts 2>/dev/null || true)"
  if [ -z "$expected_subjects" ] || [ "$expected_subjects" = "0" ]; then
    echo "⚠ could not read the target list from scripts/build.ts — attestation coverage NOT checked"
    attestation_warned=1
  else
    case "$bundle_subjects" in
      "$expected_subjects") : ;;
      "") echo "⚠ attestation bundle's signed statement could not be read"; attestation_warned=1 ;;
      *)  echo "⚠ attestation covers $bundle_subjects artefact(s), expected $expected_subjects"
          attestation_warned=1 ;;
    esac
  fi

  case "$bundle_san" in
    *"@refs/tags/$TAG")
      echo "✓ attestation bundle names $TAG and covers $bundle_subjects/$expected_subjects artefacts"
      ;;
    "")
      echo "⚠ attestation bundle published but its signing identity could not be read"
      attestation_warned=1
      ;;
    *)
      echo "⚠ attestation bundle names '$bundle_san', not @refs/tags/$TAG"
      attestation_warned=1
      ;;
  esac
else
  echo "⚠ no attestation bundle published for $TAG — self-update will refuse this release"
  attestation_warned=1
fi
rm -rf "$bundle_tmp"

# `|| true` is load-bearing: under `set -e` a bare `[ … ] && arr+=(…)` is exempt
# only while it is not the final command of the script. That makes the block
# position-dependent, and the next edit that moves it turns a green release red.
warnings=()
[ "$run_failed" -eq 1 ] && warnings+=("release.yml run $run_id ended red — read its log before trusting this release") || true
[ "$homebrew_warned" -eq 1 ] && warnings+=("tap bump unverified, re-check in ~60s") || true
[ "$docs_warned" -eq 1 ] && warnings+=("docs site stale, specnaut.com/version.json not updated") || true
[ "$marketplace_warned" -eq 1 ] && warnings+=("marketplace catalog stale, that channel is behind") || true
[ "$selfupdate_warned" -eq 1 ] && warnings+=("local binary not refreshed (does not affect the release)") || true
[ "$attestation_warned" -eq 1 ] && warnings+=("attestation bundle missing or unreadable — self-update will refuse this release") || true

# A red job is not a warning-flavoured success. The verifications above still
# ran and their results are worth printing, but the exit code has to say no.
if [ "$run_failed" -eq 1 ]; then
  joined="$(printf '%s; ' "${warnings[@]}")"
  echo "❌ postflight: release.yml failed for $TAG (${joined%; })"
  exit 1
fi

if [ "${#warnings[@]}" -gt 0 ]; then
  # `${warnings[*]}` joins on the FIRST character of IFS only, so `IFS='; '`
  # yields `;` with no space. Each warning already contains commas, so the
  # run-together form is genuinely hard to read. printf keeps the separator.
  joined="$(printf '%s; ' "${warnings[@]}")"
  echo "✅ release shipped — $TAG is live (⚠ ${joined%; })"
else
  echo "✅ postflight passed — $TAG is live"
fi
