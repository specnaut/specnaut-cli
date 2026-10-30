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
# `audit.sh` carries the same four surface prefixes in `SURFACE_PATHSPEC` (in
# `_audit_collect.sh`), and #564 hoisted them there so its own two collections
# could not drift apart.
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
# Its own file. It plants nothing until every capture above has been taken.
# shellcheck source=_audit_meta_564.sh
. "$SMOKE_DIR/_audit_meta_564.sh"

# --- The verdicts --------------------------------------------------------
# shellcheck source=_audit_meta_verdicts.sh
. "$SMOKE_DIR/_audit_meta_verdicts.sh"
# shellcheck source=_audit_meta_564_verdicts.sh
. "$SMOKE_DIR/_audit_meta_564_verdicts.sh"

finish "SMOKE-AUDIT"
