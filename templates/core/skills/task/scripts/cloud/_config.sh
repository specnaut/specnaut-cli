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

# The key reaches every request's query string and the name of reconcile.sh's
# cursor file: letters, digits, `_` and `-`, nothing a URL or a path reads
# as more than a name.
if ! printf '%s\n' "$PROJECT_KEY" | LC_ALL=C grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'; then
  echo "error: backlog-config.yml project_key is not a plain key." >&2
  exit 2
fi

# curl is handed this string, and is not the parser `specnaut cloud token` judged
# it with: only a plain http(s) base passes, and plain http only to a loopback
# host -- the rule normalizeApiUrl holds (tests/scripts/cloud_config_sh_test.ts
# keeps the two equal). LC_ALL=C keeps the classes ASCII whatever the locale.
if ! printf '%s\n' "$API_URL" |
  LC_ALL=C grep -Eq '^https?://([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*|\[::1\])(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "error: backlog-config.yml api_url is not a plain http(s) URL." >&2
  exit 2
fi
# The token would cross the network in clear over plain http; loopback stays.
case $API_URL in http://*)
  LC_ALL=C grep -Eiq '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)' <<<"$API_URL" || {
    echo "error: backlog-config.yml api_url is plain http; use https (http only to localhost)." >&2
    exit 2
  } ;;
esac

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

# require_issue_number <id> — <id> as a bare decimal issue number on stdout, or
# a refusal on stderr and status 2. Every script that takes an id runs it first:
# the id reaches a URL path, a query variable or a file glob, so it is digits
# and nothing else — never a URL, an `@file` or query text. Zero padding is
# dropped (`042` is 42, never octal). Every copy is the same text
# (tests/scripts/backlog_issue_number_test.ts).
require_issue_number() {
  local n=${1:-}
  n=${n#"${n%%[!0]*}"}
  if [[ $n =~ ^[1-9][0-9]{0,9}$ ]]; then printf '%s\n' "$n"; return 0; fi
  printf '%s: not an issue number: %q\n' "${0##*/}" "${1:-}" >&2
  return 2
}

# cloud_curl <curl args…> — the one way this script family reaches Cloud, so every
# request is made alike: curl reads no config file (`-q`), the Authorization
# header arrives on stdin, and a 3xx is a failure (exit 22, as for any HTTP error,
# which `-f` does not make of a 3xx). No Cloud request follows a redirect. What comes
# back is normalized JSON (`CLOUD_JSON`): one line per string, except a `body`.
# Which characters pass is `_issue_text.sh`'s rule, installed beside this file.
# shellcheck source=../_issue_text.sh
. "$(dirname "$0")/_issue_text.sh"
CLOUD_JSON="$ISSUE_TEXT_JQ"'
  def clean:
    if type == "object" then
      with_entries(.key as $k
        | .value |= (if $k == "body" and type == "string" then body else clean end)
        | .key |= text)
    elif type == "array" then map(clean)
    elif type == "string" then text
    else . end;
  clean'
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
  _out=${_out%$'\n'*}
  [ -n "$_out" ] || return 0
  if ! printf '%s' "$_out" | jq_lf "$CLOUD_JSON" 2>/dev/null; then
    if ! jq_lf -n "\"\" | $CLOUD_JSON" >/dev/null 2>&1; then
      echo "error: the Cloud scripts cannot run on this version of jq; install 1.6 or later." >&2
      return 22
    fi
    echo "error: Specnaut Cloud answered with something other than JSON." >&2
    return 22
  fi
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

# terminal_column <columns-json> — the one home of which column means "done"
# on a hosted board. Its columns are the project's own, an order and a name,
# and nothing declares one terminal: so it is the LAST column by order,
# whatever it is called. Sets TERMINAL_ID, TERMINAL_NAME, TERMINAL_ORDER and
# COLUMN_COUNT from a `GET /columns` answer; 1 when the board has none.
# cascade-check.sh gates against it, apply-plan.sh closes into it and keeps
# it out of the columns a plan may move a task to.
terminal_column() {
  local t
  # shellcheck disable=SC2016  # jq program.
  t=$(printf '%s' "$1" | jq_lf -r -e '(.columns // []) as $c | ($c | sort_by(.order) | last) as $t
    | select(($t.id // "" | tostring) != "" and ($t.name | type) == "string" and $t.name != "")
    | "\($t.id)\t\($t.order)\t\($c | length)\t\($t.name)"' 2>/dev/null) || return 1
  # shellcheck disable=SC2034  # read by the sourcing script.
  IFS=$'\t' read -r TERMINAL_ID TERMINAL_ORDER COLUMN_COUNT TERMINAL_NAME <<<"$t"
}

# open_columns <columns-json> — every column's name but the terminal one, in
# board order: the statuses a `move` may name. 1 when the board has none.
open_columns() {
  terminal_column "$1" || return 1
  # shellcheck disable=SC2016  # jq program.
  printf '%s' "$1" | jq_lf -r --arg t "$TERMINAL_ID" '.columns | sort_by(.order)[] | select((.id | tostring) != $t) | .name'
}
