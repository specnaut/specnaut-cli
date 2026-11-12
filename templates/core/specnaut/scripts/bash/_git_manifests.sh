# shellcheck shell=bash
# _git_manifests.sh - git-read's `manifests` form: the patch of every changed file
# _scope_globs.sh counts as a manifest. Sourced, never run, by _git_untrusted.sh, whose
# argument checks and git runner it calls.

# gu_manifests <a> <b> - that patch, in a new temp file outside the repository; it
# prints that path and the count, so no file name reaches a command line. The names
# come from git (NUL-separated) and go after `--` as they are: --literal-pathspecs
# keeps each one a path.
gu_manifests() {
  [ $# -eq 2 ] || { _gu_refuse "manifests takes <a> <b>"; return 2; }
  _gu_need_rev "$1" && _gu_need_rev "$2" || return 2
  local out names f rc=0 picked=()
  out="$(mktemp "${TMPDIR:-/tmp}/git-read-manifests.XXXXXX")" || return 1
  names="$(mktemp "${TMPDIR:-/tmp}/git-read-names.XXXXXX")" || return 1
  _gu_git diff --name-only -z "${_GU_PLAIN[@]}" --end-of-options "$1" "$2" -- >"$names" || rc=$?
  while IFS= read -r -d '' f; do
    matches_any "$f" "${SCOPE_DEP_GLOBS[@]}" && picked+=("$f")
  done <"$names"
  rm -f "$names"
  # None changed: the file stays empty, since a patch naming no path is the whole diff.
  if [ "$rc" -eq 0 ] && [ ${#picked[@]} -gt 0 ]; then
    _gu_git diff "${_GU_PLAIN[@]}" --end-of-options "$1" "$2" -- "${picked[@]}" >"$out" || rc=$?
  fi
  [ "$rc" -eq 0 ] || { rm -f "$out" && return "$rc"; }
  printf 'MANIFESTS_FILE: %s\nMANIFESTS: %s\n' "$out" "${#picked[@]}"
}
