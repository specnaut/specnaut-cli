#!/usr/bin/env bash
# open_url <url> -- open <url> in the system default browser, the rules of the
# CLI's own opener (src/infrastructure/browser_opener.ts): only a plain http(s)
# URL, handed to the launcher as one argument, never through a shell string.
# Sourced by kanban.sh, the same file on every backend.
#
# Says what it did on one line: `OPEN: <launcher>`, or `OPEN: skipped - <why>`.
# Never fails: a refused URL, a missing launcher or a headless machine is
# skipped with status 0 -- the caller has already printed the URL to copy.

# PLAIN_URL in browser_opener.ts, as an ERE; tests/scripts/open_url_sh_test.ts
# holds the two equal. LC_ALL=C keeps the classes ASCII whatever the locale.
OPEN_URL_PLAIN='^https?://[][A-Za-z0-9._~:/?#=&%+,-]+$'

# open_launcher -- the launcher this OS opens a URL with, chosen as
# browser_opener.ts chooses it: `open` on macOS, the URL handler on Windows
# (Git Bash, MSYS2 or Cygwin), `xdg-open` anywhere else.
open_launcher() {
  case $(uname -s 2>/dev/null) in
    Darwin) echo open ;;
    MINGW* | MSYS* | CYGWIN*) echo rundll32 ;;
    *) echo xdg-open ;;
  esac
}

open_url() {
  local url=${1:-} launcher
  case $url in *$'\n'* | *$'\r'*) url="" ;; esac
  if ! LC_ALL=C grep -Eq "$OPEN_URL_PLAIN" <<<"$url"; then
    echo "OPEN: skipped - not a plain http(s) URL"
    return 0
  fi
  launcher=$(open_launcher)
  if ! command -v "$launcher" >/dev/null 2>&1; then
    echo "OPEN: skipped - $launcher not found"
    return 0
  fi
  _open_launch "$launcher" "$url" >/dev/null 2>&1 || { echo "OPEN: skipped - $launcher failed"; return 0; }
  echo "OPEN: $launcher"
}

# _open_launch <launcher> <url> -- hand <url> to <launcher> as one argument.
_open_launch() {
  if [ "$1" = rundll32 ]; then
    # MSYS would rewrite an argument that looks like a path; this one is a URL.
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' rundll32 url.dll,FileProtocolHandler "$2"
  else
    "$1" "$2"
  fi
}
