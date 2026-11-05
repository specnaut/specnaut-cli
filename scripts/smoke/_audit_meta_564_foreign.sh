# shellcheck shell=bash
# Sourced by _audit_meta_564.sh, in place, late in its run: the two #564 probes
# whose witness is a repository other than the synthetic tree, a decoy that an
# ambient GIT_DIR points at and one with a corrupt index. It only plants and
# captures, like the file that sources it; the verdicts are in
# _audit_meta_564_verdicts.sh.
#
# Every u564_* capture here is read by that file, which ShellCheck cannot see
# from this one, and _iso_audit is defined by the file that sources this one.
# shellcheck disable=SC2034,SC2154

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
