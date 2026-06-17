#!/usr/bin/env bash
# specnaut installer — downloads the latest (or pinned) release binary,
# verifies SHA256, and places it in $PREFIX (default /usr/local/bin).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/specnaut/specnaut-cli/main/install.sh | bash
#   curl -fsSL https://.../install.sh | VERSION=v0.1.0-alpha.1 bash
#   curl -fsSL https://.../install.sh | PREFIX=$HOME/.local/bin bash
#   curl -fsSL https://.../install.sh | DRY_RUN=1 bash
#
set -euo pipefail

REPO="${REPO:-specnaut/specnaut-cli}"
PREFIX_EXPLICIT="${PREFIX+1}"
PREFIX="${PREFIX:-/usr/local/bin}"
VERSION="${VERSION:-}"
DRY_RUN="${DRY_RUN:-}"

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
  printf "specnaut-%s-%s" "$os" "$arch"
}

latest_version() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -Eo '"tag_name":\s*"[^"]+"' \
    | head -n1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

# Move $1 to $2, handling permission elevation transparently.
# Sets FINAL_DEST to the actual install path (may differ from $2 on fallback).
install_binary() {
  local src="$1" dest="$2" dest_dir
  dest_dir="$(dirname "$dest")"
  FINAL_DEST=""

  # Best case: directory exists and is writable.
  if [[ -d "$dest_dir" && -w "$dest_dir" ]]; then
    mv -f "$src" "$dest"
    chmod 755 "$dest"
    FINAL_DEST="$dest"
    return 0
  fi

  # Try elevating with sudo (reads password from controlling tty even when
  # this script's stdin is the curl pipe).
  if [[ -e /dev/tty ]] && command -v sudo >/dev/null 2>&1; then
    info "${dest_dir} requires admin access — you'll be prompted for your password."
    if sudo -p "  [sudo] password for %u: " mkdir -p "$dest_dir" </dev/tty \
       && sudo mv -f "$src" "$dest" </dev/tty \
       && sudo chmod 755 "$dest" </dev/tty; then
      FINAL_DEST="$dest"
      return 0
    fi
    warn "sudo failed — falling back to a user-writable location."
  fi

  # Fallback: install into $HOME/.local/bin (no admin needed).
  if [[ -n "${PREFIX_EXPLICIT:-}" && "$PREFIX" != "/usr/local/bin" ]]; then
    abort "cannot write to ${dest_dir} and you set PREFIX explicitly — aborting."
  fi
  local fallback_dir="$HOME/.local/bin"
  mkdir -p "$fallback_dir"
  local fallback_dest="$fallback_dir/specnaut"
  mv -f "$src" "$fallback_dest"
  chmod 755 "$fallback_dest"
  warn "installed to ${fallback_dir} instead of ${dest_dir}."
  FINAL_DEST="$fallback_dest"
}

main() {
  require curl

  local SHA_CMD
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

  step "specnaut ${BOLD}${version}${RESET} ${DIM}(${target})${RESET}"
  info "${DIM}prefix:${RESET} ${PREFIX}"

  if [[ -n "$DRY_RUN" ]]; then
    info "DRY_RUN=1 — would download:"
    info "  $bin_url"
    info "  $sha_url"
    info "  and install to ${PREFIX}/specnaut"
    exit 0
  fi

  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT

  info "downloading binary..."
  curl -fsSL "$bin_url" -o "$tmp/specnaut"
  info "downloading checksum..."
  curl -fsSL "$sha_url" -o "$tmp/specnaut.sha256"

  expected_sha="$(awk '{print $1}' < "$tmp/specnaut.sha256")"
  actual_sha="$(cd "$tmp" && $SHA_CMD specnaut | awk '{print $1}')"
  if [[ "$expected_sha" != "$actual_sha" ]]; then
    abort "checksum mismatch: expected $expected_sha, got $actual_sha"
  fi
  ok "checksum verified"

  chmod 755 "$tmp/specnaut"
  dest="${PREFIX}/specnaut"

  install_binary "$tmp/specnaut" "$dest"
  dest="$FINAL_DEST"

  echo
  ok "installed ${BOLD}${dest}${RESET}"

  local dest_dir
  dest_dir="$(dirname "$dest")"
  case ":$PATH:" in
    *":$dest_dir:"*) ;;
    *)
      echo
      warn "${dest_dir} is not in your PATH."
      info "Add this to your shell profile (~/.zshrc, ~/.bashrc, …):"
      info "  ${BOLD}export PATH=\"${dest_dir}:\$PATH\"${RESET}"
      info "Then restart your shell, or run: ${BOLD}source ~/.zshrc${RESET}"
      ;;
  esac

  echo
  "$dest" --version || true
}

main "$@"
