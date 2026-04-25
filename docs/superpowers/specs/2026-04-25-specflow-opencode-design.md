# OpenCode harness — design spec

**Goal.** Add OpenCode (https://opencode.ai) as a 7th `--ai` target alongside `claude`, `cursor`,
`codex`, `gemini`, `windsurf`, `copilot`. Same shape as the recent Copilot brick: a new harness
adapter that maps `CoreBundle` entries to OpenCode-native paths and rewrites frontmatter to OpenCode
conventions.

**Why.** OpenCode is a popular open-source agentic coding assistant with first-class support for
custom agents, slash commands, and skills — three primitives that map cleanly to Specflow's neutral
core bundle. Shipping the harness lets OpenCode users adopt Specflow's spec-driven workflow.

**Shipping.** Binary `0.6.0-alpha.2 → 0.6.0-alpha.3`, templates unchanged at `0.7.0` (no template
content touched, only a new adapter).

---

## Destination mapping

OpenCode discovers per-project assets under three project-local directories. Specflow emits to each:

| `CoreCategory` | OpenCode destination                                       | Invocation         |
| -------------- | ---------------------------------------------------------- | ------------------ |
| `command`      | `.opencode/commands/specflow.<name>.md`                    | `/specflow.<name>` |
| `backlog-cmd`  | `.opencode/commands/backlog.md`                            | `/backlog`         |
| `agent`        | `.opencode/agents/specflow-<name>.md`                      | `@specflow-<name>` |
| `skill`        | `.opencode/skills/specflow-<name>/SKILL.md`                | (loaded on demand) |
| `spec-root`    | `.specflow/<suffix>` (passthrough)                         | —                  |
| `project-root` | `<suffix>` (passthrough — `AGENTS.md`, `.gitignore`, etc.) | —                  |

OpenCode reads `AGENTS.md` natively at the project root, so no harness-specific static file is
needed (unlike Claude's `CLAUDE.md` or Cursor's `specify-rules.mdc`). The `manifest.json`'s
`harness_static` array gains no new entry.

---

## Frontmatter rewrites

### Commands

Strip Claude-specific fields (`argument-hint`, `allowed-tools`, etc.). Preserve `description`. Do
not inject `agent:` — OpenCode auto-routes commands to the appropriate agent based on body content.

```yaml
---
description: <preserved from source>
---

<body unchanged>
```

### Agents

Strip Claude-specific fields. Inject `mode: subagent` and a `permission:` block translated from the
source's `tools:` list (see table below).

```yaml
---
description: <preserved from source>
mode: subagent
permission:
  read: allow
  edit: allow
  bash:
    "*": ask
---

<body unchanged>
```

`mode: subagent` for **all** agents — Specflow's agents (`developer`, `code-reviewer`,
`security-auditor`, `qa-tester`, `product-owner`, `workflow-manager`, `review-coordinator`,
`test-reviewer`) are all dispatched / orchestrated, not used as primary chat partners. Keeping them
out of OpenCode's primary slot leaves Build/Plan as the user's top-level interaction surface.

### Skills

Use the existing `ensureSkillFrontmatter(content, skillName)` helper (already shared with
Cursor/Codex harnesses). Guarantees `name` and `description` are present. No `mode` or `permission`
— skills are content modules, loaded on demand via OpenCode's `skill` tool.

```yaml
---
name: <skillName>
description: <preserved or synthesized>
---

<body unchanged>
```

---

## Tools → permission translation

Source agents declare a comma-separated `tools:` field in Claude format. Translate as follows:

| Claude tool         | OpenCode permission key | Value             |
| ------------------- | ----------------------- | ----------------- |
| `Read`              | `read`                  | `allow`           |
| `Write`             | `write`                 | `allow`           |
| `Edit`, `MultiEdit` | `edit`                  | `allow`           |
| `Bash`              | `bash`                  | `{ "*": "ask" }`  |
| `WebFetch`          | `webfetch`              | `ask`             |
| `WebSearch`         | `websearch`             | `ask`             |
| `Grep`, `Glob`      | —                       | (omit — native)   |
| `Task`              | —                       | (omit — native)   |
| `TodoWrite`         | —                       | (omit — no equiv) |
| `NotebookEdit`      | —                       | (omit — no equiv) |
| (any unknown name)  | —                       | (omit silently)   |

If an agent's source has no `tools:` field, emit no `permission:` block — OpenCode applies its own
defaults. The `Edit` and `MultiEdit` Claude tools collapse to a single `edit` permission (de-duped).

---

## Code changes

### New files

- `src/infrastructure/harness/opencode_harness.ts` — adapter implementing `Harness`.
  - `mapBundle(core)` iterates entries, dispatches by category, applies frontmatter rewrites.
  - Two helper functions:
    - `toOpenCodeCommandMarkdown(entry)` — strips Claude frontmatter, keeps `description`.
    - `toOpenCodeAgentMarkdown(entry)` — strips Claude frontmatter, injects `mode: subagent` and
      translated `permission:` block.
  - One private helper `translateToolsToPermissions(toolsField: string | undefined)` that maps the
    comma-list to a YAML permission object (or returns `null` if the input is empty/missing).

- `tests/infrastructure/harness/opencode_harness_test.ts` — ~10 unit tests:
  1. `command` entries → `.opencode/commands/specflow.<name>.md` with stripped frontmatter
  2. `backlog-cmd` entry → `.opencode/commands/backlog.md`
  3. `agent` entries → `.opencode/agents/specflow-<name>.md` with `mode: subagent`
  4. `skill` entries → `.opencode/skills/specflow-<name>/SKILL.md` with `name` + `description`
  5. `spec-root` and `project-root` entries pass through unchanged
  6. `tools: Read, Bash` → `permission: { read: allow, bash: { "*": ask } }`
  7. `tools: Edit, MultiEdit` → `permission: { edit: allow }` (de-dup)
  8. `tools: Grep, Glob, Task` → no `permission:` block (all omitted)
  9. Agent with no `tools:` field → no `permission:` block emitted
  10. Round-trip: write bundle to FS via `DenoFsWriter` and read back — content matches.

- `tests/integration/init_opencode_test.ts` — 1 end-to-end test: spawn
  `specflow init demo --ai
  opencode --no-git`, assert `.opencode/commands/`, `.opencode/agents/`,
  `.opencode/skills/` are populated with the expected file count and that one sample agent contains
  `mode: subagent`.

### Modified files

- `src/cli/harnesses.ts` — add `OpenCodeHarness` to the registry.
- `src/cli/parser.ts` — add `"opencode"` to the `--ai` enum.
- `src/cli/help.ts` — list `opencode` in the harness names line.
- `src/infrastructure/fs_project_inspector.ts` — add detection rule (presence of `.opencode/`
  directory implies the harness).
- `src/domain/installed_lock.ts` — extend `KnownHarness` union to include `"opencode"`.

### Modified tests

- `tests/cli/parser_test.ts` — extend the `--ai` parameterized cases.
- `tests/domain/installed_lock_test.ts` — extend the harness round-trip cases.
- `tests/infrastructure/fs_project_inspector_test.ts` — add a `.opencode/` detection case.

---

## Out of scope

- Per-command `bash` permission patterns (e.g. `bash: { "git *": "allow", "*": "ask" }`). All
  `Bash`-using agents get `"*": ask`. Users can hand-edit afterwards.
- Auto-detecting `OpenCode` from existing `.opencode/` in `specflow init --here` and suggesting it
  as a default — kept manual via `--ai opencode`.
- README update / user-facing announcement — separate doc PR.
- Migrating existing Specflow projects to add OpenCode alongside their current harness — single
  harness per project remains the rule.

---

## Test count

Current 297 → 297 + 10 (unit) + 1 (integration) + ~3 (parser/inspector/lock test extensions) =
**~311**.

---

## Release plan

1. Branch `feat/opencode-harness` from main.
2. Implement: domain (none) → adapter + tests → CLI wiring → integration test.
3. Verify full suite green; manual smoke `specflow init /tmp/oc-smoke --ai opencode --no-git` and
   inspect the `.opencode/` tree.
4. Squash-merge to main.
5. Bump binary `0.6.0-alpha.2 → 0.6.0-alpha.3`; templates unchanged at `0.7.0`. Tag
   `v0.6.0-alpha.3`; push main + tag.
