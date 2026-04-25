# Codex CLI harness — design spec

**Goal.** Add OpenAI Codex CLI as the third supported AI harness. Scaffold idiomatic Codex
artefacts: team-shared skills under `.agents/skills/` and first-class subagents under
`.codex/agents/*.toml`.

**Why.** After the multi-harness refactor, adding a third harness validates the `Harness`
abstraction. Codex uses the same skills-folder idiom as Cursor but also exposes a TOML subagent
format that's the native home for Specflow's `agent` category (product-owner, developer,
review-coordinator, …). Mapping our agents to Codex subagents instead of skills is the correct
idiomatic choice and gives the `Bundle` abstraction its first non-markdown file type.

**Shipping.** Binary bumps to `0.3.0-alpha.1`, templates to `0.4.0`. Ships alongside the just-landed
`.specflow/` rename in a single release tag.

**Reference docs verified.**

- `https://developers.openai.com/codex/skills` — SKILL.md frontmatter requires `name`
  - `description`; team-shared skills live at `<repo>/.agents/skills/<name>/SKILL.md`
- `https://developers.openai.com/codex/subagents` — subagent files are TOML at
  `<repo>/.codex/agents/<name>.toml` with required fields `name`, `description`,
  `developer_instructions`
- `https://developers.openai.com/codex/guides/agents-md` — AGENTS.md at project root is Codex's
  native persistent-instruction file; Specflow already emits it via the `project-root` category

---

## File tree emitted by `specflow init --ai codex`

| `CoreCategory`                | Codex destination                          |
| ----------------------------- | ------------------------------------------ |
| `command` (specify, plan, …)  | `.agents/skills/specflow-<name>/SKILL.md`  |
| `backlog-cmd` (backlog)       | `.agents/skills/specflow-backlog/SKILL.md` |
| `skill` (speckit auto-chain)  | `.agents/skills/specflow-<name>/SKILL.md`  |
| `agent` (product-owner, …)    | `.codex/agents/<name>.toml`                |
| `spec-root` (constitution, …) | `.specflow/<suffix>`                       |
| `project-root` (AGENTS.md, …) | `<suffix>`                                 |

No Codex-specific static overlay. AGENTS.md carries the persistent instructions; Codex reads it
natively.

---

## Shared `skill_folder.ts` helper

New file `src/infrastructure/harness/skill_folder.ts` extracts the skill-folder naming + frontmatter
logic that `CursorHarness` and `CodexHarness` both need:

```typescript
import type { CoreEntry } from "../../domain/core_bundle.ts";

export function skillFolderName(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "skill":
      return `specflow-${entry.name}`;
    case "agent":
      return `specflow-agent-${entry.name}`;
    default:
      throw new Error(
        `skillFolderName not applicable for category: ${entry.category}`,
      );
  }
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function ensureSkillFrontmatter(content: string, skillName: string): string {
  // ... existing logic lifted verbatim from CursorHarness
}
```

`CursorHarness` imports both and deletes its local copies — its adapter body shrinks to ~30 lines
(same behavior, smaller surface). `CodexHarness` imports both too.

---

## `CodexHarness` shape

```typescript
import { stringify as stringifyToml } from "@std/toml";
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";

export class CodexHarness implements Harness {
  readonly key = "codex";
  readonly displayName = "Codex CLI";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      switch (entry.category) {
        case "agent":
          out[`.codex/agents/${entry.name}.toml`] = {
            content: toCodexSubagentToml(entry),
            executable: false,
          };
          break;
        case "command":
        case "backlog-cmd":
        case "skill": {
          const name = skillFolderName(entry);
          out[`.agents/skills/${name}/SKILL.md`] = {
            content: ensureSkillFrontmatter(entry.content, name),
            executable: entry.executable,
          };
          break;
        }
        case "spec-root":
          if (!entry.suffix) throw new Error(`spec-root needs suffix`);
          out[`.specflow/${entry.suffix}`] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        case "project-root":
          if (!entry.suffix) throw new Error(`project-root needs suffix`);
          out[entry.suffix] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
      }
    }
    // Codex has no HARNESS_STATIC overlay.
    return out;
  }
}
```

### TOML emission for subagents

Agent templates (e.g. `templates/core/agents/product-owner.md`) have frontmatter with
Claude-specific fields plus `description`. `toCodexSubagentToml(entry)`:

1. Parses the frontmatter with the same `FRONTMATTER_RE` pattern
2. Extracts the `description:` value
3. Strips Claude-only fields (`model`, `tools`, `maxTurns`) — not emitted to TOML
4. Passes the markdown body (everything after the closing `---`) as `developer_instructions`
5. Calls `stringifyToml({ name, description, developer_instructions })`

If an agent template is missing a `description:` line, synthesize one as `"Specflow <name> agent"` —
mirrors how `ensureSkillFrontmatter` handles missing descriptions. Without a description, Codex
can't auto-trigger the subagent.

`@std/toml` handles multi-line string escaping, so the body content lands inside `"""..."""` blocks
safely even if it contains quotes, backticks, backslashes.

---

## Wiring changes

- `src/domain/installed_lock.ts` — widen `KnownHarness` and `KNOWN_HARNESSES`:
  ```typescript
  export type KnownHarness = "claude" | "cursor" | "codex";
  export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
    "claude",
    "cursor",
    "codex",
  ];
  ```

- `src/cli/harnesses.ts` — register the new adapter:
  ```typescript
  export const HARNESSES: ReadonlyArray<Harness> = [
    new ClaudeHarness(),
    new CursorHarness(),
    new CodexHarness(),
  ];
  ```

- `src/cli/parser.ts` — widen the init `ai` union to `"claude" | "cursor" | "codex"` and add `codex`
  to the accepted literal set in the validator.

- `src/cli/help.ts` — usage line becomes
  `--ai <name>    Target AI harness: claude (default) | cursor | codex`.

- `src/infrastructure/fs_project_inspector.ts` — `checkHarness` uses a 3-entry lookup instead of a
  ternary:
  ```typescript
  const expectedFolder: Record<KnownHarness, string> = {
    claude: ".claude/",
    cursor: ".cursor/",
    codex: ".agents/",
  };
  ```
  `.agents/` is the Codex team-shared skills root and is always emitted.

---

## Testing

### New tests

- `tests/infrastructure/harness/skill_folder_test.ts` (~5):
  1. `skillFolderName("command", "specify")` → `specflow-specify`
  2. `skillFolderName("backlog-cmd", "backlog")` → `specflow-backlog`
  3. `skillFolderName("skill", "speckit")` → `specflow-speckit`
  4. `skillFolderName("agent", "product-owner")` → `specflow-agent-product-owner`
  5. `skillFolderName` throws on `spec-root`/`project-root`
  6. `ensureSkillFrontmatter` injects `name:` + `description:` when absent
  7. `ensureSkillFrontmatter` preserves an existing `name:`

- `tests/infrastructure/harness/codex_harness_test.ts` (~7):
  1. `key === "codex"`, `displayName === "Codex CLI"`
  2. Commands map to `.agents/skills/specflow-<name>/SKILL.md`
  3. backlog-cmd maps to `.agents/skills/specflow-backlog/SKILL.md`
  4. skill maps to `.agents/skills/specflow-<name>/SKILL.md`
  5. agent maps to `.codex/agents/<name>.toml` and the TOML parses back with the expected `name` +
     `description` + `developer_instructions`
  6. spec-root maps to `.specflow/<suffix>`; project-root maps to `<suffix>` unchanged
  7. No `.claude/…`, `.cursor/…` or `CLAUDE.md` keys in the mapped bundle

- `tests/integration/init_codex_test.ts` (~1): `specflow init demo --no-git --ai codex` scaffolds
  the expected tree, including `.agents/skills/specflow-specify/SKILL.md`,
  `.codex/agents/product-owner.toml`, `.specflow/memory/constitution.md`, AGENTS.md, and writes
  `harness: codex` in the installed lock.

### Updated tests

- `tests/infrastructure/harness/cursor_harness_test.ts` — remove the frontmatter inject/preserve
  tests (now covered by `skill_folder_test.ts`); keep the destination-mapping and static-file tests
- `tests/domain/installed_lock_test.ts` — add 1 test for `harness: codex` accepted on parse
- `tests/cli/parser_test.ts` — add 1 test for `parseArgs(["init", "demo", "--ai",
  "codex"])`
  returning `ai: "codex"`

### Expected final count

Current 223 + ~7 (skill_folder) + ~7 (codex_harness) + 1 (integration) + 1 (lock)

- 1 (parser) − 3 (cursor frontmatter tests moved to skill_folder) ≈ 237.

---

## Out of scope

- Multi-harness in a single project (one harness per init).
- `specflow migrate --from claude --to codex` (no installed base to migrate).
- Codex Rules (`.codex/rules/*.rules` in Starlark) — those configure sandbox command permissions,
  not workflow content; unrelated to Specflow's concerns.
- Non-agent TOML schema tweaks (e.g. optional `model`, `sandbox_mode` fields on subagents) —
  deferrable until a user asks for them.
- Codex subagent `agents/openai.yaml` metadata file inside a skill folder — the Codex docs mark it
  optional and Specflow does not need it.

---

## Release plan

1. Branch `feat/codex-harness` from main.
2. Implement in sequence (helper extraction → Cursor refactor → Codex adapter → wiring → parser →
   tests → docs).
3. Verify full suite green, `specflow init demo --ai codex` produces the expected tree,
   `specflow check --project` in a Codex project reports `harness: codex`.
4. Squash-merge to main.
5. Bump binary to `0.3.0-alpha.1`, templates to `0.4.0`; tag `v0.3.0-alpha.1` and push; watch the
   release workflow.
