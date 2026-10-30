#!/usr/bin/env bash
# The suite's single entry point. Runs every script in SUITE_FILES against
# the working tree and exits non-zero if any of them is red.
#
# Usage:
#   run-all.sh                 # the whole suite
#   run-all.sh --list          # print the suite membership and exit
#   run-all.sh --only <script> # one script (name from --list)
#   run-all.sh --no-bundle     # skip the re-bundle (see below — rarely right)
#
# ─── Why it bundles first ────────────────────────────────────────────────
# `specnaut init` scaffolds from the GENERATED src/templates_bundle.ts, not
# from templates/ on disk. Verified: a marker appended to a file under
# templates/core/ without re-bundling does not appear in the scaffolded
# output at all.
#
# So a suite that does not bundle first asserts against whatever the bundle
# held when it was last regenerated — it would go green on a change it never
# saw. That is the same defect the suite exists to catch, one level up: a
# mechanism reporting success without having read what it claims to cover.
#
# The regenerated file is restored on exit, because it is a TRACKED file and
# `.specnaut/release/preflight.sh` aborts on a dirty tree. Running the suite
# must not leave the repository in a state that fails an unrelated gate.
set -uo pipefail

. "$(dirname "$0")/_common.sh"

DO_BUNDLE=1
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      printf '%s\n' "$SUITE_FILES"
      exit 0
      ;;
    --only)
      ONLY="${2:-}"
      [ -n "$ONLY" ] || die "--only needs a script name (see --list)"
      case "
$SUITE_FILES
" in
        *"
$ONLY
"*) ;;
        *) die "--only '$ONLY' is not in the suite (see --list)" ;;
      esac
      shift 2
      ;;
    --no-bundle) DO_BUNDLE=0; shift ;;
    -h|--help)
      sed -n '2,/^set -/p' "$0" | sed 's/^# \{0,1\}//;/^set -/d'
      exit 0
      ;;
    *) die "unknown flag '$1' (try --help)" ;;
  esac
done

# --- FR-001: the suite guards its own boundary --------------------------
# Every script must resolve its paths inside this repository. This used to be
# a grep a person ran once, for a defect whose entire history is that it
# rots; running it here makes a green run the evidence.
#
# Comments are stripped first: _common.sh documents the old workspace climb
# by quoting it, and a comment resolves nothing. The rule is about what the
# code DOES, not what it mentions. What counts as a comment is decided in
# _common.sh (plan.md §5 023-R1), not here.
#
# The pattern is ASSEMBLED, never written out in full. This block IS the
# check, so a pattern spelled literally here makes the guard match its own
# source. #544 settled the shape of the answer: assemble from fragments
# (smoke-toolbox.sh:38 does the same with `up=".."`); exempting the file
# that holds a check is a hole in the check, not a fix for one.
#
# It stayed hidden while this loop stripped comments inline with
# `sed 's/#.*$//'` — that expression cut this very line at the hash inside
# itself and erased the pattern before grep ever saw it. Only the workspace
# half ever self-matched; the escaped `\.\./…` half never did.
_seg_ws="apps"
_seg_half="specnaut-cli"
BOUNDARY_RE="\.\./\.\./\.\./\.\.\|$_seg_ws/$_seg_half"

boundary_hits=0

# #550: a positive control. Nothing else here proves the pattern can EVER
# match, so a typo in BOUNDARY_RE is indistinguishable from a clean tree — the
# check would report ✓ forever. Both alternations are probed separately: the
# escaped `../../../..` half has never self-matched in this file, so only a
# deliberate probe exercises it at all.
# Assembled, never written out — the literal would match BOUNDARY_RE and this
# file would report itself as a violation, which is the self-match hazard the
# comment above BOUNDARY_RE describes. It fired on the first draft of this
# very control.
_up=".."
for _probe in "$_up/$_up/$_up/$_up/elsewhere" "$_seg_ws/$_seg_half/src/main.ts"; do
  if ! grep -q "$BOUNDARY_RE" <<<"$_probe"; then
    fail "the boundary pattern cannot match a known violation: $_probe" \
         "a typo in BOUNDARY_RE reads exactly like a clean tree (FR-001)"
    boundary_hits=$((boundary_hits + 1))
  fi
done
# And the other direction, so the control cannot be satisfied by a pattern
# that matches everything.
if grep -q "$BOUNDARY_RE" <<<'scripts/smoke/audit.sh'; then
  fail "the boundary pattern matches an ordinary in-repo path" \
       "a pattern that matches everything reports every file as a violation (FR-001)"
  boundary_hits=$((boundary_hits + 1))
fi

for f in "$SMOKE_DIR"/*.sh; do
  # Asker two of two for 023-R1; the definition lives in _common.sh. The
  # inline expression this replaces cut at the FIRST hash on a line, so any
  # path written after a `${var#…}` or inside a banner escaped the check —
  # this guard was blind to part of its own surface.
  #
  # `grep -c` consumes all input, so unlike audit.sh's `grep -q` there is no
  # early exit to SIGPIPE the producer under pipefail.
  # A file this cannot read is NOT a file with no violations. The inline
  # `sed` this replaces had the same hole — it printed to stderr, produced
  # nothing, and the count came out 0 — so the guard reported clean on
  # exactly the input it could not inspect. Same principle as audit.sh's
  # exit codes: "could not run" is not "found nothing".
  if ! code="$(smoke_code_lines "$f")"; then
    # `fail`, not `echo`. `finish` branches on the harness counter, never on
    # boundary_hits, so an echo here let an unreadable file exit 0 through
    # "ALL CHECKS PASSED" with no smoke run at all. The bare `exit 1` this
    # block replaced could not do that: routing the OTHER branch through the
    # harness and leaving this one behind is what created the fail-open.
    fail "$(basename "$f") could not be read" \
         "the boundary check did not inspect it (FR-001)"
    boundary_hits=$((boundary_hits + 1))
    continue
  fi
  # #550: `|| true` collapsed rc>=2 (grep itself errored) into rc=1 ("found
  # nothing"), so a broken search reported a clean result. grep -c prints 0
  # and exits 1 on no match, which is not an error; anything at or above 2 is.
  grep_rc=0
  n="$(grep -c "$BOUNDARY_RE" <<<"$code")" || grep_rc=$?
  if [ "$grep_rc" -ge 2 ]; then
    fail "$(basename "$f") — the boundary grep errored (rc=$grep_rc)" \
         "the boundary check did not inspect it (FR-001)"
    boundary_hits=$((boundary_hits + 1))
    continue
  fi
  if [ "$n" -gt 0 ]; then
    fail "$(basename "$f") resolves $n path(s) outside this repository" \
         "the suite must run from a bare clone of this repository (FR-001)"
    boundary_hits=$((boundary_hits + n))
  fi
done
if [ "$boundary_hits" -gt 0 ]; then
  # Through the suite's own contract (022-R4), not a bare `exit`. `finish`
  # follows `fail` immediately and on purpose: `fail` does not exit, and
  # continuing here would run `deno task bundle` and the whole suite against a
  # tree this check has just declared out of bounds.
  finish "SUITE"
fi

# --- Re-bundle, and put it back afterwards ------------------------------
BUNDLE="$CLI/src/templates_bundle.ts"
if [ "$DO_BUNDLE" -eq 1 ]; then
  # This script is `set -uo pipefail` with NO `-e`, so a failed mktemp would
  # leave BUNDLE_BAK empty, `cp "$BUNDLE" ""` would fail, execution would
  # continue, and the trap would become `cp '' <bundle>` — failing at exit,
  # after `finish` has already printed ALL CHECKS PASSED and set the code.
  # The restore is the one thing here that touches a TRACKED file, so it does
  # not get to fail quietly.
  BUNDLE_BAK="$(mktemp)" || BUNDLE_BAK=""
  [ -n "$BUNDLE_BAK" ] || die "could not create a bundle backup — refusing to regenerate over a tracked file"
  cp "$BUNDLE" "$BUNDLE_BAK" || die "could not back up $BUNDLE"
  # shellcheck disable=SC2064
  trap "cp '$BUNDLE_BAK' '$BUNDLE'; rm -f '$BUNDLE_BAK'" EXIT
  echo "▶ deno task bundle (so the suite reads the working tree, not the committed bundle)"
  ( cd "$CLI" && deno task bundle ) >/dev/null || die "deno task bundle failed"
fi

# --- Run ----------------------------------------------------------------
# Serial, on purpose. clean.sh with no argument wipes the whole sandbox tree,
# and every script traps a cleanup on exit; running them concurrently would
# let one script's trap delete another's fixture mid-run. If this ever needs
# to be parallel, the scenario namespace has to be separated first.
to_run="$SUITE_FILES"
[ -n "$ONLY" ] && to_run="$ONLY"

failed=""
for script in $to_run; do
  stem="${script#smoke-}"; stem="${stem%.sh}"
  scenario="runall-$stem-$$"
  smoke_require_name "$scenario"
  echo
  echo "▶ $script"
  # Parsed first: on bash 3.2 a syntax error halfway down a script runs its
  # EXIT trap, and the trap's `|| true` becomes the exit status — the script
  # stopped at that line, every later check unrun, and this loop read 0.
  if ! bash -n "$SMOKE_DIR/$script"; then
    fail "$script" "does not parse"
    failed="$failed $script"
    continue
  fi
  if bash "$SMOKE_DIR/$script" "$scenario"; then
    pass "$script"
  else
    fail "$script" "exit $?"
    failed="$failed $script"
  fi
done

echo
echo "▶ audit"
if bash "$SMOKE_DIR/audit.sh"; then
  pass "audit.sh"
else
  fail "audit.sh" "exit $?"
  failed="$failed audit.sh"
fi

echo
[ -n "$failed" ] && echo "red:$failed"
finish "SUITE"
