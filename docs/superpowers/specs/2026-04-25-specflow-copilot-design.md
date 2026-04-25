# GitHub Copilot CLI harness — design spec

**Goal.** Add GitHub Copilot CLI as the sixth supported AI harness. Map every invocable Specflow
category onto Copilot's path-specific instruction files
(`.github/instructions/<name>.instructions.md`).

**Why.** Copilot CLI is the last major harness on the original roadmap. Adding it rounds out the
major-IDE/CLI coverage so Specflow scaffolds work for any team's existing AI tooling.

**Shipping.** Binary `0.5.0-alpha.3 → 0.6.0-alpha.1`, templates `0.6.1 → 0.7.0`. Standalone release
(minor bump because adding a harness is a feature, not a fix).

**Reference docs verified.**

- `https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli`
- `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions`

---

## What makes Copilot different from the other 4 harnesses

Copilot CLI is fundamentally simpler:

- **No slash commands** (no `/specflow-specify` UX).
- **No skills, no subagents** — just custom-instruction files.
- **AGENTS.md is read as primary instructions** automatically (same convention as Codex / Gemini /
  Windsurf).
- **Path-specific instruction files** at `.github/instructions/<name>.instructions.md` require
  frontmatter with an `applyTo` glob.

So Specflow's `command` / `backlog-cmd` / `skill` / `agent` categories — which are slash-invocable
in every other harness — collapse into a single artefact type for Copilot: path-specific instruction
files that Copilot auto-loads when a glob matches.

The user UX shifts from `/specflow-specify` to natural language ("write a feature spec following our
Specflow workflow"). Copilot picks up the instruction content automatically.

---

## File tree emitted by `specflow init --ai copilot`

| `CoreCategory`                | Copilot destination                                          |
| ----------------------------- | ------------------------------------------------------------ |
| `command` (specify, plan, …)  | `.github/instructions/specflow-<name>.instructions.md`       |
| `backlog-cmd` (backlog)       | `.github/instructions/specflow-backlog.instructions.md`      |
| `skill` (speckit auto-chain)  | `.github/instructions/specflow-<name>.instructions.md`       |
| `agent` (product-owner, …)    | `.github/instructions/specflow-agent-<name>.instructions.md` |
| `spec-root` (constitution, …) | `.specflow/<suffix>` (unchanged)                             |
| `project-root` (AGENTS.md, …) | `<suffix>` (AGENTS.md auto-loaded as primary instructions)   |

20 instruction files total (10 commands + 1 backlog-cmd + 1 skill + 8 agents).

**No `HARNESS_STATIC.copilot` overlay.** AGENTS.md is the persistent instruction surface, already
emitted by `project-root`.

**Why no `.github/copilot-instructions.md`?** That's the repo-wide file (single blob). We use the
granular path-specific format instead, mirroring the multi-file pattern used by Cursor / Codex /
Gemini / Windsurf for maintainability.

---

## Frontmatter rewrite

Path-specific Copilot instructions require `applyTo` frontmatter. Claude-flavored templates carry
`description`, `handoffs`, `scripts`, `model`, `tools`, `maxTurns`. None of those translate cleanly
to Copilot — replace the entire frontmatter with the minimal required form:

```yaml
---
applyTo: "**"
---
```

`"**"` means "applies to every file in the repo," which makes the instruction loadable in any
context. The body (everything after the closing `---`) ships unchanged.

This is the same shape as Gemini's subagent rewrite — strip Claude-only frontmatter, write a fresh
harness-specific frontmatter, preserve the body.

---

## `CopilotHarness` shape

```typescript
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillFolderName } from "./skill_folder.ts";
import { splitFrontmatter } from "./frontmatter.ts";

function toCopilotInstructionMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  return `---\napplyTo: "**"\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.github/instructions/${skillFolderName(entry)}.instructions.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class CopilotHarness implements Harness {
  readonly key = "copilot";
  readonly displayName = "GitHub Copilot CLI";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      const dest = destinationFor(entry);
      const isInstruction = entry.category === "command" ||
        entry.category === "backlog-cmd" ||
        entry.category === "agent" ||
        entry.category === "skill";
      out[dest] = {
        content: isInstruction ? toCopilotInstructionMarkdown(entry) : entry.content,
        executable: entry.executable,
      };
    }
    return out;
  }
}
```

`skillFolderName` from the existing shared helper already produces the right basename
(`specflow-<name>` for command/backlog-cmd/skill, `specflow-agent-<name>` for agent). The
destination just appends `.instructions.md`.

---

## Wiring changes

- `src/domain/installed_lock.ts` — widen `KnownHarness` and `KNOWN_HARNESSES` with `"copilot"`.
- `src/cli/harnesses.ts` — register `new CopilotHarness()` in `HARNESSES`.
- `src/cli/parser.ts` — widen the init `ai` union and validator to accept `"copilot"`.
- `src/cli/handlers/init_handler.ts` — widen `InitIntent.ai` union to match.
- `src/cli/help.ts` — usage line becomes
  `--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf | copilot`.
- `src/infrastructure/fs_project_inspector.ts` — extend `expectedFolder` Record with
  `copilot: ".github/instructions/"`.

---

## Testing

### New tests

- `tests/infrastructure/harness/copilot_harness_test.ts` (~7):
  1. `key === "copilot"`, `displayName === "GitHub Copilot CLI"`
  2. Commands map to `.github/instructions/specflow-<name>.instructions.md`
  3. backlog-cmd maps to `.github/instructions/specflow-backlog.instructions.md`
  4. skill maps to `.github/instructions/specflow-<name>.instructions.md`
  5. agents map to `.github/instructions/specflow-agent-<name>.instructions.md`
  6. spec-root → `.specflow/<suffix>`; project-root → `<suffix>`
  7. Emitted instruction frontmatter has `applyTo: "**"` and Claude-only fields (`model`, `tools`,
     `maxTurns`) stripped; body preserved
  8. No `.claude/`, `.cursor/`, `.agents/`, `.codex/`, `.gemini/`, `.windsurf/` keys, no CLAUDE.md

- `tests/integration/init_copilot_test.ts` (~1): end-to-end
  `specflow init demo --no-git --ai copilot` scaffolds the expected tree, lock reports
  `harness: copilot`, instruction files have `applyTo: "**"` frontmatter, expected per-directory
  file count.

### Updated tests

- `tests/domain/installed_lock_test.ts` — +1 test for `harness: copilot` accepted.
- `tests/cli/parser_test.ts` — +1 test for `--ai copilot` accepted.
- `tests/infrastructure/fs_project_inspector_test.ts` — +2 tests (copilot pass when
  `.github/instructions/` present; fail when missing).

### Expected count

Current 275 plus 8 (copilot_harness) plus 1 (integration) plus 1 (lock) plus 1 (parser) plus 2
(inspector) equals **288**.

---

## Out of scope

- `excludeAgent` field in instruction frontmatter (would let users opt into excluding specific
  agents like `code-review`; not needed for Specflow's workflow content).
- Repo-wide `.github/copilot-instructions.md` blob.
- Per-glob `applyTo` scoping (e.g. apply backlog-cmd only when editing `tasks/backlog/*.md`). All
  instructions use `**` — they're workflow procedures, not file-edit guidance.
- Multi-harness in one project.
- `specflow migrate`.

---

## Release plan

1. Branch `feat/copilot-harness` from main.
2. Implement: domain widening → harness adapter → wiring → tests → integration.
3. Verify full suite green; `specflow init demo --ai copilot` produces the expected tree;
   `specflow check --project` reports `harness: copilot`.
4. Squash-merge to main.
5. Bump binary `0.5.0-alpha.3 → 0.6.0-alpha.1`, templates `0.6.1 → 0.7.0`; tag `v0.6.0-alpha.1`;
   push main + tag.
