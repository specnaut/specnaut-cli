# Claude plugin (`claude-specflow`) — boundary and backwards-compat design

**Goal.** Define (a) which Specflow template files move to the plugin vs stay binary-owned, and (b)
how `specflow upgrade` handles v0.x users who have inline on-disk agents once the plugin exists.
This is the design-only document for issue #73; no code ships until AC are written.

---

## Summary

The Claude plugin system (`code.claude.com/docs/en/plugins`) installs a plugin repo's content at
user scope (cached under `~/.claude/plugins/cache/<name>/`) when the user runs
`/plugin install claude-specflow`. Plugin skills are **namespaced** (`/claude-specflow:specify`), so
they coexist with but do not replace project-level `.claude/skills/` files. Hooks in a plugin live
in `hooks/hooks.json`, not in `settings.json`. Agents in a plugin live in `agents/`.

The key constraint: **plugin content is user-scoped and project-agnostic**. It cannot vary by
backlog backend, cannot reference `.specflow/installed.lock`, and cannot be conditionally rendered.
Anything that requires project-state stays binary-owned.

---

## Q3 — Path → destination table

| Template path (relative to `templates/`)                 | Category        | Destination                       | Rationale                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/commands/specflow.*.md` (10 files)                 | Skills          | **Both**                          | Plugin ships the generic version (namespaced `/claude-specflow:specify`). Binary continues to scaffold project-local copies in `.claude/skills/specflow.*/SKILL.md` (unlocked, un-namespaced `/specify`). Users get the convenience of the plugin AND the short slash-command. On upgrade, binary version wins for project files. |
| `core/commands/backlog.md`                               | Backlog command | **Binary only**                   | Content varies by backend (conditional-render markers). Plugin cannot pre-render per-backend.                                                                                                                                                                                                                                     |
| `core/agents/*.md` (9 agents)                            | Agents          | **Both**                          | Plugin ships the canonical latest version. Binary scaffolds the snapshot at init time. See Q4 for migration.                                                                                                                                                                                                                      |
| `core/agents/*/memory/MEMORY.md` (5 files)               | Agent memory    | **Binary only**                   | These are project-local memory files meant to be mutated per-project. Plugin scope makes no sense.                                                                                                                                                                                                                                |
| `core/skills/auto-chain/SKILL.md`                        | Skill           | **Plugin only**                   | No project-state dependency. Shipping in plugin alone is sufficient; binary can stop scaffolding it once plugin is the canonical source.                                                                                                                                                                                          |
| `core/skills/specflow.groom/SKILL.md`                    | Skill           | **Both** (same logic as commands) | Short-name convenience justifies project-local copy.                                                                                                                                                                                                                                                                              |
| `core/skills/backlog/SKILL.md`                           | Backlog skill   | **Binary only**                   | Backlog-backend conditional render — plugin cannot do this.                                                                                                                                                                                                                                                                       |
| `core/skills/backlog/scripts/**`                         | Backlog scripts | **Binary only**                   | Runtime scripts that read `.specflow/installed.lock` for backend discovery. Project-stateful.                                                                                                                                                                                                                                     |
| `core/specflow/**` (constitution, templates, scripts)    | Spec-root       | **Binary only**                   | Entirely project-stateful (`.specflow/` dir).                                                                                                                                                                                                                                                                                     |
| `core/root/AGENTS.md`                                    | Project root    | **Binary only**                   | Project-specific constitution.                                                                                                                                                                                                                                                                                                    |
| `core/root/.gitignore`                                   | Project root    | **Binary only**                   | Mergeable project file.                                                                                                                                                                                                                                                                                                           |
| `harness-specific/claude/CLAUDE.md`                      | Harness static  | **Binary only**                   | References project-local paths (`.specflow/`, `.claude/commands/`).                                                                                                                                                                                                                                                               |
| `harness-specific/claude/settings.json`                  | Harness static  | **Binary only**                   | Hook commands use relative project paths (`.claude/hooks/…`). Plugin hooks use `hooks/hooks.json` with different command resolution.                                                                                                                                                                                              |
| `harness-specific/claude/hooks/protect-generated.sh`     | Hook            | **Binary only**                   | Reads `.specflow/installed.lock` at runtime — project-stateful.                                                                                                                                                                                                                                                                   |
| `harness-specific/claude/hooks/check-backlog-prereqs.sh` | Hook            | **Binary only**                   | Reads `$(pwd)/.specflow/installed.lock` — project-stateful.                                                                                                                                                                                                                                                                       |
| `harness-specific/claude/hooks/log-subagent.sh`          | Hook            | **Plugin-only candidate**         | No project-state dependency. Could live in `hooks/hooks.json` of the plugin. Decide below.                                                                                                                                                                                                                                        |
| `harness-specific/claude/loop.md`                        | Harness static  | **Binary only**                   | Meant to be customized per-project.                                                                                                                                                                                                                                                                                               |
| `harness-specific/claude/scripts/dispatch-agent.sh`      | Harness static  | **Binary only**                   | References project-local agent paths.                                                                                                                                                                                                                                                                                             |

### Hook split: `log-subagent.sh`

`log-subagent.sh` has no project-state dependency — it just timestamps subagent events. It is a
candidate for the plugin's `hooks/hooks.json`. However, the plugin's hook commands must be
path-stable (relative to the plugin cache dir, not the project). Until the plugin SDK specifies how
hook `command` paths resolve relative to plugin root, keep it binary-owned and revisit at plugin GA.

### Naming note

Plugin skills are namespaced: `/claude-specflow:specify`, not `/specify`. Binary-scaffolded project
skills keep the short form. This is the correct UX: the plugin provides discoverability for new
users; the binary provides the customizable project-local copy with the short slash-command.

---

## Q4 — Backwards-compat state table

### Detection method

`InstalledLock.entries` (`.specflow/installed.lock`) records a SHA-256 per managed file. A file is
**vanilla** when `sha256(disk content) === lock.entries[path].sha256`. A file is **customized** when
the two differ. This is already implemented in `src/domain/installed_lock.ts` and used by the
upgrade path — no new infrastructure needed.

Plugin install detection: check whether `~/.claude/plugins/cache/claude-specflow/` exists (the
canonical cache path per the discover-plugins docs). The binary reads this path via a new
`PluginDetector` port method `isPluginInstalled(name: string): Promise<boolean>` backed by a
`Deno.stat` check in `src/infrastructure/fs_plugin_detector.ts`.

### State table

| On-disk state              | Plugin state  | `specflow upgrade` action                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vanilla (SHA matches lock) | Not installed | Normal upgrade: overwrite with latest bundle snapshot.                                                                                                                                                                                                                                                 |
| Customized (SHA differs)   | Not installed | Normal upgrade: preserve unless `--force`. No change from today.                                                                                                                                                                                                                                       |
| Vanilla                    | Installed     | **Auto-migrate**: backup the file to `.specflow/backups/<timestamp>/`, delete the on-disk copy, drop the lock entry. Print: `info: agent 'product-owner' removed — now served by the claude-specflow plugin`.                                                                                          |
| Customized                 | Installed     | **Warn + preserve**: keep the on-disk copy (it wins over plugin per Claude Code loading order). Print: `warn: agent 'product-owner' is customized and the claude-specflow plugin is installed. The on-disk version takes precedence. Reconcile manually or run specflow upgrade --force to overwrite.` |
| Missing (user deleted)     | Not installed | Drop lock entry, nothing on disk to act on.                                                                                                                                                                                                                                                            |
| Missing (user deleted)     | Installed     | Drop lock entry. Plugin serves the agent. No action needed.                                                                                                                                                                                                                                            |

### Loading order clarification

Claude Code loads user-scope plugin agents before project-scope `.claude/agents/` files, and
project-scope wins on name collision. So a customized on-disk file naturally takes precedence over
the plugin version — the "warn + preserve" policy matches the runtime behavior.

### Migration command UX

No new top-level command. Migration is triggered implicitly by `specflow upgrade` when the plugin is
detected. The `--force` flag extends its existing semantics: with `--force`, customized agents are
backed up and deleted, yielding fully plugin-managed operation.

There is no `--migrate-to-plugin` flag — that adds surface area for a rare scenario. The `--force`
path is sufficient.

### Exit ramp — plugin uninstalled after migration

If the binary deleted vanilla agent files (auto-migrate path) and the user later uninstalls the
plugin, `specflow check --project` detects the gap: lock entry exists, file is missing from disk,
plugin is not installed. It emits:

```
warn: .claude/agents/product-owner.md is tracked in the lock but missing from disk.
      The claude-specflow plugin is not installed. Run `specflow upgrade` to restore
      the bundled version, or install the plugin: /plugin install claude-specflow.
```

`specflow upgrade` restores the file from the bundle (same path as `add-new` action). No new action
kind needed — the existing `add-new` path handles it.

---

## Trade-offs to decide

1. **Dual-copy for commands and agents.** Recommending "both" means two sources of truth during the
   transition period. The plugin is authoritative for the user-scope latest; the binary snapshot is
   authoritative for the project-local customizable copy. This is intentional (short slash-commands
   - customizability) but adds upgrade complexity. Accept this as a first-party first-mover cost, or
     decide the plugin is the only source and force namespaced commands on all users. **Recommend:
     keep both.** The `/specify` short form is a core UX property; namespaced
     `/claude-specflow:specify` is the discoverability layer.

2. **`log-subagent.sh` plugin vs binary.** Defer to plugin GA when hook path resolution from plugin
   cache is documented. Until then, binary-owned. **Recommend: defer.**

3. **Auto-migrate threshold.** The state table auto-migrates vanilla files when the plugin is
   detected. This is a silent deletion (with backup). Consider requiring `--migrate-to-plugin` to
   gate deletion explicitly rather than auto-migrating on any `specflow upgrade`. **Recommend:
   auto-migrate with backup + explicit `info:` line per file.** The backup path is the safety net;
   the log line is the audit trail. Explicit flag adds friction for the common case.

4. **Plugin install detection path.** `~/.claude/plugins/cache/claude-specflow/` is inferred from
   docs; the actual path is not formally guaranteed by the Claude Code API surface. If the path
   changes, the detector silently fails (no migration, no warning). Accept this fragility at v0.12,
   revisit once Claude Code publishes a stable plugin query API. **Recommend: accept.** Fallback
   behavior (no auto-migration) is safe — the worst case is the user has both copies.
