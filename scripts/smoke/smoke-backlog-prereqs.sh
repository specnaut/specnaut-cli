#!/usr/bin/env bash
# Fire the scaffolded Claude hook .claude/hooks/check-backlog-prereqs.sh with a
# synthetic stdin payload on the local and the github backend: it always exits
# 0, says nothing on the local backend, and warns only when gh is genuinely off
# PATH. Its own script: smoke-hooks.sh is at its size limit.
#
# Usage: smoke-backlog-prereqs.sh <name>
set -euo pipefail

NAME="${1:?usage: smoke-backlog-prereqs.sh <name>}"
. "$(dirname "$0")/_common.sh"
DIR="$(scenario_dir "$NAME")"

# Trap-based cleanup: wipe the scenario directory on every exit path.
trap 'bash "$SMOKE_DIR/clean.sh" "$NAME" >/dev/null 2>&1 || true' EXIT

bash "$SMOKE_DIR/bootstrap-empty.sh" "$NAME" >/dev/null
(cd "$DIR" && git init -q && deno run --allow-all "$CLI/src/main.ts" \
  init --here --no-git --ai claude --backlog local >/dev/null 2>&1)
cd "$DIR"

check "check-backlog-prereqs.sh executable" '[ -x .claude/hooks/check-backlog-prereqs.sh ]'

echo "═══ check-backlog-prereqs.sh (local backend) ═══"

# Capturing the status inside the substitution appends an `ec=N` line, so the
# hook's OWN output is everything except that last line. Asserting silence
# against the raw capture would compare against a string that is never empty.
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")
hook_out="$(printf '%s' "$out" | sed '$d')"
echo "$out" | grep -q "ec=0" && pass "exit 0 on local backend" \
  || fail "non-zero exit" "$out"
[ -z "$hook_out" ] && pass "silent on local backend (no warn)" \
  || fail "unexpected output on local backend" "$hook_out"

echo
echo "═══ check-backlog-prereqs.sh (github backend, gh present) ═══"
# Patch the lock to simulate the github backend
sed -i.bak 's/backlog_backend: local/backlog_backend: github/' \
  .specnaut/installed.lock
# #550: assert the fixture APPLIED. A sed whose pattern matches nothing exits
# 0 and changes nothing, so if the lock ever spells the key differently every
# assertion below runs against the LOCAL backend and passes — a whole section
# exercising the wrong branch, reported as green.
if ! grep -q "backlog_backend: github" .specnaut/installed.lock; then
  fail "the github-backend fixture did not apply" \
       "lock still reads: $(grep backlog_backend .specnaut/installed.lock || echo '<no backlog_backend key>')"
  # Not a bare `fail`: every assertion below is about the github branch, and
  # running them against the local one produces green results that mean
  # nothing. Stop here through the suite's own contract.
  mv .specnaut/installed.lock.bak .specnaut/installed.lock
  finish "BACKLOG-PREREQS"
fi
out=$(echo "{}" | bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")

# The disjunction the old comment shrugged at ("Either is OK") is queryable, so
# it is asserted instead of echoed. Both sides are exercised HERE, while the
# lock still says github — the hook only consults gh on that backend, so after
# the restore below either branch would pass for the wrong reason.
#
# The warning text is copied from the hook, not paraphrased. The first version
# of this check grepped "gh CLI not found", which the hook never prints: on a
# machine where gh IS present the grep could not match, the `||` branch ran,
# and the assertion passed unconditionally. A constant-true assertion, inside
# the fix for constant-true assertions.
GH_WARN="is not on PATH"
if echo "$out" | grep -qF "$GH_WARN"; then
  fail "warned about a missing gh" "gh is on PATH here; $out"
else
  pass "no missing-gh warning when gh is on PATH"
fi

# /usr/bin:/bin hides a Homebrew gh but NOT ubuntu-latest's, which ships at
# /usr/bin/gh — so on CI a correct hook would have turned this red, and a red
# assertion on correct code is how assertions get deleted to unblock a push.
# Build a PATH guaranteed not to contain gh.
nogh_bin="$(mktemp -d)"
# bash is symlinked too: `PATH=x cmd` resolves cmd through x, so leaving it out
# made the run fail with "bash: command not found" rather than exercising the
# hook.
for _t in bash awk cat env; do
  _p="$(command -v "$_t" 2>/dev/null)" && ln -sf "$_p" "$nogh_bin/$_t"
done
if PATH="$nogh_bin" command -v gh >/dev/null 2>&1; then
  fail "the gh-absent fixture still finds gh" "the absent branch cannot be exercised"
fi
out_nogh=$(echo "{}" | PATH="$nogh_bin" bash .claude/hooks/check-backlog-prereqs.sh 2>&1; echo "ec=$?")
# Not `rm -rf`: smoke-toolbox.sh's static sweep requires every deleting path be
# built through scenario_dir, and this one is a mktemp outside the sandbox. The
# directory holds only symlinks, so removing them and rmdir'ing is exact — and
# it keeps the sweep's rule intact instead of carving an exception into it.
rm -f "$nogh_bin"/*
rmdir "$nogh_bin"
if echo "$out_nogh" | grep -qF "$GH_WARN"; then
  pass "and warns when gh is genuinely off PATH"
else
  fail "no warning with gh off PATH" "$out_nogh"
fi
echo "$out_nogh" | grep -q "ec=0" \
  && pass "a missing gh is a warning, not a failure" \
  || fail "the hook failed instead of warning" "$out_nogh"

mv .specnaut/installed.lock.bak .specnaut/installed.lock
echo "$out" | grep -q "ec=0" && pass "exit 0 on github backend" \
  || fail "non-zero exit" "$out"


finish "BACKLOG-PREREQS"
