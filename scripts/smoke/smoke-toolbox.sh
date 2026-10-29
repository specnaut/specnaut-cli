#!/usr/bin/env bash
# Guards the toolbox's own safety properties — the scripts that DELETE things.
#
# ─── Why this exists ─────────────────────────────────────────────────────
# The suite asserted a great deal about Specnaut's output and nothing at all
# about the scripts doing the asserting. Review found `clean.sh` calling
# `rm -rf "$CLI/sandbox/$1"` with no validation, sourcing the very file that
# defines the name check and never calling it. `clean.sh ../../../..`
# resolved two levels above the workspace.
#
# The guard existed. It was wired into three of the six paths that reach
# `rm -rf` and not the other three — which is the failure this file is
# scoped to prevent: not "is there a guard" but "does it cover every path".
#
# So the static sweep below matters more than the three dynamic cases. A
# seventh deleting path added tomorrow is caught by the sweep even though no
# one thought to write a case for it.
#
# Usage: smoke-toolbox.sh <name>
set -uo pipefail

. "$(dirname "$0")/_common.sh"

NAME="${1:?usage: smoke-toolbox.sh <name>}"
smoke_require_name "$NAME"

echo "═══ deleting paths refuse a traversal argument ═══"

# Each of these would, unguarded, resolve outside sandbox/ and delete it.
#
# The traversal strings are ASSEMBLED rather than written literally. This file
# is scanned by run-all.sh's FR-001 boundary check, which reads a literal
# `../../../..` as a script resolving a path outside the repository — true of
# code, false of a test whose entire job is to feed that string to a guard.
# Assembling keeps the check maximally strict: exempting this file instead
# would have been a hole in the guard, which is the shape of defect this very
# script exists to catch.
up=".."
for script in clean.sh bootstrap-empty.sh bootstrap-vite.sh; do
  for evil in "$up/$up" "$up/$up/$up/$up" "." "$up" ""; do
    if bash "$SMOKE_DIR/$script" "$evil" >/dev/null 2>&1; then
      fail "$script accepted '$evil'" "it reaches rm -rf with an unvalidated path"
    else
      pass "$script refuses '${evil:-<empty>}'"
    fi
  done
done

echo
echo "═══ a legitimate name still works end to end ═══"
probe="$NAME-probe"
if bash "$SMOKE_DIR/bootstrap-empty.sh" "$probe" >/dev/null 2>&1; then
  pass "bootstrap-empty accepts a valid scenario name"
else
  fail "bootstrap-empty rejected a valid name" "the guard is too strict"
fi
if [ -d "$(scenario_dir "$probe")" ]; then
  pass "the scenario tree was created where expected"
else
  fail "scenario tree missing" "$(scenario_dir "$probe")"
fi
if bash "$SMOKE_DIR/clean.sh" "$probe" >/dev/null 2>&1 && [ ! -d "$SANDBOX_ROOT/$probe" ]; then
  pass "clean.sh removes a valid scenario"
else
  fail "clean.sh did not remove the scenario" "$SANDBOX_ROOT/$probe"
fi

echo
echo "═══ static sweep: EVERY deleting path is validated ═══"
# The dynamic cases above cover the three entry points somebody thought to
# test. This covers the ones nobody did. A path is acceptable only if it
# comes from scenario_dir (which validates), from SANDBOX_ROOT itself, or
# from a variable this sweep can see was built that way.
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
done < <(grep -n 'rm -rf' "$SMOKE_DIR"/*.sh \
           | grep -v '/_common\.sh:' | grep -v '/smoke-toolbox\.sh:' \
           | grep -vE ':[0-9]+:[[:space:]]*#' || true)
[ "$bad" -eq 0 ] && pass "every rm -rf in the toolbox targets a validated path"

# And the variables the sweep allow-lists must themselves come from
# scenario_dir — otherwise the allow-list above is the hiding place.
# DERIVED from the sweep's own hits, not a literal list. Keyed by file, this
# check could not see a NEW script using `rm -rf "$SANDBOX"` with a hand-built
# assignment: the sweep passed it on the variable name, and the provenance loop
# never looked at it because its filename was not written here. The allow-list
# above and the provenance check below now enumerate the same population.
pairs="$(grep -n 'rm -rf' "$SMOKE_DIR"/*.sh \
           | grep -v '/_common\.sh:' | grep -v '/smoke-toolbox\.sh:' \
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
  if grep -qE "^[[:space:]]*(local )?$v=\"?\\\$\(scenario_dir" "$SMOKE_DIR/$f"; then
    pass "$f builds \$$v through scenario_dir"
  else
    fail "$f does not build \$$v through scenario_dir" "the sweep's allow-list would pass it anyway"
  fi
done

echo
echo "═══ run-all.sh's own argument handling ═══"

if bash "$SMOKE_DIR/run-all.sh" --only definitely-not-a-script.sh >/dev/null 2>&1; then
  fail "run-all.sh --only accepted a script not in the suite" "it would run nothing and exit 0"
else
  pass "run-all.sh --only rejects a script not in the suite"
fi

if [ "$(bash "$SMOKE_DIR/run-all.sh" --list)" = "$SUITE_FILES" ]; then
  pass "run-all.sh --list is SUITE_FILES verbatim (no second copy)"
else
  fail "run-all.sh --list disagrees with SUITE_FILES" "membership has two spellings"
fi

echo
echo "═══ audit.sh notices a script the suite does not run ═══"
# This is the one guard nothing could reach: audit.sh only runs its membership
# check when scanning its DEFAULT directory, and smoke-audit.sh always points
# it at a synthetic one. So the check that would have validated adding this
# very file to SUITE_FILES had no test of its own.
drift_probe="$SMOKE_DIR/smoke-zzz-drift-probe.sh"
cleanup_probe() { rm -f "$drift_probe"; }
trap cleanup_probe EXIT
printf '#!/usr/bin/env bash\n# transient probe for the membership check\n' > "$drift_probe"
set +e
drift_out="$(bash "$SMOKE_DIR/audit.sh" 2>&1)"
drift_rc=$?
set -e
cleanup_probe
trap - EXIT

if grep -q "smoke-zzz-drift-probe.sh exists but is not in SUITE_FILES" <<<"$drift_out"; then
  pass "audit names a script on disk that SUITE_FILES omits"
else
  fail "membership drift not reported" "a smoke could exist and never run"
fi
if [ "$drift_rc" -ne 0 ]; then
  pass "membership drift is fatal, not advisory"
else
  fail "membership drift exited 0" "a script nobody runs would ship as covered"
fi

echo
echo "═══ smoke_code_lines: a comment is not an assertion ═══"
# The accuracy of the strip has no natural witness. audit.sh's real-tree
# verdict and smoke-audit.sh's comment-only scenario BOTH pass under the
# naive `sed 's/#.*$//'`, so without these checks 023-R3 would ship with
# zero coverage. That is why they exist and why the negative half below
# matters as much as the positive one.
#
# This file is the toolbox's own meta-test, so it is the right home for
# testing a _common.sh helper. Its `rm -rf` sweep above deliberately does
# NOT use that helper — see plan.md §8.
cl_fixture="$(mktemp)"
# `set -e` is live from the drift-probe block onward, so an abort between
# here and the rm would leak the fixture.
trap 'rm -f "$cl_fixture"' EXIT
cat > "$cl_fixture" <<'FIXTURE'
# a whole-line comment naming victim-a.sh
    # an indented comment naming victim-b.sh
kept_trailing="survivor-c.sh"   # comment naming victim-d.sh
expansion="${rt#prefix/}survivor-e.sh"
bare_expansion=${rt#prefix/}survivor-g.sh
sq_closed='survivor-h.sh'   # comment naming victim-e.sh
banner_line='echo "=== #180  survivor-f.sh --parent flag ==="'
    indented_code="survivor-k.sh"   # comment naming victim-g.sh
unquoted_escape=$(echo \") # comment naming victim-f.sh
dq_escape="a \" b # survivor-i.sh"
FIXTURE
cl_out="$(smoke_code_lines "$cl_fixture")"

# Positive half: real code carrying a hash survives. Both shapes were
# measured on this suite — 16 parameter expansions and the banner lines.
# survivor-g.sh is the one that matters most and was missing at review: the
# other fixtures sit inside quotes, so they exercise the quote clause only.
# An UNQUOTED `${var#…}` is held together solely by the rule that a `#` must
# be preceded by whitespace to start a comment — `${line#…}` in audit.sh's
# allow_reason is a real instance, and dropping that clause truncates it
# while every other assertion here still passes.
# survivor-i.sh and victim-f.sh are the backslash clause's only witnesses
# (#548). `\"` must not toggle the quote state: on the dq_escape line the
# string stays OPEN, so its `#` is quoted and survivor-i.sh survives; on the
# unquoted_escape line the string never opens, so the trailing comment IS a
# comment and victim-f.sh must go. Drop the clause and the two swap places —
# each is the other's control, and every other assertion here stays green.
# survivor-k.sh is indented CODE. Only an indented *comment* existed before,
# which strips to a blank line and is a valid prefix either way, so the
# suffix-invariant check below had nothing to bite on.
for survivor in survivor-c.sh survivor-e.sh survivor-f.sh survivor-g.sh survivor-h.sh survivor-i.sh survivor-k.sh; do
  if grep -qF "$survivor" <<<"$cl_out"; then
    pass "smoke_code_lines keeps real code: $survivor"
  else
    fail "smoke_code_lines destroyed real code: $survivor" \
         "a hash that is quoted, or not preceded by whitespace, does not start a comment"
  fi
done

# Negative half: without it, a helper that returned its input unchanged
# would pass everything above.
# victim-e.sh sits after a single-quoted region that CLOSES. A quote
# tracker whose state got stuck open would score the hash as quoted, keep
# the comment, and reinstate #545 — while passing every other assertion here.
for victim in victim-a.sh victim-b.sh victim-d.sh victim-e.sh victim-f.sh victim-g.sh; do
  if grep -qF "$victim" <<<"$cl_out"; then
    fail "smoke_code_lines kept a comment: $victim" "a comment would still vouch for a file"
  else
    pass "smoke_code_lines removes the comment naming $victim"
  fi
done

# The two properties callers rely on (023-R2).
if [ "$(wc -l < "$cl_fixture")" = "$(printf '%s\n' "$cl_out" | wc -l)" ]; then
  pass "smoke_code_lines preserves line numbering"
else
  fail "smoke_code_lines changed the line count" "a caller reporting file:line would misreport it"
fi

cl_prefix_bad=0
while IFS= read -r pair; do
  orig="${pair%%$(printf '\034')*}"
  out="${pair#*$(printf '\034')}"
  case "$orig" in "$out"*) ;; *) cl_prefix_bad=$((cl_prefix_bad + 1)) ;; esac
done < <(paste -d"$(printf '\034')" "$cl_fixture" <(printf '%s\n' "$cl_out"))
if [ "$cl_prefix_bad" -eq 0 ]; then
  pass "smoke_code_lines removes a suffix, never an interior span"
else
  fail "smoke_code_lines cut out an interior span on $cl_prefix_bad line(s)" \
       "the fail-closed guarantee rests on every output line being a prefix of its input"
fi
if grep -q '^    indented_code="survivor-k.sh"' <<<"$cl_out"; then
  pass "smoke_code_lines preserves leading whitespace on a code line"
else
  fail "smoke_code_lines lost the indentation of a code line" \
       "a caller matching an anchored pattern would stop seeing indented code"
fi

# A file with no comments must come back byte-identical. Without this, a
# helper that dropped the last character of every line satisfies the suffix
# invariant (a truncation IS a prefix) and every grep above that searches for
# a token not at end-of-line. It is the cheapest assertion here and the only
# one that pins the strip to doing NOTHING when there is nothing to do.
cl_clean="$(mktemp)"
trap 'rm -f "$cl_fixture" "$cl_clean"' EXIT
cat > "$cl_clean" <<'FIXTURE'
set -euo pipefail
    indented=1
value="${rt#prefix/}"
printf '%s\n' "$value"

banner='echo "=== #180 ==="'
FIXTURE
if smoke_code_lines "$cl_clean" | cmp -s - "$cl_clean"; then
  pass "smoke_code_lines returns a comment-free file byte-identical"
else
  fail "smoke_code_lines altered a file that has no comments" \
       "the strip must be a no-op when there is nothing to strip"
fi
rm -f "$cl_clean"

rm -f "$cl_fixture"
trap - EXIT

if smoke_code_lines /nonexistent/definitely-not-here.sh >/dev/null 2>&1; then
  fail "smoke_code_lines returned success for an unreadable file" \
       "a caller cannot tell 'no violations' from 'never looked'"
else
  pass "smoke_code_lines fails loudly on a file it cannot read"
fi

echo
echo "═══ run-all.sh's boundary guard still catches a real violation ═══"
# SC-006. The pattern is assembled from fragments so this file does not
# match its own guard; an assembly that silently stopped matching would be
# a dead guard that looks green, which is worse than the defect it replaced.
# Written with printf and separate arguments for the same reason.
bp="$SMOKE_DIR/smoke-zzz-boundary-probe.sh"
cleanup_bp() { rm -f "$bp"; }
trap cleanup_bp EXIT
{
  printf '#!/usr/bin/env bash\n'
  printf 'climb="%s/%s/%s/%s"\n' ".." ".." ".." ".."
  printf 'half="%s/%s"\n' "apps" "specnaut-cli"
} > "$bp"
set +e
bp_out="$(bash "$SMOKE_DIR/run-all.sh" 2>&1)"
bp_rc=$?
set -e
cleanup_bp
trap - EXIT

if grep -q "smoke-zzz-boundary-probe.sh resolves 2 path(s) outside this repository" <<<"$bp_out"; then
  pass "run-all.sh reports a planted boundary violation, both halves"
else
  fail "the boundary guard missed a planted violation" \
       "$(grep -iE 'resolves|outside this repository' <<<"$bp_out" | head -1)"
fi
if [ "$bp_rc" -ne 0 ]; then
  pass "a boundary violation is fatal, not advisory"
else
  fail "run-all.sh exited 0 with a boundary violation planted" "FR-001 would not stop anything"
fi

finish "TOOLBOX"
