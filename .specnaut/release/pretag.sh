#!/usr/bin/env bash
# The release's last check before the tag: upgrade a previous release's project
# with THIS release, compiled locally (cli#696).
#
# Usage: pretag.sh <tag> [binary]
#
# `smoke-upgrade.sh` used to run only from `postflight.sh`, after the tag was
# pushed and the release published — so a broken `upgrade` was found when the
# only fix left was a patch release. This runs the same smoke before the tag.
#
# It cannot live in `preflight.sh`: that runs before any release mutation, and
# the smoke asserts the lock ends at <tag>'s templates version, which only
# exists once the version is bumped and `deno task bundle` has run. So this
# runs after the bump, the bundle and the tests, and before the tag.
#
# Without [binary], the host target is compiled into dist/ (ignored by git, so
# the release commit's clean-tree gate is not disturbed). Either way the path
# handed to the smoke is absolute, because the smoke `cd`s into a temp dir.
#
# Exit codes mean what they mean in postflight:
#   0 = the upgrade held: tag.
#   1 = the upgrade is broken (or the binary could not be built): do NOT tag.
#   2 = usage.
#   3 = skipped, no release was published before <tag>.
#   4 = skipped, the previous release's project could not be prepared.
# 3 and 4 are skips, said as skips, with the command to re-run — never a pass.
#
# PRETAG_SMOKE (the smoke script run) exists for the tests; a release uses none.
set -uo pipefail

TAG="${1:-}"
BIN="${2:-}"
[ -n "$TAG" ] || { echo "usage: pretag.sh <tag> [binary]" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
SMOKE="${PRETAG_SMOKE:-$here/smoke-upgrade.sh}"

# Resolved before anything changes directory: a relative path is the caller's.
if [ -n "$BIN" ]; then
  [ -x "$BIN" ] && [ ! -d "$BIN" ] || { echo "❌ no executable binary at $BIN" >&2; exit 2; }
  BIN="$(cd "$(dirname "$BIN")" && pwd -P)/$(basename "$BIN")"
fi

# The host's entry in build.ts's target table, so the asset name is never
# spelled twice. Prints "<triple> <outName>", or nothing on an unknown host.
host_target() {
  # shellcheck disable=SC2016 # `${...}` is JavaScript, for deno, not the shell.
  (cd "$root" && deno eval --quiet \
    'const { TARGETS } = await import("./scripts/build.ts");
     const t = TARGETS.find((x) => x.triple === Deno.build.target);
     if (t) console.log(`${t.triple} ${t.outName}`);' 2>/dev/null)
}

if [ -z "$BIN" ]; then
  echo "▶ compiling $TAG for this host"
  read -r triple out_name <<< "$(host_target)"
  [ -n "${triple:-}" ] || { echo "❌ this host is not one of build.ts's targets — pass a binary"; exit 1; }
  (cd "$root" && deno run --allow-read --allow-write --allow-run scripts/build.ts "$triple") ||
    { echo "❌ could not compile $triple — do NOT tag $TAG"; exit 1; }
  BIN="$root/dist/$out_name"
fi

echo "▶ upgrading a previous release's project with $BIN"
rc=0
bash "$SMOKE" "$TAG" "$BIN" || rc=$?
rerun="bash .specnaut/release/smoke-upgrade.sh $TAG $BIN"
case "$rc" in
  0) echo "✓ pre-tag upgrade smoke passed — $TAG may be tagged" ;;
  3 | 4)
    reason="no release was published before $TAG"
    [ "$rc" -eq 3 ] || reason="the previous release's project could not be prepared"
    echo "⚠ pre-tag upgrade smoke SKIPPED — $reason."
    echo "   $TAG's upgrade is NOT tested before the tag. Re-run: $rerun"
    ;;
  *)
    echo "❌ $TAG's binary fails to upgrade a previous release's project (smoke exit $rc)."
    echo "   do NOT tag $TAG: fix it, re-bundle, re-run this step."
    exit 1
    ;;
esac
exit "$rc"
