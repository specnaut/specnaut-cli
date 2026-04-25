# Specflow Gemini harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemini CLI as the fourth supported AI harness with idiomatic triple-target mapping
(TOML commands, markdown skills, markdown subagents) and extract a shared frontmatter helper that
closes the duplicated `FRONTMATTER_RE` regex flagged in the previous review.

**Architecture:** New `src/infrastructure/harness/frontmatter.ts` module hosts `splitFrontmatter` +
`frontmatterField`. `skill_folder.ts` and `codex_harness.ts` are refactored to consume it. New
`gemini_harness.ts` emits `.gemini/commands/*.toml` (via `@std/toml`), `.gemini/skills/*/SKILL.md`,
and `.gemini/agents/*.md` (with frontmatter rewritten to `name`+`description` only).

**Tech Stack:** Deno 2 + TypeScript. `@std/toml` already in the import map (added in the Codex
brick). No new external dependencies.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-gemini-design.md`

---

## File Structure (changes)

```
src/
├── infrastructure/harness/
│   ├── frontmatter.ts                                CREATE (shared parser)
│   ├── skill_folder.ts                               MODIFY (use shared parser)
│   ├── codex_harness.ts                              MODIFY (use shared parser)
│   ├── cursor_harness.ts                             unchanged (already imports skill_folder)
│   └── gemini_harness.ts                             CREATE (new adapter)
├── domain/installed_lock.ts                          MODIFY (widen KnownHarness)
├── infrastructure/fs_project_inspector.ts            MODIFY (Record entry for gemini)
├── cli/harnesses.ts                                  MODIFY (register GeminiHarness)
├── cli/parser.ts                                     MODIFY (--ai gemini)
└── cli/help.ts                                       MODIFY (usage text)

tests/
├── infrastructure/harness/frontmatter_test.ts        CREATE (~4 tests)
├── infrastructure/harness/gemini_harness_test.ts     CREATE (~9 tests)
├── infrastructure/fs_project_inspector_test.ts       MODIFY (+2 tests)
├── domain/installed_lock_test.ts                     MODIFY (+1 test)
├── cli/parser_test.ts                                MODIFY (+1 test)
└── integration/init_gemini_test.ts                   CREATE (~1 test)
```

Expected net test count: 241 → ~259.

---

## Task 1: Extract shared `frontmatter.ts` helper

**Files:**

- Create: `src/infrastructure/harness/frontmatter.ts`
- Create: `tests/infrastructure/harness/frontmatter_test.ts`
- Modify: `src/infrastructure/harness/skill_folder.ts` (use shared helpers)
- Modify: `src/infrastructure/harness/codex_harness.ts` (use shared helpers)

- [ ] **Step 1: Create `src/infrastructure/harness/frontmatter.ts`**

Write EXACTLY:

```typescript
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export type FrontmatterParts = {
  readonly fmBody: string;
  readonly rest: string;
};

/**
 * Splits a markdown document into its YAML frontmatter body and the remaining content.
 * Returns null when the document has no frontmatter.
 */
export function splitFrontmatter(content: string): FrontmatterParts | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  return { fmBody: m[1], rest: m[2] };
}

/**
 * Extracts a single-line YAML field value from a frontmatter body, or null if
 * the key is absent. Trims surrounding whitespace from the value.
 */
export function frontmatterField(fmBody: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = re.exec(fmBody);
  return m ? m[1].trim() : null;
}
```

- [ ] **Step 2: Create `tests/infrastructure/harness/frontmatter_test.ts`**

Write EXACTLY:

```typescript
import { assert, assertEquals } from "@std/assert";
import {
  frontmatterField,
  splitFrontmatter,
} from "../../../src/infrastructure/harness/frontmatter.ts";

Deno.test("splitFrontmatter: returns parts when frontmatter present", () => {
  const out = splitFrontmatter(
    "---\nname: thing\ndescription: useful\n---\n\n# Body\n\nText.\n",
  );
  assert(out !== null);
  assert(out.fmBody.includes("name: thing"));
  assert(out.fmBody.includes("description: useful"));
  assertEquals(out.rest.trimStart().startsWith("# Body"), true);
});

Deno.test("splitFrontmatter: returns null when no frontmatter", () => {
  assertEquals(splitFrontmatter("just markdown\n"), null);
  assertEquals(splitFrontmatter(""), null);
});

Deno.test("frontmatterField: extracts a present key", () => {
  const fmBody = "name: thing\ndescription: a useful thing\n";
  assertEquals(frontmatterField(fmBody, "name"), "thing");
  assertEquals(frontmatterField(fmBody, "description"), "a useful thing");
});

Deno.test("frontmatterField: returns null when key absent", () => {
  const fmBody = "name: thing\n";
  assertEquals(frontmatterField(fmBody, "description"), null);
});
```

- [ ] **Step 3: Run — expect 4 passed**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/infrastructure/harness/frontmatter_test.ts
```

Expected: `ok | 4 passed | 0 failed`.

- [ ] **Step 4: Refactor `src/infrastructure/harness/skill_folder.ts`**

Replace the file with EXACTLY:

```typescript
import type { CoreEntry } from "../../domain/core_bundle.ts";
import { splitFrontmatter } from "./frontmatter.ts";

/**
 * Returns the folder name for a skill-emitting core entry, used by harnesses that
 * render commands/agents/skills as skill folders (Cursor, Codex).
 */
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

/**
 * Injects `name:` and `description:` into a SKILL.md's frontmatter when missing.
 * Preserves any existing values. Used by harnesses whose skill registries require
 * these fields (Cursor, Codex).
 */
export function ensureSkillFrontmatter(content: string, skillName: string): string {
  const split = splitFrontmatter(content);
  if (!split) {
    return `---\nname: ${skillName}\ndescription: Specflow skill: ${skillName}\n---\n\n${content}`;
  }
  const fmBody = split.fmBody;
  const rest = split.rest;
  const hasName = /^name:\s/m.test(fmBody);
  const hasDescription = /^description:\s/m.test(fmBody);
  let newFm = fmBody;
  if (!hasName) newFm = `name: ${skillName}\n${newFm}`;
  if (!hasDescription) {
    newFm = `${newFm}\ndescription: Specflow skill: ${skillName}`;
  }
  return `---\n${newFm}\n---\n${rest}`;
}
```

(Removed: local `FRONTMATTER_RE` constant. Added: `splitFrontmatter` import.)

- [ ] **Step 5: Refactor `src/infrastructure/harness/codex_harness.ts`**

In the file, find the local `FRONTMATTER_RE` constant and the `parseAgentFrontmatter` function
(lines 7-17 currently). Replace them as follows.

DELETE these lines (the `FRONTMATTER_RE` constant + the body of `parseAgentFrontmatter`):

```typescript
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseAgentFrontmatter(content: string): { description: string; body: string } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { description: "", body: content };
  const fmBody = m[1];
  const restBody = m[2].replace(/^\n+/, "");
  const descMatch = /^description:\s*(.+)$/m.exec(fmBody);
  const description = descMatch ? descMatch[1].trim() : "";
  return { description, body: restBody };
}
```

REPLACE with:

```typescript
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";

function parseAgentFrontmatter(content: string): { description: string; body: string } {
  const split = splitFrontmatter(content);
  if (!split) return { description: "", body: content };
  return {
    description: frontmatterField(split.fmBody, "description") ?? "",
    body: split.rest.replace(/^\n+/, ""),
  };
}
```

The new `import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";` line should sit
alongside the existing
`import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";` line near the top of
the file. Keep all other imports and code (including `toCodexSubagentToml`, the `CodexHarness`
class, etc.) untouched.

- [ ] **Step 6: Run the full suite**

```bash
deno task test
```

Expected: `ok | 245 passed | 0 failed` (241 baseline + 4 new). All existing CursorHarness,
CodexHarness, and skill_folder tests still pass — the refactor preserves behavior.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/harness/frontmatter.ts \
        src/infrastructure/harness/skill_folder.ts \
        src/infrastructure/harness/codex_harness.ts \
        tests/infrastructure/harness/frontmatter_test.ts \
        src/templates_bundle.ts
git commit -m "refactor(harness): extract shared frontmatter helper for Cursor/Codex/Gemini"
```

---

## Task 2: Widen `KnownHarness` for gemini + inspector support

**Files:**

- Modify: `src/domain/installed_lock.ts`
- Modify: `src/infrastructure/fs_project_inspector.ts`
- Modify: `tests/domain/installed_lock_test.ts` (append 1 test)
- Modify: `tests/infrastructure/fs_project_inspector_test.ts` (append 2 tests)

- [ ] **Step 1: Widen `KnownHarness` in `src/domain/installed_lock.ts`**

Find the existing `KnownHarness` + `KNOWN_HARNESSES` declarations and replace them with:

```typescript
export type KnownHarness = "claude" | "cursor" | "codex" | "gemini";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
  "gemini",
];
```

- [ ] **Step 2: Append a parseLock test to `tests/domain/installed_lock_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseLock accepts v2 lock with harness=gemini", () => {
  const v2 = `version: 2
harness: gemini
templates_version: 0.5.0
entries:
  .gemini/commands/specflow-specify.toml:
    sha256: ddd
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.5.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "gemini");
});
```

- [ ] **Step 3: Add `gemini` entry in `src/infrastructure/fs_project_inspector.ts`**

Find the `expectedFolder` Record literal inside `checkHarness`. It currently looks like:

```typescript
const expectedFolder: Record<"claude" | "cursor" | "codex", string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
};
```

Replace with:

```typescript
const expectedFolder: Record<"claude" | "cursor" | "codex" | "gemini", string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
};
```

(Both the type union and the object literal are updated.)

- [ ] **Step 4: Append 2 inspector tests to `tests/infrastructure/fs_project_inspector_test.ts`**

At the end of the file, append:

```typescript
Deno.test("inspect surfaces harness=gemini when lock says gemini and .gemini/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".gemini/commands"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: gemini
templates_version: 0.5.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.5.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("gemini"), true);
    },
  );
});

Deno.test("inspect reports fail for gemini lock when .gemini/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      // Lock says gemini but no .gemini/ directory on disk.
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: gemini
templates_version: 0.5.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.5.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});
```

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 248 passed | 0 failed` (245 baseline + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/domain/installed_lock.ts \
        src/infrastructure/fs_project_inspector.ts \
        tests/domain/installed_lock_test.ts \
        tests/infrastructure/fs_project_inspector_test.ts \
        src/templates_bundle.ts
git commit -m "feat(domain+check): recognise gemini as a known harness"
```

---

## Task 3: Implement `GeminiHarness` with TOML commands + markdown subagents

**Files:**

- Create: `src/infrastructure/harness/gemini_harness.ts`
- Create: `tests/infrastructure/harness/gemini_harness_test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/infrastructure/harness/gemini_harness_test.ts` with EXACTLY:

```typescript
import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { GeminiHarness } from "../../../src/infrastructure/harness/gemini_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content:
      "---\nname: specify\ndescription: Scaffold feature spec\n---\n\n# Body\n\nDo the thing.\n",
    executable: false,
  },
  {
    category: "backlog-cmd",
    name: "backlog",
    suffix: null,
    content: "---\ndescription: Backlog dispatcher\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "skill",
    name: "speckit",
    suffix: null,
    content: "---\ndescription: Auto-chain dispatcher\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "agent",
    name: "product-owner",
    suffix: null,
    content:
      "---\nname: product-owner\ndescription: Product Owner role\nmodel: opus\ntools: Read, Write\nmaxTurns: 30\n---\n\n# Body\n\nYou are the PO.\n",
    executable: false,
  },
  {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    content: "# const\n",
    executable: false,
  },
  {
    category: "project-root",
    name: "root",
    suffix: "AGENTS.md",
    content: "# AGENTS\n",
    executable: false,
  },
];

Deno.test("GeminiHarness.key and displayName", () => {
  const h = new GeminiHarness();
  assertEquals(h.key, "gemini");
  assertEquals(h.displayName, "Gemini CLI");
});

Deno.test("GeminiHarness maps commands to .gemini/commands/specflow-<name>.toml as parseable TOML", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  const cmd = mapped[".gemini/commands/specflow-specify.toml"];
  assert(cmd, "command TOML not emitted");
  const parsed = parseToml(cmd.content);
  assertEquals(parsed.description, "Scaffold feature spec");
  assert(typeof parsed.prompt === "string");
  assert(
    (parsed.prompt as string).includes("Do the thing"),
    "command body should land in `prompt` field",
  );
});

Deno.test("GeminiHarness maps backlog-cmd to .gemini/commands/specflow-backlog.toml", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".gemini/commands/specflow-backlog.toml" in mapped);
});

Deno.test("GeminiHarness maps skill to .gemini/skills/specflow-<name>/SKILL.md", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".gemini/skills/specflow-speckit/SKILL.md" in mapped);
});

Deno.test("GeminiHarness maps agent to .gemini/agents/<name>.md with stripped frontmatter", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  const agent = mapped[".gemini/agents/product-owner.md"];
  assert(agent, "agent markdown not emitted");
  assert(agent.content.startsWith("---\n"), "missing frontmatter");
  assert(agent.content.includes("name: product-owner"));
  assert(agent.content.includes("description: Product Owner role"));
  // Claude-specific fields must be stripped.
  assert(!agent.content.includes("model: opus"), "model should be stripped");
  assert(!agent.content.includes("tools:"), "tools should be stripped");
  assert(!agent.content.includes("maxTurns"), "maxTurns should be stripped");
  // Body preserved.
  assert(agent.content.includes("You are the PO"), "agent body lost");
});

Deno.test("GeminiHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("GeminiHarness emits no Claude/Cursor/Codex artefacts", () => {
  const h = new GeminiHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/ (Codex root)");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});

Deno.test("GeminiHarness omits TOML description when source frontmatter has none", () => {
  const core: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "no frontmatter at all\n",
    executable: false,
  }];
  const h = new GeminiHarness();
  const mapped = h.mapBundle(core);
  const parsed = parseToml(
    mapped[".gemini/commands/specflow-specify.toml"].content,
  );
  assertEquals("description" in parsed, false);
  assertEquals(parsed.prompt, "no frontmatter at all\n");
});

Deno.test("GeminiHarness synthesises agent description when source has none", () => {
  const core: CoreBundle = [{
    category: "agent",
    name: "lonely-agent",
    suffix: null,
    content: "# A body without frontmatter\n",
    executable: false,
  }];
  const h = new GeminiHarness();
  const mapped = h.mapBundle(core);
  const agent = mapped[".gemini/agents/lonely-agent.md"];
  assert(agent.content.includes("name: lonely-agent"));
  assert(agent.content.includes("description: Specflow lonely-agent agent"));
});
```

- [ ] **Step 2: Run — expect FAIL (file not found)**

```bash
deno test tests/infrastructure/harness/gemini_harness_test.ts
```

Expected: module-not-found error pointing at `gemini_harness.ts`.

- [ ] **Step 3: Implement `src/infrastructure/harness/gemini_harness.ts`**

Create with EXACTLY:

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
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = frontmatterField(fmBody, "description");
  const out: Record<string, string> = { prompt: body };
  if (description) out.description = description;
  return stringifyToml(out);
}

function toGeminiSubagentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
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
          const name = skillFolderName(entry);
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

- [ ] **Step 4: Run — expect 9 passed**

```bash
deno test tests/infrastructure/harness/gemini_harness_test.ts
```

Expected: `ok | 9 passed | 0 failed`.

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 257 passed | 0 failed` (248 baseline + 9 new).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/harness/gemini_harness.ts \
        tests/infrastructure/harness/gemini_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(harness): GeminiHarness — TOML commands + markdown skills + markdown subagents"
```

---

## Task 4: Wire `GeminiHarness` into CLI + parser

**Files:**

- Modify: `src/cli/harnesses.ts`
- Modify: `src/cli/parser.ts`
- Modify: `src/cli/help.ts`
- Modify: `src/cli/handlers/init_handler.ts` (widen `InitIntent.ai` union)
- Modify: `tests/cli/parser_test.ts` (append 1 test)

- [ ] **Step 1: Register the adapter in `src/cli/harnesses.ts`**

OVERWRITE the file with:

```typescript
import type { Harness } from "../application/ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";
import { CodexHarness } from "../infrastructure/harness/codex_harness.ts";
import { GeminiHarness } from "../infrastructure/harness/gemini_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
  new GeminiHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

- [ ] **Step 2: Widen `--ai` in `src/cli/parser.ts`**

In the `Intent` union's `init` variant, find:

```typescript
ai: "claude" | "cursor" | "codex";
```

Replace with:

```typescript
ai: "claude" | "cursor" | "codex" | "gemini";
```

Find the validator block:

```typescript
if (aiRaw !== "claude" && aiRaw !== "cursor" && aiRaw !== "codex") {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

Replace with:

```typescript
if (
  aiRaw !== "claude" &&
  aiRaw !== "cursor" &&
  aiRaw !== "codex" &&
  aiRaw !== "gemini"
) {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

- [ ] **Step 3: Update `src/cli/handlers/init_handler.ts`**

Find the `InitIntent` type and widen its `ai` field the same way (`"claude" | "cursor" | "codex"` →
`"claude" | "cursor" | "codex" | "gemini"`). The handler body itself doesn't need other changes —
`findHarness(intent.ai)` already covers any registered key.

- [ ] **Step 4: Update `src/cli/help.ts`**

Find the `--ai <name>` line (currently lists `claude (default) | cursor | codex`). Replace with:

```text
--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini
```

- [ ] **Step 5: Append a parser test in `tests/cli/parser_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseArgs accepts init --ai gemini", () => {
  const r = parseArgs(["init", "demo", "--ai", "gemini"]);
  if (r.kind === "init") assertEquals(r.ai, "gemini");
});
```

- [ ] **Step 6: Run the full suite**

```bash
deno task test
```

Expected: `ok | 258 passed | 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add src/cli/harnesses.ts src/cli/parser.ts src/cli/handlers/init_handler.ts \
        src/cli/help.ts tests/cli/parser_test.ts src/templates_bundle.ts
git commit -m "feat(cli): register Gemini harness — --ai gemini accepted"
```

---

## Task 5: Integration test for `specflow init --ai gemini`

**Files:**

- Create: `tests/integration/init_gemini_test.ts`

- [ ] **Step 1: Write the integration test**

Create with EXACTLY:

```typescript
import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecflow(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-gemini-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai gemini scaffolds a Gemini layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "gemini"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // TOML commands
    assertEquals(
      await exists(join(root, ".gemini/commands/specflow-specify.toml")),
      true,
    );
    assertEquals(
      await exists(join(root, ".gemini/commands/specflow-backlog.toml")),
      true,
    );
    const cmdContent = await Deno.readTextFile(
      join(root, ".gemini/commands/specflow-specify.toml"),
    );
    const parsedCmd = parseToml(cmdContent);
    assertEquals(typeof parsedCmd.prompt, "string");

    // Markdown skill
    assertEquals(
      await exists(join(root, ".gemini/skills/specflow-speckit/SKILL.md")),
      true,
    );

    // Markdown subagent — frontmatter has only name + description
    assertEquals(await exists(join(root, ".gemini/agents/product-owner.md")), true);
    const agentContent = await Deno.readTextFile(
      join(root, ".gemini/agents/product-owner.md"),
    );
    assertEquals(agentContent.includes("name: product-owner"), true);
    assertEquals(agentContent.includes("description:"), true);
    assertEquals(agentContent.includes("model:"), false);
    assertEquals(agentContent.includes("tools:"), false);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);

    // NOT emitted for gemini
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects gemini
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: gemini"), true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
deno test --allow-all tests/integration/init_gemini_test.ts
```

Expected: `ok | 1 passed | 0 failed`.

- [ ] **Step 3: Run the full suite**

```bash
deno task test
```

Expected: `ok | 259 passed | 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init_gemini_test.ts
git commit -m "test(integration): specflow init --ai gemini scaffolds Gemini layout"
```

---

## Wrap-up

At the end of Task 5 the repo has:

- A shared `frontmatter.ts` helper consumed by `skill_folder.ts`, `codex_harness.ts`, and
  `gemini_harness.ts` — closes the duplicated `FRONTMATTER_RE` regex
- A `GeminiHarness` that emits `.gemini/commands/*.toml` (custom commands),
  `.gemini/skills/*/SKILL.md` (skills), `.gemini/agents/*.md` (subagents) plus the shared
  `.specflow/` + AGENTS.md
- `KnownHarness` recognizes `"gemini"`; `specflow check --project` handles Gemini projects (canary:
  `.gemini/`)
- `specflow init --ai gemini` parses + scaffolds end-to-end
- ~259 tests green

### End-to-end validation

```bash
rm -rf /tmp/sf-gemini && mkdir /tmp/sf-gemini
cd /tmp/sf-gemini
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git --ai gemini
ls demo/.gemini/commands/
# expected: specflow-analyze.toml, specflow-backlog.toml, ..., specflow-tasks.toml (11 files)
ls demo/.gemini/skills/
# expected: specflow-speckit (1 entry)
ls demo/.gemini/agents/
# expected: code-reviewer.md, developer.md, product-owner.md, ..., workflow-manager.md (8 files)
cat demo/.gemini/commands/specflow-specify.toml | head
# expected: description = "..." / prompt = "..."
cat demo/.gemini/agents/product-owner.md | head -5
# expected: ---\nname: product-owner\ndescription: ...\n---
cd demo
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts check --project
# expected: harness = gemini — .gemini/ present
cd /Users/kevin/Sites/specflow
rm -rf /tmp/sf-gemini
```

### Release (after merge)

- Squash-merge `feat/gemini-harness` to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.3.0-alpha.1` to `0.4.0-alpha.1`.
- Bump `templates/manifest.json` `version` from `0.4.0` to `0.5.0`; re-run `deno task bundle`.
- Commit, tag `v0.4.0-alpha.1`, push main + tag.
