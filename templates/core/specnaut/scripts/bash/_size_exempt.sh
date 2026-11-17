# shellcheck shell=bash
# Which changed files size-ratchet.sh leaves out without measuring them: sourced
# by it after _config.sh.
#
#   size_exempt_init <limits> <lock>  keeps the `exempt <glob>` lines of
#                                     config_size_limits' output, and the lock's
#                                     entries: Specnaut's own files
#   size_exempt <path>                0 for `.specnaut/**`, a lock entry or an
#                                     `exempt:` glob

SIZE_EXEMPT_GLOBS=() SIZE_EXEMPT_MANAGED=""

size_exempt_init() {
  local unit rest
  SIZE_EXEMPT_GLOBS=()
  while read -r unit rest; do
    if [ "$unit" = exempt ]; then SIZE_EXEMPT_GLOBS+=("$rest"); fi
  done <<<"$1"
  SIZE_EXEMPT_MANAGED="$(config_lock_entries "$2")"
}

# A name holding a newline is never exempt: grep reads such a pattern as several
# lines, any of which could name a managed file.
size_exempt() {
  case "$1" in *$'\n'*) return 1 ;; .specnaut/*) return 0 ;; esac
  if [ -n "$SIZE_EXEMPT_MANAGED" ] && printf '%s\n' "$SIZE_EXEMPT_MANAGED" | grep -Fxq -- "$1"; then
    return 0
  fi
  config_exempt "$1" ${SIZE_EXEMPT_GLOBS[@]+"${SIZE_EXEMPT_GLOBS[@]}"}
}
