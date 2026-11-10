#!/usr/bin/env bash
# release.yml's `build` refuses an unsigned macOS binary BEFORE it attests or
# checksums anything (cli#428): the attestation and the .sha256 files must
# never bless one. tests/scripts/release_macos_signature_gate_test.ts runs it
# against real `rcodesign print-signature-info` output.
#
# Needs MACOS_JSON (the darwin rows of scripts/build.ts TARGETS), CANONICAL
# (true in specnaut/specnaut-cli), MACOS_TEAM_ID, MACOS_IDENTIFIER, and
# `rcodesign` on PATH. Reads dist/<outName>.
#
# `build` runs on Linux, so this reads the signature as TEXT: the embedded leaf
# certificate is a Developer ID Application of the team, and the designated
# requirement names the identifier and the team and pins no cdhash. It does not
# verify the chain — macos-smoke does, with Apple's `codesign` — so it says
# "signed", nothing stronger. A fork passes through with a warning.
set -euo pipefail

names="$(jq -r '.[].outName' <<<"$MACOS_JSON")"
[ -n "$names" ] || { echo "::error::the target table lists no macOS binary"; exit 1; }

# The first clause that fails, or nothing.
unsigned_reason() {
  local info="$1" dr
  dr="$(grep -F 'designated(' <<<"$info" || true)"
  grep -qE "subject: '?CN=Developer ID Application: .*\($MACOS_TEAM_ID\)" <<<"$info" ||
    { echo "no Developer ID Application certificate of $MACOS_TEAM_ID"; return; }
  ! grep -q cdhash <<<"$dr" || { echo "the designated requirement pins a cdhash"; return; }
  grep -qF "identifier \"$MACOS_IDENTIFIER\"" <<<"$dr" ||
    { echo "the designated requirement does not name $MACOS_IDENTIFIER"; return; }
  grep -qF "certificate leaf[subject.OU] = \"$MACOS_TEAM_ID\"" <<<"$dr" ||
    echo "the designated requirement does not name team $MACOS_TEAM_ID"
}

for name in $names; do
  info="$(rcodesign print-signature-info "dist/$name")" # a failure here fails the step
  reason="$(unsigned_reason "$info")"
  if [ -z "$reason" ]; then
    echo "$name: signed by a Developer ID Application certificate of $MACOS_TEAM_ID; its designated requirement names $MACOS_IDENTIFIER and the team (the chain is verified by macos-smoke, not here)"
  elif [ "$CANONICAL" = true ]; then
    echo "::error::$name: $reason. The canonical repository never publishes an unsigned macOS binary."
    exit 1
  else
    echo "::warning::$name is NOT signed ($reason): a fork cannot reach the signing identity."
  fi
done
