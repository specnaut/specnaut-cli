#!/usr/bin/env bash
# specnaut installer: downloads a release binary, verifies it, and places it in $PREFIX
# (default /usr/local/bin). Each release publishes its own copy of this script, which installs
# that release; the one on `releases/latest` installs the latest.
#
# Usage:
#   curl --proto '=https' --tlsv1.2 -fsSL https://github.com/specnaut/specnaut-cli/releases/latest/download/install.sh | bash
#   curl --proto '=https' --tlsv1.2 -fsSL https://github.com/specnaut/specnaut-cli/releases/download/vX.Y.Z/install.sh | bash
#     (pins the script and the binary to vX.Y.Z; SPECNAUT_VERSION=vX.Y.Z pins only the binary)
#   ... | PREFIX=$HOME/.local/bin bash    ... | DRY_RUN=1 bash    ... | REQUIRE_ATTESTATION=1 bash
#
# Verification: the SHA-256 checksum, then the release's Sigstore attestation, with
# `gh attestation verify` pinned to release.yml at the exact tag installed (the identity
# `specnaut self-update` checks). A refused attestation stops the install: nothing is placed or run.
# Without gh, or with a gh lacking `attestation`, the checksum alone is checked and a warning
# prints the command that verifies afterwards; REQUIRE_ATTESTATION=1 stops instead.
# Releases before 4.3.0 carry no attestation: they install on the checksum alone, and only when
# pinned by SPECNAUT_VERSION. REQUIRE_ATTESTATION=1 refuses them. VERSION, read for older
# instructions, pins only attested releases: a variable that generic may be set for anything else.
set -euo pipefail

REPO="${REPO:-specnaut/specnaut-cli}"
PREFIX_EXPLICIT="${PREFIX+1}"
PREFIX="${PREFIX:-/usr/local/bin}"
DRY_RUN="${DRY_RUN:-}"
REQUIRE_ATTESTATION="${REQUIRE_ATTESTATION:-}"
# What is trusted, as literals: REPO moves where files come from, never who must have signed them.
SIGNER_REPO="specnaut/specnaut-cli"
SIGNER_ISSUER="https://token.actions.githubusercontent.com"
BUNDLE_NAME="specnaut.attestation.sigstore.json"
# The release this copy belongs to, written in by scripts/release/stage-installer.sh. The
# repository's copy keeps the placeholder, and installs the latest release.
RELEASE_TAG='__SPECNAUT_RELEASE_TAG__'
case "$RELEASE_TAG" in __*) RELEASE_TAG="" ;; esac

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi

step()  { printf "%s→%s %s\n" "$CYAN$BOLD" "$RESET" "$*"; }
info()  { printf "  %s\n" "$*"; }
ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$*" >&2; }
abort() { printf "%serror:%s %s\n" "$RED$BOLD" "$RESET" "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || abort "$1 is required but not found in PATH"
}

# Every download: HTTPS only, TLS 1.2 or later, a failed status is a failure.
fetch() { curl --proto '=https' --tlsv1.2 -fsSL "$@"; }

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) os="macos" ;;
    Linux)  os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) abort "Windows detected - please download the binary manually from https://github.com/${REPO}/releases" ;;
    *) abort "unsupported OS: $os" ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) abort "unsupported arch: $arch" ;;
  esac
  printf "specnaut-%s-%s" "$os" "$arch"
}

latest_version() {
  fetch "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -Eo '"tag_name":\s*"[^"]+"' \
    | head -n1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

# Aborts unless $1 is a version, by the pattern of src/domain/release.ts, leaving its parts in
# BASH_REMATCH: anything else must never reach a URL or the unsigned branch.
require_release_version() {
  local re='^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?$'
  [[ "$1" =~ $re ]] || abort "not a release version: '$1'"
}

# Succeeds when $1 is older than 4.3.0, the first release carrying an attestation
# (FIRST_SIGNED_VERSION in src/domain/sigstore/trust_anchor.ts), compared as integers with a
# prerelease before its release, as SemVer.compare orders them.
predates_signing() {
  local floor=(4 3 0) i n
  require_release_version "$1"
  for i in 0 1 2; do
    n=$((10#${BASH_REMATCH[i + 1]}))
    if (( n != floor[i] )); then (( n < floor[i] )); return; fi
  done
  [[ -n "${BASH_REMATCH[4]}" ]]
}

# Sets VERSION_TAG and PINNED. The user's pin wins, then the release this copy was staged for,
# then the latest release. Only SPECNAUT_VERSION is PINNED, the key to the checksum-only branch.
resolve_version() {
  local v="${SPECNAUT_VERSION:-${VERSION:-}}"
  PINNED="${SPECNAUT_VERSION:+1}"
  v="${v:-$RELEASE_TAG}"
  [[ -n "$v" ]] || v="$(latest_version || true)" # a failed lookup is named below, not a silent exit
  [[ -n "$v" ]] || abort "could not resolve latest version from GitHub"
  require_release_version "$v" # named as it was given, before the v is added
  VERSION_TAG="v${v#v}"
}

# Sets ATTEST when the binary must carry an attestation, decided by version, never by what a
# download returns. Only a user's own pin may take the checksum-only branch of an older release.
choose_verification() {
  [[ "$REPO" == "$SIGNER_REPO" ]] || REQUIRE_ATTESTATION=1 # another origin: never its own checksum alone
  ATTEST=1
  predates_signing "$VERSION_TAG" || return 0
  [[ -n "$PINNED" ]] || abort "$VERSION_TAG predates signed releases (4.3.0) and SPECNAUT_VERSION does not pin it - refusing it."
  [[ -z "$REQUIRE_ATTESTATION" ]] || abort "$VERSION_TAG predates signed releases (4.3.0): it has no attestation, and REQUIRE_ATTESTATION is set."
  ATTEST=""
}

release_url() { printf 'https://github.com/%s/releases/download/%s/%s' "$REPO" "$VERSION_TAG" "$1"; }

# The certificate identity the attestation must carry: release.yml at the exact tag installed, as
# expectedSignerIdentity in src/domain/sigstore/trust_anchor.ts spells it for self-update.
signer_identity() { printf 'https://github.com/%s/.github/workflows/release.yml@refs/tags/%s' "$SIGNER_REPO" "$VERSION_TAG"; }

dry_run() {
  info "DRY_RUN=1 - would download:"
  info "  $(release_url "$TARGET")"
  info "  $(release_url "$TARGET.sha256")"
  if [[ -n "$ATTEST" ]]; then
    info "  $(release_url "$BUNDLE_NAME")"
    info "verify the attestation for $(signer_identity) (issuer $SIGNER_ISSUER)"
  else
    info "check the checksum only: $VERSION_TAG predates signed releases"
  fi
  info "and install to ${PREFIX}/specnaut"
  exit 0
}

# Creates the folder $1 as the user when it is missing and its nearest existing parent is a folder
# the user can write, as under $HOME (cli#816): `sudo mkdir -p` there leaves a root-owned folder in
# the home, and a refused sudo aborted an explicit PREFIX. Anywhere else, sudo is asked as before.
make_dir_as_user() {
  local parent="$1"
  [[ -e "$1" ]] && return 0
  while [[ ! -e "$parent" ]]; do parent="$(dirname "$parent")"; done
  [[ -d "$parent" && -w "$parent" ]] || return 0
  mkdir -p "$1" || warn "could not create $1 as you."
}

# Moves $1 to $2 with sudo, its password read from the tty even when stdin is the curl pipe.
# Returns 1 when there is no tty or no sudo, and when sudo fails, having said so.
# shellcheck disable=SC2024 # the redirects are meant as the user: sudo reads its password from the tty
install_with_sudo() {
  local src="$1" dest="$2" dest_dir
  dest_dir="$(dirname "$dest")"
  [[ -e /dev/tty ]] && command -v sudo >/dev/null 2>&1 || return 1
  info "${dest_dir} requires admin access - you'll be prompted for your password."
  if sudo -p "  [sudo] password for %u: " mkdir -p "$dest_dir" </dev/tty \
     && sudo mv -f "$src" "$dest" </dev/tty \
     && sudo chmod 755 "$dest" </dev/tty; then
    return 0
  fi
  warn "sudo failed - falling back to a user-writable location."
  return 1
}

# Move $1 to $2, handling permission elevation transparently.
# Sets FINAL_DEST to the actual install path (may differ from $2 on fallback).
install_binary() {
  local src="$1" dest="$2" dest_dir
  dest_dir="$(dirname "$dest")"
  FINAL_DEST=""
  make_dir_as_user "$dest_dir"

  # Best case: directory exists and is writable.
  if [[ -d "$dest_dir" && -w "$dest_dir" ]]; then
    mv -f "$src" "$dest"
    chmod 755 "$dest"
    FINAL_DEST="$dest"
    return 0
  fi

  if install_with_sudo "$src" "$dest"; then
    FINAL_DEST="$dest"
    return 0
  fi

  # Fallback: install into $HOME/.local/bin (no admin needed).
  if [[ -n "${PREFIX_EXPLICIT:-}" && "$PREFIX" != "/usr/local/bin" ]]; then
    abort "cannot write to ${dest_dir} and you set PREFIX explicitly — aborting."
  fi
  local fallback_dir="$HOME/.local/bin"
  local fallback_dest="$fallback_dir/specnaut"
  mkdir -p "$fallback_dir"
  mv -f "$src" "$fallback_dest"
  chmod 755 "$fallback_dest"
  warn "installed to ${fallback_dir} instead of ${dest_dir}."
  FINAL_DEST="$fallback_dest"
}

# Sets SHA_CMD to the SHA-256 tool this system has.
pick_sha_command() {
  if command -v shasum >/dev/null 2>&1; then
    SHA_CMD="shasum -a 256"
  elif command -v sha256sum >/dev/null 2>&1; then
    SHA_CMD="sha256sum"
  else
    abort "shasum or sha256sum is required"
  fi
}

# Downloads the binary to $1/specnaut and its checksum beside it; aborts unless they match.
download_checked() {
  local dir="$1" expected_sha actual_sha
  info "downloading binary..."
  fetch "$(release_url "$TARGET")" -o "$dir/specnaut"
  info "downloading checksum..."
  fetch "$(release_url "$TARGET.sha256")" -o "$dir/specnaut.sha256"
  expected_sha="$(awk '{print $1}' < "$dir/specnaut.sha256")"
  actual_sha="$(cd "$dir" && $SHA_CMD specnaut | awk '{print $1}')"
  if [[ "$expected_sha" != "$actual_sha" ]]; then
    abort "checksum mismatch: expected $expected_sha, got $actual_sha"
  fi
  ok "checksum verified"
}

# Verifies $1/specnaut against the release's bundle. gh exits 1 alike for a mismatch and for a
# network or trust-root failure, so any refusal stops the install; neither is read as a pass.
verify_attestation() {
  local dir="$1"
  info "downloading attestation..."
  fetch "$(release_url "$BUNDLE_NAME")" -o "$dir/bundle.json" || abort "$VERSION_TAG carries no attestation bundle - refusing it."
  gh attestation verify "$dir/specnaut" --bundle "$dir/bundle.json" --repo "$SIGNER_REPO" \
    --cert-identity "$(signer_identity)" --cert-oidc-issuer "$SIGNER_ISSUER" \
    --deny-self-hosted-runners >"$dir/gh.log" 2>&1 ||
    { cat "$dir/gh.log" >&2; abort "gh refused the attestation for $VERSION_TAG (reason above): nothing was installed."; }
  ok "attestation verified for $(signer_identity)"
}

# Checks the binary in $1 as far as this system allows. Sets VERIFY_LATER when gh is missing.
verify_download() {
  VERIFY_LATER=""
  download_checked "$1"
  [[ -n "$ATTEST" ]] || { warn "$VERSION_TAG predates signed releases: checked against its checksum only."; return 0; }
  if command -v gh >/dev/null 2>&1 && gh attestation verify --help >/dev/null 2>&1; then
    verify_attestation "$1"
  elif [[ -n "$REQUIRE_ATTESTATION" ]]; then
    abort "REQUIRE_ATTESTATION is set, and gh with \`gh attestation\` is not on PATH."
  else
    VERIFY_LATER=1
  fi
}

# Tells how to put the folder of $1 on PATH, when it is not there yet.
print_path_hint() {
  local dest_dir
  dest_dir="$(dirname "$1")"
  case ":$PATH:" in *":$dest_dir:"*) return 0 ;; esac
  echo
  warn "${dest_dir} is not in your PATH."
  info "Add this to your shell profile (~/.zshrc, ~/.bashrc, ...):"
  info "  ${BOLD}export PATH=\"${dest_dir}:\$PATH\"${RESET}"
  info "Then restart your shell, or run: ${BOLD}source ~/.zshrc${RESET}"
}

# The command that checks the attestation of $1 once gh is installed.
print_verify_hint() {
  echo
  warn "gh (with \`gh attestation\`) was not found: $1 was checked against its checksum only."
  info "Install gh, then verify it:"
  info "  gh attestation verify $1 --repo $SIGNER_REPO --cert-identity $(signer_identity) --cert-oidc-issuer $SIGNER_ISSUER --deny-self-hosted-runners"
}

# Says where the binary went, what is still to do, and runs it once.
report_install() {
  echo
  ok "installed ${BOLD}$1${RESET}"
  print_path_hint "$1"
  [[ -z "$VERIFY_LATER" ]] || print_verify_hint "$1"
  echo
  "$1" --version || true
}

main() {
  require curl
  pick_sha_command
  TARGET="$(detect_target)"
  resolve_version
  choose_verification
  step "specnaut ${BOLD}${VERSION_TAG}${RESET} ${DIM}(${TARGET})${RESET}"
  info "${DIM}prefix:${RESET} ${PREFIX}"
  [[ -z "$DRY_RUN" ]] || dry_run
  # Under TMPDIR by name: macOS mktemp -d alone may ignore it. tmp is global: the trap runs after main.
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/specnaut-install.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  verify_download "$tmp"
  chmod 755 "$tmp/specnaut"
  install_binary "$tmp/specnaut" "${PREFIX}/specnaut"
  report_install "$FINAL_DEST"
}

main "$@"
