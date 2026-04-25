# Specflow OpenCode harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenCode (https://opencode.ai) as the seventh supported AI harness. Map `command` and
`backlog-cmd` entries to `.opencode/commands/`, `agent` entries to `.opencode/agents/` with
`mode: subagent` and a translated `permission:` block, and `skill` entries to
`.opencode/skills/<name>/SKILL.md`. spec-root and project-root pass through unchanged. AGENTS.md
(emitted via project-root) is auto-loaded by OpenCode.

**Architecture:** New `OpenCodeHarness` adapter. Two helper functions for frontmatter rewrites:
`toOpenCodeCommandMarkdown(entry)` and `toOpenCodeAgentMarkdown(entry)`. The agent helper uses a
private `translateToolsToPermissions(toolsField)` function that parses Claude's comma-separated
`tools:` field (handling `Bash(...)` and `Agent(...)` parenthesized forms) and returns a YAML-ready
permission object or `null`. Skills reuse the existing `ensureSkillFrontmatter` helper.

**Tech Stack:** Deno 2 + TypeScript. No new dependencies.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-opencode-design.md`

---

## File Structure (changes)

```
src/
├── infrastructure/harness/
│   └── opencode_harness.ts                          CREATE (new adapter, ~100 lines)
├── domain/installed_lock.ts                         MODIFY (widen KnownHarness)
├── infrastructure/fs_project_inspector.ts           MODIFY (Record entry for opencode)
├── cli/harnesses.ts                                 MODIFY (register OpenCodeHarness)
├── cli/parser.ts                                    MODIFY (--ai opencode)
└── cli/help.ts                                      MODIFY (usage text)

tests/
├── infrastructure/harness/opencode_harness_test.ts  CREATE (~10 tests)
├── infrastructure/fs_project_inspector_test.ts      MODIFY (+1 test)
├── domain/installed_lock_test.ts                    MODIFY (+1 test)
├── cli/parser_test.ts                               MODIFY (+1 test)
└── integration/init_opencode_test.ts                CREATE (~1 test)
```

Expected net test count: 297 → ~311.

---

## Task 1: Widen `KnownHarness` for opencode + inspector support

**Files:**

- Modify: `src/domain/installed_lock.ts`
- Modify: `src/infrastructure/fs_project_inspector.ts`
- Modify: `tests/domain/installed_lock_test.ts` (append 1 test)
- Modify: `tests/infrastructure/fs_project_inspector_test.ts` (append 1 test)

- [ ] **Step 1: Widen `KnownHarness` in `src/domain/installed_lock.ts`**

Replace the existing `KnownHarness` type union and `KNOWN_HARNESSES` array (lines 3-17) with:

```typescript
export type KnownHarness =
  | "claude"
  | "cursor"
  | "codex"
  | "gemini"
  | "windsurf"
  | "copilot"
  | "opencode";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "windsurf",
  "copilot",
  "opencode",
];
```

- [ ] **Step 2: Add an `opencode` entry to the inspector's `expectedFolder` map**

In `src/infrastructure/fs_project_inspector.ts` line 45-52, extend the
`Record<KnownHarness, string>` literal to include `opencode`:

```typescript
const expectedFolder: Record<KnownHarness, string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
  windsurf: ".windsurf/",
  copilot: ".github/instructions/",
  opencode: ".opencode/",
};
```

- [ ] **Step 3: Append round-trip test in `tests/domain/installed_lock_test.ts`**

Find the existing test that exercises round-trip parsing for each harness (search for `"copilot"` in
the file). Append `"opencode"` to the same parametrized list, OR add a new `Deno.test` block
mirroring the existing copilot one with the harness key swapped to `"opencode"`. The shape of the
existing test should make this obvious; copy the exact structure.

- [ ] **Step 4: Append detection test in `tests/infrastructure/fs_project_inspector_test.ts`**

Mirror the existing copilot test (search for `"copilot"` in the file, find the test that creates a
tmp project with a `.specflow/installed.lock` declaring a harness and asserts the `checkHarness`
outcome status is `pass`). Add a parallel test for `opencode`:

```typescript
Deno.test("inspect reports pass when opencode harness is set and .opencode/ exists", async () => {
  await using tmp = await createTempProject();
  await Deno.mkdir(`${tmp.path}/.specflow`, { recursive: true });
  await Deno.mkdir(`${tmp.path}/.opencode/agents`, { recursive: true });
  await Deno.writeTextFile(
    `${tmp.path}/.specflow/installed.lock`,
    `version: 2\nharness: opencode\ntemplates_version: 0.7.0\nentries: {}\n`,
  );
  const inspector = new FsProjectInspector();
  const outcomes = await inspector.inspect(tmp.path, "0.7.0");
  const harness = outcomes.find((o) => o.name === "harness");
  assertEquals(harness?.status, "pass");
  assertEquals(harness?.message, "opencode — .opencode/ present");
});
```

(Adjust imports / `createTempProject` helper invocation to match the file's existing patterns — copy
from the copilot test sitting right above.)

- [ ] **Step 5: Run the affected tests — should pass**

Run:

```bash
deno test tests/domain/installed_lock_test.ts tests/infrastructure/fs_project_inspector_test.ts --allow-read --allow-write
```

Expected: all tests pass (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/domain/installed_lock.ts src/infrastructure/fs_project_inspector.ts \
        tests/domain/installed_lock_test.ts tests/infrastructure/fs_project_inspector_test.ts
git commit -m "feat(opencode): KnownHarness + inspector recognize opencode"
```

---

## Task 2: Implement `OpenCodeHarness`

**Files:**

- Create: `src/infrastructure/harness/opencode_harness.ts`
- Create: `tests/infrastructure/harness/opencode_harness_test.ts`

- [ ] **Step 1: Write the failing test file
      `tests/infrastructure/harness/opencode_harness_test.ts`**

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { OpenCodeHarness } from "../../../src/infrastructure/harness/opencode_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const harness = new OpenCodeHarness();

function commandEntry(name: string, body = "Body content"): CoreBundle[number] {
  return {
    category: "command",
    name,
    source: `core/commands/${name}.md`,
    content:
      `---\ndescription: ${name} command\nargument-hint: <foo>\nallowed-tools: Read\n---\n${body}`,
    executable: false,
  };
}

function agentEntry(name: string, tools: string | null, body = "Agent body"): CoreBundle[number] {
  const fm = tools === null
    ? `name: ${name}\ndescription: ${name} agent\nmodel: sonnet`
    : `name: ${name}\ndescription: ${name} agent\nmodel: sonnet\ntools: ${tools}`;
  return {
    category: "agent",
    name,
    source: `core/agents/${name}.md`,
    content: `---\n${fm}\n---\n${body}`,
    executable: false,
  };
}

function skillEntry(name: string): CoreBundle[number] {
  return {
    category: "skill",
    name,
    source: `core/skills/${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: ${name} skill\n---\n\nSkill body`,
    executable: false,
  };
}

Deno.test("command emits to .opencode/commands/specflow.<name>.md", () => {
  const bundle = harness.mapBundle([commandEntry("specify")]);
  const dest = ".opencode/commands/specflow.specify.md";
  assertEquals(Object.keys(bundle), [dest]);
  assertStringIncludes(bundle[dest].content, "description: specify command");
  assertEquals(bundle[dest].content.includes("argument-hint"), false);
  assertEquals(bundle[dest].content.includes("allowed-tools"), false);
  assertStringIncludes(bundle[dest].content, "Body content");
});

Deno.test("backlog-cmd emits to .opencode/commands/backlog.md", () => {
  const entry: CoreBundle[number] = {
    category: "backlog-cmd",
    name: "backlog",
    source: "core/commands/backlog.md",
    content: `---\ndescription: Backlog\n---\nBody`,
    executable: false,
  };
  const bundle = harness.mapBundle([entry]);
  assertEquals(Object.keys(bundle), [".opencode/commands/backlog.md"]);
});

Deno.test("agent emits to .opencode/agents/specflow-<name>.md with mode: subagent", () => {
  const bundle = harness.mapBundle([
    agentEntry("developer", "Read, Write, Edit, Grep, Glob, Bash"),
  ]);
  const dest = ".opencode/agents/specflow-developer.md";
  assertEquals(Object.keys(bundle), [dest]);
  assertStringIncludes(bundle[dest].content, "description: developer agent");
  assertStringIncludes(bundle[dest].content, "mode: subagent");
  assertStringIncludes(bundle[dest].content, "permission:");
  assertEquals(bundle[dest].content.includes("model: sonnet"), false);
});

Deno.test("agent translates Read+Write+Edit+Bash to permission block", () => {
  const bundle = harness.mapBundle([agentEntry("dev", "Read, Write, Edit, Bash")]);
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertStringIncludes(content, "read: allow");
  assertStringIncludes(content, "write: allow");
  assertStringIncludes(content, "edit: allow");
  assertStringIncludes(content, "bash:");
  assertStringIncludes(content, '"*": ask');
});

Deno.test("agent de-dups Edit+MultiEdit into single edit permission", () => {
  const bundle = harness.mapBundle([agentEntry("dev", "Edit, MultiEdit")]);
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertEquals(content.match(/edit: allow/g)?.length, 1);
});

Deno.test("agent omits Grep/Glob/Task/TodoWrite/NotebookEdit and unknowns", () => {
  const bundle = harness.mapBundle([
    agentEntry("dev", "Grep, Glob, Task, TodoWrite, NotebookEdit, Mystery"),
  ]);
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertEquals(content.includes("permission:"), false);
});

Deno.test("agent strips Bash(git log *) parenthesized variants to Bash", () => {
  const bundle = harness.mapBundle([agentEntry("po", "Read, Bash(git log *), Bash(git diff *)")]);
  const content = bundle[".opencode/agents/specflow-po.md"].content;
  assertStringIncludes(content, "read: allow");
  assertStringIncludes(content, "bash:");
  // De-duped: only one bash block
  assertEquals(content.match(/bash:/g)?.length, 1);
});

Deno.test("agent strips Agent(...) entries (subagent dispatch is native)", () => {
  const bundle = harness.mapBundle([
    agentEntry("wf", "Read, Bash, Agent(code-reviewer, security-auditor)"),
  ]);
  const content = bundle[".opencode/agents/specflow-wf.md"].content;
  assertEquals(content.includes("agent:"), false);
});

Deno.test("agent with no tools field emits no permission block", () => {
  const bundle = harness.mapBundle([agentEntry("dev", null)]);
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertEquals(content.includes("permission:"), false);
});

Deno.test("skill emits to .opencode/skills/specflow-<name>/SKILL.md with name+description", () => {
  const bundle = harness.mapBundle([skillEntry("speckit")]);
  const dest = ".opencode/skills/specflow-speckit/SKILL.md";
  assertEquals(Object.keys(bundle), [dest]);
  assertStringIncludes(bundle[dest].content, "name: speckit");
  assertStringIncludes(bundle[dest].content, "description: speckit skill");
});

Deno.test("spec-root and project-root pass through unchanged", () => {
  const specRoot: CoreBundle[number] = {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    source: "core/specflow/memory/constitution.md",
    content: "raw constitution",
    executable: false,
  };
  const projectRoot: CoreBundle[number] = {
    category: "project-root",
    name: "root",
    suffix: "AGENTS.md",
    source: "core/root/AGENTS.md",
    content: "raw AGENTS",
    executable: false,
  };
  const bundle = harness.mapBundle([specRoot, projectRoot]);
  assertEquals(bundle[".specflow/memory/constitution.md"].content, "raw constitution");
  assertEquals(bundle["AGENTS.md"].content, "raw AGENTS");
});
```

- [ ] **Step 2: Run test — should fail (module not found)**

Run: `deno test tests/infrastructure/harness/opencode_harness_test.ts --allow-read`

Expected: FAIL — `Cannot find module '.../opencode_harness.ts'`.

- [ ] **Step 3: Implement `src/infrastructure/harness/opencode_harness.ts`**

Create the file with this exact content:

```typescript
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";

type PermissionValue = "allow" | "ask" | "deny" | { "*": "ask" | "allow" | "deny" };
type PermissionMap = Record<string, PermissionValue>;

function parseToolsList(tools: string): string[] {
  // Split on commas at depth 0 (ignoring commas inside parens like "Agent(a, b)").
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of tools) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  // Strip parenthesized suffix: "Bash(git log *)" → "Bash".
  return out.map((t) => t.replace(/\(.*$/, "").trim()).filter((t) => t.length > 0);
}

function translateToolsToPermissions(toolsField: string | null): PermissionMap | null {
  if (toolsField === null || toolsField.trim().length === 0) return null;
  const map: PermissionMap = {};
  for (const tool of parseToolsList(toolsField)) {
    switch (tool) {
      case "Read":
        map.read = "allow";
        break;
      case "Write":
        map.write = "allow";
        break;
      case "Edit":
      case "MultiEdit":
        map.edit = "allow";
        break;
      case "Bash":
        map.bash = { "*": "ask" };
        break;
      case "WebFetch":
        map.webfetch = "ask";
        break;
      case "WebSearch":
        map.websearch = "ask";
        break;
        // Grep, Glob, Task, Agent, TodoWrite, NotebookEdit, unknowns: omit.
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

function stringifyPermissions(perms: PermissionMap): string {
  const lines: string[] = ["permission:"];
  for (const [key, value] of Object.entries(perms)) {
    if (typeof value === "string") {
      lines.push(`  ${key}: ${value}`);
    } else {
      // bash: { "*": "ask" } → block form
      lines.push(`  ${key}:`);
      for (const [pat, v] of Object.entries(value)) {
        lines.push(`    "${pat}": ${v}`);
      }
    }
  }
  return lines.join("\n");
}

function toOpenCodeCommandMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = split ? frontmatterField(split.fmBody, "description") : null;
  const fm = description !== null ? `description: ${description}` : `description: ${entry.name}`;
  return `---\n${fm}\n---\n\n${body}`;
}

function toOpenCodeAgentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = split ? frontmatterField(split.fmBody, "description") : null;
  const tools = split ? frontmatterField(split.fmBody, "tools") : null;
  const perms = translateToolsToPermissions(tools);
  const lines: string[] = [];
  lines.push(description !== null ? `description: ${description}` : `description: ${entry.name}`);
  lines.push("mode: subagent");
  if (perms !== null) lines.push(stringifyPermissions(perms));
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.opencode/commands/specflow.${entry.name}.md`;
    case "backlog-cmd":
      return `.opencode/commands/${entry.name}.md`;
    case "agent":
      return `.opencode/agents/specflow-${entry.name}.md`;
    case "skill":
      return `.opencode/skills/${skillFolderName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class OpenCodeHarness implements Harness {
  readonly key = "opencode";
  readonly displayName = "OpenCode";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      const dest = destinationFor(entry);
      let content: string;
      switch (entry.category) {
        case "command":
        case "backlog-cmd":
          content = toOpenCodeCommandMarkdown(entry);
          break;
        case "agent":
          content = toOpenCodeAgentMarkdown(entry);
          break;
        case "skill":
          content = ensureSkillFrontmatter(entry.content, entry.name);
          break;
        default:
          content = entry.content;
      }
      out[dest] = { content, executable: entry.executable };
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test — all 11 should pass**

Run: `deno test tests/infrastructure/harness/opencode_harness_test.ts --allow-read`

Expected: 11 passed | 0 failed.

- [ ] **Step 5: Run formatter and lint**

Run:
`deno fmt src/infrastructure/harness/opencode_harness.ts tests/infrastructure/harness/opencode_harness_test.ts && deno lint src/infrastructure/harness/opencode_harness.ts tests/infrastructure/harness/opencode_harness_test.ts`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/harness/opencode_harness.ts \
        tests/infrastructure/harness/opencode_harness_test.ts
git commit -m "feat(opencode): OpenCodeHarness adapter with tools→permission translation"
```

---

## Task 3: Wire `OpenCodeHarness` into CLI + parser

**Files:**

- Modify: `src/cli/harnesses.ts`
- Modify: `src/cli/parser.ts`
- Modify: `src/cli/help.ts`
- Modify: `tests/cli/parser_test.ts` (append 1 test)

- [ ] **Step 1: Register `OpenCodeHarness` in `src/cli/harnesses.ts`**

Replace the current file content with:

```typescript
import type { Harness } from "../application/ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";
import { CodexHarness } from "../infrastructure/harness/codex_harness.ts";
import { GeminiHarness } from "../infrastructure/harness/gemini_harness.ts";
import { WindsurfHarness } from "../infrastructure/harness/windsurf_harness.ts";
import { CopilotHarness } from "../infrastructure/harness/copilot_harness.ts";
import { OpenCodeHarness } from "../infrastructure/harness/opencode_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
  new GeminiHarness(),
  new WindsurfHarness(),
  new CopilotHarness(),
  new OpenCodeHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

- [ ] **Step 2: Add `"opencode"` to the `--ai` enum in `src/cli/parser.ts`**

In the `Intent` type's `init` variant (line 11), extend the `ai` union to include `"opencode"`:

```typescript
ai: "claude" | "cursor" | "codex" | "gemini" | "windsurf" | "copilot" | "opencode";
```

In the `parseArgs` function (lines 46-53), extend the validation conditional:

```typescript
if (
  aiRaw !== "claude" &&
  aiRaw !== "cursor" &&
  aiRaw !== "codex" &&
  aiRaw !== "gemini" &&
  aiRaw !== "windsurf" &&
  aiRaw !== "copilot" &&
  aiRaw !== "opencode"
) {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

- [ ] **Step 3: Update help text in `src/cli/help.ts`**

Find line 23 and replace with:

```
--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf | copilot | opencode
```

- [ ] **Step 4: Append a parser test in `tests/cli/parser_test.ts`**

Find the existing test that validates `--ai copilot` parses successfully and add a parallel test
right below:

```typescript
Deno.test("parseArgs accepts --ai opencode", () => {
  const intent = parseArgs(["init", "demo", "--ai", "opencode"]);
  assertEquals(intent.kind, "init");
  if (intent.kind === "init") assertEquals(intent.ai, "opencode");
});
```

If the existing copilot test is parametrized over the harness list, just append `"opencode"` to that
list instead.

- [ ] **Step 5: Run the affected tests + check**

Run:

```bash
deno test tests/cli/parser_test.ts --allow-read --allow-write && \
  deno check src/main.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/harnesses.ts src/cli/parser.ts src/cli/help.ts tests/cli/parser_test.ts
git commit -m "feat(opencode): wire OpenCodeHarness into CLI + parser"
```

---

## Task 4: Integration test for `specflow init --ai opencode`

**Files:**

- Create: `tests/integration/init_opencode_test.ts`

- [ ] **Step 1: Write the integration test**

Mirror `tests/integration/init_copilot_test.ts` exactly (read it first to copy the test scaffolding,
binary path, tmpdir helpers, etc.). Replace `--ai copilot` with `--ai opencode` and update the
assertion targets:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
// (copy the same imports / helpers from init_copilot_test.ts)

Deno.test("specflow init --ai opencode scaffolds a complete OpenCode project layout", async () => {
  await using tmp = await createTempProjectDir();
  const result = await runSpecflow(["init", "demo", "--ai", "opencode", "--no-git"], tmp.path);
  assertEquals(result.code, 0);

  const projectRoot = join(tmp.path, "demo");

  // Commands
  const commands = await listFiles(join(projectRoot, ".opencode/commands"));
  assertEquals(commands.includes("specflow.specify.md"), true);
  assertEquals(commands.includes("specflow.plan.md"), true);
  assertEquals(commands.includes("backlog.md"), true);

  // Agents — pick one and verify mode: subagent + permission block
  const developerPath = join(projectRoot, ".opencode/agents/specflow-developer.md");
  const developer = await Deno.readTextFile(developerPath);
  assertStringIncludes(developer, "mode: subagent");
  assertStringIncludes(developer, "permission:");
  assertStringIncludes(developer, "read: allow");
  assertStringIncludes(developer, "bash:");

  // Skills
  const speckitSkill = await Deno.readTextFile(
    join(projectRoot, ".opencode/skills/specflow-speckit/SKILL.md"),
  );
  assertStringIncludes(speckitSkill, "name: speckit");

  // AGENTS.md at root (project-root passthrough)
  const agentsRoot = await Deno.readTextFile(join(projectRoot, "AGENTS.md"));
  assertEquals(agentsRoot.length > 0, true);

  // Lock records the harness
  const lock = await Deno.readTextFile(join(projectRoot, ".specflow/installed.lock"));
  assertStringIncludes(lock, "harness: opencode");
});
```

(Use the exact helper functions and import paths from the copilot file — do not reinvent.)

- [ ] **Step 2: Run the integration test**

Run: `deno task test 2>&1 | tail -30`

Expected: full suite passes; new test reports OK.

- [ ] **Step 3: Smoke manually**

```bash
rm -rf /tmp/oc-smoke
./dist/specflow-macos-arm64 init /tmp/oc-smoke --ai opencode --no-git
ls /tmp/oc-smoke/.opencode/commands /tmp/oc-smoke/.opencode/agents /tmp/oc-smoke/.opencode/skills
head -8 /tmp/oc-smoke/.opencode/agents/specflow-developer.md
```

Expected: `mode: subagent` and a `permission:` block visible.

(If the `dist/` binary is stale, run `deno task build` first.)

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init_opencode_test.ts
git commit -m "test(integration): specflow init --ai opencode end-to-end"
```

---

## Release

After all 4 tasks are committed and the suite is green:

1. Squash-merge `feat/opencode-harness` to main with a comprehensive commit message.
2. Bump binary `0.6.0-alpha.2 → 0.6.0-alpha.3` via
   `deno run --allow-read --allow-write scripts/bump-version.ts prerelease:alpha`.
3. Templates remain at `0.7.0` (no template content touched).
4. Tag `v0.6.0-alpha.3`; push main + tag.
5. Release-check task at +12 min: verify the GitHub Actions release workflow uploaded all 9 binaries
   and that `specflow init --ai opencode` works against the freshly built local binary.
