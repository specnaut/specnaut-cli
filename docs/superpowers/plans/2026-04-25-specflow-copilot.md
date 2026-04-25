# Specflow GitHub Copilot CLI harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Copilot CLI as the sixth supported AI harness. Map every invocable Specflow
category onto Copilot's path-specific instruction files
(`.github/instructions/<name>.instructions.md`) with `applyTo: "**"` frontmatter. Reuses the
existing `skillFolderName` + `splitFrontmatter` helpers; no new shared modules needed.

**Architecture:** New `CopilotHarness` adapter. All four invocable categories (command, backlog-cmd,
agent, skill) emit to a single artefact type. Body content preserved; frontmatter rewritten to a
fresh `applyTo: "**"` form. spec-root and project-root unchanged. AGENTS.md (already emitted via
project-root) is auto-loaded by Copilot as primary instructions.

**Tech Stack:** Deno 2 + TypeScript. No new dependencies.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-copilot-design.md`

---

## File Structure (changes)

```
src/
├── infrastructure/harness/
│   └── copilot_harness.ts                           CREATE (new adapter)
├── domain/installed_lock.ts                         MODIFY (widen KnownHarness)
├── infrastructure/fs_project_inspector.ts           MODIFY (Record entry for copilot)
├── cli/harnesses.ts                                 MODIFY (register CopilotHarness)
├── cli/parser.ts                                    MODIFY (--ai copilot)
├── cli/help.ts                                      MODIFY (usage text)
└── cli/handlers/init_handler.ts                     MODIFY (widen InitIntent.ai)

tests/
├── infrastructure/harness/copilot_harness_test.ts   CREATE (~8 tests)
├── infrastructure/fs_project_inspector_test.ts      MODIFY (+2 tests)
├── domain/installed_lock_test.ts                    MODIFY (+1 test)
├── cli/parser_test.ts                               MODIFY (+1 test)
└── integration/init_copilot_test.ts                 CREATE (~1 test)
```

Expected net test count: 275 → 288.

---

## Task 1: Widen `KnownHarness` for copilot + inspector support

**Files:**

- Modify: `src/domain/installed_lock.ts`
- Modify: `src/infrastructure/fs_project_inspector.ts`
- Modify: `tests/domain/installed_lock_test.ts` (append 1 test)
- Modify: `tests/infrastructure/fs_project_inspector_test.ts` (append 2 tests)

- [ ] **Step 1: Widen `KnownHarness` in `src/domain/installed_lock.ts`**

Find the existing `KnownHarness` + `KNOWN_HARNESSES` declarations and replace with:

```typescript
export type KnownHarness =
  | "claude"
  | "cursor"
  | "codex"
  | "gemini"
  | "windsurf"
  | "copilot";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "windsurf",
  "copilot",
];
```

- [ ] **Step 2: Append a parseLock test to `tests/domain/installed_lock_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseLock accepts v2 lock with harness=copilot", () => {
  const v2 = `version: 2
harness: copilot
templates_version: 0.7.0
entries:
  .github/instructions/specflow-specify.instructions.md:
    sha256: fff
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.7.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "copilot");
});
```

- [ ] **Step 3: Add `copilot` entry in `src/infrastructure/fs_project_inspector.ts`**

Find the `expectedFolder` Record literal inside `checkHarness` (currently typed as
`Record<KnownHarness, string>` with 5 entries). Add the `copilot` entry:

```typescript
const expectedFolder: Record<KnownHarness, string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
  windsurf: ".windsurf/",
  copilot: ".github/instructions/",
};
```

(The Record key set must stay synchronized with `KnownHarness` for the type to compile.)

- [ ] **Step 4: Append 2 inspector tests to `tests/infrastructure/fs_project_inspector_test.ts`**

At the end of the file, append:

```typescript
Deno.test("inspect surfaces harness=copilot when lock says copilot and .github/instructions/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".github/instructions"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: copilot
templates_version: 0.7.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("copilot"), true);
    },
  );
});

Deno.test("inspect reports fail for copilot lock when .github/instructions/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: copilot
templates_version: 0.7.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});
```

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/kevin/Sites/specflow
deno task test
```

Expected: `ok | 278 passed | 0 failed` (275 baseline + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/domain/installed_lock.ts \
        src/infrastructure/fs_project_inspector.ts \
        tests/domain/installed_lock_test.ts \
        tests/infrastructure/fs_project_inspector_test.ts \
        src/templates_bundle.ts
git commit -m "feat(domain+check): recognise copilot as a known harness"
```

---

## Task 2: Implement `CopilotHarness`

**Files:**

- Create: `src/infrastructure/harness/copilot_harness.ts`
- Create: `tests/infrastructure/harness/copilot_harness_test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/infrastructure/harness/copilot_harness_test.ts` with EXACTLY:

```typescript
import { assert, assertEquals } from "@std/assert";
import { CopilotHarness } from "../../../src/infrastructure/harness/copilot_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content:
      "---\nname: specify\ndescription: Scaffold feature spec\nmodel: opus\ntools: Read, Write\nmaxTurns: 30\n---\n\n# Body\n\nDo the thing.\n",
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
      "---\nname: product-owner\ndescription: Product Owner role\nmodel: opus\ntools: Read, Write\n---\n\nYou are the PO.\n",
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

Deno.test("CopilotHarness.key and displayName", () => {
  const h = new CopilotHarness();
  assertEquals(h.key, "copilot");
  assertEquals(h.displayName, "GitHub Copilot CLI");
});

Deno.test("CopilotHarness maps commands to .github/instructions/specflow-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".github/instructions/specflow-specify.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps backlog-cmd to .github/instructions/specflow-backlog.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".github/instructions/specflow-backlog.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps skill to .github/instructions/specflow-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".github/instructions/specflow-speckit.instructions.md" in mapped);
});

Deno.test("CopilotHarness maps agents to .github/instructions/specflow-agent-<name>.instructions.md", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".github/instructions/specflow-agent-product-owner.instructions.md" in mapped);
});

Deno.test('CopilotHarness rewrites instruction frontmatter to applyTo: "**" and strips Claude fields', () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  const cmd = mapped[".github/instructions/specflow-specify.instructions.md"];
  assert(cmd, "instruction file not emitted");
  assert(cmd.content.startsWith("---\n"));
  assert(cmd.content.includes('applyTo: "**"'));
  // Claude-specific fields stripped:
  assert(!cmd.content.includes("model: opus"), "model should be stripped");
  assert(!cmd.content.includes("tools:"), "tools should be stripped");
  assert(!cmd.content.includes("maxTurns"), "maxTurns should be stripped");
  // Body preserved:
  assert(cmd.content.includes("Do the thing"), "body should be preserved");
});

Deno.test("CopilotHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CopilotHarness emits no Claude/Cursor/Codex/Gemini/Windsurf artefacts", () => {
  const h = new CopilotHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.some((k) => k.startsWith(".gemini/")), "no .gemini/");
  assert(!keys.some((k) => k.startsWith(".windsurf/")), "no .windsurf/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});
```

- [ ] **Step 2: Run — expect FAIL (file not found)**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/infrastructure/harness/copilot_harness_test.ts
```

Expected: module-not-found error pointing at `copilot_harness.ts`.

- [ ] **Step 3: Implement `src/infrastructure/harness/copilot_harness.ts`**

Create with EXACTLY:

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

- [ ] **Step 4: Run — expect 8 passed**

```bash
deno test tests/infrastructure/harness/copilot_harness_test.ts
```

Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 286 passed | 0 failed` (278 baseline + 8 new).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/harness/copilot_harness.ts \
        tests/infrastructure/harness/copilot_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(harness): CopilotHarness — path-specific instructions with applyTo: ** frontmatter"
```

---

## Task 3: Wire `CopilotHarness` into CLI + parser

**Files:**

- Modify: `src/cli/harnesses.ts`
- Modify: `src/cli/parser.ts`
- Modify: `src/cli/handlers/init_handler.ts`
- Modify: `src/cli/help.ts`
- Modify: `tests/cli/parser_test.ts` (append 1 test)

- [ ] **Step 1: Register the adapter in `src/cli/harnesses.ts`**

OVERWRITE the file with:

```typescript
import type { Harness } from "../application/ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";
import { CodexHarness } from "../infrastructure/harness/codex_harness.ts";
import { GeminiHarness } from "../infrastructure/harness/gemini_harness.ts";
import { WindsurfHarness } from "../infrastructure/harness/windsurf_harness.ts";
import { CopilotHarness } from "../infrastructure/harness/copilot_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
  new GeminiHarness(),
  new WindsurfHarness(),
  new CopilotHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

- [ ] **Step 2: Widen `--ai` in `src/cli/parser.ts`**

In the `Intent` union's `init` variant, find:

```typescript
ai: "claude" | "cursor" | "codex" | "gemini" | "windsurf";
```

Replace with:

```typescript
ai: "claude" | "cursor" | "codex" | "gemini" | "windsurf" | "copilot";
```

Find the validator block:

```typescript
if (
  aiRaw !== "claude" &&
  aiRaw !== "cursor" &&
  aiRaw !== "codex" &&
  aiRaw !== "gemini" &&
  aiRaw !== "windsurf"
) {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

Replace with:

```typescript
if (
  aiRaw !== "claude" &&
  aiRaw !== "cursor" &&
  aiRaw !== "codex" &&
  aiRaw !== "gemini" &&
  aiRaw !== "windsurf" &&
  aiRaw !== "copilot"
) {
  return { kind: "unknown", received: `init --ai ${aiRaw}` };
}
```

- [ ] **Step 3: Widen `InitIntent.ai` in `src/cli/handlers/init_handler.ts`**

Find the `InitIntent` type. Widen its `ai` field from
`"claude" | "cursor" | "codex" | "gemini" | "windsurf"` to
`"claude" | "cursor" | "codex" | "gemini" | "windsurf" | "copilot"`. The handler body itself doesn't
need other changes.

- [ ] **Step 4: Update `src/cli/help.ts`**

Find the `--ai <name>` line. It currently says:

```text
--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf
```

Replace with:

```text
--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf | copilot
```

- [ ] **Step 5: Append a parser test in `tests/cli/parser_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseArgs accepts init --ai copilot", () => {
  const r = parseArgs(["init", "demo", "--ai", "copilot"]);
  if (r.kind === "init") assertEquals(r.ai, "copilot");
});
```

- [ ] **Step 6: Run the full suite**

```bash
cd /Users/kevin/Sites/specflow
deno task test
```

Expected: `ok | 287 passed | 0 failed` (286 baseline + 1 new).

- [ ] **Step 7: Commit**

```bash
git add src/cli/harnesses.ts src/cli/parser.ts src/cli/handlers/init_handler.ts \
        src/cli/help.ts tests/cli/parser_test.ts src/templates_bundle.ts
git commit -m "feat(cli): register Copilot harness — --ai copilot accepted"
```

---

## Task 4: Integration test for `specflow init --ai copilot`

**Files:**

- Create: `tests/integration/init_copilot_test.ts`

- [ ] **Step 1: Write the integration test**

Create with EXACTLY:

```typescript
import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-copilot-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai copilot scaffolds a Copilot layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "copilot"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // Path-specific instruction files for commands, backlog, skill, agents
    assertEquals(
      await exists(join(root, ".github/instructions/specflow-specify.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specflow-backlog.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specflow-speckit.instructions.md")),
      true,
    );
    assertEquals(
      await exists(
        join(root, ".github/instructions/specflow-agent-product-owner.instructions.md"),
      ),
      true,
    );

    // Frontmatter rewritten — applyTo: "**" present, Claude fields stripped
    const cmdContent = await Deno.readTextFile(
      join(root, ".github/instructions/specflow-specify.instructions.md"),
    );
    assertEquals(cmdContent.includes('applyTo: "**"'), true);
    assertEquals(cmdContent.includes("model: opus"), false);
    assertEquals(cmdContent.includes("tools:"), false);

    // Per-directory file count
    const instructionsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".github/instructions")),
    )).length;
    assertEquals(instructionsCount, 20);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);

    // NOT emitted for copilot
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".gemini/")), false);
    assertEquals(await exists(join(root, ".windsurf/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects copilot
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: copilot"), true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
cd /Users/kevin/Sites/specflow
deno test --allow-all tests/integration/init_copilot_test.ts
```

Expected: `ok | 1 passed | 0 failed`.

- [ ] **Step 3: Run the full suite**

```bash
deno task test
```

Expected: `ok | 288 passed | 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init_copilot_test.ts
git commit -m "test(integration): specflow init --ai copilot scaffolds Copilot layout"
```

---

## Wrap-up

At the end of Task 4 the repo has:

- A `CopilotHarness` that emits `.github/instructions/<name>.instructions.md` files with
  `applyTo: "**"` frontmatter, plus the shared `.specflow/` + AGENTS.md.
- `KnownHarness` recognizes `"copilot"`; `specflow check --project` handles Copilot projects
  (canary: `.github/instructions/`).
- `specflow init --ai copilot` parses + scaffolds end-to-end.
- ~288 tests green.

### End-to-end validation

```bash
rm -rf /tmp/sf-copilot && mkdir /tmp/sf-copilot
cd /tmp/sf-copilot
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git --ai copilot
ls demo/.github/instructions/ | head
# expected: 20 files, all *.instructions.md
head -3 demo/.github/instructions/specflow-specify.instructions.md
# expected: ---\napplyTo: "**"\n---
cd demo
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts check --project
# expected: harness = copilot — .github/instructions/ present
cd /Users/kevin/Sites/specflow
rm -rf /tmp/sf-copilot
```

### Release (after merge)

- Squash-merge `feat/copilot-harness` to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.5.0-alpha.3` to `0.6.0-alpha.1`.
- Bump `templates/manifest.json` `version` from `0.6.1` to `0.7.0`; re-run `deno task bundle`.
- Commit, tag `v0.6.0-alpha.1`, push main + tag.
