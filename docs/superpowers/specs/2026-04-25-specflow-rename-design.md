# Specflow rename — design spec

**Goal.** Rename every user-facing `speckit`/`.specify` identifier to `specflow`/`.specflow` so the
scaffolded project speaks the Specflow vocabulary end to end.

**Why.** "Specflow" is the product. "Speckit" is the upstream fork source, and its leakage into
command names (`/speckit-specify`) and directory names (`.specify/`) is a legacy from the v0.1
scaffold. Before adding a third harness (Codex), the nomenclature should be consistent so new
adapters don't encode the legacy names.

**Shipping.** Binary bumps to `0.3.0-alpha.1`, templates to `0.4.0`. No installed base to migrate —
this and the upcoming Codex brick ride together in one release.

---

## Rename table

User-visible destinations (per harness):

| Category                    | Before                                   | After                                     |
| --------------------------- | ---------------------------------------- | ----------------------------------------- |
| `command` (Claude)          | `.claude/commands/speckit.<name>.md`     | `.claude/commands/specflow.<name>.md`     |
| `command` (Cursor)          | `.cursor/skills/speckit-<name>/SKILL.md` | `.cursor/skills/specflow-<name>/SKILL.md` |
| `spec-root` (all harnesses) | `.specify/<suffix>`                      | `.specflow/<suffix>`                      |

Other categories already used the `specflow` vocabulary:

- `backlog-cmd` → `specflow-backlog` (unchanged)
- `agent` → `specflow-agent-<name>` (Cursor; Claude keeps `.claude/agents/<name>.md` raw)
- `skill` → `specflow-<name>` (unchanged since post-merge hygiene)

Template source files (not user-visible, but renamed for consistency):

| Before                                      | After                                        |
| ------------------------------------------- | -------------------------------------------- |
| `templates/core/commands/speckit.<name>.md` | `templates/core/commands/specflow.<name>.md` |
| `templates/core/specify/`                   | `templates/core/specflow/`                   |

`templates/manifest.json` is rewritten with the new `source:` paths.

---

## Directory consolidation side effect

After this change, every Specflow-managed file in a scaffolded project lives under `.specflow/`
(plus whichever harness directory the user chose). Specifically:

```
project-root/
├── .specflow/
│   ├── config.yml          (existing, backlog sync config)
│   ├── installed.lock      (existing, upgrade tracker)
│   ├── memory/
│   │   └── constitution.md (was .specify/memory/…)
│   ├── templates/
│   │   └── *.md            (was .specify/templates/…)
│   └── scripts/
│       ├── bash/*          (was .specify/scripts/bash/…)
│       └── powershell/*    (was .specify/scripts/powershell/…)
├── .claude/ or .cursor/    (harness-specific)
├── AGENTS.md               (unchanged, for Codex & human contributors)
├── CLAUDE.md               (Claude harness only, unchanged)
└── tasks/
    └── backlog.md          (unchanged)
```

No collisions between the new spec-kit content and the existing `config.yml` / `installed.lock` —
they occupy disjoint subpaths.

---

## Text references inside templates

Every template file that text-references the old vocabulary needs updating. The references fall into
two categories and are mechanical:

1. `.specify/…` → `.specflow/…` — appears in `CLAUDE.md`, `AGENTS.md` (project-root),
   `cursor/specify-rules.mdc`, constitution template, agent files that point at the constitution,
   command files that read from `.specify/templates/…`, bash/powershell scripts that `cd` into
   `.specify/…`, etc.
2. `/speckit-<name>` → `/specflow-<name>` — appears in the same files wherever one command
   references another (e.g. `/speckit-plan` after `/speckit-specify`).

A codebase-wide grep + sed pass handles both in seconds. The bash/powershell scripts need the same
treatment — they resolve `.specify/` paths at runtime.

---

## Adapter changes

**ClaudeHarness** (`src/infrastructure/harness/claude_harness.ts`):

- `case "command"`: `.claude/commands/speckit.${name}.md` → `.claude/commands/specflow.${name}.md`
- `case "spec-root"`: `.specify/${suffix}` → `.specflow/${suffix}`

**Shared `skill_folder.ts`** (introduced by upcoming Codex brick; for now the same logic lives
inline in `CursorHarness`):

- `case "command"`: `speckit-${name}` → `specflow-${name}`

**CursorHarness** (`src/infrastructure/harness/cursor_harness.ts`):

- `case "spec-root"`: `.specify/${suffix}` → `.specflow/${suffix}`
- `command` naming delegated to the shared helper (or kept inline if this brick ships before Codex —
  functionally identical).

No other adapter mapping changes.

---

## Lock-file implication

The installed lock tracks files by destination path, so rerunning `specflow upgrade` on a pre-rename
project would see every old path as an orphan and every new path as a new file. We do not ship
rename-detection logic — there is no installed base to protect. A fresh
`specflow init --here --force` regenerates the tree cleanly.

---

## Testing

Every snapshot / destination assertion referring to the old paths is updated in place:

- `tests/infrastructure/harness/claude_harness_test.ts` — spot-checks include
  `.claude/commands/specflow.specify.md`, `.specflow/memory/constitution.md`
- `tests/infrastructure/harness/cursor_harness_test.ts` — skill-folder assertions use
  `specflow-specify`
- `tests/integration/init_cursor_test.ts` — expects `.cursor/skills/specflow-specify/SKILL.md` and
  `.specflow/memory/constitution.md`
- Any other test that hard-codes a path with `speckit.`, `speckit-`, or `.specify/`

No new tests; the suite stays around its current count (223).

The integration test's value here is the end-to-end check that a fresh `specflow init demo --no-git`
produces the new tree. If that passes, the rename is consistent across the pipeline.

---

## Out of scope

- Codex harness adapter (separate brick, rides on top of this in the same release).
- Upgrade migration logic (Option A decided).
- Backward-compat aliases for the old command names or old directory.
- Rename of the `speckit` internal skill bundled under `templates/core/skills/speckit/` (this is the
  name of the auto-chain dispatcher skill; it's already emitted as `specflow-speckit` in Cursor by
  the skill-folder logic. Renaming the source folder is cosmetic and deferred.)

---

## Release plan

1. Branch `feat/rename-specflow` from main.
2. Implement in sequence (manifest → sources → adapters → tests → docs).
3. Verify full suite green, integration tests pass, fresh `init` produces the new tree.
4. Squash-merge to main, but **don't tag yet** — the Codex brick lands next and both ship under a
   single `v0.3.0-alpha.1` / templates `0.4.0` tag.
