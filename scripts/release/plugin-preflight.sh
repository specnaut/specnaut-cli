#!/usr/bin/env bash
# The plugin pre-flight release.yml runs before compiling: version lockstep across
# every manifest, and scaffold integrity. Run from the repository root.

set -euo pipefail
# 1. plugin.json must be parseable JSON
jq -e . plugin/.claude-plugin/plugin.json > /dev/null
# 2. Plugin scaffold must contain at minimum the specnaut router skill
# (catches an accidentally truncated plugin/ directory).
test -f plugin/skills/specnaut/SKILL.md
# 3. Hard fail if plugin.json version drifts from deno.json version.
# The two are kept in lockstep by scripts/bump-version.ts.
BIN_VERSION=$(jq -r .version deno.json)
PLUGIN_VERSION=$(jq -r .version plugin/.claude-plugin/plugin.json)
if [ "$BIN_VERSION" != "$PLUGIN_VERSION" ]; then
  echo "::error::plugin/.claude-plugin/plugin.json version ($PLUGIN_VERSION) does not match deno.json version ($BIN_VERSION). Re-run scripts/bump-version.ts."
  exit 1
fi
# 4. Hard fail if templates/manifest.json version drifts.
# `TEMPLATES_VERSION` in src/templates_bundle.ts is generated
# from this file; surfacing a stale value would mislabel the
# binary's `--version` output.
MANIFEST_VERSION=$(jq -r .version templates/manifest.json)
if [ "$BIN_VERSION" != "$MANIFEST_VERSION" ]; then
  echo "::error::templates/manifest.json version ($MANIFEST_VERSION) does not match deno.json version ($BIN_VERSION). Re-run scripts/bump-version.ts."
  exit 1
fi
# 5. Hard fail if .codex-plugin/plugin.json version drifts.
# Codex users install directly from this repository, so the
# manifest must match the binary it ships beside. The fork this
# used to name was deleted 2026-08-22 and publishes nothing —
# the gate is still right, its old reason was not, and a gate
# defended by a false reason is one somebody deletes.
CODEX_VERSION=$(jq -r .version .codex-plugin/plugin.json)
if [ "$BIN_VERSION" != "$CODEX_VERSION" ]; then
  echo "::error::.codex-plugin/plugin.json version ($CODEX_VERSION) does not match deno.json version ($BIN_VERSION). Re-run scripts/bump-version.ts."
  exit 1
fi
# 6. Hard fail if .cursor-plugin/plugin.json version drifts.
# Cursor users install directly from the repo; the manifest's
# version must match the binary or the install would advertise
# a stale version.
CURSOR_VERSION=$(jq -r .version .cursor-plugin/plugin.json)
if [ "$BIN_VERSION" != "$CURSOR_VERSION" ]; then
  echo "::error::.cursor-plugin/plugin.json version ($CURSOR_VERSION) does not match deno.json version ($BIN_VERSION). Re-run scripts/bump-version.ts."
  exit 1
fi
# 7. Hard fail if a marketplace catalog entry is not pinned to this tag.
# The marketplace repository copies these files verbatim at this tag,
# so an entry on another ref (or none) installs another plugin (#633).
# The same definition the bump and check-release-commit.ts use.
deno run --allow-read scripts/catalog-refs.ts --check "v$BIN_VERSION"
# 8. Hard fail if the cockpit mod's manifest drifts. Claude Code pins an
# installed plugin to its `version`; a stale one never updates (#636).
COCKPIT_VERSION=$(jq -r .version mods/specnaut-cockpit/.claude-plugin/plugin.json)
if [ "$BIN_VERSION" != "$COCKPIT_VERSION" ]; then
  echo "::error::mods/specnaut-cockpit/.claude-plugin/plugin.json version ($COCKPIT_VERSION) does not match deno.json version ($BIN_VERSION). Re-run scripts/bump-version.ts."
  exit 1
fi
echo "✓ plugin manifests valid, scaffold present, versions $PLUGIN_VERSION/$MANIFEST_VERSION/$CODEX_VERSION/$CURSOR_VERSION match binary, catalogs pinned to v$BIN_VERSION"
