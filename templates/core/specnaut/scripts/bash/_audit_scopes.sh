# shellcheck shell=bash
# _audit_scopes.sh - the one home of how each scope of collect-audit-scope.sh resolves:
# each scope_<kind> sets SCOPE, SCOPE_LABEL, COMMITS and FILES. Sourced, never run, by
# collect-audit-scope.sh, after _git_untrusted.sh: every read goes through its forms.
# Reads TIP (HEAD, or the head given), and the script's PATH_ARG, RANGE_ARG and LAST_N.
# shellcheck disable=SC2034  # SCOPE, SCOPE_LABEL, COMMITS and FILES are the script's

# scope_read <form> <args...> - the form's output. A refusal by the library stops
# the audit with its message: an argument it refuses is an error, not an empty
# scope. Any other failure (an unknown revision) reads as empty, as before.
scope_read() {
  local out rc=0 err
  err="$(mktemp)"
  out="$("$@" 2>"$err")" || rc=$?
  if [ "$rc" -eq 2 ] && grep -q '^git-read: refused' "$err"; then
    cat "$err" >&2
    rm -f "$err"
    exit 2
  fi
  rm -f "$err"
  printf '%s' "$out"
}

# scope_path - the tracked files under the subtree; no commit list for a path scope.
scope_path() {
  SCOPE="path"
  SCOPE_LABEL="$PATH_ARG"
  FILES="$(scope_read gu_files "$PATH_ARG")"
  COMMITS=""
  if [ -z "$FILES" ]; then
    echo "warning: --path '$PATH_ARG' matched no tracked files (empty scope)" >&2
  fi
}

# scope_range - an explicit range; the library takes the two endpoints apart, and
# validates each again there.
scope_range() {
  SCOPE="range"
  SCOPE_LABEL="$RANGE_ARG"
  FILES="$(scope_read gu_names "${RANGE_ARG%%..*}" "${RANGE_ARG#*..}")"
  COMMITS="$(scope_read gu_log "$RANGE_ARG")"
}

# scope_unpushed_count - prints how many commits TIP holds that origin/main does not;
# false when there is no origin/main or none.
scope_unpushed_count() {
  local count
  _gu_git rev-parse --verify --quiet origin/main >/dev/null 2>&1 || return 1
  count="$(_gu_git rev-list --count "origin/main..$TIP" 2>/dev/null || echo 0)"
  [ "$count" -gt 0 ] && echo "$count"
}

# scope_unpushed <count> - what origin/main does not hold yet; the count comes from
# scope_unpushed_count, so rev-list does not run twice.
scope_unpushed() {
  SCOPE="unpushed"
  SCOPE_LABEL="origin/main..$TIP ($1 commits)"
  FILES="$(scope_read gu_names origin/main "$TIP")"
  COMMITS="$(scope_read gu_log "origin/main..$TIP")"
}

# scope_latest_tag - prints the latest tag TIP reaches; false when there is none.
scope_latest_tag() {
  local tag
  tag="$(_gu_git describe --tags --abbrev=0 "$TIP" 2>/dev/null)" && [ -n "$tag" ] && echo "$tag"
}

# scope_since_tag <tag> - every commit since that tag.
scope_since_tag() {
  SCOPE="since-tag"
  SCOPE_LABEL="$1..$TIP"
  FILES="$(scope_read gu_names "$1" "$TIP")"
  COMMITS="$(scope_read gu_log "$1..$TIP")"
}

# scope_last_n - the last LAST_N commits, clamped to the available history so TIP~N
# never points before the root.
scope_last_n() {
  local avail n="$LAST_N" empty
  SCOPE="last-N"
  avail="$(_gu_git rev-list --count "$TIP" 2>/dev/null || echo 1)"
  [ "$n" -le "$avail" ] || n="$avail"
  SCOPE_LABEL="last ${n} commits"
  if [ "$n" -ge "$avail" ]; then
    # The window covers all of history; TIP~N would precede the root, so diff
    # against the empty tree to surface every file the history touched.
    empty="$(_gu_git hash-object -t tree /dev/null)"
    FILES="$(scope_read gu_names "$empty" "$TIP")"
  else
    FILES="$(scope_read gu_names "$TIP~${n}" "$TIP")"
  fi
  COMMITS="$(scope_read gu_log "$TIP" "$n")"
}
