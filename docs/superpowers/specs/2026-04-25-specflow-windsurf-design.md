# Windsurf harness — design spec

**Goal.** Add Windsurf as the fifth supported AI harness, mapping every invocable Specflow category
onto Windsurf workflows (a single artefact type) and reusing the existing shared helpers without
introducing new emission machinery.

**Why.** With four harnesses landed, the abstraction is well-exercised. Windsurf is the smallest
brick remaining: it has only one invocable artefact type (workflows), no subagent format, no
required frontmatter, and reads AGENTS.md natively. Adding it costs almost nothing and rounds out
the major-IDE coverage.

**Shipping.** Binary `0.4.0-alpha.1 → 0.5.0-alpha.1`, templates `0.5.0 → 0.6.0`. Standalone release.

**Reference docs verified.**

- `https://docs.windsurf.com/windsurf/cascade/workflows` — workflows are markdown files at
  `<repo>/.windsurf/workflows/<name>.md`; the body becomes the Cascade prompt; invoked via `/<name>`
  slash command; 12 000-character cap; no required YAML frontmatter
- `https://docs.windsurf.com/windsurf/cascade/memories` — workspace rules at
  `<repo>/.windsurf/rules/<name>.md` (out of scope for this brick); root-level `AGENTS.md` is
  "always active, no frontmatter needed" — same convention as Codex

---

## File tree emitted by `specflow init --ai windsurf`

| `CoreCategory`                | Windsurf destination                           |
| ----------------------------- | ---------------------------------------------- |
| `command` (specify, plan, …)  | `.windsurf/workflows/specflow-<name>.md`       |
| `backlog-cmd` (backlog)       | `.windsurf/workflows/specflow-backlog.md`      |
| `skill` (speckit auto-chain)  | `.windsurf/workflows/specflow-<name>.md`       |
| `agent` (product-owner, …)    | `.windsurf/workflows/specflow-agent-<name>.md` |
| `spec-root` (constitution, …) | `.specflow/<suffix>` (unchanged)               |
| `project-root` (AGENTS.md, …) | `<suffix>` (unchanged)                         |

User-visible slash commands: `/specflow-specify`, `/specflow-plan`, `/specflow-agent-product-owner`,
etc.

No `.windsurf/rules/` emission. AGENTS.md (project-root) carries the persistent instructions, and
Windsurf reads it natively. Future bricks can add a Windsurf-specific rules file if a real need
surfaces.

---

## Content emission: verbatim pass-through

Each entry's `content` ships unchanged to its destination. Windsurf:

- has no required workflow frontmatter to inject,
- ignores Claude-flavored frontmatter (`model: opus`, `tools: …`, `maxTurns`) if present — Cascade
  reads the whole file as instructions,
- doesn't need a `name:` or `description:` synthesis (the slash command name comes from the filename
  basename, which we control via `skillFolderName`).

This is the same approach `ClaudeHarness` already uses: no rewrite, no strip, no TOML, no YAML
manipulation. The simplest possible adapter.

---

## `WindsurfHarness` shape

```typescript
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillFolderName } from "./skill_folder.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.windsurf/workflows/${skillFolderName(entry)}.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class WindsurfHarness implements Harness {
  readonly key = "windsurf";
  readonly displayName = "Windsurf";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      out[destinationFor(entry)] = {
        content: entry.content,
        executable: entry.executable,
      };
    }
    return out;
  }
}
```

`skillFolderName` from the existing shared helper produces `specflow-<name>` for
command/backlog-cmd/skill and `specflow-agent-<name>` for agent — exactly the naming we want for
Windsurf workflows.

No `HARNESS_STATIC.windsurf` overlay. No `ensureSkillFrontmatter` call. No TOML.

---

## Wiring changes

- `src/domain/installed_lock.ts` — widen the `KnownHarness` union and `KNOWN_HARNESSES` array with
  `"windsurf"`.

- `src/cli/harnesses.ts` — register `new WindsurfHarness()` in `HARNESSES`.

- `src/cli/parser.ts` — widen the init `ai` union and validator to accept `"windsurf"`.

- `src/cli/handlers/init_handler.ts` — widen `InitIntent.ai` union to match the parser.

- `src/cli/help.ts` — usage line becomes
  `--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf`.

- `src/infrastructure/fs_project_inspector.ts` — extend the existing `expectedFolder` Record with
  `windsurf: ".windsurf/"`.

---

## Testing

### New tests

- `tests/infrastructure/harness/windsurf_harness_test.ts` (~8):
  1. `key === "windsurf"`, `displayName === "Windsurf"`
  2. Commands map to `.windsurf/workflows/specflow-<name>.md`
  3. backlog-cmd maps to `.windsurf/workflows/specflow-backlog.md`
  4. skill maps to `.windsurf/workflows/specflow-<name>.md`
  5. agents map to `.windsurf/workflows/specflow-agent-<name>.md`
  6. spec-root → `.specflow/<suffix>`; project-root → `<suffix>`
  7. Content is byte-identical to `entry.content` (no frontmatter rewrite)
  8. No `.claude/`, `.cursor/`, `.agents/`, `.codex/`, `.gemini/` keys, no CLAUDE.md

- `tests/integration/init_windsurf_test.ts` (~1): end-to-end
  `specflow init demo --no-git --ai windsurf` scaffolds the expected tree, lock reports
  `harness: windsurf`.

### Updated tests

- `tests/domain/installed_lock_test.ts` — +1 test for `harness: windsurf` accepted.
- `tests/cli/parser_test.ts` — +1 test for `--ai windsurf` accepted.
- `tests/infrastructure/fs_project_inspector_test.ts` — +2 tests (windsurf pass when `.windsurf/`
  present; fail when missing).

### Expected final count

Current 259 + 8 (windsurf_harness) + 1 (integration) + 1 (lock) + 1 (parser)

- 2 (inspector) = **272**.

---

## Out of scope

- `.windsurf/rules/` emission (workflows already cover the slash-command surface; rules would
  duplicate AGENTS.md without obvious benefit).
- Windsurf global rules / system rules (those are user-level, not per-project).
- Multi-harness in a single project.
- `specflow migrate`.
- Tuning the workflow body for Windsurf — keeping content byte-identical means any prose mentioning
  `/specflow-<name>` works unchanged across all 5 harnesses.

---

## Release plan

1. Branch `feat/windsurf-harness` from main.
2. Implement: domain widening → harness adapter → wiring → tests → integration.
3. Verify full suite green; `specflow init demo --ai windsurf` produces the expected tree;
   `specflow check --project` reports `harness: windsurf`.
4. Squash-merge to main.
5. Bump binary to `0.5.0-alpha.1`, templates to `0.6.0`; tag `v0.5.0-alpha.1`; push main + tag.
