# Gemini CLI harness — design spec

**Goal.** Add Gemini CLI as the fourth supported AI harness. Map Specflow's `CoreCategory` cleanly
onto Gemini's three idiomatic artefact types (custom commands as TOML, skills as markdown, subagents
as markdown), and extract a small shared frontmatter helper now that three adapters need it.

**Why.** Of the candidate harnesses, Gemini is the one that genuinely stresses the abstraction: it's
the first harness with a _third_ file format (TOML for commands, with a different schema from
Codex's TOML subagents) and the first harness whose subagents are markdown, not TOML. Building it
forces the abstraction to handle a 4-shape matrix without growing the `Harness` port.

**Shipping.** Binary `0.3.0-alpha.1 → 0.4.0-alpha.1`, templates `0.4.0 → 0.5.0`. Standalone release.

**Reference docs verified.**

- `https://geminicli.com/docs/cli/skills/` — skills at `<repo>/.gemini/skills/<name>/SKILL.md` (or
  `.agents/skills/` alias); markdown + YAML frontmatter; required `name` + `description`
- `https://geminicli.com/docs/cli/custom-commands/` — commands at
  `<repo>/.gemini/commands/<name>.toml`; required `prompt` (string), optional `description`;
  subdirectories convert to colon-namespaces (we don't use that)
- `https://geminicli.com/docs/core/subagents/` — subagents at `<repo>/.gemini/agents/<name>.md`;
  markdown + YAML frontmatter; required `name` (lowercase + numbers + hyphens + underscores) +
  `description`; markdown body becomes the system prompt; many optional tuning fields we don't
  populate

---

## File tree emitted by `specflow init --ai gemini`

| `CoreCategory`                | Gemini destination                                   |
| ----------------------------- | ---------------------------------------------------- |
| `command` (specify, plan, …)  | `.gemini/commands/specflow-<name>.toml` (TOML)       |
| `backlog-cmd` (backlog)       | `.gemini/commands/specflow-backlog.toml` (TOML)      |
| `skill` (speckit auto-chain)  | `.gemini/skills/specflow-<name>/SKILL.md` (markdown) |
| `agent` (product-owner, …)    | `.gemini/agents/<name>.md` (markdown subagent)       |
| `spec-root` (constitution, …) | `.specflow/<suffix>` (unchanged)                     |
| `project-root` (AGENTS.md, …) | `<suffix>` (unchanged)                               |

User-visible slash commands become `/specflow-specify`, `/specflow-plan`, etc. — matching the
Cursor/Codex naming convention. Subagents are addressable as `@product-owner`, `@developer`, etc.

No Gemini-specific static overlay. AGENTS.md (project-root) carries the persistent instructions;
Gemini reads it natively.

---

## Shared `frontmatter.ts` helper extraction

Three adapters now need to parse YAML frontmatter from markdown templates:

- `skill_folder.ts::ensureSkillFrontmatter` (Cursor + Codex skills)
- `codex_harness.ts::parseAgentFrontmatter` (Codex subagent TOML)
- _new_ `gemini_harness.ts` for both subagent markdown rewrite and TOML command emission

The same `FRONTMATTER_RE` regex is duplicated across two files today; a third copy in
`gemini_harness.ts` would entrench the duplication. Extract a small shared module:

`src/infrastructure/harness/frontmatter.ts`:

```typescript
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export type FrontmatterParts = {
  readonly fmBody: string;
  readonly rest: string;
};

export function splitFrontmatter(content: string): FrontmatterParts | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  return { fmBody: m[1], rest: m[2] };
}

export function frontmatterField(fmBody: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = re.exec(fmBody);
  return m ? m[1].trim() : null;
}
```

`skill_folder.ts` and `codex_harness.ts` are refactored to import from it; their inlined
`FRONTMATTER_RE` constants are removed. `gemini_harness.ts` (new) imports both functions directly.

---

## `GeminiHarness` shape

```typescript
import { stringify as stringifyToml } from "@std/toml";
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";

function toGeminiCommandToml(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split?.rest.replace(/^\n+/, "") ?? entry.content;
  const description = frontmatterField(fmBody, "description");
  const out: Record<string, string> = { prompt: body };
  if (description) out.description = description;
  return stringifyToml(out);
}

function toGeminiSubagentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split?.rest.replace(/^\n+/, "") ?? entry.content;
  const description = frontmatterField(fmBody, "description") ??
    `Specflow ${entry.name} agent`;
  return `---\nname: ${entry.name}\ndescription: ${description}\n---\n\n${body}`;
}

export class GeminiHarness implements Harness {
  readonly key = "gemini";
  readonly displayName = "Gemini CLI";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      switch (entry.category) {
        case "command":
        case "backlog-cmd": {
          const name = skillFolderName(entry); // specflow-<name>
          out[`.gemini/commands/${name}.toml`] = {
            content: toGeminiCommandToml(entry),
            executable: false,
          };
          break;
        }
        case "skill": {
          const name = skillFolderName(entry);
          out[`.gemini/skills/${name}/SKILL.md`] = {
            content: ensureSkillFrontmatter(entry.content, name),
            executable: entry.executable,
          };
          break;
        }
        case "agent":
          out[`.gemini/agents/${entry.name}.md`] = {
            content: toGeminiSubagentMarkdown(entry),
            executable: false,
          };
          break;
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
    return out;
  }
}
```

### TOML command schema

Per `https://geminicli.com/docs/cli/custom-commands/`, the only required field is `prompt`. We also
emit `description` when the source frontmatter has one, so the command shows useful help text in
`gemini /commands` listings.

### Subagent frontmatter rewrite

Claude agent templates carry `name`, `description`, `model: opus`, `tools: ...`, `maxTurns: 30`. Of
those, only `name` and `description` translate cleanly to Gemini — `model: opus` is meaningless to
Gemini, Claude tool names don't match Gemini's tool registry, and `maxTurns` would need
camelCase→snake_case conversion that doesn't really gain us anything for the default value. We strip
everything but `name` + `description` and let Gemini's defaults apply.

---

## Wiring changes

- `src/domain/installed_lock.ts` — widen `KnownHarness` and `KNOWN_HARNESSES`:
  ```typescript
  export type KnownHarness = "claude" | "cursor" | "codex" | "gemini";
  export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
    "claude",
    "cursor",
    "codex",
    "gemini",
  ];
  ```

- `src/cli/harnesses.ts` — register `new GeminiHarness()` in the `HARNESSES` array.

- `src/cli/parser.ts` — widen the init `ai` union and validator to accept `"gemini"`.

- `src/cli/help.ts` — usage line becomes
  `--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini`.

- `src/infrastructure/fs_project_inspector.ts` — add `gemini: ".gemini/"` to the existing
  `expectedFolder: Record<KnownHarness, string>` lookup. `.gemini/` is the canary because all three
  Gemini subdirectories (commands/, skills/, agents/) are always emitted and they all live under it.

- `src/cli/handlers/init_handler.ts` — `InitIntent.ai` union widens via the parser change; the
  handler itself needs no edit (it already routes through `findHarness(intent.ai)`).

---

## Testing

### New tests

- `tests/infrastructure/harness/frontmatter_test.ts` (~4):
  1. `splitFrontmatter` returns parts when content has frontmatter
  2. `splitFrontmatter` returns `null` when content has no frontmatter
  3. `frontmatterField` extracts a present key
  4. `frontmatterField` returns `null` when key is absent

- `tests/infrastructure/harness/gemini_harness_test.ts` (~9):
  1. `key === "gemini"`, `displayName === "Gemini CLI"`
  2. Commands map to `.gemini/commands/specflow-<name>.toml` and parse back as TOML with the
     markdown body in the `prompt` field
  3. backlog-cmd maps to `.gemini/commands/specflow-backlog.toml`
  4. Skills map to `.gemini/skills/specflow-<name>/SKILL.md`
  5. Agents map to `.gemini/agents/<name>.md` with frontmatter restricted to `name` + `description`;
     Claude-only fields stripped
  6. Agent body is preserved verbatim
  7. spec-root maps to `.specflow/<suffix>`; project-root maps to `<suffix>`
  8. No `.claude/`, `.cursor/`, `.agents/`, `.codex/` keys, no CLAUDE.md
  9. TOML command emission includes `description` when source frontmatter has one and omits it
     otherwise

- `tests/integration/init_gemini_test.ts` (~1): `specflow init demo --no-git --ai gemini` scaffolds
  `.gemini/commands/`, `.gemini/skills/`, `.gemini/agents/`, `.specflow/`, AGENTS.md; `.claude/`,
  `.cursor/`, `.agents/`, `.codex/`, CLAUDE.md absent; lock has `harness: gemini`; TOML command
  parses back; subagent markdown frontmatter has only `name` + `description`.

### Updated tests

- `tests/infrastructure/harness/codex_harness_test.ts` — refactor `parseAgentFrontmatter` to use the
  shared helper (test file unchanged in intent; may need import path tweak if Codex internally
  refactors)
- `tests/infrastructure/harness/skill_folder_test.ts` — `ensureSkillFrontmatter` now imports
  `splitFrontmatter` from the new module; test file unchanged in intent
- `tests/domain/installed_lock_test.ts` — +1 test for `harness: gemini` accepted
- `tests/cli/parser_test.ts` — +1 test for `parseArgs(["init", "demo", "--ai",
  "gemini"])`
  returning `ai: "gemini"`
- `tests/infrastructure/fs_project_inspector_test.ts` — +2 tests (gemini lock pass when `.gemini/`
  present; gemini lock fail when `.gemini/` missing)

### Expected final count

Current 241 + 4 (frontmatter) + 9 (gemini_harness) + 1 (integration) + 1 (lock)

- 1 (parser) + 2 (inspector) ≈ **259**.

---

## Out of scope

- Multi-harness in a single project.
- `specflow migrate --from <a> --to <b>`.
- Gemini extensions (mentioned in nav but distinct from skills/commands/agents) and gemini-specific
  MCP server configuration.
- Cross-harness reuse via the `.agents/skills/` alias (Codex emits to `.agents/`, Gemini also reads
  from `.agents/`) — interesting but a separate brick.
- Subagent tuning fields (`temperature`, `max_turns`, `timeout_mins`, `tools`, `mcpServers`,
  `model`) — defaults are fine for Specflow agents.

---

## Release plan

1. Branch `feat/gemini-harness` from main.
2. Implement: frontmatter helper extraction → existing-adapter refactor → Gemini adapter → wiring →
   tests → integration.
3. Verify full suite green; `specflow init demo --ai gemini` produces the expected tree;
   `specflow check --project` reports `harness: gemini`.
4. Squash-merge to main.
5. Bump binary `0.3.0-alpha.1 → 0.4.0-alpha.1`, templates `0.4.0 → 0.5.0`; tag `v0.4.0-alpha.1`;
   push main + tag.
