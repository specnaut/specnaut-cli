#!/usr/bin/env bash
# Smoke test for `audit.sh` itself. Builds a self-contained synthetic repo,
# plants one of each finding type the audit is supposed to detect, and runs
# the REAL audit.sh against it.
#
# ─── Why it no longer copies audit.sh ────────────────────────────────────
# The previous version copied audit.sh alone into the synthetic tree and ran
# the copy. That made the meta-test depend on audit.sh deriving its source
# tree from wherever the file happened to sit — so the moment audit.sh
# gained a shared header (_common.sh), the single-file copy would have died
# at its first `source`, and any location-based derivation would have
# silently pointed it at the wrong directory.
#
# The audit's source tree and smoke directory are now explicit parameters,
# so this test points the real script at a synthetic tree instead of
# relocating it. That also deletes the question "is the copy still the same
# as the original" — there is no copy.
#
# ─── What it asserts ─────────────────────────────────────────────────────
#   1. a new bundled file with no assertion is reported (coverage gap)
#   2. an assertion referencing a deleted file is reported (staleness)
#   3. the summary counts exactly one of each
#   3b. a changed file under NO mapped surface is reported as unmapped
#       rather than passing in silence — and is not fatal by itself
#   3c. the allowlist escape actually works AND actually flips the verdict —
#       an untested escape hatch is how a gate quietly stops gating
#   3d. a stale allowlist entry — one whose file is gone — is reported, so
#       the allowlist cannot outlive what it excuses
#   3e. the exit codes that mean "could not run" (2, 3) are distinct from the
#       one that means "found things" (1); .specnaut/release/preflight.sh
#       branches on that difference and would otherwise blame a shallow clone
#       for coverage gaps
#   3f. a basename that appears ONLY inside a comment is not coverage —
#       a comment resolves nothing, and one saying a file is deliberately
#       uncovered would otherwise vouch for it (#545)
#   3l. an UNCOMMITTED surface file — untracked or merely staged — is seen
#       at all (#564). Until then the collection was `git diff <a>..<b>`, which
#       compares two COMMITS, so a file git had never recorded was in neither
#       and the gate ran blind on precisely the files it exists to catch.
#       Includes the paired --exclude-standard control, the pathspec control,
#       the union's de-duplication, the nested-repository shape, the
#       machine-global excludes pin, idempotence, and the invariant that no
#       collected path is ever OPENED.
#   4. the EXIT CODE is the verdict: 0 on a clean tree, non-zero with
#      findings. The old version wrapped the call in `|| true` and grepped
#      only stdout, so it passed identically whether audit.sh exited 0, 1 or
#      99 — it could not have detected the contract it exists to guard.
#
# Usage: smoke-audit.sh <name>
set -euo pipefail

. "$(dirname "$0")/_common.sh"

NAME="${1:?usage: smoke-audit.sh <name>}"
SANDBOX="$(scenario_dir "$NAME")"
SYNTH_SMOKE="$SANDBOX/scripts/smoke"

trap 'rm -rf "$SANDBOX"' EXIT

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

# --- Synthetic baseline state -------------------------------------------
git init -q -b main
git config user.email "smoke-audit@local"
git config user.name "smoke-audit"

# ─── Why these prefixes are written out as literals ──────────────────────
# `audit.sh` carries the same four surface prefixes in `SURFACE_PATHSPEC`, and
# #564 hoisted them there so its own two collections could not drift apart.
# These literals are NOT that duplication and must not be "fixed" by importing
# the array: they are the only independent opinion in the suite about what that
# array should contain. Import it and this test plants under whatever audit.sh
# currently says, so no assertion here can ever fail on a wrong pathspec.
#
# #551 is what that would have cost — twelve shipped files under
# `templates/harness-specific/` were invisible for months because the pathspec
# ignored the whole tree, and only a hand-written literal elsewhere could have
# caught it.
mkdir -p templates/core/agents \
         templates/core/skills/task/scripts/github \
         templates/harness-specific/claude/hooks \
         "$SYNTH_SMOKE"

# Baseline content the smoke ALREADY covers, so the audit has a happy path
# alongside the planted gap.
cat > templates/core/agents/baseline-agent.md <<'EOF'
---
name: baseline-agent
description: existed in the baseline tag and is referenced by the smoke.
---
EOF

cat > "$SYNTH_SMOKE/smoke-features.sh" <<'EOF'
#!/usr/bin/env bash
# Synthetic smoke for the audit meta-test. Asserts the baseline agent is
# present. Does NOT mention the planted "new" agent — that's the gap.
set -euo pipefail
[ -f .claude/agents/baseline-agent.md ] || { echo "missing baseline"; exit 1; }
EOF
chmod +x "$SYNTH_SMOKE/smoke-features.sh"

git add -A
git commit -q -m "baseline"
git tag vTEST-BASELINE

# --- Assertion 4a: a clean tree exits 0 ---------------------------------
# Run before anything is planted. Same baseline, same HEAD: no surface
# change, no stale reference, so the verdict must be clean AND the exit code
# must say so on its own.
set +e
clean_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
clean_rc=$?
set -e

# --- Plant the two findings ---------------------------------------------
# 1. New bundled agent with no smoke assertion → coverage gap.
cat > templates/core/agents/new-fake-agent.md <<'EOF'
---
name: new-fake-agent
description: shipped after the baseline tag with zero smoke coverage.
---
EOF

# 2. Smoke referencing a runtime path whose source is missing → stale.
#    (`baseline-deleted-agent.md` never existed under templates/core/agents/.)
cat > "$SYNTH_SMOKE/smoke-stale.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-deleted-agent.md ] || { echo "stale ref"; exit 1; }
EOF
chmod +x "$SYNTH_SMOKE/smoke-stale.sh"

# 3. A file under a category the SURFACES map has never heard of. It is not a
#    coverage gap (no glob claims it) and it must not be silently skipped —
#    silence here is how a required gate reports "every surface change has a
#    matching smoke assertion" about something it never looked at.
mkdir -p templates/core/statusline src/cli
cat > templates/core/statusline/config.md <<'EOF'
# a shipped category no glob in the SURFACES map matches
EOF
# And one under src/cli/, which the diff pathspec collects but no SURFACES
# glob claims. The unmapped section was originally scoped to templates/core/
# only, so this whole root fell through in silence.
cat > src/cli/new_surface.ts <<'EOF'
// a CLI surface the audit collects but maps to nothing
EOF

git add -A
git commit -q -m "plant audit findings"

# --- Run the audit against the planted tree -----------------------------
set +e
out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
rc=$?
set -e

# --- Assertion 3c: the allowlist escape ---------------------------------
# Allow-list the planted gap WITH a reason, and separately WITHOUT one. The
# first must clear the gap and flip the exit code; the second must not,
# because an entry with no reason is not an entry.
#
# The stale smoke is taken off disk first, so the gap is genuinely the ONLY
# finding. Without this the exit code stays 1 for the stale assertion and the
# flip proves nothing — which is exactly what the first version of this test
# asserted, and it failed for the right reason.
rm -f "$SYNTH_SMOKE/smoke-stale.sh"
# Both classes must be excused for the verdict to flip: the coverage gap and
# the unmapped category #549 made fatal. That one rule clears either is the
# point of the hatch.
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/new-fake-agent.md  deferred on purpose, for the meta-test
templates/core/statusline/config.md  an unmapped category, excused with a reason
EOF
set +e
allow_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
allow_rc=$?
set -e

cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/new-fake-agent.md
EOF
set +e
noreason_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
noreason_rc=$?
set -e
rm -f "$SYNTH_SMOKE/coverage-allowlist.txt"

# Put the stale smoke back: the assertions below read `$out`, captured while
# it was present.
cat > "$SYNTH_SMOKE/smoke-stale.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-deleted-agent.md ] || { echo "stale ref"; exit 1; }
EOF
chmod +x "$SYNTH_SMOKE/smoke-stale.sh"

# --- Assertion 3d: a stale allowlist entry ------------------------------
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/this-file-was-deleted-long-ago.md  excuses a file that no longer exists
EOF
set +e
staleallow_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
staleallow_rc=$?
set -e
rm -f "$SYNTH_SMOKE/coverage-allowlist.txt"

# --- Assertion 3e: "could not run" is not "found things" ----------------
set +e
bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since v99.99.99-does-not-exist >/dev/null 2>&1
baseline_rc=$?
# A directory that EXISTS but is in no git work tree. Anything under $SANDBOX
# is inside the synthetic repo, and a path that does not exist exits 1 from
# the flag validation — neither would reach the exit-3 branch.
notgit_dir="$(mktemp -d)"
bash "$SMOKE_DIR/audit.sh" --src-root "$notgit_dir" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE >/dev/null 2>&1
notgit_rc=$?
rmdir "$notgit_dir"
set -e

# --- Assertion 3f: a mention inside a COMMENT is not coverage -----------
# #545. The coverage test was one unanchored fixed-string match over the
# whole smoke file, so a basename occurring only in a comment counted as
# coverage — including a comment saying the file is deliberately NOT
# covered. The failure direction is the one a gate must never take: it
# reports coverage that does not exist.
#
# Planted last, and captured separately, so the counts every assertion
# above pins against `$out` are untouched.
cat > templates/core/agents/comment-only-agent.md <<'EOF'
---
name: comment-only-agent
description: mentioned by the smoke in a comment and nowhere else.
---
EOF
cat >> "$SYNTH_SMOKE/smoke-features.sh" <<'EOF'
# comment-only-agent.md is named here and nowhere else in this file.
# A comment resolves nothing and asserts nothing; it must not vouch for a file.
EOF
git add -A
git commit -q -m "plant a file mentioned only in a comment"
#
# The exit code is deliberately NOT captured here. This run is non-zero for
# the planted stale assertion whatever the coverage logic does, so an
# assertion on it would pass with the defect still in place — the vacuous
# shape #546 exists to remove from this file. The gap COUNT below is the
# assertion that can fail.
set +e
commentonly_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
set -e

# --- Assertion 3g: a skill's basename identifies nothing ----------------
# #547. Every skill file is named SKILL.md, so the basename match was
# constant-true across the whole surface and 13 shipped skills were asserted
# on by nothing. Two are planted, because the naive repair fails on the
# second: `lonely-skill` is named nowhere, and `mentioned-elsewhere` is named
# ONLY inside an assertion whose subject is a different file — the shape at
# smoke-features.sh:591 that both plan-time audits found. A token built from
# the bare skill name reports the second one covered.
mkdir -p templates/core/skills/lonely-skill templates/core/skills/mentioned-elsewhere
printf -- '---\nname: lonely-skill\n---\n' > templates/core/skills/lonely-skill/SKILL.md
printf -- '---\nname: mentioned-elsewhere\n---\n' > templates/core/skills/mentioned-elsewhere/SKILL.md
cat >> "$SYNTH_SMOKE/smoke-features.sh" <<'EOF'
[ -f .claude/skills/task/SKILL.md ] || { echo "missing task"; exit 1; }
grep -q "mentioned-elsewhere" .claude/skills/task/SKILL.md || { echo "no xref"; exit 1; }
EOF
git add -A
git commit -q -m "plant two skills, one named only in another file's assertion"
set +e
skills_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
set -e

# --- Assertion 3h: a non-ASCII path is mapped like any other -------------
# #549. git renders a path containing non-ASCII bytes as an escaped, quoted
# string, so it matched no glob in SURFACES and left through the "Unmapped
# surface" bucket — which was not fatal. A file nothing asserts on, on a green
# gate. The fix is `-c core.quotePath=false`; this pins that the file lands in
# the COVERAGE scan, not in the unmapped one.
mkdir -p templates/core/agents
printf -- '---\nname: accented\n---\n' > "templates/core/agents/agént-café.md"
git add -A
git commit -q -m "plant an agent whose name is not ASCII"
set +e
nonascii_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
set -e

# --- Assertion 3i: an unmapped file is fatal, and 022-R13 still governs ----
# The allow-list is the escape hatch for the new fatal class, and an entry
# without a written reason is not an entry — the same refusal that already
# applies to coverage gaps.
mkdir -p templates/core/nosuchcategory
echo "shipped, claimed by no glob" > templates/core/nosuchcategory/thing.md
git add -A
git commit -q -m "plant a category the SURFACES map has never heard of"
set +e
unmapped_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
unmapped_rc=$?
set -e
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/nosuchcategory/thing.md
EOF
set +e
unmapped_noreason_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
set -e
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/nosuchcategory/thing.md  a deliberate category, excused on purpose
EOF
set +e
unmapped_reason_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
set -e
rm -f "$SYNTH_SMOKE/coverage-allowlist.txt"

# --- Assertion 3j: fatality, ISOLATED -----------------------------------
# 3i above cannot fail on fatality: its run is non-zero for five coverage gaps
# and a planted stale assertion whatever the unmapped class does, and its grep
# matches the report the pre-fix ADVISORY build printed too. Deleting the
# fatality clause from audit.sh left the whole meta-test green — reproduced.
#
# This run clears every other finding class so the unmapped file is the only
# one left, then flips only its allow-list reason. If unmapped stops being
# fatal, the first half goes green and this assertion fails.
rm -f "$SYNTH_SMOKE/smoke-stale.sh"
# 3g's appended assertion references .claude/skills/task/SKILL.md, which has
# no source counterpart in this synthetic tree — a stale assertion that would
# keep the isolated run non-zero for a reason unrelated to the class under
# test. Give it its source; the same assertion then covers it.
mkdir -p templates/core/skills/task
printf -- '---\nname: task\n---\nmentioned-elsewhere\n' > templates/core/skills/task/SKILL.md
git add -A
git commit -q -m "give the task reference a source, so the isolated run is isolated"
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/new-fake-agent.md  isolated run: not the class under test
templates/core/agents/comment-only-agent.md  isolated run: not the class under test
templates/core/agents/agént-café.md  isolated run: not the class under test
templates/core/skills/lonely-skill/SKILL.md  isolated run: not the class under test
templates/core/skills/mentioned-elsewhere/SKILL.md  isolated run: not the class under test
templates/core/statusline/config.md  isolated run: not the class under test
EOF
set +e
iso_fatal_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
iso_fatal_rc=$?
set -e
cat >> "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/nosuchcategory/thing.md  and now the class under test, excused
EOF
set +e
iso_clear_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
iso_clear_rc=$?
printf '%s
' "$iso_clear_out" | sed -n '/## Summary/,$p' >&2
set -e
rm -f "$SYNTH_SMOKE/coverage-allowlist.txt"
cat > "$SYNTH_SMOKE/smoke-stale.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-deleted-agent.md ] || { echo "stale ref"; exit 1; }
EOF
chmod +x "$SYNTH_SMOKE/smoke-stale.sh"

# --- Assertion 3k: a capture read only inside a fail, ISOLATED ----------
# The positive control for #550's unread-capture scan. Isolated for the same
# reason 3j is: a run that is already non-zero for coverage gaps cannot tell
# you whether THIS class is fatal, and a grep for the finding text passes
# against a report that merely printed it.
#
# The pair is the control. Same synthetic smoke, one version whose only reader
# of $probe_out sits inside a `fail`, one that reads it in the condition. If
# the scan stops firing, or stops being fatal, the first half goes green here.
rm -f "$SYNTH_SMOKE/smoke-stale.sh"
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/new-fake-agent.md  isolated run: not the class under test
templates/core/agents/comment-only-agent.md  isolated run: not the class under test
templates/core/agents/agént-café.md  isolated run: not the class under test
templates/core/skills/lonely-skill/SKILL.md  isolated run: not the class under test
templates/core/skills/mentioned-elsewhere/SKILL.md  isolated run: not the class under test
templates/core/statusline/config.md  isolated run: not the class under test
templates/core/nosuchcategory/thing.md  isolated run: not the class under test
EOF
# The defect. `probe_out` is captured, then read ONLY in the fail diagnostic —
# which runs after `[ 1 = 1 ]` has already decided. The assertion cannot fail
# for any reason connected to what was captured.
cat > "$SYNTH_SMOKE/smoke-capture.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-agent.md ] || { echo "missing baseline"; exit 1; }
probe_out="$(printf 'unexpected')"
if [ 1 = 1 ]; then
  fail "the probe disagreed" "got: $probe_out"
fi
EOF
chmod +x "$SYNTH_SMOKE/smoke-capture.sh"
set +e
capture_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
capture_rc=$?
set -e
# The fix: the captured value now decides the branch. Nothing else changes —
# same file, same capture, same fail line.
cat > "$SYNTH_SMOKE/smoke-capture.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-agent.md ] || { echo "missing baseline"; exit 1; }
probe_out="$(printf 'unexpected')"
if [ "$probe_out" != "unexpected" ]; then
  fail "the probe disagreed" "got: $probe_out"
fi
EOF
set +e
capture_fixed_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
capture_fixed_rc=$?
set -e
rm -f "$SYNTH_SMOKE/smoke-capture.sh" "$SYNTH_SMOKE/coverage-allowlist.txt"
cat > "$SYNTH_SMOKE/smoke-stale.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-deleted-agent.md ] || { echo "stale ref"; exit 1; }
EOF
chmod +x "$SYNTH_SMOKE/smoke-stale.sh"

# --- Assertion 3l: an UNCOMMITTED surface file is seen (#564) ------------
# EVERYTHING below is planted AFTER every capture above. Nineteen assertions in
# this file pin exact counts, and one stray untracked file under a surface
# prefix moves all of them. The margin is one line; this comment is the guard
# rail, because nothing mechanical enforces the ordering.
#
# Each probe runs ISOLATED — every other finding class allow-listed or removed —
# for the reason 3j and 3k are isolated: a run that is already non-zero for
# five coverage gaps cannot tell you whether THIS class is fatal, and a grep
# for the finding text passes against a report that merely printed it.

# The synthetic tree gets a .gitignore mirroring a REAL rule from this
# repository's own (`*.log`, .gitignore:3). It sits at the synthetic root,
# outside all four surface prefixes, so it shifts no count above.
cat > .gitignore <<'EOF'
*.log
EOF
git add -A
git commit -q -m "give the synthetic tree a .gitignore mirroring a real rule"

rm -f "$SYNTH_SMOKE/smoke-stale.sh"
cat > "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/new-fake-agent.md  isolated run: not the class under test
templates/core/agents/comment-only-agent.md  isolated run: not the class under test
templates/core/agents/agént-café.md  isolated run: not the class under test
templates/core/skills/lonely-skill/SKILL.md  isolated run: not the class under test
templates/core/skills/mentioned-elsewhere/SKILL.md  isolated run: not the class under test
templates/core/statusline/config.md  isolated run: not the class under test
templates/core/nosuchcategory/thing.md  isolated run: not the class under test
EOF

_iso_audit() {
  bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1
}

# The control every probe below is measured against. Nothing planted, every
# other class excused: the isolated tree must be GREEN. If this is not 0, every
# "rc=1 because of my probe" assertion below is vacuous.
set +e
u564_base_out="$(_iso_audit)"; u564_base_rc=$?
set -e

# (a) untracked, under a mapped surface, named by no smoke.
printf -- '---\nname: probe-untracked-564\n---\n' > templates/core/agents/probe-untracked-564.md
set +e
u564_untracked_out="$(_iso_audit)"; u564_untracked_rc=$?
set -e

# (b) the same file, with an assertion naming it — the verdict must flip.
cp "$SYNTH_SMOKE/smoke-features.sh" "$SANDBOX/features-564.bak"
cat >> "$SYNTH_SMOKE/smoke-features.sh" <<'EOF'
[ -f .claude/agents/probe-untracked-564.md ] || { echo "missing probe"; exit 1; }
EOF
set +e
u564_covered_out="$(_iso_audit)"; u564_covered_rc=$?
set -e
cp "$SANDBOX/features-564.bak" "$SYNTH_SMOKE/smoke-features.sh"
rm -f "$SANDBOX/features-564.bak" templates/core/agents/probe-untracked-564.md

# (c) FR-004 — the --exclude-standard control, PAIRED.
# The fixture is under a surface prefix AND matched by an ignore rule, so the
# pathspec cannot be what hides it. The first draft of the plan planted this
# under `sandbox/` — outside the pathspec — which meant `--exclude-standard`
# could be deleted with the assertion still green. That is the vacuous shape
# this whole file exists to refuse.
echo "noise" > templates/core/agents/debug.log
set +e
u564_ignored_out="$(_iso_audit)"; u564_ignored_rc=$?
set -e
# The negative half: the same collection WITHOUT the flag does see it. Run
# directly, because the point is what the flag does, not what audit.sh does.
u564_noflag_hits="$(git -C "$SANDBOX" ls-files --others --full-name -- 'templates/core/' 2>/dev/null | grep -c 'agents/debug\.log' || true)"
u564_flag_hits="$(git -C "$SANDBOX" ls-files --others --exclude-standard --full-name -- 'templates/core/' 2>/dev/null | grep -c 'agents/debug\.log' || true)"
rm -f templates/core/agents/debug.log

# (d) the pathspec control — a DIFFERENT mechanism from (c), so neither can
# stand in for the other. An untracked file outside all four prefixes.
# At the synthetic ROOT rather than in a subdirectory: smoke-toolbox.sh's
# static sweep refuses `rm -rf` on any path it cannot see was built from
# $SANDBOX, and it is right to — one failed `cd` and a literal relative path
# deletes the real repository's directory of the same name.
echo "scratch" > scratch-564.md
set +e
u564_outside_out="$(_iso_audit)"; u564_outside_rc=$?
set -e
rm -f scratch-564.md

# (e) staged but not committed — invisible to BOTH `ls-files --others` and
# `$SINCE..HEAD`. `git add` is the next keystroke after `touch`, so without the
# third source the feature's value window is approximately zero.
printf -- '---\nname: probe-staged-564\n---\n' > templates/core/agents/probe-staged-564.md
git add templates/core/agents/probe-staged-564.md
set +e
u564_staged_out="$(_iso_audit)"; u564_staged_rc=$?
set -e
git rm --cached -q templates/core/agents/probe-staged-564.md
rm -f templates/core/agents/probe-staged-564.md

# (f) a nested repository. `ls-files --others` emits it as `<dir>/` — trailing
# slash, contents suppressed — which the plan's first draft called impossible
# "by construction". Measured, twice, in a throwaway repo and here.
# A MINIMAL .git skeleton rather than `git init`, deliberately: git needs only
# HEAD, objects/ and refs/ to treat the directory as a repository — verified —
# and this shape tears down with `rm -f` + `rmdir` alone. `git init` would
# leave ~15 files behind and force an `rm -rf` on a literal relative path,
# which smoke-toolbox.sh's static sweep refuses. Satisfying that guard is
# cheaper than widening it, and widening a guard to fit new code is how the
# guard stops guarding.
mkdir -p templates/core/agents/nested-564/.git/objects \
         templates/core/agents/nested-564/.git/refs
printf 'ref: refs/heads/main\n' > templates/core/agents/nested-564/.git/HEAD
printf -- '---\nname: inner\n---\n' > templates/core/agents/nested-564/inner.md
set +e
u564_nested_out="$(_iso_audit)"; u564_nested_rc=$?
set -e
rm -f templates/core/agents/nested-564/.git/HEAD templates/core/agents/nested-564/inner.md
rmdir templates/core/agents/nested-564/.git/objects \
      templates/core/agents/nested-564/.git/refs \
      templates/core/agents/nested-564/.git \
      templates/core/agents/nested-564

# (g) FR-014 — the audit reads the CONTENT of no collected path. An unreadable
# file must not stop the run. This assertion fails the day somebody "improves"
# the unmapped bucket by reading a new file's front-matter to classify it —
# which would turn a filename report into a content-disclosure path in a job
# whose logs are public.
printf -- '---\nname: unreadable\n---\n' > templates/core/agents/probe-unreadable-564.md
chmod 000 templates/core/agents/probe-unreadable-564.md
# The probe's own control. chmod 000 is a no-op for uid 0, so under a
# `container:` runner — which smoke.yml does not use today, and that is the only
# reason this was live — the file stays readable and the assertion below would
# pass while proving nothing. A probe that can silently stop probing is worse
# than no probe: it reports coverage that does not exist, which is the class
# this whole file guards.
u564_unreadable_control=0
[ -r templates/core/agents/probe-unreadable-564.md ] && u564_unreadable_control=1
set +e
u564_unreadable_out="$(_iso_audit)"; u564_unreadable_rc=$?
set -e
chmod 644 templates/core/agents/probe-unreadable-564.md
rm -f templates/core/agents/probe-unreadable-564.md

# (h) an untracked path with non-ASCII bytes. #549 was the tracked half of this:
# git renders such a path as an escaped, quoted string that matches no SURFACES
# glob. `-c core.quotePath=false` now lives in the shared GIT_SRC prefix, so it
# applies to this source too — and this is the only thing that says so.
printf -- '---\nname: untracked-accented\n---\n' > "templates/core/agents/untracked-café-564.md"
set +e
u564_accent_out="$(_iso_audit)"; u564_accent_rc=$?
set -e
rm -f "templates/core/agents/untracked-café-564.md"

# (i) the machine-global excludes pin. `--exclude-standard` reads THREE sources;
# the third is the user's own excludes file, which has nothing to do with this
# repository. Unpinned, the same tree gets different verdicts on different
# laptops — in the false-green direction, which is the family #564 belongs to.
cat > "$SANDBOX/probe-excludes-564" <<'EOF'
templates/core/agents/probe-excl-564.md
EOF
cat > "$SANDBOX/probe-gitconfig-564" <<EOF
[core]
	excludesFile = $SANDBOX/probe-excludes-564
EOF
printf -- '---\nname: probe-excl\n---\n' > templates/core/agents/probe-excl-564.md
# The control: with that global in force and NO pin, git hides the file.
u564_global_hidden="$(GIT_CONFIG_GLOBAL="$SANDBOX/probe-gitconfig-564" \
  git -C "$SANDBOX" ls-files --others --exclude-standard --full-name -- 'templates/core/' 2>/dev/null \
  | grep -c 'probe-excl-564' || true)"
# A SIMPLE COMMAND, not `_iso_audit`: a variable assignment prefixing a shell
# function is not the same construct as one prefixing an external command, and
# the control above only proves propagation for the latter. The probe and its
# control must exercise the same mechanism or the control is not one.
set +e
u564_excl_out="$(GIT_CONFIG_GLOBAL="$SANDBOX/probe-gitconfig-564" \
  bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
u564_excl_rc=$?
set -e
rm -f templates/core/agents/probe-excl-564.md "$SANDBOX/probe-excludes-564" "$SANDBOX/probe-gitconfig-564"

# (j) idempotence AND first-seen order — two different properties, because
# byte-equality alone cannot see the one the union actually decided.
#
# The first version of this probe compared two runs byte-for-byte and claimed,
# in its own comment, to catch a `sort -u` substituted for
# `awk '!seen[$0]++'`. It cannot: `sort -u` is deterministic, so both runs stay
# identical and it passes. It also passed on two identical CRASHES — neither rc
# was captured and nothing asserted the output was non-empty. FR-012's ordering
# decision had zero witness while plan §9 and §12 both named this as its
# mitigation. Caught at review, and it is the same vacuous shape #546 exists to
# remove from this file.
#
# The order witness: `new-fake-agent.md` is TRACKED and committed after the
# baseline, so it comes from source 1. `aaa-order-564.md` is untracked, so it
# comes from source 3 — and it sorts FIRST alphabetically. Concatenation order
# puts the tracked one first; any sort puts the untracked one first. So the
# assertion below distinguishes them, which byte-equality never could.
sed -i.bak '/new-fake-agent/d' "$SYNTH_SMOKE/coverage-allowlist.txt"
rm -f "$SYNTH_SMOKE/coverage-allowlist.txt.bak"
printf -- '---\nname: probe-order-564\n---\n' > templates/core/agents/aaa-order-564.md
set +e
u564_idem1_out="$(_iso_audit)"; u564_idem1_rc=$?
u564_idem2_out="$(_iso_audit)"
set -e
# `|| true` on both: a capture that feeds an assertion must never decide the
# suite's fate by itself. Without it, `set -e` killed the whole run the moment
# either path was ABSENT from the report — which is precisely the state the
# assertion below exists to detect, so the defect it guards aborted the file
# before that assertion was reached. Found while observing the red battery: the
# "delete source 3" probe produced a crash with zero failed assertions, which
# reads as green to anything counting failures.
u564_order_tracked="$(grep -n 'new-fake-agent\.md' <<<"$u564_idem1_out" | head -1 | cut -d: -f1 || true)"
u564_order_untracked="$(grep -n 'aaa-order-564\.md' <<<"$u564_idem1_out" | head -1 | cut -d: -f1 || true)"
rm -f templates/core/agents/aaa-order-564.md
cat >> "$SYNTH_SMOKE/coverage-allowlist.txt" <<'EOF'
templates/core/agents/new-fake-agent.md  isolated run: not the class under test
EOF

# (k) the union's de-duplication, LAST because it commits. `git rm --cached` on
# a path committed after the baseline puts it in source 1 (an `A` in the range)
# AND source 3 (the index no longer has it). Concatenated without a dedupe the
# gap is counted twice and the report names one file twice.
printf -- '---\nname: probe-dup-564\n---\n' > templates/core/agents/probe-dup-564.md
git add -A
git commit -q -m "plant a file for the union de-duplication case"
git rm --cached -q templates/core/agents/probe-dup-564.md
u564_dup_in_tracked="$(git -C "$SANDBOX" diff --name-only --diff-filter=AMR vTEST-BASELINE..HEAD -- 'templates/core/' | grep -c 'probe-dup-564' || true)"
u564_dup_in_others="$(git -C "$SANDBOX" ls-files --others --exclude-standard --full-name -- 'templates/core/' | grep -c 'probe-dup-564' || true)"
set +e
u564_dup_out="$(_iso_audit)"
set -e
u564_dup_reported="$(grep -c '^  - templates/core/agents/probe-dup-564\.md' <<<"$u564_dup_out" || true)"
rm -f templates/core/agents/probe-dup-564.md

# (m) the SECOND surface prefix. Until this probe every fixture in this file
# sat under `templates/core/`, so the literals above claimed an independent
# opinion about four prefixes while witnessing one — and the #551 drift they
# cite as their own justification (twelve files under
# `templates/harness-specific/` invisible because the pathspec ignored the
# tree) would still have passed. Caught at review.
#
# `templates/manifest.json` and `src/cli/` deliberately have NO fixture here:
# manifest.json is a named category exemption that produces no finding either
# way, so an assertion on it could not fail, and `src/cli/` is already
# witnessed by the non-fatal outside-surface bucket above. Naming the gap
# beats claiming the coverage.
mkdir -p templates/harness-specific/claude
printf -- '---\nname: probe-hs\n---\n' > templates/harness-specific/claude/probe-hs-564.md
set +e
u564_hs_out="$(_iso_audit)"; u564_hs_rc=$?
set -e
rm -f templates/harness-specific/claude/probe-hs-564.md

# (l) FR-013 — --src-root must be the TOPLEVEL, not merely inside a work tree.
# `git diff --name-only` speaks root-relative and `git ls-files` speaks
# cwd-relative, so from a subdirectory the two halves of the union name
# different things and the untracked half matches no glob. Exit 3 is reused on
# purpose: it already means "--src-root is not usable" and preflight.sh already
# branches on it.
set +e
bash "$SMOKE_DIR/audit.sh" --src-root "$SANDBOX/templates" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE >/dev/null 2>&1
u564_subdir_rc=$?
set -e

# (n) ambient git environment. `git -C <dir>` does NOT beat an exported
# GIT_DIR: measured on the real repository, it made the audit take another
# repo's tag as the baseline and report 28 TRACKED files as "(untracked)".
# Until #564 added a second git query only the baseline lookup could see it,
# which is why a script whose header calls its source tree "never an ambient
# value" had carried the breach unnoticed.
_decoy_564="$SANDBOX/decoy-564"
mkdir -p "$_decoy_564"
git -C "$_decoy_564" init -q -b main
echo "decoy" > "$_decoy_564/f.md"
git -C "$_decoy_564" add -A
git -C "$_decoy_564" -c user.email=d@l -c user.name=d commit -q -m decoy
git -C "$_decoy_564" tag vDECOY-564
# Measured against a SAME-MOMENT control rather than against rc=0. By this
# point the fixture has left a permanent finding behind on purpose (the
# de-duplication case commits a file), so "green" is the wrong yardstick — the
# property is that the ambient variable changes NOTHING, and the only honest
# way to say that is to run the same audit twice and diff.
set +e
u564_ambient_ctl_out="$(_iso_audit)"
u564_ambient_out="$(GIT_DIR="$_decoy_564/.git" bash "$SMOKE_DIR/audit.sh" \
  --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
u564_ambient_rc=$?
# GIT_COMMON_DIR repoints refs, config and objects exactly as GIT_DIR does, and
# the first version of the unset named three variables by hand and missed it.
# Its own witness, because a hand-written list only ever fails on the entry
# somebody forgot — and the assertion above cannot see this one.
u564_common_out="$(GIT_COMMON_DIR="$_decoy_564/.git" bash "$SMOKE_DIR/audit.sh" \
  --src-root "$SANDBOX" --smoke-dir "$SYNTH_SMOKE" --since vTEST-BASELINE 2>&1)"
set -e

# (o) a FAILING collection is not an empty tree. Until the review, all three
# collection lines ended `2>/dev/null || true`, so a fatal git produced the same
# empty string a clean repository does — and an empty changed set prints
# `✓ no user-visible surface changes` and exits 0. A green gate from a broken
# query is this ticket's own defect class.
#
# The witness is a SEPARATE repository with a CORRUPT INDEX, chosen because it
# breaks exactly one thing. Everything upstream still succeeds — it is a work
# tree, it is the toplevel, the baseline tag resolves, `rev-parse --short HEAD`
# resolves, and even the tree-to-tree diff of source 1 succeeds, because none of
# those reads the index. Only the two index-reading collections fail, with 128.
#
# The first attempt used a dangling HEAD instead. It exposed a different defect
# — an unguarded `rev-parse --short HEAD` that died with git's raw fatal and exit
# 128 before the collection was ever reached — which is now guarded above. But it
# made a poor witness for THIS rule, because it never got there. A witness has to
# break the thing under test and nothing else.
_brokenhead_564="$SANDBOX/brokenhead-564"
mkdir -p "$_brokenhead_564/templates/core/agents"
git -C "$_brokenhead_564" init -q -b main
echo "x" > "$_brokenhead_564/templates/core/agents/a.md"
git -C "$_brokenhead_564" add -A
git -C "$_brokenhead_564" -c user.email=b@l -c user.name=b commit -q -m base
git -C "$_brokenhead_564" tag vBROKEN-564
printf 'GARBAGE-NOT-AN-INDEX' > "$_brokenhead_564/.git/index"
set +e
u564_broken_out="$(bash "$SMOKE_DIR/audit.sh" --src-root "$_brokenhead_564" \
  --smoke-dir "$SYNTH_SMOKE" --since vBROKEN-564 2>&1)"
u564_broken_rc=$?
set -e

rm -f "$SYNTH_SMOKE/coverage-allowlist.txt"
cat > "$SYNTH_SMOKE/smoke-stale.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -f .claude/agents/baseline-deleted-agent.md ] || { echo "stale ref"; exit 1; }
EOF
chmod +x "$SYNTH_SMOKE/smoke-stale.sh"

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
       "the token must not be the bare skill name — smoke-features.sh:591 is this shape"
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

finish "SMOKE-AUDIT"
