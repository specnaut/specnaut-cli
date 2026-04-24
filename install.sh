#!/usr/bin/env bash
# specflow installer — downloads the latest (or pinned) release binary,
# verifies SHA256, and places it in $PREFIX (default /usr/local/bin).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kevinraimbaud/specflow/main/install.sh | bash
#   curl -fsSL https://.../install.sh | VERSION=v0.1.0-alpha.1 bash
#   curl -fsSL https://.../install.sh | PREFIX=$HOME/.local/bin bash
#   curl -fsSL https://.../install.sh | DRY_RUN=1 bash
#
set -euo pipefail

REPO="${REPO:-kevinraimbaud/specflow}"
PREFIX="${PREFIX:-/usr/local/bin}"
VERSION="${VERSION:-}"
DRY_RUN="${DRY_RUN:-}"

abort() {
  echo "error: $*" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null 2>&1 || abort "$1 is required but not found in PATH"
}

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) os="macos" ;;
    Linux)  os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) abort "Windows detected — please download the binary manually from https://github.com/${REPO}/releases" ;;
    *) abort "unsupported OS: $os" ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) abort "unsupported arch: $arch" ;;
  esac
  echo "specflow-${os}-${arch}"
}

latest_version() {
  require curl
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -Eo '"tag_name":\s*"[^"]+"' \
    | head -n1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

main() {
  require curl

  if command -v shasum >/dev/null 2>&1; then
    SHA_CMD="shasum -a 256"
  elif command -v sha256sum >/dev/null 2>&1; then
    SHA_CMD="sha256sum"
  else
    abort "shasum or sha256sum is required"
  fi

  local target version bin_url sha_url tmp expected_sha actual_sha dest
  target="$(detect_target)"
  if [[ -z "$VERSION" ]]; then
    version="$(latest_version)"
    [[ -z "$version" ]] && abort "could not resolve latest version from GitHub"
  else
    version="$VERSION"
  fi
  bin_url="https://github.com/${REPO}/releases/download/${version}/${target}"
  sha_url="${bin_url}.sha256"

  echo "→ specflow ${version} (${target})"
  echo "  prefix: ${PREFIX}"

  if [[ -n "$DRY_RUN" ]]; then
    echo "DRY_RUN=1 — would download:"
    echo "  $bin_url"
    echo "  $sha_url"
    echo "  and install to ${PREFIX}/specflow"
    exit 0
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "  downloading binary..."
  curl -fsSL "$bin_url" -o "$tmp/specflow"
  echo "  downloading checksum..."
  curl -fsSL "$sha_url" -o "$tmp/specflow.sha256"

  expected_sha="$(awk '{print $1}' < "$tmp/specflow.sha256")"
  actual_sha="$(cd "$tmp" && $SHA_CMD specflow | awk '{print $1}')"
  if [[ "$expected_sha" != "$actual_sha" ]]; then
    abort "checksum mismatch: expected $expected_sha, got $actual_sha"
  fi
  echo "  checksum verified"

  chmod 755 "$tmp/specflow"
  dest="${PREFIX}/specflow"

  if [[ -w "$PREFIX" ]]; then
    mv "$tmp/specflow" "$dest"
  else
    echo "  $PREFIX is not writable — run the following manually:" >&2
    echo "    sudo mv \"$tmp/specflow\" \"$dest\"" >&2
    exit 1
  fi

  echo
  echo "installed $dest"
  echo
  "$dest" --version || true
}

main "$@"
