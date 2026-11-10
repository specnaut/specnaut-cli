#!/usr/bin/env bash
# Is this macOS binary ours? (cli#428)
#
#   check-macos-signature.sh <team-id> <identifier> <file>
#
# Shared by release.yml's macos-smoke (each signed binary, before publishing)
# and .specnaut/release/postflight.sh (each published asset). Needs Apple's
# `codesign`, so macOS only. Prints one `OK <name>: …` line and exits 0, or one
# `FAIL <name>: <the clause that failed>` line and exits 1.
#
# 1. `codesign --verify --strict` against an EXPLICIT requirement: Apple
#    anchor, Developer ID intermediate, Developer ID Application leaf, the team,
#    the identifier. The chain is verified, not read from text.
# 2. The binary's own designated requirement names the identifier and the team
#    and pins no cdhash. A cdhash requirement is the ad-hoc signature that made
#    the Keychain forget "Always Allow" on every update; the requirement is what
#    the Keychain grant is tied to.
set -uo pipefail

[ "$#" -eq 3 ] || { echo "usage: check-macos-signature.sh <team-id> <identifier> <file>" >&2; exit 2; }
team="$1" identifier="$2" file="$3"
name="${file##*/}"
fail() { echo "FAIL $name: $1"; exit 1; }

requirement="=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$team\" and identifier \"$identifier\""
codesign --verify --strict -R "$requirement" "$file" >/dev/null 2>&1 \
  || fail "does not verify as a Developer ID Application of $team with identifier $identifier"

dr="$(codesign -d -r- "$file" 2>&1)" || fail "its designated requirement cannot be read"
[[ "$dr" != *cdhash* ]] || fail "its designated requirement pins a cdhash (an ad-hoc signature)"
[[ "$dr" == *"identifier \"$identifier\""* ]] \
  && [[ "$dr" == *"subject.OU] = $team"* || "$dr" == *"subject.OU] = \"$team\""* ]] \
  || fail "its designated requirement does not name $identifier and $team"

echo "OK $name: Developer ID Application of $team, identifier $identifier; designated requirement names both"
