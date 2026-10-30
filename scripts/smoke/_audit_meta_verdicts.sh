# shellcheck shell=bash
# Sourced by smoke-audit.sh, once every scenario has run: the verdicts on the
# reports smoke-audit.sh captured for findings 1 to 3k. Reads only those
# captures, and prints one pass or fail per assertion.
#
# Every capture read here is assigned in smoke-audit.sh, which ShellCheck
# cannot see from this file.
# shellcheck disable=SC2154

echo "$out"
echo
echo "── assertions ──"

if grep -q "new-fake-agent.md" <<<"$out"; then
  pass "audit reports the planted coverage gap (new-fake-agent.md)"
else
  fail "audit did NOT report the planted coverage gap"
fi

if grep -q "baseline-deleted-agent.md" <<<"$out"; then
  pass "audit reports the planted stale assertion (baseline-deleted-agent.md)"
else
  fail "audit did NOT report the planted stale assertion"
fi

if grep -qE "^  1 coverage gap\(s\)$" <<<"$out"; then
  pass "audit summary counts exactly 1 coverage gap"
else
  fail "audit summary did NOT count exactly 1 coverage gap"
fi

if grep -qE "^  1 stale assertion\(s\)$" <<<"$out"; then
  pass "audit summary counts exactly 1 stale assertion"
else
  fail "audit summary did NOT count exactly 1 stale assertion"
fi

# The contract this file exists to guard (plan.md §5 R5, FR-004/FR-005).
# AC4: clean_out's only reader used to be the `fail` diagnostic below, which
# runs only once this assertion has already decided. A diagnostic is not a
# reader. Assert the clean REPORT, not just the clean exit code.
# The clean scenario runs at the baseline with nothing planted, so the coverage
# scan takes its no-changes branch — NOT the "every surface change has a
# matching smoke assertion" branch, which needs a non-empty diff. Asserting the
# wrong one of the two is how this check first failed; the two lines are not
# interchangeable and the distinction is the report's, not this file's.
if grep -qE "^  ✓ no user-visible surface changes since " <<<"$clean_out" \
   && grep -qE "^  0 coverage gap\(s\)$" <<<"$clean_out" \
   && grep -qE "^  0 stale assertion\(s\)$" <<<"$clean_out"; then
  pass "a clean tree SAYS it is clean, in the report and not only in the exit code"
else
  fail "the clean report did not say what a clean tree looks like" \
       "$(grep -E 'coverage gap|stale assertion|surface change' <<<"$clean_out" | head -3)"
fi

if [ "$clean_rc" -eq 0 ]; then
  pass "audit exits 0 on a clean tree"
else
  fail "audit exited $clean_rc on a clean tree" "$(tail -6 <<<"$clean_out")"
fi

# Exactly 1, not merely non-zero: 2 and 3 mean "could not run", and a test
# that accepts any non-zero would go green on an audit that never ran.
if [ "$rc" -eq 1 ]; then
  pass "audit exits 1 with findings — the verdict is the exit code"
else
  fail "audit exited $rc WITH findings, expected 1" "1 means findings; 2 and 3 mean it could not run"
fi

if grep -q "prune this allowlist entry" <<<"$staleallow_out" && [ "$staleallow_rc" -ne 0 ]; then
  pass "an allowlist entry whose file is gone is reported and fatal"
else
  fail "stale allowlist entry not reported" "the allowlist can outlive what it excuses"
fi

if [ "$baseline_rc" -eq 2 ]; then
  pass "an unresolvable baseline exits 2, not 1 (could-not-run, not findings)"
else
  fail "unresolvable baseline exited $baseline_rc, expected 2" "preflight would blame a shallow clone for coverage gaps"
fi

if [ "$notgit_rc" -eq 3 ]; then
  pass "a non-git --src-root exits 3, not 1"
else
  fail "non-git src-root exited $notgit_rc, expected 3" "could-not-run is being reported as findings"
fi

if grep -q "templates/core/statusline/config.md" <<<"$out"; then
  pass "audit reports the unmapped surface (templates/core/statusline/)"
else
  fail "audit did NOT report the unmapped surface" "it passed in silence"
fi

# One unmapped (a shipped category — fatal) and one outside the scaffolded
# surface (src/cli — reported, not fatal). #549 split them: #544 added src/cli
# to the pathspec so it would be VISIBLE, and that stands; but the smoke suite
# does not test this repository's TypeScript, so it must not block a release.
if grep -qE "^  1 unmapped surface change\(s\)" <<<"$out"; then
  pass "audit counts the shipped unmapped category"
else
  fail "unmapped count is not 1" "$(grep -E 'unmapped' <<<"$out" | head -2)"
fi
if grep -qE "^  1 change\(s\) outside the scaffolded surface \(not fatal\)" <<<"$out"; then
  pass "and counts the src/cli change separately, as not fatal"
else
  fail "the outside-the-surface class was not counted" "$(grep -E 'outside' <<<"$out" | head -2)"
fi

if grep -q "src/cli/new_surface.ts" <<<"$out"; then
  pass "an unmapped src/cli/ change is named, not silently skipped"
else
  fail "src/cli/ change fell through in silence" "the unmapped section had its own blind spot"
fi

# Anchored to the PER-FILE line. `grep -q "allow-listed"` was satisfied by the
# summary line `N allow-listed gap(s) (not fatal)` just as readily, so the
# assertion survived the per-file report disappearing entirely.
if grep -qE "^  0 coverage gap\(s\)$" <<<"$allow_out" \
   && grep -qE "^  ~ templates/core/agents/new-fake-agent\.md \(allow-listed\)$" <<<"$allow_out"; then
  pass "an allow-listed gap with a reason is cleared and named per file"
else
  fail "the allowlist did not clear the gap" "$(grep -E 'coverage gap' <<<"$allow_out" | head -2)"
fi

# AC3 — the recorded REASON is read. Carrying it is the entire point of 022-R13
# and audit.sh prints it, but nothing had ever looked at the text.
if grep -qE "^      reason: deferred on purpose, for the meta-test$" <<<"$allow_out"; then
  pass "the allowlist entry's written reason is echoed back verbatim"
else
  fail "the recorded reason was not reported" \
       "an entry may as well carry no reason if the report never shows it (022-R13)"
fi

if [ "$allow_rc" -eq 0 ]; then
  pass "allow-listing the only finding flips the exit code to 0"
else
  fail "allow-listed gap still exited $allow_rc" "the escape hatch does not actually work"
fi

# Asserted on the REPORT, not only on the exit code. audit.sh reaches
# non-zero here by two independent routes — the gap staying fatal, and the
# reasonless entry being itself a finding — so `rc != 0` would still pass if
# allow_reason regressed to accept an empty reason. Pin the gap count.
if grep -qE "^  1 coverage gap\(s\)$" <<<"$noreason_out" && [ "$noreason_rc" -ne 0 ]; then
  pass "an allowlist entry with NO reason does not grant an exemption"
else
  fail "a reasonless allowlist entry silenced the gap" \
       "$(grep -E 'coverage gap' <<<"$noreason_out" | head -1)"
fi

# DELETED: an assertion named "exit code and report agree in both directions",
# written as `[ "$clean_rc" -eq 0 ] && [ "$rc" -ne 0 ]`. It was the conjunction
# of two assertions that already stand above it — "audit exits 0 on a clean
# tree" and "audit exits 1 with findings", the second of which is strictly
# stronger than `-ne 0`. It read no report and could not fail on its own.
#
# Not rewritten to pin report content, because an assertion that cannot fail is
# worse than an absent one: it is counted. Do not reinstate it — if you want the
# agreement checked, the two assertions above are where it lives.

if grep -q "comment-only-agent.md" <<<"$commentonly_out"; then
  pass "a basename occurring only in a comment is NOT coverage (#545)"
else
  fail "a comment vouched for a file" \
       "audit reported coverage for comment-only-agent.md, which no assertion names"
fi

# Asserted on the REPORT, not merely on the exit code: this run is non-zero
# for the planted stale assertion regardless, so `rc != 0` would pass even
# with the comment still counting as coverage. Pin the count instead.
if grep -qE "^  2 coverage gap\(s\)$" <<<"$commentonly_out"; then
  pass "the comment-only file is counted as a gap, not merely mentioned"
else
  fail "gap count did not reach 2 with the comment-only file planted" \
       "$(grep -E 'coverage gap' <<<"$commentonly_out" | head -1)"
fi

if grep -q "skills/lonely-skill/SKILL.md" <<<"$skills_out"; then
  pass "a skill no smoke names is a coverage gap (#547)"
else
  fail "a skill nothing asserts on was reported covered" \
       "every skill's basename is SKILL.md, so the basename match cannot fail"
fi

if grep -q "skills/mentioned-elsewhere/SKILL.md" <<<"$skills_out"; then
  pass "naming a skill inside another file's assertion is not coverage"
else
  fail "a cross-reference vouched for a skill" \
       "the token must not be the bare skill name — smoke-contracts.sh's #442 block is this shape"
fi

# Pinned as a COUNT, the way 3f is. Both greps above match substrings that the
# non-fatal "Unmapped surface" section also prints, so they would stay green if
# skills stopped being coverage-scanned at all — the section would name the same
# paths for a different reason.
if grep -qE "^  4 coverage gap\(s\)$" <<<"$skills_out"; then
  pass "both planted skills are counted as gaps, not merely named somewhere"
else
  fail "gap count is not 4 with two skills planted" \
       "$(grep -E 'coverage gap' <<<"$skills_out" | head -1)"
fi

if grep -qF "agént-café.md" <<<"$nonascii_out"; then
  pass "a non-ASCII path is seen by the scan at all (#549)"
else
  fail "a non-ASCII path was invisible" "git quotes it unless core.quotePath=false"
fi
if grep -A20 "## Coverage scan" <<<"$nonascii_out" | grep -qF "agént-café.md"; then
  pass "and it is judged by the COVERAGE scan, not swallowed as unmapped"
else
  fail "the non-ASCII file did not reach the coverage scan" \
       "$(grep -B1 -A3 'Unmapped surface' <<<"$nonascii_out" | head -5)"
fi

if [ "$unmapped_rc" -ne 0 ] && grep -qF "nosuchcategory/thing.md" <<<"$unmapped_out"; then
  pass "a changed file no glob claims is fatal, not advisory"
else
  fail "an unmapped category did not fail the audit" "rc=$unmapped_rc"
fi
# The COUNT, not the exit code: this scenario is non-zero for several unrelated
# findings, so `rc != 0` would pass with the rule regressed — the vacuous shape
# #546 removed from this file. The pair is the control: same entry, one without
# a reason and one with, and only the count distinguishes them.
if grep -qE "^  2 unmapped surface change\(s\)" <<<"$unmapped_noreason_out"; then
  pass "allow-listing it WITHOUT a reason does not excuse it (022-R13)"
else
  fail "a reasonless allowlist entry changed the unmapped count" \
       "$(grep -E 'unmapped surface change' <<<"$unmapped_noreason_out" | head -1)"
fi
if grep -qE "^  1 unmapped surface change\(s\)" <<<"$unmapped_reason_out" \
   && grep -qF "(unmapped, allow-listed)" <<<"$unmapped_reason_out"; then
  pass "and the SAME entry WITH a reason does excuse it"
else
  fail "a reasoned allowlist entry did not excuse the unmapped file" \
       "$(grep -E 'unmapped surface change|allow-listed' <<<"$unmapped_reason_out" | head -2)"
fi

# The pair, and only the pair, can fail on fatality.
if [ "$iso_fatal_rc" -ne 0 ] && grep -qE "^  0 coverage gap\(s\)$" <<<"$iso_fatal_out" \
   && grep -qE "^  1 unmapped surface change\(s\)$" <<<"$iso_fatal_out"; then
  pass "an unmapped file is fatal when it is the ONLY finding (#549)"
else
  fail "unmapped alone did not fail the audit" \
       "rc=$iso_fatal_rc; $(grep -E 'coverage gap|unmapped surface' <<<"$iso_fatal_out" | head -2)"
fi
if [ "$iso_clear_rc" -eq 0 ]; then
  pass "and adding its written reason is what clears the verdict"
else
  fail "a reasoned allowlist entry did not clear the isolated run" \
       "rc=$iso_clear_rc; $(grep -E 'coverage gap|unmapped' <<<"$iso_clear_out" | head -2)"
fi

# #550's positive control. The COUNT and the exit code together: a grep for
# the finding text alone would pass against a report that printed it without
# acting on it, which is the shape this whole ticket exists to remove.
if [ "$capture_rc" -ne 0 ] \
   && grep -qE "^  1 capture\(s\) read only inside a fail$" <<<"$capture_out" \
   && grep -qE "^  0 coverage gap\(s\)$" <<<"$capture_out" \
   && grep -qF 'captures $probe_out' <<<"$capture_out"; then
  pass "a capture read only inside a fail is reported, and is fatal alone (#550)"
else
  fail "an unread capture did not fail the audit" \
       "rc=$capture_rc; $(grep -E 'capture\(s\)|coverage gap' <<<"$capture_out" | head -2)"
fi
if [ "$capture_fixed_rc" -eq 0 ] \
   && grep -qE "^  0 capture\(s\) read only inside a fail$" <<<"$capture_fixed_out"; then
  pass "and reading it in the condition is what clears the verdict"
else
  fail "reading the capture outside the fail did not clear the audit" \
       "rc=$capture_fixed_rc; $(grep -E 'capture\(s\)' <<<"$capture_fixed_out" | head -1)"
fi
