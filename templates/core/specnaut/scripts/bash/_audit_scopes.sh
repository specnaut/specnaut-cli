# shellcheck shell=bash
# _audit_scopes.sh - the one home of how each scope of collect-audit-scope.sh resolves:
# each scope_<kind> sets SCOPE, SCOPE_LABEL, COMMITS and FILES. Sourced, never run, by
# collect-audit-scope.sh, after _git_untrusted.sh: every read goes through its forms.
# Reads TIP (HEAD, or the head given), and the script's PATH_ARG, RANGE_ARG, LAST_N and
# BASE_ARG.
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

# scope_base - the head's scope against the base's tip, never HEAD: its commits since the
# base, and its files since the merge bases of the two, so the base's own later changes,
# which a two-point diff would list reverted, stay out. A criss-cross history has several
# merge bases, and a file the head's merge took back to one base's content differs from
# another only: FILES are the union of the diffs from every one.
scope_base() {
  local forks fork files=""
  # The base is proved by the repository's own objects, never through the head's folder.
  [ "$(EXPLICIT_OBJECTS="" _gu_git rev-parse --verify --quiet --end-of-options "$BASE_ARG^{commit}" 2>/dev/null)" = "$BASE_ARG" ] ||
    { echo "error: --base: no commit $BASE_ARG in reach" >&2; exit 2; }
  forks="$(scope_read _gu_git merge-base --all --end-of-options "$EXPLICIT_HEAD" "$BASE_ARG")"
  [ -n "$forks" ] || { echo "error: --base: $BASE_ARG and the head share no history" >&2; exit 2; }
  SCOPE="range"
  SCOPE_LABEL="$BASE_ARG..$EXPLICIT_HEAD"
  COMMITS="$(scope_read gu_log "$BASE_ARG..$EXPLICIT_HEAD")"
  for fork in $forks; do
    files+="$(scope_read gu_names "$fork" "$EXPLICIT_HEAD")"$'\n'
  done
  FILES="$(printf '%s' "$files" | LC_ALL=C sort -u)"
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
