# shellcheck shell=bash disable=SC2034,SC2016
# (SC2034: GUARD_*/P_* are read by the sourcing guard. SC2016: the single-
# quoted strings are jq programs; `$v` is a jq variable.)
# Sourced prelude of every Specnaut guard — the one home of "how a guard
# fails" (spec 036, plan § 5, FR-015).
#
# Claude Code and Codex both let a tool call through on any exit other than 2,
# so a guard that crashes, meets a payload it cannot parse, or runs without jq
# would allow by failing. Here every such path — the ERR trap, a bad payload, a
# missing jq, an unknown shape — ends in exit 2 with the reason on stderr. A
# guard allows only by calling guard_allow. Git runs as read-only plumbing
# (§ 11 F10): --no-pager, GIT_OPTIONAL_LOCKS=0, fsmonitor off, expansions
# quoted, no eval.
#
# Usage: `. "$HOOK_DIR/_guard.sh" || { …; exit 2; }`, then
# `guard_init <guard-name> "$@" [field…]` ($1 = harness: claude | codex). It
# reads stdin once and parses it in ONE jq call (a spawn costs tens of ms, and
# a guard runs on every tool call), setting GUARD_HARNESS, GUARD_CWD (payload
# cwd, else $PWD), P_TOOL, P_SESSION, P_TURN, P_MODE (permission_mode),
# P_EVENT, P_AGENT (agent_id), and GF: one entry per extra field, in order. A
# field is a jq path read as a string ("" when absent or null, any other type
# a shape error), or prefixed: any:<path> any JSON value, as text; argv:<path>
# a string, or argv as shell words; lines:<path> a string, or strings joined by newlines.
set -Eeuo pipefail
set -f          # words are split on purpose below, never globbed
export LC_ALL=C # byte-wise string ops: fast, and case folding stays ASCII
export GIT_OPTIONAL_LOCKS=0 GIT_PAGER=cat PAGER=cat

# GUARD_FAIL_CODE: the approval writer sets 0 after sourcing — not a guard, an
# exit 2 there would block the user's prompt or keep a Claude turn from stopping.
GUARD_NAME=hook GUARD_FAIL_CODE=2 GUARD_ROOT="" GUARD_JQ_CRLF=0 GUARD_ALLOWED=0

guard_fail() { printf 'specnaut %s: %s\n' "$GUARD_NAME" "$1" >&2; exit "$GUARD_FAIL_CODE"; }

# _guard_err <status> <line> — the ERR trap. set -E carries it into every
# `$(…)` and subshell; there it only leaves, with the failing command's own
# status, for the caller to judge: `$(git config --get alias.x)` exiting 1
# means "no such alias". A caller that does not handle it fails in this
# shell, where the trap refuses. Refusing inside the substitution turned every
# such 1 into the fail code — cmd_git read each git subcommand outside its
# list as an alias it cannot follow — and printed a crash above a deny (cli#711).
_guard_err() {
  if [ "${BASH_SUBSHELL:-0}" -gt 0 ]; then exit "$1"; fi
  guard_fail "unexpected error at line $2 — refusing rather than allowing"
}
trap '_guard_err $? $LINENO' ERR

# guard_allow — the ONLY way a guard lets a call through.
guard_allow() { GUARD_ALLOWED=1; exit 0; }

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
    [ $prog ] | map(gsub(\"\\u001e\"; \" \")) | join(\"\\u001e\") + \"\\u001e\\n.\" end" 2>/dev/null) \
    || guard_fail "the payload is not JSON, or not of the shape this hook reads — refusing"
  # The sentinel's \n measures jq on this very call: a native Windows jq.exe
  # writes stdout in text mode, every \n as \r\n — a \r at the end of each
  # line of a command, in each heredoc delimiter. Undone only when measured.
  case $out in *$'\r\n.') GUARD_JQ_CRLF=1 out=${out//$'\r\n'/$'\n'} ;; esac
  local IFS=$'\x1e'
  # shellcheck disable=SC2206 # split on the record separator on purpose; set -f is on
  GF=($out)
  IFS=$' \t\n' # bash 3.2 joins "${a[@]:n}" with spaces under an IFS without one
  [ "${#GF[@]}" = $((8 + $# - 2)) ] && [ "${GF[${#GF[@]} - 1]}" = $'\n.' ] \
    || guard_fail "the payload did not parse into the fields this hook reads — refusing"
  GUARD_CWD=${GF[0]} P_TOOL=${GF[1]} P_SESSION=${GF[2]} P_TURN=${GF[3]} P_MODE=${GF[4]} P_EVENT=${GF[5]} P_AGENT=${GF[6]}
  GF=("${GF[@]:7}")
  unset 'GF[${#GF[@]}-1]' # the sentinel
  [ -n "$GUARD_CWD" ] || GUARD_CWD=$PWD
  guard_path GUARD_CWD "$GUARD_CWD"
  case $GUARD_CWD in /*) ;; *) guard_fail "payload cwd '$GUARD_CWD' is not absolute" ;; esac
}

# guard_jq <jq args…> — jq for every read after guard_init: undoes the \r\n
# guard_init measured, and only then. Exact, never "drop every \r": a \r the
# payload carries itself survives — stripped, `\r#` would read as a comment.
guard_jq() {
  local o
  o=$(jq "$@" && printf .) || return # the dot keeps a trailing \r\n to undo
  o=${o%.}
  if [ "$GUARD_JQ_CRLF" = 1 ]; then o=${o//$'\r\n'/$'\n'}; fi
  printf '%s' "$o"
}

# guard_path <var> <path> — <path> as this shell opens and compares it. A
# Windows harness sends `C:\a\b`: never absolute to a POSIX test, so every
# guard refused every call. Under Git Bash, MSYS or Cygwin, `\` becomes `/` and
# a drive path goes through cygpath (no cygpath: the ERR trap refuses).
# Elsewhere kept byte for byte: on POSIX a `\` is a filename character.
guard_path() {
  local _gp=$2 # not `p`: printf -v would set this local, not the caller's p
  case ${OSTYPE:-} in
    msys* | cygwin*)
      _gp=${_gp//\\//}
      # Repeated slashes after the first character (`C:/a//b`): cygpath and
      # -ef disagree on them. A leading `//` stays: it is a UNC path.
      local _t=${_gp:1}
      while [[ $_t == *//* ]]; do _t=${_t//\/\//\/}; done
      _gp=${_gp:0:1}$_t
      case $_gp in [A-Za-z]:/*) _gp=$(cygpath -u "$_gp") ;; esac ;;
  esac
  printf -v "$1" '%s' "$_gp"
}

# guard_root — GUARD_ROOT: the project whose hooks run, the folder above this
# script's `.specnaut/hooks/`. Not the git toplevel: a project with no .git of
# its own inside another repository would be judged against the outer one, its
# lock unprotected. Outside an installed `.specnaut/hooks/` (the source tree,
# its tests): the payload cwd's git toplevel, else the cwd. One git spawn at most.
guard_root() {
  [ -z "$GUARD_ROOT" ] || return 0
  case $(cd "$HOOK_DIR" 2>/dev/null && pwd -P) in
    */.specnaut/hooks) GUARD_ROOT=$(cd "$HOOK_DIR/../.." && pwd -P); return 0 ;;
  esac
  if GUARD_ROOT=$(guard_git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null); then
    guard_path GUARD_ROOT "$GUARD_ROOT" # Git for Windows prints C:/…
  else GUARD_ROOT=$GUARD_CWD; fi
}

# guard_eq <a> <b> — equal AND non-empty: an absent id never matches an absent id.
guard_eq() { [ -n "$1" ] && [ "$1" = "$2" ]; }

# guard_ieq <a> <b> — equal ignoring ASCII case (refs and paths on case-folding systems).
guard_ieq() { local r=1; shopt -s nocasematch; if [[ $1 == "$2" ]]; then r=0; fi; shopt -u nocasematch; return "$r"; }

# guard_git <args…> — git as read-only plumbing (§ 11 F10).
guard_git() { git --no-pager -c core.fsmonitor=false "$@"; }
