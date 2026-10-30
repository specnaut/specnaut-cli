# shellcheck shell=bash
# Sourced by smoke-audit.sh, after its last capture: the #564 probes — files
# that are untracked, staged, ignored, nested or unreadable — each run against
# the real audit.sh on the synthetic tree. It only plants and captures; the
# verdicts on what it captures are in _audit_meta_564_verdicts.sh.
#
# Every u564_* capture here is read by that file, which ShellCheck cannot see
# from this one.
# shellcheck disable=SC2034
#
# --- Assertion 3l: an UNCOMMITTED surface file is seen (#564) ------------
# EVERYTHING here is planted AFTER every capture smoke-audit.sh takes before
# sourcing this file. Nineteen assertions in _audit_meta_verdicts.sh pin exact
# counts, and one stray untracked file under a surface prefix moves all of
# them. The margin is one line; this comment is the guard rail, because
# nothing mechanical enforces the ordering.
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
u564_accent_out="$(_iso_audit)"
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
