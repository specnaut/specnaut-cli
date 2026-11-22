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

# Downloads $1 to $3/specnaut and its checksum $2 beside it; aborts unless they match.
download_verified() {
  local bin_url="$1" sha_url="$2" dir="$3" expected_sha actual_sha
  info "downloading binary..."
  curl -fsSL "$bin_url" -o "$dir/specnaut"
  info "downloading checksum..."
  curl -fsSL "$sha_url" -o "$dir/specnaut.sha256"
  expected_sha="$(awk '{print $1}' < "$dir/specnaut.sha256")"
  actual_sha="$(cd "$dir" && $SHA_CMD specnaut | awk '{print $1}')"
  if [[ "$expected_sha" != "$actual_sha" ]]; then
    abort "checksum mismatch: expected $expected_sha, got $actual_sha"
  fi
  ok "checksum verified"
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

main() {
  require curl
  pick_sha_command

  local target version bin_url sha_url dest
  target="$(detect_target)"
  version="${VERSION:-$(latest_version || true)}" # a failed lookup is named below, not a silent exit
  [[ -n "$version" ]] || abort "could not resolve latest version from GitHub"
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
  trap 'rm -rf "$tmp"' EXIT # tmp is global: the trap runs after main returns
  download_verified "$bin_url" "$sha_url" "$tmp"

  chmod 755 "$tmp/specnaut"
  dest="${PREFIX}/specnaut"
  install_binary "$tmp/specnaut" "$dest"
  dest="$FINAL_DEST"

  echo
  ok "installed ${BOLD}${dest}${RESET}"
  print_path_hint "$dest"

  echo
  "$dest" --version || true
}

main "$@"
