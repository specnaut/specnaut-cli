# shellcheck shell=bash
# The static sweep: every `rm -rf` in the smoke scripts deletes a vetted path.
# Moved out of smoke-toolbox.sh, which sources it after _common.sh and runs it
# on the suite's own directory. Source it; do not run it.

# smoke_rm_sweep <dir> — every finding is a `fail`; a clean sweep, one `pass`.
smoke_rm_sweep() {
  local dir=$1 bad hit file rest line code pairs pair f v
  # smoke-toolbox.sh's dynamic cases cover the three entry points somebody
  # thought to test. This covers the ones nobody did. A path is acceptable
  # only if it comes from scenario_dir (which validates), from SANDBOX_ROOT
  # itself, or from a variable this sweep can see was built that way.
  bad=0
  while IFS= read -r hit; do
    file="${hit%%:*}"
    rest="${hit#*:}"
    line="${rest%%:*}"
    code="${rest#*:}"
    case "$code" in
      *'rm -rf "$SANDBOX_ROOT"'*|*'rm -rf "$SANDBOX_DIR"'*|*'rm -rf "$SANDBOX"'*|*'rm -rf "$target"'*|*'rm -rf "$variant_dir"'*)
        continue ;;
    esac
    fail "$file:$line deletes an unvetted path" "$(printf '%s' "$code" | sed 's/^[[:space:]]*//')"
    bad=$((bad + 1))
  #
  # This file and _common.sh are skipped: neither deletes anything, and both
  # discuss `rm -rf` in prose that the sweep would otherwise read as code.
  # Narrowing the pattern instead — say, to lines STARTING with `rm -rf` —
  # would have been the wrong fix: it would stop matching
  # `trap 'rm -rf "$SANDBOX"' EXIT`, which is a real deleting path.
  # Comment lines are dropped by testing the first non-blank character after
  # the `path:lineno:` prefix — NOT by filtering any line containing `#`, which
  # would also drop real code carrying a trailing comment.
  done < <(grep -n 'rm -rf' "$dir"/*.sh \
             | grep -v '/_common\.sh:' | grep -v '/smoke-toolbox\.sh:' | grep -v '/_rm_sweep\.sh:' \
             | grep -vE ':[0-9]+:[[:space:]]*#' || true)
  [ "$bad" -eq 0 ] && pass "every rm -rf in the toolbox targets a validated path"

  # And the variables the sweep allow-lists must themselves come from
  # scenario_dir — otherwise the allow-list above is the hiding place.
  # DERIVED from the sweep's own hits, not a literal list. Keyed by file, this
  # check could not see a NEW script using `rm -rf "$SANDBOX"` with a hand-built
  # assignment: the sweep passed it on the variable name, and the provenance loop
  # never looked at it because its filename was not written here. The allow-list
  # above and the provenance check below now enumerate the same population.
  pairs="$(grep -n 'rm -rf' "$dir"/*.sh \
             | grep -v '/_common\.sh:' | grep -v '/smoke-toolbox\.sh:' | grep -v '/_rm_sweep\.sh:' \
             | grep -vE ':[0-9]+:[[:space:]]*#' \
             | sed -E 's|^.*/([^/:]+):[0-9]+:.*rm -rf "\$([A-Za-z_][A-Za-z0-9_]*)".*$|\1:\2|' \
             | grep -E '^[^:]+:[A-Za-z_]' | sort -u || true)"
  for pair in $pairs; do
    f="${pair%%:*}"; v="${pair##*:}"
    # SANDBOX_ROOT is not built per-scenario: _common.sh derives it from
    # BASH_SOURCE, so no argument reaches it and there is nothing for
    # scenario_dir to validate. Deriving the list rather than writing it out
    # surfaced it, which is the derivation working — the exemption is stated
    # here instead of being invisible in a literal list nobody re-reads.
    [ "$v" = "SANDBOX_ROOT" ] && continue
    if grep -qE "^[[:space:]]*(local )?$v=\"?\\\$\(scenario_dir" "$dir/$f"; then
      pass "$f builds \$$v through scenario_dir"
    else
      fail "$f does not build \$$v through scenario_dir" "the sweep's allow-list would pass it anyway"
    fi
  done
}
