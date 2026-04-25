# Specflow Codex harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Codex CLI as the third supported AI harness with native TOML subagent emission,
and extract the shared skill-folder helper that both Cursor and Codex use.

**Architecture:** New `src/infrastructure/harness/skill_folder.ts` module hosts the skill-name and
frontmatter logic. `CursorHarness` is refactored to import from it (same behaviour, shorter file).
`CodexHarness` (new) reuses the helper for skills and adds `@std/toml`-based emission for
`.codex/agents/*.toml` subagent files.

**Tech Stack:** Deno 2 + TypeScript. New stdlib import: `@std/toml@^1.0.0` (TOML serializer, emits
single-line escaped strings — correct and parseable by Codex).

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-codex-design.md`

---

## File Structure (changes)

```
src/
├── infrastructure/harness/
│   ├── skill_folder.ts                              CREATE (shared helper)
│   ├── cursor_harness.ts                            MODIFY (use shared helper)
│   └── codex_harness.ts                             CREATE (new adapter)
├── domain/installed_lock.ts                         MODIFY (widen KnownHarness)
├── infrastructure/fs_project_inspector.ts           MODIFY (Record lookup)
├── cli/harnesses.ts                                 MODIFY (register CodexHarness)
├── cli/parser.ts                                    MODIFY (--ai codex)
└── cli/help.ts                                      MODIFY (usage text)

tests/
├── infrastructure/harness/skill_folder_test.ts      CREATE (~7 tests)
├── infrastructure/harness/cursor_harness_test.ts    MODIFY (prune dups)
├── infrastructure/harness/codex_harness_test.ts     CREATE (~7 tests)
├── infrastructure/fs_project_inspector_test.ts      MODIFY (+2 tests)
├── domain/installed_lock_test.ts                    MODIFY (+1 test)
├── cli/parser_test.ts                               MODIFY (+1 test)
└── integration/init_codex_test.ts                   CREATE (~1 test)

deno.json                                            MODIFY (add @std/toml)
```

Expected net test count: 223 → ~239.

---

## Task 1: Extract shared `skill_folder.ts` helper

**Files:**

- Create: `src/infrastructure/harness/skill_folder.ts`
- Create: `tests/infrastructure/harness/skill_folder_test.ts`
- Modify: `src/infrastructure/harness/cursor_harness.ts` (delete local copies)
- Modify: `tests/infrastructure/harness/cursor_harness_test.ts` (prune dup tests)

- [ ] **Step 1: Create `src/infrastructure/harness/skill_folder.ts`**

Write EXACTLY:

```typescript
import type { CoreEntry } from "../../domain/core_bundle.ts";

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

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Injects `name:` and `description:` into a SKILL.md's frontmatter when missing.
 * Preserves any existing values. Used by harnesses whose skill registries require
 * these fields (Cursor, Codex).
 */
export function ensureSkillFrontmatter(content: string, skillName: string): string {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    return `---\nname: ${skillName}\ndescription: Specflow skill: ${skillName}\n---\n\n${content}`;
  }
  const fmBody = m[1];
  const rest = m[2];
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

- [ ] **Step 2: Create `tests/infrastructure/harness/skill_folder_test.ts`**

Write EXACTLY:

```typescript
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ensureSkillFrontmatter,
  skillFolderName,
} from "../../../src/infrastructure/harness/skill_folder.ts";
import type { CoreEntry } from "../../../src/domain/core_bundle.ts";

function entry(category: CoreEntry["category"], name: string): CoreEntry {
  return { category, name, suffix: null, content: "", executable: false };
}

Deno.test("skillFolderName: command → specflow-<name>", () => {
  assertEquals(skillFolderName(entry("command", "specify")), "specflow-specify");
});

Deno.test("skillFolderName: backlog-cmd → specflow-<name>", () => {
  assertEquals(skillFolderName(entry("backlog-cmd", "backlog")), "specflow-backlog");
});

Deno.test("skillFolderName: skill → specflow-<name>", () => {
  assertEquals(skillFolderName(entry("skill", "speckit")), "specflow-speckit");
});

Deno.test("skillFolderName: agent → specflow-agent-<name>", () => {
  assertEquals(skillFolderName(entry("agent", "product-owner")), "specflow-agent-product-owner");
});

Deno.test("skillFolderName: throws for spec-root and project-root", () => {
  assertThrows(
    () =>
      skillFolderName({
        category: "spec-root",
        name: "specify",
        suffix: "x",
        content: "",
        executable: false,
      }),
    Error,
    "not applicable",
  );
  assertThrows(
    () =>
      skillFolderName({
        category: "project-root",
        name: "root",
        suffix: "x",
        content: "",
        executable: false,
      }),
    Error,
    "not applicable",
  );
});

Deno.test("ensureSkillFrontmatter: synthesizes frontmatter when absent", () => {
  const out = ensureSkillFrontmatter("# body\n", "my-skill");
  assert(out.startsWith("---\n"));
  assert(out.includes("name: my-skill"));
  assert(out.includes("description: Specflow skill: my-skill"));
  assert(out.endsWith("# body\n"));
});

Deno.test("ensureSkillFrontmatter: preserves existing name and description", () => {
  const input = "---\nname: user-choice\ndescription: User-written\n---\n\n# body\n";
  const out = ensureSkillFrontmatter(input, "default-name");
  assert(out.includes("name: user-choice"));
  assert(out.includes("description: User-written"));
  assert(!out.includes("name: default-name"));
});
```

- [ ] **Step 3: Run — expect 7 passed**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/infrastructure/harness/skill_folder_test.ts
```

Expected: `ok | 7 passed | 0 failed`.

- [ ] **Step 4: Refactor `src/infrastructure/harness/cursor_harness.ts` to use the helper**

Replace the file with EXACTLY:

```typescript
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle, TemplateFile } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.cursor/skills/${skillFolderName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class CursorHarness implements Harness {
  readonly key = "cursor";
  readonly displayName = "Cursor";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      const dest = destinationFor(entry);
      let content = entry.content;
      const isSkillFile = entry.category === "command" ||
        entry.category === "backlog-cmd" ||
        entry.category === "agent" ||
        entry.category === "skill";
      if (isSkillFile) {
        content = ensureSkillFrontmatter(content, skillFolderName(entry));
      }
      out[dest] = { content, executable: entry.executable } satisfies TemplateFile;
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
```

The local `cursorSkillName`, `ensureSkillFrontmatter`, and `FRONTMATTER_RE` are gone — imports
replace them.

- [ ] **Step 5: Prune duplicated tests from `tests/infrastructure/harness/cursor_harness_test.ts`**

Find and DELETE these two tests from the file (they are now covered by `skill_folder_test.ts`):

```typescript
Deno.test("CursorHarness injects name: frontmatter when absent", () => { ... });

Deno.test("CursorHarness preserves original name: when already present", () => { ... });
```

(Between the `"CursorHarness keeps spec-root and project-root paths unchanged"` test and the
`"CursorHarness includes .cursor/rules/specify-rules.mdc from HARNESS_STATIC"` test.)

Remove the `withoutName` and `withName` inline constants they used. The other 7 tests in the file
stay.

- [ ] **Step 6: Run the full suite**

```bash
deno task test
```

Expected: `ok | 227 passed | 0 failed` (223 baseline − 2 pruned + 7 new - 1 — actually: +7
skill_folder − 2 cursor duplicates = +5 net, but let me verify; the number printed by the test
runner is the source of truth, not this comment).

Precise projection: 223 + 7 − 2 = 228. Accept 227 or 228; anything else means something else went
wrong.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/harness/skill_folder.ts \
        src/infrastructure/harness/cursor_harness.ts \
        tests/infrastructure/harness/skill_folder_test.ts \
        tests/infrastructure/harness/cursor_harness_test.ts \
        src/templates_bundle.ts
git commit -m "refactor(harness): extract shared skill_folder helper used by Cursor (+ Codex)"
```

---

## Task 2: Widen `KnownHarness` for codex + inspector support

**Files:**

- Modify: `src/domain/installed_lock.ts`
- Modify: `src/infrastructure/fs_project_inspector.ts`
- Modify: `tests/domain/installed_lock_test.ts` (append 1 test)
- Modify: `tests/infrastructure/fs_project_inspector_test.ts` (append 2 tests)

The inspector's `checkHarness` currently uses a ternary `lock.harness === "claude" ? ...
: ...`.
Widening `KnownHarness` without fixing the ternary would silently resolve `codex` as `.cursor/`. Fix
them together.

- [ ] **Step 1: Widen `KnownHarness` in `src/domain/installed_lock.ts`**

Replace the existing `KnownHarness` + `KNOWN_HARNESSES` lines with:

```typescript
export type KnownHarness = "claude" | "cursor" | "codex";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
];
```

- [ ] **Step 2: Append a parseLock test in `tests/domain/installed_lock_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseLock accepts v2 lock with harness=codex", () => {
  const v2 = `version: 2
harness: codex
templates_version: 0.4.0
entries:
  .agents/skills/specflow-specify/SKILL.md:
    sha256: ccc
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.4.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "codex");
});
```

- [ ] **Step 3: Fix `checkHarness` in `src/infrastructure/fs_project_inspector.ts`**

Find the current implementation (the ternary `lock.harness === "claude" ? ".claude/" :
".cursor/"`)
and replace the `checkHarness` method body to use a lookup table:

```typescript
private async checkHarness(projectDir: string): Promise<CheckOutcome> {
  const path = join(projectDir, ".specflow/installed.lock");
  if (!(await exists(path))) {
    return {
      name: "harness",
      status: "warn",
      message: "no installed.lock (pre-upgrade-tracking project)",
    };
  }
  try {
    const raw = await Deno.readTextFile(path);
    const lock = parseLock(raw);
    const expectedFolder: Record<"claude" | "cursor" | "codex", string> = {
      claude: ".claude/",
      cursor: ".cursor/",
      codex: ".agents/",
    };
    const folder = expectedFolder[lock.harness];
    const folderPresent = await exists(join(projectDir, folder));
    if (!folderPresent) {
      return {
        name: "harness",
        status: "fail",
        message: `lock says ${lock.harness} but ${folder} is missing`,
      };
    }
    return {
      name: "harness",
      status: "pass",
      message: `${lock.harness} — ${folder} present`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "harness", status: "fail", message: `corrupt lock — ${msg}` };
  }
}
```

Leave all other methods (`inspect`, `checkTemplatesVersion`, `checkDir`, `checkConstitution`,
`checkBacklogConfig`) untouched.

- [ ] **Step 4: Append 2 inspector tests in `tests/infrastructure/fs_project_inspector_test.ts`**

At the end of the file, append:

```typescript
Deno.test("inspect surfaces harness=codex when lock says codex and .agents/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".agents/skills"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: codex
templates_version: 0.4.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.4.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("codex"), true);
    },
  );
});

Deno.test("inspect reports fail for codex lock when .agents/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      // Lock says codex but no .agents/ directory on disk.
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: codex
templates_version: 0.4.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.4.0");
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

Expected: `ok | 231 passed | 0 failed` (prev +1 +2 = +3 = 228→231; may be 230 or 231 depending on
Task 1 baseline).

- [ ] **Step 6: Commit**

```bash
git add src/domain/installed_lock.ts \
        src/infrastructure/fs_project_inspector.ts \
        tests/domain/installed_lock_test.ts \
        tests/infrastructure/fs_project_inspector_test.ts \
        src/templates_bundle.ts
git commit -m "feat(domain+check): recognise codex as a known harness"
```

---

## Task 3: Implement `CodexHarness` with TOML subagent emission

**Files:**

- Modify: `deno.json` (add `@std/toml` import)
- Create: `src/infrastructure/harness/codex_harness.ts`
- Create: `tests/infrastructure/harness/codex_harness_test.ts`

- [ ] **Step 1: Add `@std/toml` to `deno.json` imports**

Open `deno.json` and add this entry to `"imports"` (alphabetical order suggests putting it between
`@std/path` and `@std/fmt`, or after `@std/yaml`):

```json
"@std/toml": "jsr:@std/toml@^1.0.0"
```

After the edit the `"imports"` block should look like:

```json
"imports": {
  "@std/cli": "jsr:@std/cli@^1.0.0",
  "@std/fs": "jsr:@std/fs@^1.0.0",
  "@std/path": "jsr:@std/path@^1.0.0",
  "@std/fmt": "jsr:@std/fmt@^1.0.0",
  "@std/assert": "jsr:@std/assert@^1.0.0",
  "@std/yaml": "jsr:@std/yaml@^1.0.0",
  "@std/toml": "jsr:@std/toml@^1.0.0"
},
```

Warm the module cache:

```bash
deno cache src/infrastructure/harness/cursor_harness.ts 2>&1 | tail -3
```

No errors expected.

- [ ] **Step 2: Write the failing test**

Create `tests/infrastructure/harness/codex_harness_test.ts` with EXACTLY:

```typescript
import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: specify\ndescription: Scaffold feature spec\n---\n\n# body\n",
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
      "---\nname: product-owner\ndescription: Product Owner role\nmodel: opus\ntools: Read, Write\n---\n\n# Body\n\nYou are the PO.\n",
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

Deno.test("CodexHarness.key and displayName", () => {
  const h = new CodexHarness();
  assertEquals(h.key, "codex");
  assertEquals(h.displayName, "Codex CLI");
});

Deno.test("CodexHarness maps commands to .agents/skills/specflow-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".agents/skills/specflow-specify/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps backlog-cmd to .agents/skills/specflow-backlog/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".agents/skills/specflow-backlog/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps skill to .agents/skills/specflow-<name>/SKILL.md", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".agents/skills/specflow-speckit/SKILL.md" in mapped);
});

Deno.test("CodexHarness maps agent to .codex/agents/<name>.toml with valid TOML", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  const agentToml = mapped[".codex/agents/product-owner.toml"];
  assert(agentToml, "agent TOML not emitted");
  const parsed = parseToml(agentToml.content);
  assertEquals(parsed.name, "product-owner");
  assertEquals(parsed.description, "Product Owner role");
  assert(typeof parsed.developer_instructions === "string");
  assert(
    (parsed.developer_instructions as string).includes("You are the PO"),
    "agent body should end up in developer_instructions",
  );
  // Claude-only frontmatter fields must be stripped.
  assertEquals("model" in parsed, false);
  assertEquals("tools" in parsed, false);
});

Deno.test("CodexHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CodexHarness emits no Claude/Cursor artefacts", () => {
  const h = new CodexHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/ keys allowed");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/ keys allowed");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md allowed");
});

Deno.test("CodexHarness injects name+description into SKILL.md when absent", () => {
  const core: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CodexHarness();
  const mapped = h.mapBundle(core);
  const skill = mapped[".agents/skills/specflow-specify/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: specflow-specify"));
});
```

- [ ] **Step 3: Run — expect FAIL (file not found)**

```bash
deno test tests/infrastructure/harness/codex_harness_test.ts
```

Expected: `not found` error pointing at `codex_harness.ts`.

- [ ] **Step 4: Implement `src/infrastructure/harness/codex_harness.ts`**

Create with EXACTLY:

```typescript
import { stringify as stringifyToml } from "@std/toml";
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";

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

function toCodexSubagentToml(entry: CoreEntry): string {
  const { description, body } = parseAgentFrontmatter(entry.content);
  return stringifyToml({
    name: entry.name,
    description: description || `Specflow ${entry.name} agent`,
    developer_instructions: body,
  });
}

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
    return out;
  }
}
```

- [ ] **Step 5: Run — expect 8 passed**

```bash
deno test tests/infrastructure/harness/codex_harness_test.ts
```

Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 6: Run the full suite**

```bash
deno task test
```

Expected: `ok | ~239 passed | 0 failed` (Task 2 baseline + 8 new).

- [ ] **Step 7: Commit**

```bash
git add deno.json \
        src/infrastructure/harness/codex_harness.ts \
        tests/infrastructure/harness/codex_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(harness): CodexHarness adapter with TOML subagent emission"
```

---

## Task 4: Wire `CodexHarness` into CLI + parser

**Files:**

- Modify: `src/cli/harnesses.ts`
- Modify: `src/cli/parser.ts`
- Modify: `src/cli/help.ts`
- Modify: `tests/cli/parser_test.ts` (append 1 test)

- [ ] **Step 1: Register the adapter in `src/cli/harnesses.ts`**

Replace the file with:

```typescript
import type { Harness } from "../application/ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";
import { CodexHarness } from "../infrastructure/harness/codex_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

- [ ] **Step 2: Widen `--ai` in `src/cli/parser.ts`**

Find the `Intent` union's `init` variant. Change `ai: "claude" | "cursor"` to
`ai: "claude" | "cursor" | "codex"`.

Find the `if (command === "init")` block. Change the validator line:

```typescript
if (aiRaw !== "claude" && aiRaw !== "cursor") {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

…to:

```typescript
if (aiRaw !== "claude" && aiRaw !== "cursor" && aiRaw !== "codex") {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

And the returned `ai: aiRaw` line: the TypeScript checker will narrow correctly if the `ai` field
type was widened as above.

- [ ] **Step 3: Update `src/cli/help.ts`**

Find the `--ai <name>` line:

```text
--ai <name>    Target AI harness: claude (default) | cursor
```

Replace with:

```text
--ai <name>    Target AI harness: claude (default) | cursor | codex
```

- [ ] **Step 4: Append a parser test in `tests/cli/parser_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseArgs accepts init --ai codex", () => {
  const r = parseArgs(["init", "demo", "--ai", "codex"]);
  if (r.kind === "init") assertEquals(r.ai, "codex");
});
```

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | ~240 passed | 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/harnesses.ts \
        src/cli/parser.ts \
        src/cli/help.ts \
        tests/cli/parser_test.ts \
        src/templates_bundle.ts
git commit -m "feat(cli): register Codex harness — --ai codex accepted"
```

---

## Task 5: Integration test for `specflow init --ai codex`

**Files:**

- Create: `tests/integration/init_codex_test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/init_codex_test.ts` with EXACTLY:

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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-codex-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai codex scaffolds a Codex layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "codex"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // Codex team-shared skills
    assertEquals(await exists(join(root, ".agents/skills/specflow-specify/SKILL.md")), true);
    assertEquals(await exists(join(root, ".agents/skills/specflow-backlog/SKILL.md")), true);
    assertEquals(await exists(join(root, ".agents/skills/specflow-speckit/SKILL.md")), true);

    // Codex subagents (TOML)
    assertEquals(await exists(join(root, ".codex/agents/product-owner.toml")), true);
    const tomlContent = await Deno.readTextFile(
      join(root, ".codex/agents/product-owner.toml"),
    );
    const parsed = parseToml(tomlContent);
    assertEquals(parsed.name, "product-owner");
    assertEquals(typeof parsed.description, "string");
    assertEquals(typeof parsed.developer_instructions, "string");

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);

    // NOT emitted for codex
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects codex
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: codex"), true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
deno test --allow-all tests/integration/init_codex_test.ts
```

Expected: `ok | 1 passed | 0 failed`.

If the test fails with "agent TOML missing" or similar, investigate the content of the generated
`.codex/agents/` folder — the issue is most likely in `toCodexSubagentToml`'s frontmatter parsing.

- [ ] **Step 3: Run the full suite**

```bash
deno task test
```

Expected: `ok | ~241 passed | 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init_codex_test.ts
git commit -m "test(integration): specflow init --ai codex scaffolds Codex layout"
```

---

## Wrap-up

At the end of Task 5 the repo has:

- A shared `skill_folder.ts` helper consumed by `CursorHarness` and `CodexHarness`
- A `CodexHarness` that emits `.agents/skills/` + `.codex/agents/*.toml` + shared `.specflow/` +
  AGENTS.md
- `KnownHarness` recognizes `"codex"`; `specflow check --project` handles Codex projects
- `specflow init --ai codex` passes parser + integration-test validation
- ~241 tests green

### End-to-end validation

```bash
rm -rf /tmp/sf-codex && mkdir /tmp/sf-codex
cd /tmp/sf-codex
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git --ai codex
ls demo/.agents/skills/
# expected: specflow-backlog, specflow-speckit, specflow-specify, specflow-clarify, ...
ls demo/.codex/agents/
# expected: code-reviewer.toml, developer.toml, product-owner.toml, qa-tester.toml, ...
cat demo/.codex/agents/product-owner.toml | head
# expected: name = "product-owner" / description = "..." / developer_instructions = "..."
ls demo/.specflow/
# expected: installed.lock, memory, scripts, templates
cd demo
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts check --project
# expected: harness = codex — .agents/ present
cd /Users/kevin/Sites/specflow
rm -rf /tmp/sf-codex
```

### Release (performed after the brick lands)

- Squash-merge to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.2.0-alpha.1` to `0.3.0-alpha.1`.
- Bump `templates/manifest.json` `version` from `0.3.0` to `0.4.0`; re-run `deno task bundle`.
- Commit, tag `v0.3.0-alpha.1`, push main + tag.
