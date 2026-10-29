# shellcheck shell=bash disable=SC2034,SC2016
# (SC2034: GUARD_*/P_* are read by the sourcing guard. SC2016: the single-
# quoted strings are jq programs; `$v` is a jq variable.)
# Sourced prelude of every Specnaut guard — the one home of "how a guard
# fails" (spec 036, plan § 5, FR-015).
#
# Claude Code and Codex both let a tool call through on any exit other than 2.
# A guard that crashes, meets a payload it cannot parse, or runs without jq
# would therefore allow by failing. Here every such path — the ERR trap, a bad
# payload, a missing jq, a shape the guard does not know — ends in exit 2 with
# the reason on stderr. A guard allows only by calling guard_allow.
#
# Git runs as read-only plumbing (§ 11 F10): --no-pager, GIT_OPTIONAL_LOCKS=0,
# fsmonitor off, every expansion quoted, no eval anywhere.
#
# Usage (first lines of a guard):
#   . "$HOOK_DIR/_guard.sh" || { echo "…_guard.sh missing" >&2; exit 2; }
#   guard_init <guard-name> "$@" [field…]   # $1 = harness: claude | codex
# guard_init reads stdin once and parses it in ONE jq call (each process
# spawn costs tens of ms, and a guard runs on every tool call). It sets
# GUARD_HARNESS, GUARD_CWD (payload cwd, else $PWD), P_TOOL, P_SESSION,
# P_TURN, P_MODE (permission_mode), P_EVENT, P_AGENT (agent_id), and GF: one
# entry per extra field, in order. A field is a jq path, read as a string
# ("" when absent or null, any other type is a shape error), or prefixed:
#   any:<path>   any JSON value, as text      argv:<path>  string, or argv as shell words
#   lines:<path> string, or strings joined by newlines
set -Eeuo pipefail
set -f          # words are split on purpose below, never globbed
export LC_ALL=C # byte-wise string ops: fast, and case folding stays ASCII
export GIT_OPTIONAL_LOCKS=0 GIT_PAGER=cat PAGER=cat

GUARD_NAME=hook
# The approval writer sets 0 after sourcing: it is not a guard, and an exit 2
# there would block the user's prompt or keep a Claude turn from stopping.
GUARD_FAIL_CODE=2
GUARD_ROOT=""

guard_fail() {
  printf 'specnaut %s: %s\n' "$GUARD_NAME" "$1" >&2
  exit "$GUARD_FAIL_CODE"
}
trap 'guard_fail "unexpected error at line $LINENO — refusing rather than allowing"' ERR
GUARD_ALLOWED=0

# guard_allow — the ONLY way a guard lets a call through.
guard_allow() {
  GUARD_ALLOWED=1
  exit 0
}

# The net under the ERR trap. A `set -u` abort skips the ERR trap and exits 1
# — "allow" to both harnesses — and under bash 3.2 (macOS's /bin/bash) with
# `set -e` it even exits 0, the EXIT trap seeing $? = 0. So a 0 counts only
# when guard_allow said so; every other status becomes the fail code.
_guard_exit() {
  local rc=$?
  if [ "$rc" = "$GUARD_FAIL_CODE" ]; then return 0; fi
  if [ "$rc" = 0 ] && [ "$GUARD_ALLOWED" = 1 ]; then return 0; fi
  printf 'specnaut %s: unexpected exit %s — refusing rather than allowing\n' "$GUARD_NAME" "$rc" >&2
  exit "$GUARD_FAIL_CODE"
}
trap _guard_exit EXIT

# _guard_expr <field> — the jq expression reading one field as a string (into $e).
_guard_expr() {
  local p=${1#*:} t='if $v == null then ""
    elif ($v | type) == "string" then $v'
  case $1 in
    any:*) t+=' else ($v | tojson)' ;;
    argv:*) t+=' elif ($v | type) == "array" and all($v[]; type == "string") then ($v | map(@sh) | join(" "))' ;;
    lines:*) t+=' elif ($v | type) == "array" and all($v[]; type == "string") then ($v | join("\n"))' ;;
    *) p=$1 ;;
  esac
  case $1 in any:*) ;; *) t+=' else error("shape")' ;; esac
  e="(($p) as \$v | $t end)"
}

guard_init() {
  local spec prog="" e out
  GUARD_NAME=$1
  case "${2:-}" in
    claude | codex) GUARD_HARNESS=$2 ;;
    *) guard_fail "first argument must be the harness (claude or codex), got '${2:-}'" ;;
  esac
  command -v jq >/dev/null 2>&1 \
    || guard_fail "jq is required and is not on PATH — install jq; until then this hook refuses"
  GUARD_INPUT=$(cat)
  for spec in .cwd .tool_name .session_id .turn_id .permission_mode .hook_event_name .agent_id "${@:3}"; do
    _guard_expr "$spec"
    prog+="${prog:+, }$e"
  done
  out=$(printf '%s' "$GUARD_INPUT" | jq -j "if type != \"object\" then error(\"not an object\") else
    [ $prog ] | map(gsub(\"\\u001e\"; \" \")) | join(\"\\u001e\") + \"\\u001e.\" end" 2>/dev/null) \
    || guard_fail "the payload is not JSON, or not of the shape this hook reads — refusing"
  local IFS=$'\x1e'
  # shellcheck disable=SC2206 # split on the record separator on purpose; set -f is on
  GF=($out)
  IFS=$' \t\n' # bash 3.2 joins "${a[@]:n}" with spaces under an IFS without one
  [ "${#GF[@]}" = $((8 + $# - 2)) ] && [ "${GF[${#GF[@]} - 1]}" = . ] \
    || guard_fail "the payload did not parse into the fields this hook reads — refusing"
  GUARD_CWD=${GF[0]} P_TOOL=${GF[1]} P_SESSION=${GF[2]} P_TURN=${GF[3]} P_MODE=${GF[4]} P_EVENT=${GF[5]} P_AGENT=${GF[6]}
  GF=("${GF[@]:7}")
  unset 'GF[${#GF[@]}-1]' # the sentinel
  [ -n "$GUARD_CWD" ] || GUARD_CWD=$PWD
  case $GUARD_CWD in /*) ;; *) guard_fail "payload cwd '$GUARD_CWD' is not absolute" ;; esac
}

# guard_root — GUARD_ROOT: the project whose hooks are running, i.e. the
# folder above this script's `.specnaut/hooks/`. Not the git toplevel: a
# project without its own .git inside another repository (a workspace member)
# would be judged against the outer one, and its lock left unprotected.
# Outside an installed `.specnaut/hooks/` (the source tree, its tests): the git
# toplevel of the payload cwd, else the cwd. Lazy: one git spawn at most.
guard_root() {
  [ -z "$GUARD_ROOT" ] || return 0
  case $(cd "$HOOK_DIR" 2>/dev/null && pwd -P) in
    */.specnaut/hooks) GUARD_ROOT=$(cd "$HOOK_DIR/../.." && pwd -P); return 0 ;;
  esac
  if ! GUARD_ROOT=$(guard_git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null); then
    GUARD_ROOT=$GUARD_CWD
  fi
}

# guard_eq <a> <b> — equal AND non-empty: an absent id never matches an absent id.
guard_eq() { [ -n "$1" ] && [ "$1" = "$2" ]; }

# guard_ieq <a> <b> — equal ignoring ASCII case (refs and paths on case-folding systems).
guard_ieq() {
  local r=1
  shopt -s nocasematch
  if [[ $1 == "$2" ]]; then r=0; fi
  shopt -u nocasematch
  return "$r"
}

# guard_git <args…> — git as read-only plumbing (§ 11 F10).
guard_git() { git --no-pager -c core.fsmonitor=false "$@"; }
