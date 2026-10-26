#!/usr/bin/env bash
# Upgrade a project made by the PREVIOUS release with the PUBLISHED binary, twice.
#
# Usage: smoke-upgrade.sh <tag> [binary]     (binary defaults to `specnaut`)
#
# `smoke-published.sh` runs a fresh `init`; nothing after publish ran `upgrade`,
# so a release whose fixes live there was verified only by hand (cli#670). This
# installs the previous release with `install.sh` (SHA-256 verified), scaffolds
# with it, plants what upgrade must not lose, and asks three things:
#
#   1. each `specnaut upgrade` exits 0, and the lock ends at THIS release;
#   2. a declared file the bundle does not ship is still on disk and in the lock
#      after the second run, and the second run still reports it (cli#668);
#   3. a lock entry outside Specnaut's folders leaves its file untouched (cli#665).
#
# The previous release is the highest PUBLISHED stable release below <tag>, read
# from the Releases API, never hard-coded and never from local tags: a tag with
# no release cannot be installed, and a shallow clone lacks tags.
#
# Exit 0 = all held. Exit 1 = the published `upgrade` failed a check; the reason
# is printed. Exit 2 = usage. Exit 3 = skipped: no release before <tag>.
# Exit 4 = the previous release's project could not be prepared (the API, the
# install, its `init`, its lock format) — nothing was learned about <tag>, so a
# caller must not read it as a broken release.
#
# SMOKE_RELEASES (newline-separated tags, replacing the API) and SMOKE_INSTALLER
# (the installer run) and SMOKE_RETRY_DELAY exist for the tests; a release uses none.
set -uo pipefail

TAG="${1:-}"
BIN="${2:-specnaut}"
[ -n "$TAG" ] || { echo "usage: smoke-upgrade.sh <tag> [binary]" >&2; exit 2; }
want="${TAG#v}"
here="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="${SMOKE_INSTALLER:-$here/../../install.sh}"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
note=""
fail() { echo "❌ upgrade smoke: $*"; [ -z "$note" ] || echo "   $note"; exit 1; }
unprepared() { echo "⚠ upgrade smoke could not prepare the previous release's project: $*"; exit 4; }
# A failed check after an upgrade shows what that upgrade printed.
upfail() { tail -20 "$dir/.upgrade.log"; fail "$@"; }

if [ -n "${SMOKE_RELEASES+x}" ]; then
  releases="$SMOKE_RELEASES"
else
  releases="$(gh release list --repo specnaut/specnaut-cli --exclude-drafts --exclude-pre-releases \
    --limit 1000 --json tagName --jq '.[].tagName')" || unprepared "could not list the published releases"
fi
prev="$(printf '%s\n%s\n' "$releases" "$TAG" | grep -v -e '^$' | sort -uV |
  awk -v t="$TAG" '$0 == t { print p; exit } { p = $0 }')"
[ -n "$prev" ] || { echo "⚠ upgrade smoke skipped — no release was published before $TAG"; exit 3; }
[ "${prev%%.*}" = "${TAG%%.*}" ] ||
  note="This upgrade crosses a major version ($prev → $TAG): if the release notes ask users to act by hand, read the log before retracting."

mkdir -p "$dir/prev" "$dir/proj" "$dir/home"
installed=0
for attempt in 1 2 3; do
  if VERSION="$prev" PREFIX="$dir/prev" bash "$INSTALLER" > "$dir/.install.log" 2>&1; then
    installed=1
    break
  fi
  [ "$attempt" -eq 3 ] || sleep "${SMOKE_RETRY_DELAY:-5}"
done
[ "$installed" -eq 1 ] || { tail -20 "$dir/.install.log"; unprepared "could not install $prev (3 attempts)"; }
PREV="$dir/prev/specnaut"
[ -x "$PREV" ] || unprepared "installing $prev left no binary at $PREV"

# Neither binary may read the maintainer's home (its plugin registry changes
# upgrade's path) or wait on a terminal picker nobody can see.
export HOME="$dir/home"
cd "$dir/proj" || unprepared "no project directory"
git init -q || unprepared "could not create a throwaway git repository"
"$PREV" init --here --no-git --ai claude --backlog local < /dev/null > "$dir/.init.log" 2>&1 ||
  { tail -20 "$dir/.init.log"; unprepared "\`specnaut init\` of $prev exited non-zero"; }

# Entries are appended as text, so they must land inside the lock's last block.
[ "$(grep -E '^[a-z_]+:' .specnaut/installed.lock | tail -1)" = "entries:" ] ||
  unprepared "the $prev lock does not end with its entries, so this smoke cannot plant into it"
sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }
KEPT=.claude/skills/retired-smoke/SKILL.md
FOREIGN=src/app.ts
mkdir -p "$(dirname "$KEPT")" src
printf 'retired by upstream, kept by declaration\n' > "$KEPT"
printf 'export const app = 1;\n' > "$FOREIGN"
for f in "$KEPT" "$FOREIGN"; do
  printf '  %s:\n    sha256: %s\n    installed_at: "2026-01-01T00:00:00Z"\n    templates_version: %s\n' \
    "$f" "$(sha "$f")" "${prev#v}" >> .specnaut/installed.lock
done
printf 'preserved:\n  - %s\n' "$KEPT" > .specnaut/preserve.yml
foreign_sha="$(sha "$FOREIGN")"

for run in first second; do
  "$BIN" upgrade < /dev/null > "$dir/.upgrade.log" 2>&1 ||
    upfail "the $run \`specnaut upgrade\` from $prev exited non-zero"
  [ -f "$KEPT" ] || upfail "the $run upgrade deleted $KEPT, which .specnaut/preserve.yml declares"
  grep -q "^  $KEPT:" .specnaut/installed.lock || upfail "the $run upgrade dropped $KEPT from the lock"
  grep -A1 "upstream no longer ships this path" "$dir/.upgrade.log" | grep -qF "⚠ $KEPT" ||
    upfail "the $run upgrade did not report that upstream no longer ships $KEPT"
  [ -f "$FOREIGN" ] && [ "$(sha "$FOREIGN")" = "$foreign_sha" ] ||
    upfail "the $run upgrade changed $FOREIGN, which is outside Specnaut's folders"
done

got="$(sed -n 's/^templates_version:[[:space:]]*//p' .specnaut/installed.lock | head -1)"
[ "$got" = "$want" ] || fail "after upgrading the lock records templates $got, expected $want"

echo "✓ published binary upgrades a $prev project twice: declared orphan kept and reported, $FOREIGN untouched (templates $want)"
