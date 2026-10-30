# shellcheck shell=bash
# Sourced by smoke-audit.sh, after _audit_meta_verdicts.sh: the verdicts on
# the #564 probes that _audit_meta_564.sh captured.
#
# Every u564_* capture read here is assigned in _audit_meta_564.sh, which
# ShellCheck cannot see from this file.
# shellcheck disable=SC2154

# ── #564: an uncommitted surface file is seen ──────────────────────────
# The control first. Every assertion below reads "rc flipped to 1 because of
# my probe", and that sentence means nothing unless the tree without the probe
# was 0.
if [ "$u564_base_rc" -eq 0 ]; then
  pass "the isolated tree is green before anything uncommitted is planted"
else
  fail "the isolated control run was not green — every #564 assertion below is vacuous" \
       "rc=$u564_base_rc; $(grep -E 'gap\(s\)|unmapped|stale' <<<"$u564_base_out" | head -3)"
fi

if [ "$u564_untracked_rc" -ne 0 ] \
   && grep -qE "^  1 coverage gap\(s\)$" <<<"$u564_untracked_out" \
   && grep -qF "probe-untracked-564.md" <<<"$u564_untracked_out"; then
  pass "an UNTRACKED surface file nothing asserts on is a fatal coverage gap (#564)"
else
  fail "an untracked surface file did not fail the audit" \
       "rc=$u564_untracked_rc; $(grep -E 'coverage gap' <<<"$u564_untracked_out" | head -1)"
fi

# The marker is not decoration: without it a brand-new file prints identically
# to a landed one, and the natural repair for a red gate naming a file that was
# never meant to exist is to add an assertion for it.
if grep -qF "probe-untracked-564.md (untracked)" <<<"$u564_untracked_out"; then
  pass "and the report says the file is untracked, not merely that it is a gap"
else
  fail "the report did not mark the file as untracked" \
       "$(grep -F 'probe-untracked-564' <<<"$u564_untracked_out" | head -1)"
fi

if [ "$u564_covered_rc" -eq 0 ]; then
  pass "adding an assertion for it is what clears the verdict"
else
  fail "an asserted-on untracked file still failed the audit" \
       "rc=$u564_covered_rc; $(grep -E 'coverage gap' <<<"$u564_covered_out" | head -1)"
fi

# FR-004, paired. The `_flag_hits`/`_noflag_hits` control is what makes this
# non-vacuous: it proves --exclude-standard is what hides the file, not the
# pathspec. Assert the control BEFORE the verdict it explains.
if [ "$u564_noflag_hits" -ge 1 ] && [ "$u564_flag_hits" -eq 0 ]; then
  pass "--exclude-standard is what hides an ignored file, and the control proves it"
else
  fail "the --exclude-standard control did not behave as a control" \
       "without the flag: $u564_noflag_hits row(s); with it: $u564_flag_hits"
fi
if [ "$u564_ignored_rc" -eq 0 ] && ! grep -qF "debug.log" <<<"$u564_ignored_out"; then
  pass "an IGNORED file under a mapped surface appears in no bucket"
else
  fail "a gitignored file under a surface prefix reached the audit" \
       "rc=$u564_ignored_rc; $(grep -F 'debug.log' <<<"$u564_ignored_out" | head -1)"
fi

if [ "$u564_outside_rc" -eq 0 ] && ! grep -qF "scratch-564.md" <<<"$u564_outside_out"; then
  pass "an untracked file outside the four prefixes is not collected (the pathspec, separately)"
else
  fail "an untracked file outside the pathspec was collected" \
       "rc=$u564_outside_rc; $(grep -F 'scratch-564' <<<"$u564_outside_out" | head -1)"
fi

if [ "$u564_staged_rc" -ne 0 ] \
   && grep -qF "probe-staged-564.md (staged, not committed)" <<<"$u564_staged_out"; then
  pass "a STAGED but uncommitted surface file is seen, and named as staged"
else
  fail "a staged surface file was invisible or unmarked" \
       "rc=$u564_staged_rc; $(grep -F 'probe-staged-564' <<<"$u564_staged_out" | head -1)"
fi

if [ "$u564_nested_rc" -ne 0 ] \
   && grep -qF "templates/core/agents/nested-564/ (untracked nested repository" <<<"$u564_nested_out"; then
  pass "an untracked nested repository is reported as a directory, with its cause named"
else
  fail "a nested repository under a surface prefix was not reported as one" \
       "rc=$u564_nested_rc; $(grep -F 'nested-564' <<<"$u564_nested_out" | head -1)"
fi

# FR-014. The run must COMPLETE — reaching the summary is the assertion. It
# goes non-zero for the gap, which is expected and is not what is under test.
# The control first: if chmod 000 did not actually make the file unreadable
# (uid 0), say so instead of passing.
if [ "$u564_unreadable_control" -eq 0 ]; then
  pass "the unreadable-path probe is actually unreadable (its own control)"
else
  fail "chmod 000 left the file readable — the FR-014 probe below proves nothing" \
       "running as uid $(id -u)?"
fi
if grep -qE "^## Summary$" <<<"$u564_unreadable_out" \
   && grep -qF "probe-unreadable-564.md" <<<"$u564_unreadable_out"; then
  pass "an unreadable collected path is reported without being opened (FR-014)"
else
  fail "the audit did not survive an unreadable collected path" \
       "rc=$u564_unreadable_rc; $(tail -3 <<<"$u564_unreadable_out")"
fi

if [ "$u564_hs_rc" -ne 0 ] && grep -qF "probe-hs-564.md (untracked)" <<<"$u564_hs_out"; then
  pass "the SECOND surface prefix (templates/harness-specific/) is witnessed too"
else
  fail "an untracked file under templates/harness-specific/ was not collected" \
       "rc=$u564_hs_rc; $(grep -F 'probe-hs-564' <<<"$u564_hs_out" | head -1)"
fi

# `git -C` does not beat an exported GIT_DIR. The whole report must be
# unchanged, not merely the exit code: the observed failure mode was 28 TRACKED
# files reported as "(untracked)" on a run whose rc was already non-zero for
# unrelated reasons, so an rc-only assertion would have seen nothing.
# `could not run` must be exit 2, not 0 and not 1. Asserting merely "non-zero"
# would pass on 1 — the findings verdict — which is the confusion this script's
# exit codes exist to prevent and which preflight.sh branches on.
# It names the SPECIFIC collection, not just "a collection". A corrupt index
# breaks both index-reading sources, so a generic grep passes even when the
# staged guard is removed — the untracked one catches it one line later and the
# message still contains "collection failed". Observed: that generic version
# stayed green under the very defect it claimed to catch.
if [ "$u564_broken_rc" -eq 2 ] && grep -qF "the staged collection failed" <<<"$u564_broken_out"; then
  pass "a failing collection exits 2 and names which one, instead of reporting a clean tree"
else
  fail "a broken git query did not produce a could-not-run verdict" \
       "rc=$u564_broken_rc; $(grep -E 'no user-visible|collection failed' <<<"$u564_broken_out" | head -1)"
fi

if [ -n "$u564_ambient_ctl_out" ] && [ "$u564_ambient_out" = "$u564_ambient_ctl_out" ]; then
  pass "an ambient GIT_DIR cannot repoint the audit at another repository"
else
  fail "an exported GIT_DIR changed the audit's report" \
       "rc=$u564_ambient_rc; $(diff <(printf '%s\n' "$u564_ambient_ctl_out") <(printf '%s\n' "$u564_ambient_out") | head -4)"
fi
if [ -n "$u564_ambient_ctl_out" ] && [ "$u564_common_out" = "$u564_ambient_ctl_out" ]; then
  pass "and neither can GIT_COMMON_DIR — the variable a hand-written list missed"
else
  fail "an exported GIT_COMMON_DIR changed the audit's report" \
       "$(diff <(printf '%s\n' "$u564_ambient_ctl_out") <(printf '%s\n' "$u564_common_out") | head -4)"
fi

if grep -qF "untracked-café-564.md" <<<"$u564_accent_out"; then
  pass "an UNTRACKED non-ASCII path is rendered unescaped too (#549 on the new source)"
else
  fail "an untracked non-ASCII path was escaped or lost" \
       "$(grep -F 'untracked' <<<"$u564_accent_out" | head -2)"
fi

if [ "$u564_global_hidden" -eq 0 ] && grep -qF "probe-excl-564.md" <<<"$u564_excl_out"; then
  pass "a machine-global excludes file cannot hide a surface file from the audit"
else
  fail "the core.excludesFile pin did not hold" \
       "global-hidden rows=$u564_global_hidden; audit named it: $(grep -cF 'probe-excl-564' <<<"$u564_excl_out")"
fi

# Not 1: a subdirectory is a tree the audit CANNOT answer for, which is the
# same class as "not a work tree" and gets the same code. Asserting it is
# non-zero would pass on 1, which is the findings verdict.
if [ "$u564_subdir_rc" -eq 3 ]; then
  pass "--src-root pointed at a subdirectory exits 3, not a findings verdict (FR-013)"
else
  fail "a subdirectory --src-root did not exit 3" "rc=$u564_subdir_rc"
fi

# Idempotence, with the non-emptiness control the first version lacked: two
# identical crashes are byte-identical too.
if [ -n "$u564_idem1_out" ] && grep -qE "^## Summary$" <<<"$u564_idem1_out" \
   && [ "$u564_idem1_out" = "$u564_idem2_out" ]; then
  pass "two runs on one unchanged tree produce identical, non-empty output"
else
  fail "the audit is not idempotent on an unchanged tree" \
       "rc=$u564_idem1_rc; $(diff <(printf '%s\n' "$u564_idem1_out") <(printf '%s\n' "$u564_idem2_out") | head -4)"
fi

# FR-012's ACTUAL decision — first-seen order, not byte-equality. A tracked gap
# (source 1) must be reported BEFORE an untracked one (source 3) that sorts
# first alphabetically. Any sort in the union inverts this; byte-equality above
# cannot see it.
if [ -n "$u564_order_tracked" ] && [ -n "$u564_order_untracked" ] \
   && [ "$u564_order_tracked" -lt "$u564_order_untracked" ]; then
  pass "the union preserves first-seen order: source 1 before source 3 (FR-012)"
else
  fail "the union did not preserve concatenation order" \
       "tracked at line ${u564_order_tracked:-<absent>}, untracked at ${u564_order_untracked:-<absent>}"
fi

# The de-duplication control: assert the path really was in BOTH sources before
# asserting it was reported once. Without the control, a run where the repro
# failed to set itself up would read as a passing dedupe.
if [ "$u564_dup_in_tracked" -ge 1 ] && [ "$u564_dup_in_others" -ge 1 ]; then
  pass "the union's duplicate case reproduces: one path, both sources"
else
  fail "the duplication repro did not set itself up" \
       "tracked=$u564_dup_in_tracked others=$u564_dup_in_others"
fi
if [ "$u564_dup_reported" -eq 1 ]; then
  pass "and the union reports it exactly once"
else
  fail "a path present in two sources was reported $u564_dup_reported time(s)" \
       "$(grep -F 'probe-dup-564' <<<"$u564_dup_out" | head -3)"
fi
