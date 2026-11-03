#!/usr/bin/env bash
# Helper: read api_url + project_key from .specnaut/backlog-config.yml and get a
# fresh access token from `specnaut cloud token`. Sourced by the other
# cloud-backend scripts. Exports API_BASE (…/api/v1); `cloud_curl` sends a request.
#
# Credentials are NOT stored in backlog-config.yml — they live in the OS keychain
# (or ~/.specnaut/credentials.json). Run `specnaut cloud login` once to
# authenticate. For CI / headless, set SPECNAUT_CLOUD_TOKEN instead.
set -euo pipefail

# jq_lf <jq args…> — jq, for every call in this script family (cli#701). A
# native Windows jq.exe writes stdout in text mode, every \n as \r\n, so a
# value read with `$(jq -r …)` kept a \r: a path that opens nothing, an id the
# tracker does not know, a count `[ -gt ]` refuses. The \r\n is undone only
# when the jq on PATH was measured writing it, once, as this file is sourced —
# exact, never "drop every \r": a \r a value carries itself survives. jq's
# exit status and its trailing newline are kept. Every copy of this helper is
# the same text (tests/scripts/jq_crlf_test.ts).
JQ_CRLF=0
case $(jq -n 1 2>/dev/null; printf .) in *$'\r\n.') JQ_CRLF=1 ;; esac
jq_lf() {
  local _o _rc=0
  _o=$(_r=0; jq "$@" || _r=$?; printf .; exit "$_r") || _rc=$?
  _o=${_o%.}
  if [ "$JQ_CRLF" = 1 ]; then _o=${_o//$'\r\n'/$'\n'}; fi
  printf '%s' "$_o"
  return "$_rc"
}

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONFIG="$ROOT/.specnaut/backlog-config.yml"

if [ ! -f "$CONFIG" ]; then
  echo "error: $CONFIG not found. Run \`specnaut init --backlog cloud\` first." >&2
  exit 2
fi

# Extract a YAML scalar: a quoted value up to its closing quote, or a bare one
# up to an inline `# comment` — the shape renderCloudConfig writes. A CRLF
# checkout's \r is dropped first.
extract() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub(/\r$/, "")
      sub("^"key":[[:space:]]*", "")
      if ($0 ~ /^"/) { sub(/^"/, ""); sub(/".*$/, "") }
      else if ($0 ~ /^'"'"'/) { sub(/^'"'"'/, ""); sub(/'"'"'.*$/, "") }
      else { sub(/[[:space:]]+#.*$/, ""); sub(/[[:space:]]+$/, "") }
      print
      exit
    }
  ' "$CONFIG"
}

API_URL=$(extract api_url)
PROJECT_KEY=$(extract project_key)

if [ -z "$API_URL" ] || [ -z "$PROJECT_KEY" ]; then
  echo "error: backlog-config.yml is missing api_url or project_key." >&2
  echo "Run \`specnaut cloud login\` to authenticate and link a project." >&2
  exit 2
fi

# curl is handed this string, and is not the parser `specnaut cloud token` judged
# it with: only a plain http(s) base passes, the grammar normalizeApiUrl holds
# (tests/scripts/cloud_config_sh_test.ts keeps the two equal). LC_ALL=C keeps the
# classes ASCII whatever the locale.
if ! printf '%s\n' "$API_URL" |
  LC_ALL=C grep -Eq '^https?://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "error: backlog-config.yml api_url is not a plain http(s) URL." >&2
  exit 2
fi

# Resolve a fresh access token (refreshes transparently; honors
# SPECNAUT_CLOUD_TOKEN for headless / CI).
# A failure has said why on stderr: logged out, Cloud unavailable, or a redirect.
unset API_TOKEN
if ! API_TOKEN=$(specnaut cloud token --api-url "$API_URL"); then
  exit 2
fi

case "$API_TOKEN" in
  *[[:cntrl:]]*)
    echo "error: \`specnaut cloud token\` returned an unusable token." >&2
    exit 2
    ;;
esac

API_BASE="${API_URL%/}/api/v1"

export API_URL PROJECT_KEY API_BASE

# cloud_curl <curl args…> — the one way this script family reaches Cloud, so every
# request is made alike: curl reads no config file (`-q`), the Authorization
# header arrives on stdin, and a 3xx is a failure (exit 22, as for any HTTP error,
# which `-f` does not make of a 3xx). No Cloud request follows a redirect.
cloud_curl() {
  local _out _rc=0
  _out=$(printf 'Authorization: Bearer %s\n' "$API_TOKEN" |
    curl -q -H @- -fsS -w '\n%{http_code}' "$@") || _rc=$?
  [ "$_rc" -eq 0 ] || return "$_rc"
  case ${_out##*$'\n'} in
    3*)
      echo "error: Specnaut Cloud redirected the request, and the CLI follows no redirect: check the API URL." >&2
      return 22
      ;;
  esac
  printf '%s' "${_out%$'\n'*}"
}

# Cloud has no browser URL yet: the config carries an API base, and the task
# payloads expose no web address. Per `backlog-reference-contract` this is the
# documented no-link fallback, not an oversight — callers render
# "#<n> — <title>" with no link.
#
# NEVER derive a browser URL from $API_URL. An API base is not a web origin, and
# a wrong link sends the user somewhere that does not exist. When the payload
# gains a web-address field, read it here.
item_url() {
  return 0
}
