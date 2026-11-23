#!/usr/bin/env bash
# Writes the release's own copy of install.sh: the repository's, with the tag written in.
#
# Usage: stage-installer.sh <tag> <out>     (release.yml passes "$GITHUB_REF_NAME" dist/install.sh)
#
# The staged copy installs <tag> unless the user pins another version, so
# `releases/download/<tag>/install.sh` names the script and the binary in one URL, and
# `releases/latest/download/install.sh` needs no API lookup (cli#817). It is attested, in a bundle
# of its own, so the tag is checked before it is written: it must be the tag this workflow runs for,
# the version deno.json declares, and a version install.sh itself would accept.
#
# The placeholder must occur exactly once, as a whole line, and the copy must parse; anything else
# fails the release before the attestation step signs it.
#
# STAGE_INSTALLER_SOURCE (the file staged) exists for the tests; a release uses none.
set -euo pipefail

TAG="${1:-}"
OUT="${2:-}"
[ -n "$TAG" ] && [ -n "$OUT" ] || { echo "usage: stage-installer.sh <tag> <out>" >&2; exit 2; }
root="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="${STAGE_INSTALLER_SOURCE:-$root/install.sh}"
PLACEHOLDER="RELEASE_TAG='__SPECNAUT_RELEASE_TAG__'"

fail() { echo "::error::stage-installer: $*" >&2; exit 1; }

re='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
[[ "$TAG" =~ $re ]] || fail "'$TAG' is not a release tag"
[ "${GITHUB_REF_NAME:-}" = "$TAG" ] || fail "'$TAG' is not the tag this run is for ('${GITHUB_REF_NAME:-}')"
BIN_VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/deno.json")"
[ "$TAG" = "v$BIN_VERSION" ] || fail "'$TAG' is not 'v$BIN_VERSION', the version deno.json declares"

found="$(grep -cxF "$PLACEHOLDER" "$SOURCE" || true)"
[ "$found" = 1 ] || fail "$SOURCE holds the placeholder line $found times, expected once"
baked="RELEASE_TAG='$TAG'"
sed "s/^${PLACEHOLDER}\$/${baked}/" "$SOURCE" > "$OUT" # the tag is [0-9A-Za-z.-]: nothing sed reads

[ "$(grep -cxF "$baked" "$OUT" || true)" = 1 ] || fail "$OUT does not carry $baked once"
! grep -qF "__SPECNAUT_RELEASE_TAG__" "$OUT" || fail "$OUT still carries the placeholder"
bash -n "$OUT" || fail "$OUT does not parse"
chmod 644 "$OUT"
echo "staged $OUT for $TAG"
