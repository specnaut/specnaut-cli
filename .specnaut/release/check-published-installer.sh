#!/usr/bin/env bash
# Run the PUBLISHED installer as a user runs it, once for real and once on a tampered binary.
#
# Usage: check-published-installer.sh <tag>
#
# `curl ... releases/latest/download/install.sh | bash` is the first thing a new user runs
# (cli#817). verify-release.ts proved the file is the one release.yml attested; this asks whether
# it works:
#
#   1. it is staged for <tag>: the baked line once, no placeholder left;
#   2. with REQUIRE_ATTESTATION=1 and nothing else of the operator's environment that steers it,
#      it installs <tag>, prints `attestation verified for <identity>`, and the binary it placed
#      reports <tag>;
#   3. handed a binary one byte longer than the published one, with a checksum that matches it,
#      it refuses: only the attestation can tell, so this proves the attestation is what decides.
#
# Exit 0 = all three held. Exit 1 = one did not; the reason is printed. Exit 2 = usage.
# Exit 3 = skipped: this machine's gh has no `attestation` command, so 2 and 3 cannot run here.
#
# CHECK_INSTALLER_URL (where the installer is fetched) exists for the tests; a release uses none.
set -uo pipefail

TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: check-published-installer.sh <tag>" >&2; exit 2; }
URL="${CHECK_INSTALLER_URL:-https://github.com/specnaut/specnaut-cli/releases/latest/download/install.sh}"
ID="https://github.com/specnaut/specnaut-cli/.github/workflows/release.yml@refs/tags/$TAG"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
fail() { echo "FAIL published installer: $*"; exit 1; }
# The installer with PREFIX=$1, required to verify, and none of the variables that would steer it.
run() { env -u VERSION -u SPECNAUT_VERSION -u REPO REQUIRE_ATTESTATION=1 PREFIX="$1" bash "$dir/install.sh"; }

curl --proto '=https' --tlsv1.2 -fsSL "$URL" -o "$dir/install.sh" || fail "could not download $URL"
[ "$(grep -cxF "RELEASE_TAG='$TAG'" "$dir/install.sh")" = 1 ] || fail "it is not staged for $TAG"
! grep -qF "__SPECNAUT_RELEASE_TAG__" "$dir/install.sh" || fail "it still carries the placeholder"
if ! gh attestation verify --help >/dev/null 2>&1; then
  echo "SKIPPED published installer: gh here has no \`attestation\` command"
  exit 3
fi

run "$dir/good" > "$dir/good.log" 2>&1 || { tail -20 "$dir/good.log"; fail "it did not install $TAG"; }
grep -qF "attestation verified for $ID" "$dir/good.log" || { tail -20 "$dir/good.log"; fail "it never said: attestation verified for $ID"; }
got="$("$dir/good/specnaut" --version 2>/dev/null | awk '{print $2}')"
[ "v$got" = "$TAG" ] || fail "the binary it placed reports '$got', not $TAG"

# The tampering curl: the published binary plus one byte, and a checksum of exactly that. It
# matches the file name, never the whole URL: every URL holds /specnaut-cli/, and the bundle must
# arrive untouched, or the refusal would be the bundle's and prove nothing about the binary.
real_curl="$(command -v curl)"
mkdir "$dir/shim"
cat > "$dir/shim/curl" <<EOF
#!/bin/sh
out="" url="" prev=""
for a in "\$@"; do [ "\$prev" = -o ] && out=\$a; case \$a in https://*) url=\$a ;; esac; prev=\$a; done
name=\${url##*/}
case \$name in
  specnaut-*.sha256) '$real_curl' --proto =https --tlsv1.2 -fsSL "\${url%.sha256}" -o "\$out.bin" || exit 1
    printf x >> "\$out.bin"
    { shasum -a 256 "\$out.bin" 2>/dev/null || sha256sum "\$out.bin"; } | awk '{print \$1 "  specnaut"}' > "\$out"
    rm -f "\$out.bin" ;;
  specnaut-*) '$real_curl' "\$@" || exit 1; printf x >> "\$out" ;;
  *) exec '$real_curl' "\$@" ;;
esac
EOF
chmod 755 "$dir/shim/curl"
PATH="$dir/shim:$PATH" run "$dir/bad" > "$dir/bad.log" 2>&1 && fail "it installed a tampered binary"
grep -qF "gh refused the attestation for $TAG" "$dir/bad.log" || { tail -20 "$dir/bad.log"; fail "it refused the tampered binary, but not on its attestation"; }
[ ! -e "$dir/bad/specnaut" ] || fail "it placed the tampered binary before refusing it"
echo "ok published installer: installs $TAG on its attestation, and refuses a tampered binary"
