# Specflow Windsurf harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windsurf as the fifth supported AI harness with verbatim pass-through emission to
`.windsurf/workflows/*.md`.

**Architecture:** New `WindsurfHarness` adapter using the existing `skillFolderName` shared helper.
All four invocable categories (command, backlog-cmd, agent, skill) emit to a single artefact type —
Windsurf workflows. Content ships byte-identical to source: no frontmatter rewrite, no TOML, no
shared-helper extraction needed.

**Tech Stack:** Deno 2 + TypeScript. No new dependencies.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-windsurf-design.md`

---

## File Structure (changes)

```
src/
├── infrastructure/harness/
│   └── windsurf_harness.ts                          CREATE (new adapter)
├── domain/installed_lock.ts                         MODIFY (widen KnownHarness)
├── infrastructure/fs_project_inspector.ts           MODIFY (Record entry for windsurf)
├── cli/harnesses.ts                                 MODIFY (register WindsurfHarness)
├── cli/parser.ts                                    MODIFY (--ai windsurf)
├── cli/help.ts                                      MODIFY (usage text)
└── cli/handlers/init_handler.ts                     MODIFY (widen InitIntent.ai)

tests/
├── infrastructure/harness/windsurf_harness_test.ts  CREATE (~8 tests)
├── infrastructure/fs_project_inspector_test.ts      MODIFY (+2 tests)
├── domain/installed_lock_test.ts                    MODIFY (+1 test)
├── cli/parser_test.ts                               MODIFY (+1 test)
└── integration/init_windsurf_test.ts                CREATE (~1 test)
```

Expected net test count: 259 → 272.

---

## Task 1: Widen `KnownHarness` for windsurf + inspector support

**Files:**

- Modify: `src/domain/installed_lock.ts`
- Modify: `src/infrastructure/fs_project_inspector.ts`
- Modify: `tests/domain/installed_lock_test.ts` (append 1 test)
- Modify: `tests/infrastructure/fs_project_inspector_test.ts` (append 2 tests)

- [ ] **Step 1: Widen `KnownHarness` in `src/domain/installed_lock.ts`**

Find the existing `KnownHarness` + `KNOWN_HARNESSES` declarations and replace with:

```typescript
export type KnownHarness = "claude" | "cursor" | "codex" | "gemini" | "windsurf";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "windsurf",
];
```

- [ ] **Step 2: Append a parseLock test to `tests/domain/installed_lock_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseLock accepts v2 lock with harness=windsurf", () => {
  const v2 = `version: 2
harness: windsurf
templates_version: 0.6.0
entries:
  .windsurf/workflows/specflow-specify.md:
    sha256: eee
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.6.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "windsurf");
});
```

- [ ] **Step 3: Add `windsurf` entry in `src/infrastructure/fs_project_inspector.ts`**

Find the `expectedFolder` Record literal inside `checkHarness`. It currently has:

```typescript
const expectedFolder: Record<"claude" | "cursor" | "codex" | "gemini", string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
};
```

Replace with:

```typescript
const expectedFolder: Record<
  "claude" | "cursor" | "codex" | "gemini" | "windsurf",
  string
> = {
  claude: ".claude/",
  cursor: ".cursor/",
  codex: ".agents/",
  gemini: ".gemini/",
  windsurf: ".windsurf/",
};
```

- [ ] **Step 4: Append 2 inspector tests to `tests/infrastructure/fs_project_inspector_test.ts`**

At the end of the file, append:

```typescript
Deno.test("inspect surfaces harness=windsurf when lock says windsurf and .windsurf/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".windsurf/workflows"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: windsurf
templates_version: 0.6.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.6.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("windsurf"), true);
    },
  );
});

Deno.test("inspect reports fail for windsurf lock when .windsurf/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: windsurf
templates_version: 0.6.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.6.0");
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

Expected: `ok | 262 passed | 0 failed` (259 baseline + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/domain/installed_lock.ts \
        src/infrastructure/fs_project_inspector.ts \
        tests/domain/installed_lock_test.ts \
        tests/infrastructure/fs_project_inspector_test.ts \
        src/templates_bundle.ts
git commit -m "feat(domain+check): recognise windsurf as a known harness"
```

---

## Task 2: Implement `WindsurfHarness`

**Files:**

- Create: `src/infrastructure/harness/windsurf_harness.ts`
- Create: `tests/infrastructure/harness/windsurf_harness_test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/infrastructure/harness/windsurf_harness_test.ts` with EXACTLY:

```typescript
import { assert, assertEquals } from "@std/assert";
import { WindsurfHarness } from "../../../src/infrastructure/harness/windsurf_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: specify\ndescription: Scaffold feature spec\n---\n\n# Body\n",
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
    content: "---\nname: product-owner\ndescription: Product Owner role\n---\n\nYou are the PO.\n",
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

Deno.test("WindsurfHarness.key and displayName", () => {
  const h = new WindsurfHarness();
  assertEquals(h.key, "windsurf");
  assertEquals(h.displayName, "Windsurf");
});

Deno.test("WindsurfHarness maps commands to .windsurf/workflows/specflow-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-specify.md" in mapped);
});

Deno.test("WindsurfHarness maps backlog-cmd to .windsurf/workflows/specflow-backlog.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-backlog.md" in mapped);
});

Deno.test("WindsurfHarness maps skill to .windsurf/workflows/specflow-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-speckit.md" in mapped);
});

Deno.test("WindsurfHarness maps agents to .windsurf/workflows/specflow-agent-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".windsurf/workflows/specflow-agent-product-owner.md" in mapped);
});

Deno.test("WindsurfHarness maps spec-root to .specflow/<suffix> and project-root to <suffix>", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("WindsurfHarness emits content byte-identical to entry.content (no frontmatter rewrite)", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  const cmd = mapped[".windsurf/workflows/specflow-specify.md"];
  assertEquals(cmd.content, SAMPLE[0].content);
  const agent = mapped[".windsurf/workflows/specflow-agent-product-owner.md"];
  assertEquals(agent.content, SAMPLE[3].content);
});

Deno.test("WindsurfHarness emits no Claude/Cursor/Codex/Gemini artefacts", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE);
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.some((k) => k.startsWith(".gemini/")), "no .gemini/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});
```

- [ ] **Step 2: Run — expect FAIL (file not found)**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/infrastructure/harness/windsurf_harness_test.ts
```

Expected: module-not-found error pointing at `windsurf_harness.ts`.

- [ ] **Step 3: Implement `src/infrastructure/harness/windsurf_harness.ts`**

Create with EXACTLY:

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

- [ ] **Step 4: Run — expect 8 passed**

```bash
deno test tests/infrastructure/harness/windsurf_harness_test.ts
```

Expected: `ok | 8 passed | 0 failed`.

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 270 passed | 0 failed` (262 baseline + 8 new).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/harness/windsurf_harness.ts \
        tests/infrastructure/harness/windsurf_harness_test.ts \
        src/templates_bundle.ts
git commit -m "feat(harness): WindsurfHarness — workflows pass-through emission"
```

---

## Task 3: Wire `WindsurfHarness` into CLI + parser

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

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
  new CodexHarness(),
  new GeminiHarness(),
  new WindsurfHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

- [ ] **Step 2: Widen `--ai` in `src/cli/parser.ts`**

In the `Intent` union's `init` variant, find:

```typescript
ai: "claude" | "cursor" | "codex" | "gemini";
```

Replace with:

```typescript
ai: "claude" | "cursor" | "codex" | "gemini" | "windsurf";
```

Find the validator block:

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

Replace with:

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

- [ ] **Step 3: Widen `InitIntent.ai` in `src/cli/handlers/init_handler.ts`**

Find the `InitIntent` type definition. Widen its `ai` field from
`"claude" | "cursor" | "codex" | "gemini"` to
`"claude" | "cursor" | "codex" | "gemini" | "windsurf"`. The handler body itself doesn't need other
changes.

- [ ] **Step 4: Update `src/cli/help.ts`**

Find the `--ai <name>` line in the Flags block. It currently says:

```text
--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini
```

Replace with:

```text
--ai <name>    Target AI harness: claude (default) | cursor | codex | gemini | windsurf
```

- [ ] **Step 5: Append a parser test in `tests/cli/parser_test.ts`**

At the end of the file, append:

```typescript
Deno.test("parseArgs accepts init --ai windsurf", () => {
  const r = parseArgs(["init", "demo", "--ai", "windsurf"]);
  if (r.kind === "init") assertEquals(r.ai, "windsurf");
});
```

- [ ] **Step 6: Run the full suite**

```bash
cd /Users/kevin/Sites/specflow
deno task test
```

Expected: `ok | 271 passed | 0 failed` (270 baseline + 1 new).

- [ ] **Step 7: Commit**

```bash
git add src/cli/harnesses.ts src/cli/parser.ts src/cli/handlers/init_handler.ts \
        src/cli/help.ts tests/cli/parser_test.ts src/templates_bundle.ts
git commit -m "feat(cli): register Windsurf harness — --ai windsurf accepted"
```

---

## Task 4: Integration test for `specflow init --ai windsurf`

**Files:**

- Create: `tests/integration/init_windsurf_test.ts`

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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-windsurf-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai windsurf scaffolds a Windsurf layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "windsurf"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // Workflows for commands, backlog, skill, agents
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow-specify.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow-backlog.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow-speckit.md")),
      true,
    );
    assertEquals(
      await exists(
        join(root, ".windsurf/workflows/specflow-agent-product-owner.md"),
      ),
      true,
    );

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);

    // NOT emitted for windsurf
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".gemini/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects windsurf
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: windsurf"), true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
cd /Users/kevin/Sites/specflow
deno test --allow-all tests/integration/init_windsurf_test.ts
```

Expected: `ok | 1 passed | 0 failed`.

- [ ] **Step 3: Run the full suite**

```bash
deno task test
```

Expected: `ok | 272 passed | 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/init_windsurf_test.ts
git commit -m "test(integration): specflow init --ai windsurf scaffolds Windsurf layout"
```

---

## Wrap-up

At the end of Task 4 the repo has:

- A `WindsurfHarness` that emits `.windsurf/workflows/<name>.md` (verbatim pass-through) plus the
  shared `.specflow/` + AGENTS.md
- `KnownHarness` recognizes `"windsurf"`; `specflow check --project` handles Windsurf projects
  (canary: `.windsurf/`)
- `specflow init --ai windsurf` parses + scaffolds end-to-end
- ~272 tests green

### End-to-end validation

```bash
rm -rf /tmp/sf-windsurf && mkdir /tmp/sf-windsurf
cd /tmp/sf-windsurf
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git --ai windsurf
ls demo/.windsurf/workflows/
# expected: specflow-analyze.md, specflow-backlog.md, ..., specflow-agent-product-owner.md (~20 files)
ls demo/.specflow/
# expected: installed.lock, memory, scripts, templates
cd demo
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts check --project
# expected: harness = windsurf — .windsurf/ present
cd /Users/kevin/Sites/specflow
rm -rf /tmp/sf-windsurf
```

### Release (after merge)

- Squash-merge `feat/windsurf-harness` to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.4.0-alpha.1` to `0.5.0-alpha.1`.
- Bump `templates/manifest.json` `version` from `0.5.0` to `0.6.0`; re-run `deno task bundle`.
- Commit, tag `v0.5.0-alpha.1`, push main + tag.
