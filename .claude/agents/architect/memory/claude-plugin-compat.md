---
name: claude-plugin-compat
description: Backwards-compat strategy for v0.x inline agents when specflow-plugin plugin is installed — issue #73
type: decision
---

**Detection method:** SHA comparison against InstalledLock.entries (already implemented in src/domain/installed_lock.ts). Plugin presence detected via Deno.stat on ~/.claude/plugins/cache/specflow-plugin/ through a new PluginDetector port + fs_plugin_detector.ts adapter.

**Rule: auto-migrate vanilla files, warn-and-preserve customized files.**

Why: Claude Code project-scope .claude/agents/ wins over user-scope plugin agents on name collision, so a customized file already takes precedence at runtime. The binary behavior should match the runtime behavior.

**State table summary:**
- Vanilla on disk + plugin installed → auto-migrate: backup to .specflow/backups/<timestamp>/, delete, drop lock entry, print info
- Customized on disk + plugin installed → warn + preserve, user reconciles manually (or --force)
- Any + plugin not installed → normal upgrade path, no change

**Exit ramp:** specflow check --project detects "lock entry exists, file missing from disk, plugin not installed" and recommends specflow upgrade to restore from bundle. The existing add-new action kind handles the restore — no new action kind needed.

**No new CLI flag.** --force extends naturally to mean "overwrite customized files and delete them when plugin is present".
