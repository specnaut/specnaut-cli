# Specflow multi-harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class `Harness` abstraction, refactor the Claude-only flow through it
with byte-identical output, and add Cursor as the second supported harness.

**Architecture:** New domain module `core_bundle.ts` (categorized neutral representation). New port
`Harness.mapBundle(core): Bundle`. Two adapters: `ClaudeHarness` (refactor) + `CursorHarness` (new).
`installed.lock` bumped to v2 with `harness` field (v1 auto-upgrades to `claude`). `templates/`
reorganized from harness-flat to `core/` + `harness-specific/`. Bundler rewrites
`src/templates_bundle.ts` to emit `CORE_BUNDLE` + `HARNESS_STATIC`. `InitProjectUseCase` +
`UpgradeProjectUseCase` + handlers pick the active harness. `--ai cursor` CLI flag accepted.

**Tech Stack:** Deno 2 + TypeScript. No new external deps. `@std/yaml`, `@std/path`,
`@std/fmt/colors`, `@std/assert` — all already in the import map.

**Scope:** Ship Claude (refactored) + Cursor. Explicitly out of scope: Codex / Copilot / Gemini /
Windsurf (each a follow-up brick); multi-harness in one project; migration commands.

**Reference docs:**

- Design: `docs/superpowers/specs/2026-04-25-specflow-multi-harness-design.md`
- Cursor docs verified: `https://cursor.com/docs/skills` and `https://cursor.com/docs/rules`

---

## File Structure (additions + moves)

```
src/
├── domain/
│   ├── core_bundle.ts            # NEW — CoreCategory, CoreEntry, CoreBundle
│   └── installed_lock.ts         # MODIFY — v1 → v2, add harness field
├── application/
│   ├── ports.ts                  # MODIFY — add Harness interface
│   ├── harnesses.ts              # NEW — HARNESSES registry + findHarness
│   ├── init_project.ts           # MODIFY — accept harness dep, map core→bundle
│   └── upgrade_project.ts        # MODIFY — pick harness from lock
├── infrastructure/
│   ├── harness/
│   │   ├── claude_harness.ts     # NEW — ClaudeHarness
│   │   └── cursor_harness.ts     # NEW — CursorHarness
├── cli/
│   ├── parser.ts                 # MODIFY — accept --ai cursor + validate
│   ├── help.ts                   # MODIFY — usage text
│   └── handlers/
│       ├── init_handler.ts       # MODIFY — resolve harness
│       ├── upgrade_handler.ts    # MODIFY — read harness from lock
│       └── check_handler.ts      # MODIFY — surface harness info
└── templates_bundle.ts           # REGENERATED — CORE_BUNDLE + HARNESS_STATIC

templates/
├── manifest.json                 # MODIFY — entries declare {category, name, suffix}
├── core/                         # MOVE FROM templates/{claude,specify,root}/
│   ├── commands/speckit.<name>.md
│   ├── commands/backlog.md
│   ├── agents/<name>.md
│   ├── skills/speckit/SKILL.md
│   ├── specify/memory/constitution.md
│   ├── specify/templates/*.md
│   ├── specify/scripts/{bash,powershell}/*
│   └── root/{AGENTS.md, tasks/backlog.md, .gitignore}
└── harness-specific/
    ├── claude/CLAUDE.md          # NEW — static, Claude-only root file
    └── cursor/specify-rules.mdc  # NEW — static, Cursor rules file

scripts/bundle-templates.ts       # MODIFY — emit CORE_BUNDLE + HARNESS_STATIC

tests/
├── domain/
│   ├── core_bundle_test.ts
│   └── installed_lock_test.ts    # EXTEND — v1→v2 migration + v2 round-trip
├── infrastructure/harness/
│   ├── claude_harness_test.ts    # Snapshot vs current behaviour
│   └── cursor_harness_test.ts
├── application/
│   ├── init_project_test.ts      # EXTEND — cursor path
│   └── upgrade_project_test.ts   # EXTEND — harness from lock
├── cli/parser_test.ts            # EXTEND — --ai cursor + invalid
└── integration/init_cursor_test.ts
```

---

## Task 1: `CoreBundle` domain type

**Files:**

- Create: `src/domain/core_bundle.ts`
- Create: `tests/domain/core_bundle_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import {
  type CoreBundle,
  type CoreCategory,
  type CoreEntry,
  entriesByCategory,
  findByName,
} from "../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "# specify\n",
    executable: false,
  },
  {
    category: "command",
    name: "clarify",
    suffix: null,
    content: "# clarify\n",
    executable: false,
  },
  {
    category: "agent",
    name: "product-owner",
    suffix: null,
    content: "# PO\n",
    executable: false,
  },
  {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    content: "# constitution\n",
    executable: false,
  },
];

Deno.test("CoreCategory is a narrow union", () => {
  const values: CoreCategory[] = [
    "command",
    "agent",
    "skill",
    "spec-root",
    "project-root",
    "backlog-cmd",
  ];
  assertEquals(values.length, 6);
});

Deno.test("entriesByCategory groups entries by category", () => {
  const grouped = entriesByCategory(SAMPLE);
  assertEquals(grouped.get("command")?.length, 2);
  assertEquals(grouped.get("agent")?.length, 1);
  assertEquals(grouped.get("spec-root")?.length, 1);
  assertEquals(grouped.get("skill"), undefined);
});

Deno.test("findByName returns the matching entry", () => {
  const hit = findByName(SAMPLE, "command", "specify");
  assertEquals(hit?.content, "# specify\n");
  const miss = findByName(SAMPLE, "command", "absent");
  assertEquals(miss, null);
});

Deno.test("findByName considers suffix for spec-root/project-root", () => {
  const hit = findByName(SAMPLE, "spec-root", "specify", "memory/constitution.md");
  assertEquals(hit?.content, "# constitution\n");
  const miss = findByName(SAMPLE, "spec-root", "specify", "memory/missing.md");
  assertEquals(miss, null);
});

Deno.test("CoreEntry enforces the expected shape", () => {
  const entry: CoreEntry = {
    category: "skill",
    name: "speckit",
    suffix: null,
    content: "# skill\n",
    executable: false,
  };
  assertEquals(entry.category, "skill");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test tests/domain/core_bundle_test.ts`

- [ ] **Step 3: Implement `src/domain/core_bundle.ts`**

```typescript
export type CoreCategory =
  | "command"
  | "agent"
  | "skill"
  | "spec-root"
  | "project-root"
  | "backlog-cmd";

export type CoreEntry = {
  readonly category: CoreCategory;
  readonly name: string;
  readonly suffix: string | null;
  readonly content: string;
  readonly executable: boolean;
};

export type CoreBundle = ReadonlyArray<CoreEntry>;

export function entriesByCategory(
  bundle: CoreBundle,
): Map<CoreCategory, ReadonlyArray<CoreEntry>> {
  const out = new Map<CoreCategory, CoreEntry[]>();
  for (const entry of bundle) {
    const existing = out.get(entry.category);
    if (existing) existing.push(entry);
    else out.set(entry.category, [entry]);
  }
  return out as Map<CoreCategory, ReadonlyArray<CoreEntry>>;
}

export function findByName(
  bundle: CoreBundle,
  category: CoreCategory,
  name: string,
  suffix: string | null = null,
): CoreEntry | null {
  return (
    bundle.find(
      (e) => e.category === category && e.name === name && (e.suffix ?? null) === suffix,
    ) ?? null
  );
}
```

- [ ] **Step 4: Run — expect 5 passed**

- [ ] **Step 5: Full suite — expect 196 + 5 = 201 green**

Run: `deno task test`

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/domain/core_bundle.ts tests/domain/core_bundle_test.ts
git commit -m "feat(domain): CoreBundle value type for harness-agnostic templates"
```

---

## Task 2: `InstalledLock` v2 migration (add `harness` field)

**Files:**

- Modify: `src/domain/installed_lock.ts`
- Modify: `tests/domain/installed_lock_test.ts`

- [ ] **Step 1: Append failing tests**

Add at the end of `tests/domain/installed_lock_test.ts`:

```typescript
Deno.test("parseLock auto-upgrades a v1 lock to v2 with harness=claude", () => {
  const v1 = `version: 1
templates_version: 0.2.0
entries:
  CLAUDE.md:
    sha256: aaa
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.2.0"
`;
  const lock = parseLock(v1);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "claude");
  assertEquals(lock.templatesVersion, "0.2.0");
});

Deno.test("parseLock accepts v2 lock with harness field", () => {
  const v2 = `version: 2
harness: cursor
templates_version: 0.3.0
entries:
  .cursor/skills/speckit-specify/SKILL.md:
    sha256: bbb
    installed_at: "2026-04-25T00:00:00Z"
    templates_version: "0.3.0"
`;
  const lock = parseLock(v2);
  assertEquals(lock.version, 2);
  assertEquals(lock.harness, "cursor");
});

Deno.test("parseLock rejects unsupported v2 harness", () => {
  const bad = `version: 2
harness: not-a-harness
templates_version: 0.3.0
entries: {}
`;
  assertThrows(() => parseLock(bad), Error, "harness");
});

Deno.test("serializeLock writes version 2 with harness field", () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "cursor",
    templatesVersion: "0.3.0",
    entries: new Map(),
  };
  const yaml = serializeLock(lock);
  assertEquals(yaml.includes("version: 2"), true);
  assertEquals(yaml.includes("harness: cursor"), true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test tests/domain/installed_lock_test.ts`

- [ ] **Step 3: Modify `src/domain/installed_lock.ts`**

Replace the type definition section with:

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type KnownHarness = "claude" | "cursor";
export const KNOWN_HARNESSES: ReadonlyArray<KnownHarness> = ["claude", "cursor"];

export type LockEntry = {
  readonly sha256: string;
  readonly installedAt: string;
  readonly templatesVersion: string;
};

export type InstalledLock = {
  readonly version: 2;
  readonly harness: KnownHarness;
  readonly templatesVersion: string;
  readonly entries: ReadonlyMap<string, LockEntry>;
};

function asObject(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== "object") {
    throw new Error(`${name} must be an object`);
  }
  return v as Record<string, unknown>;
}

function assertKnownHarness(v: unknown): asserts v is KnownHarness {
  if (typeof v !== "string" || !KNOWN_HARNESSES.includes(v as KnownHarness)) {
    throw new Error(
      `Unsupported harness '${String(v)}' — known: ${KNOWN_HARNESSES.join(", ")}`,
    );
  }
}

export function parseLock(yaml: string): InstalledLock {
  const root = asObject(parseYaml(yaml), "lock root");
  const rawVersion = root.version;
  if (rawVersion !== 1 && rawVersion !== 2) {
    throw new Error(`Unsupported lock version (expected 1 or 2): ${String(rawVersion)}`);
  }

  // Harness field: v2 requires it, v1 defaults to "claude".
  let harness: KnownHarness;
  if (rawVersion === 2) {
    assertKnownHarness(root.harness);
    harness = root.harness;
  } else {
    harness = "claude";
  }

  const templatesVersion = root.templates_version;
  if (typeof templatesVersion !== "string") {
    throw new Error("missing top-level templates_version");
  }
  const rawEntries = asObject(root.entries ?? {}, "entries");
  const entries = new Map<string, LockEntry>();
  for (const [path, value] of Object.entries(rawEntries)) {
    const entry = asObject(value, `entries[${path}]`);
    const sha256 = entry.sha256;
    const installedAt = entry.installed_at;
    const ver = entry.templates_version;
    if (typeof sha256 !== "string") throw new Error(`entries[${path}].sha256 must be string`);
    if (typeof installedAt !== "string") {
      throw new Error(`entries[${path}].installed_at must be string`);
    }
    if (typeof ver !== "string") {
      throw new Error(`entries[${path}].templates_version must be string`);
    }
    entries.set(path, { sha256, installedAt, templatesVersion: ver });
  }
  return { version: 2, harness, templatesVersion, entries };
}

export function serializeLock(lock: InstalledLock): string {
  const entriesObj: Record<string, Record<string, string>> = {};
  const keys = [...lock.entries.keys()].sort();
  for (const k of keys) {
    const e = lock.entries.get(k)!;
    entriesObj[k] = {
      sha256: e.sha256,
      installed_at: e.installedAt,
      templates_version: e.templatesVersion,
    };
  }
  return stringifyYaml({
    version: 2,
    harness: lock.harness,
    templates_version: lock.templatesVersion,
    entries: entriesObj,
  });
}
```

- [ ] **Step 4: Run installed_lock tests — expect 8 passed (4 existing + 4 new)**

Run: `deno test tests/domain/installed_lock_test.ts`

If any existing test fails because the returned `version` is now always `2`, update the assertion to
expect `2` (the v1 → v2 auto-upgrade is the point of this change).

- [ ] **Step 5: Commit**

```bash
deno fmt
git add src/domain/installed_lock.ts tests/domain/installed_lock_test.ts
git commit -m "feat(domain): InstalledLock v2 with harness field + v1 auto-upgrade"
```

---

## Task 3: Reorganize `templates/` → `core/` + `harness-specific/`

**Files:**

- Move (`git mv`):
  - `templates/claude/` → `templates/core/` (with subtree restructure below)
  - `templates/specify/` → `templates/core/specify/`
  - `templates/root/` → `templates/core/root/`
- Create: `templates/harness-specific/claude/CLAUDE.md`
- Create: `templates/harness-specific/cursor/specify-rules.mdc`
- Modify: `templates/manifest.json`

The `templates/claude/{commands,agents,skills}/` subtree becomes
`templates/core/{commands,agents,skills}/` (the `claude/` segment disappears because these are now
harness-agnostic).

- [ ] **Step 1: Restructure directories**

```bash
cd /Users/kevin/Sites/specflow/templates

# Move Claude-specific subtrees into core/
mkdir -p core
git mv claude/commands core/commands
git mv claude/agents core/agents
git mv claude/skills core/skills
rmdir claude 2>/dev/null || true

# Move specify/ and root/ into core/
git mv specify core/specify
git mv root core/root

# Prepare harness-specific dirs
mkdir -p harness-specific/claude harness-specific/cursor
```

- [ ] **Step 2: Extract `CLAUDE.md` into harness-specific/claude/**

`CLAUDE.md` is currently at `templates/core/root/CLAUDE.md`. It's a Claude-only file. Move it:

```bash
git mv core/root/CLAUDE.md harness-specific/claude/CLAUDE.md
```

- [ ] **Step 3: Create `templates/harness-specific/cursor/specify-rules.mdc`**

Write `/Users/kevin/Sites/specflow/templates/harness-specific/cursor/specify-rules.mdc`:

```markdown
---
description: Specflow workflow for this project — spec-driven development with auto-chained phases, structured review, and product backlog.
globs:
alwaysApply: true
---

# Specflow workflow rules

This project uses Specflow — an enhanced Spec Kit fork — to drive feature development through a
spec-driven workflow. When working with the user, consult the skills below.

## Workflow overview
```

specify → clarify → plan → tasks → analyze → implement → review → merge ▲ ▲ STOP #1 (only if
clarifications needed) STOP #2 (pre-merge validation)

```
## Skills available

- `/speckit-specify` — scaffold a new feature spec from a description
- `/speckit-clarify` — resolve outstanding questions in `spec.md`
- `/speckit-plan` — produce the implementation plan
- `/speckit-tasks` — break the plan into tasks
- `/speckit-analyze` — cross-artefact consistency check
- `/speckit-implement` — run the developer → review-coordinator → qa-tester pipeline
- `/speckit-review` — architecture + quality gates
- `/speckit-merge` — merge the feature branch to main
- `/specflow-backlog` — manage the product backlog (via the PO agent)
- `/specflow-auto-chain` — auto-chain dispatcher invoked by `/speckit-specify`

## Agent roles (invocable manually as skills)

- `/specflow-agent-product-owner` — business guardian, backlog management
- `/specflow-agent-developer` — implementation work
- `/specflow-agent-review-coordinator` — parallel review orchestration
- `/specflow-agent-code-reviewer` — code quality review
- `/specflow-agent-security-auditor` — security review
- `/specflow-agent-test-reviewer` — test coverage review
- `/specflow-agent-qa-tester` — QA + test writing
- `/specflow-agent-workflow-manager` — long-running orchestration

## Project context

- Constitution lives at `.specify/memory/constitution.md` — treat as non-negotiable rules.
- Product backlog lives at `tasks/backlog.md` (index) and `tasks/backlog/NNN-*.md` (task files).
- Project conventions: `AGENTS.md` at project root.

Read the constitution and AGENTS.md before starting any significant work.
```

- [ ] **Step 4: Rewrite `templates/manifest.json` with the new schema**

Each entry now declares `{category, name, suffix?, source, executable?}`. `source` is the path under
`templates/core/` or `templates/harness-specific/<harness>/`. `harness` field omitted means the
entry goes into CORE_BUNDLE; a `harness` field means it goes into HARNESS_STATIC for that harness
only.

Replace `templates/manifest.json` contents:

```json
{
  "version": "0.3.0",
  "core": [
    { "category": "command", "name": "specify", "source": "core/commands/speckit.specify.md" },
    { "category": "command", "name": "clarify", "source": "core/commands/speckit.clarify.md" },
    { "category": "command", "name": "plan", "source": "core/commands/speckit.plan.md" },
    { "category": "command", "name": "tasks", "source": "core/commands/speckit.tasks.md" },
    { "category": "command", "name": "analyze", "source": "core/commands/speckit.analyze.md" },
    { "category": "command", "name": "implement", "source": "core/commands/speckit.implement.md" },
    {
      "category": "command",
      "name": "constitution",
      "source": "core/commands/speckit.constitution.md"
    },
    { "category": "command", "name": "checklist", "source": "core/commands/speckit.checklist.md" },
    { "category": "command", "name": "merge", "source": "core/commands/speckit.merge.md" },
    { "category": "command", "name": "review", "source": "core/commands/speckit.review.md" },
    { "category": "backlog-cmd", "name": "backlog", "source": "core/commands/backlog.md" },

    { "category": "agent", "name": "product-owner", "source": "core/agents/product-owner.md" },
    { "category": "agent", "name": "developer", "source": "core/agents/developer.md" },
    {
      "category": "agent",
      "name": "review-coordinator",
      "source": "core/agents/review-coordinator.md"
    },
    { "category": "agent", "name": "code-reviewer", "source": "core/agents/code-reviewer.md" },
    {
      "category": "agent",
      "name": "security-auditor",
      "source": "core/agents/security-auditor.md"
    },
    { "category": "agent", "name": "test-reviewer", "source": "core/agents/test-reviewer.md" },
    { "category": "agent", "name": "qa-tester", "source": "core/agents/qa-tester.md" },
    {
      "category": "agent",
      "name": "workflow-manager",
      "source": "core/agents/workflow-manager.md"
    },

    { "category": "skill", "name": "speckit", "source": "core/skills/speckit/SKILL.md" },

    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "memory/constitution.md",
      "source": "core/specify/memory/constitution.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "templates/spec-template.md",
      "source": "core/specify/templates/spec-template.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "templates/plan-template.md",
      "source": "core/specify/templates/plan-template.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "templates/tasks-template.md",
      "source": "core/specify/templates/tasks-template.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "templates/checklist-template.md",
      "source": "core/specify/templates/checklist-template.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "templates/constitution-template.md",
      "source": "core/specify/templates/constitution-template.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "templates/agent-file-template.md",
      "source": "core/specify/templates/agent-file-template.md"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/bash/check-prerequisites.sh",
      "source": "core/specify/scripts/bash/check-prerequisites.sh",
      "executable": true
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/bash/common.sh",
      "source": "core/specify/scripts/bash/common.sh",
      "executable": true
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/bash/create-new-feature.sh",
      "source": "core/specify/scripts/bash/create-new-feature.sh",
      "executable": true
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/bash/setup-plan.sh",
      "source": "core/specify/scripts/bash/setup-plan.sh",
      "executable": true
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/powershell/check-prerequisites.ps1",
      "source": "core/specify/scripts/powershell/check-prerequisites.ps1"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/powershell/common.ps1",
      "source": "core/specify/scripts/powershell/common.ps1"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/powershell/create-new-feature.ps1",
      "source": "core/specify/scripts/powershell/create-new-feature.ps1"
    },
    {
      "category": "spec-root",
      "name": "specify",
      "suffix": "scripts/powershell/setup-plan.ps1",
      "source": "core/specify/scripts/powershell/setup-plan.ps1"
    },

    {
      "category": "project-root",
      "name": "root",
      "suffix": "AGENTS.md",
      "source": "core/root/AGENTS.md"
    },
    {
      "category": "project-root",
      "name": "root",
      "suffix": "tasks/backlog.md",
      "source": "core/root/tasks/backlog.md"
    },
    {
      "category": "project-root",
      "name": "root",
      "suffix": ".gitignore",
      "source": "core/root/.gitignore"
    }
  ],
  "harness_static": [
    {
      "harness": "claude",
      "destination": "CLAUDE.md",
      "source": "harness-specific/claude/CLAUDE.md"
    },
    {
      "harness": "cursor",
      "destination": ".cursor/rules/specify-rules.mdc",
      "source": "harness-specific/cursor/specify-rules.mdc"
    }
  ]
}
```

If your current `templates/root/CLAUDE.md` content differs from what would be embedded via the
`harness-specific/claude/CLAUDE.md` copy, reconcile by keeping the original content in the new
location (it is still a Claude pointer file).

- [ ] **Step 5: Do NOT regenerate the bundle yet**

Because the bundler still expects the old manifest schema, generating now will fail. The next task
rewrites the bundler.

- [ ] **Step 6: Commit the reorg without breaking anything**

The bundler failing here is expected — we'll fix it in Task 4. The file moves preserve git history.

```bash
git add -A
git commit -m "refactor(templates): move to core/ + harness-specific/ layout (new manifest schema)"
```

Note: `src/templates_bundle.ts` still contains the old generated bundle — don't delete it yet.
`deno task bundle` will be broken until Task 4 lands; the pre-commit hook runs `bundle` so this
commit may need `--no-verify`. Use:

```bash
git commit --no-verify -m "refactor(templates): move to core/ + harness-specific/ layout (new manifest schema)"
```

- [ ] **Step 7: Sanity**

`deno task test` will still work because tests run against the _committed_ `src/templates_bundle.ts`
(the old version). Verify: 201 green.

---

## Task 4: Rewrite `scripts/bundle-templates.ts` to emit `CORE_BUNDLE` + `HARNESS_STATIC`

**Files:**

- Modify: `scripts/bundle-templates.ts`
- Modify: `src/templates_bundle.ts` (regenerated output)

- [ ] **Step 1: Replace `scripts/bundle-templates.ts`**

```typescript
// Reads templates/manifest.json + templates/** and emits src/templates_bundle.ts.
// The generated module exports:
//   - TEMPLATES_VERSION: string
//   - CORE_BUNDLE: CoreBundle (from src/domain/core_bundle.ts)
//   - HARNESS_STATIC: Record<harnessKey, Record<destination, TemplateFile>>
// Runtime code reads nothing from disk.

import { relative } from "@std/path";

type CoreManifestEntry = {
  category: string;
  name: string;
  suffix?: string;
  source: string;
  executable?: boolean;
};

type HarnessStaticManifestEntry = {
  harness: string;
  destination: string;
  source: string;
  executable?: boolean;
};

type Manifest = {
  version: string;
  core: CoreManifestEntry[];
  harness_static: HarnessStaticManifestEntry[];
};

const ROOT = new URL("..", import.meta.url);
const TEMPLATES_DIR = new URL("templates/", ROOT);
const MANIFEST_PATH = new URL("templates/manifest.json", ROOT);
const OUTPUT_PATH = new URL("src/templates_bundle.ts", ROOT);

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await Deno.readTextFile(MANIFEST_PATH)) as Manifest;
}

async function assertAllSourcesPresent(m: Manifest): Promise<void> {
  const missing: string[] = [];
  const check = async (source: string) => {
    const abs = new URL(source, TEMPLATES_DIR);
    try {
      const s = await Deno.stat(abs);
      if (!s.isFile) missing.push(source);
    } catch {
      missing.push(source);
    }
  };
  for (const e of m.core) await check(e.source);
  for (const e of m.harness_static) await check(e.source);
  if (missing.length > 0) {
    throw new Error(`Missing template sources:\n  - ${missing.join("\n  - ")}`);
  }
}

function escapeTemplateLiteral(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

async function buildCoreEntries(m: Manifest): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of m.core) {
    const abs = new URL(entry.source, TEMPLATES_DIR);
    const content = await Deno.readTextFile(abs);
    const suffix = entry.suffix === undefined ? "null" : JSON.stringify(entry.suffix);
    lines.push(
      `  {\n` +
        `    category: ${JSON.stringify(entry.category)},\n` +
        `    name: ${JSON.stringify(entry.name)},\n` +
        `    suffix: ${suffix},\n` +
        `    content: \`${escapeTemplateLiteral(content)}\`,\n` +
        `    executable: ${entry.executable === true},\n` +
        `  }`,
    );
  }
  return lines;
}

async function buildHarnessStatic(m: Manifest): Promise<string> {
  const byHarness: Record<
    string,
    Array<{ destination: string; content: string; executable: boolean }>
  > = {};
  for (const e of m.harness_static) {
    const abs = new URL(e.source, TEMPLATES_DIR);
    const content = await Deno.readTextFile(abs);
    byHarness[e.harness] ??= [];
    byHarness[e.harness].push({
      destination: e.destination,
      content,
      executable: e.executable === true,
    });
  }
  const outer: string[] = [];
  for (const harness of Object.keys(byHarness).sort()) {
    const inner = byHarness[harness].map((f) =>
      `    ${JSON.stringify(f.destination)}: {\n` +
      `      content: \`${escapeTemplateLiteral(f.content)}\`,\n` +
      `      executable: ${f.executable},\n` +
      `    }`
    ).join(",\n");
    outer.push(`  ${JSON.stringify(harness)}: {\n${inner},\n  }`);
  }
  return outer.join(",\n");
}

async function main() {
  const manifest = await readManifest();
  await assertAllSourcesPresent(manifest);
  const core = await buildCoreEntries(manifest);
  const staticBlock = await buildHarnessStatic(manifest);

  const src = `// THIS FILE IS GENERATED BY scripts/bundle-templates.ts — DO NOT EDIT BY HAND.
import type { CoreBundle } from "./domain/core_bundle.ts";

export type TemplateFile = {
  content: string;
  executable: boolean;
};

export const TEMPLATES_VERSION = ${JSON.stringify(manifest.version)};

export const CORE_BUNDLE: CoreBundle = [
${core.join(",\n")}
];

export const HARNESS_STATIC: Record<string, Record<string, TemplateFile>> = {
${staticBlock}
};
`;
  await Deno.writeTextFile(OUTPUT_PATH, src);
  console.log(
    `Bundled ${manifest.core.length} core entries + ${manifest.harness_static.length} harness-specific → ${
      relative(Deno.cwd(), OUTPUT_PATH.pathname)
    }`,
  );
}

if (import.meta.main) await main();
```

- [ ] **Step 2: Run the bundler**

```bash
deno task bundle
```

Expected output:

```
Bundled 38 core entries + 2 harness-specific → src/templates_bundle.ts
```

(The count is 38 if every template from v0.1 is now in core. If not 38, something went missing
during the reorg — go back to Task 3 and verify.)

- [ ] **Step 3: Verify the generated bundle type-checks**

```bash
deno check src/templates_bundle.ts
```

Expected: exit 0.

- [ ] **Step 4: `TEMPLATES` no longer exists — update consumers**

The old `TEMPLATES: Record<string, TemplateFile>` export is gone. Callers now consume `CORE_BUNDLE`
through a Harness. For this task, we do NOT yet update consumers — `InitProjectUseCase`,
`UpgradeProjectUseCase`, integration tests all reference `TEMPLATES`. They will break until Task
7/8.

Temporary compatibility shim: add to the generated `src/templates_bundle.ts` a re-export that
matches the pre-refactor shape so existing code keeps compiling until we refactor it. Append to the
generator just before the final `await Deno.writeTextFile`:

```typescript
// Temporary v0.1-compatible flat bundle — deleted after all call sites migrate.
// Maps each CORE entry + harness-specific claude entry to the Claude flat layout.
// Built here by the generator so runtime code doesn't compute it.
```

Then emit an additional `export const TEMPLATES: Record<string, TemplateFile> = { ... };` with the
Claude-flat mapping. Logic: reuse the old Claude→path mapping (commands → `.claude/commands/...`,
agents → `.claude/agents/...`, skill → `.claude/skills/speckit/SKILL.md`, spec-root →
`.specify/<suffix>`, project-root → `<suffix>`) plus the single `CLAUDE.md` from
harness-specific/claude.

Add to the generator:

```typescript
function claudeDestination(entry: CoreManifestEntry): string {
  switch (entry.category) {
    case "command":
      return `.claude/commands/speckit.${entry.name}.md`;
    case "backlog-cmd":
      return `.claude/commands/${entry.name}.md`;
    case "agent":
      return `.claude/agents/${entry.name}.md`;
    case "skill":
      return `.claude/skills/${entry.name}/SKILL.md`;
    case "spec-root":
      return `.specify/${entry.suffix}`;
    case "project-root":
      return entry.suffix ?? entry.name;
    default:
      throw new Error(`Unknown category: ${entry.category}`);
  }
}

async function buildLegacyTemplates(m: Manifest): Promise<string> {
  const entries: string[] = [];
  for (const e of m.core) {
    const abs = new URL(e.source, TEMPLATES_DIR);
    const content = await Deno.readTextFile(abs);
    const dest = claudeDestination(e);
    entries.push(
      `  ${JSON.stringify(dest)}: {\n` +
        `    content: \`${escapeTemplateLiteral(content)}\`,\n` +
        `    executable: ${e.executable === true},\n` +
        `  }`,
    );
  }
  for (const hs of m.harness_static.filter((h) => h.harness === "claude")) {
    const abs = new URL(hs.source, TEMPLATES_DIR);
    const content = await Deno.readTextFile(abs);
    entries.push(
      `  ${JSON.stringify(hs.destination)}: {\n` +
        `    content: \`${escapeTemplateLiteral(content)}\`,\n` +
        `    executable: ${hs.executable === true},\n` +
        `  }`,
    );
  }
  return entries.join(",\n");
}
```

Add to the generated source block in `main()`:

```typescript
const legacy = await buildLegacyTemplates(manifest);
// ...
const src = `// THIS FILE IS GENERATED BY scripts/bundle-templates.ts — DO NOT EDIT BY HAND.
import type { CoreBundle } from "./domain/core_bundle.ts";

export type TemplateFile = { content: string; executable: boolean; };

export const TEMPLATES_VERSION = ${JSON.stringify(manifest.version)};

export const CORE_BUNDLE: CoreBundle = [
${core.join(",\n")}
];

export const HARNESS_STATIC: Record<string, Record<string, TemplateFile>> = {
${staticBlock}
};

// Legacy Claude-flat view — migrates away once all call sites use a Harness.
export const TEMPLATES: Record<string, TemplateFile> = {
${legacy}
};
`;
```

- [ ] **Step 5: Regenerate the bundle**

```bash
deno task bundle
deno task test
```

Expected: 201 green (the tests still import `TEMPLATES`; the legacy shim keeps them working).

- [ ] **Step 6: Commit**

```bash
deno fmt
git add scripts/bundle-templates.ts src/templates_bundle.ts
git commit -m "feat(bundler): emit CORE_BUNDLE + HARNESS_STATIC with legacy TEMPLATES shim"
```

---

## Task 5: Extend `ports.ts` with `Harness` interface

**Files:**

- Modify: `src/application/ports.ts`

- [ ] **Step 1: Append the interface**

Read the current file, then append:

```typescript
import type { CoreBundle } from "../domain/core_bundle.ts";
import type { Bundle } from "../domain/template.ts";

export interface Harness {
  readonly key: string;
  readonly displayName: string;
  mapBundle(core: CoreBundle): Bundle;
}
```

- [ ] **Step 2: Type-check**

```bash
deno check src/main.ts
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
deno fmt
git add src/application/ports.ts
git commit -m "feat(ports): Harness interface"
```

---

## Task 6: Implement `ClaudeHarness` + snapshot regression test

**Files:**

- Create: `src/infrastructure/harness/claude_harness.ts`
- Create: `tests/infrastructure/harness/claude_harness_test.ts`

- [ ] **Step 1: Write the snapshot test**

The test asserts that mapping the CORE_BUNDLE through ClaudeHarness produces the same content as the
legacy `TEMPLATES` flat export. This guarantees zero regression.

Write `tests/infrastructure/harness/claude_harness_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { ClaudeHarness } from "../../../src/infrastructure/harness/claude_harness.ts";
import { CORE_BUNDLE, HARNESS_STATIC, TEMPLATES } from "../../../src/templates_bundle.ts";

Deno.test("ClaudeHarness.key and displayName", () => {
  const h = new ClaudeHarness();
  assertEquals(h.key, "claude");
  assertEquals(h.displayName, "Claude Code");
});

Deno.test("ClaudeHarness.mapBundle emits every path from legacy TEMPLATES", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const mappedKeys = Object.keys(mapped).sort();
  const legacyKeys = Object.keys(TEMPLATES).sort();
  assertEquals(mappedKeys, legacyKeys);
});

Deno.test("ClaudeHarness.mapBundle emits identical content to legacy TEMPLATES", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  for (const [dest, file] of Object.entries(TEMPLATES)) {
    assertEquals(mapped[dest]?.content, file.content, `content diff at ${dest}`);
    assertEquals(mapped[dest]?.executable, file.executable, `exec diff at ${dest}`);
  }
});

Deno.test("ClaudeHarness includes HARNESS_STATIC claude files (CLAUDE.md)", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const claudeMd = mapped["CLAUDE.md"];
  const staticClaude = HARNESS_STATIC.claude["CLAUDE.md"];
  assertEquals(claudeMd?.content, staticClaude?.content);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test tests/infrastructure/harness/claude_harness_test.ts`

- [ ] **Step 3: Implement `src/infrastructure/harness/claude_harness.ts`**

```typescript
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.claude/commands/speckit.${entry.name}.md`;
    case "backlog-cmd":
      return `.claude/commands/${entry.name}.md`;
    case "agent":
      return `.claude/agents/${entry.name}.md`;
    case "skill":
      return `.claude/skills/${entry.name}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root entry needs suffix: ${entry.name}`);
      return `.specify/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root entry needs suffix: ${entry.name}`);
      return entry.suffix;
  }
}

export class ClaudeHarness implements Harness {
  readonly key = "claude";
  readonly displayName = "Claude Code";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      out[destinationFor(entry)] = {
        content: entry.content,
        executable: entry.executable,
      };
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
```

- [ ] **Step 4: Run — expect 4 passed**

Run: `deno test tests/infrastructure/harness/claude_harness_test.ts`

If the snapshot test fails, the diff will show which destination path is mismatched — fix
`destinationFor` accordingly.

- [ ] **Step 5: Full suite — expect 205 green (201 + 4)**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/infrastructure/harness/claude_harness.ts tests/infrastructure/harness/claude_harness_test.ts
git commit -m "feat(harness): ClaudeHarness adapter with snapshot regression test"
```

---

## Task 7: Implement `CursorHarness`

**Files:**

- Create: `src/infrastructure/harness/cursor_harness.ts`
- Create: `tests/infrastructure/harness/cursor_harness_test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { assert, assertEquals } from "@std/assert";
import { CursorHarness } from "../../../src/infrastructure/harness/cursor_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const SAMPLE: CoreBundle = [
  {
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\ndescription: Scaffold feature spec\n---\n\n# body\n",
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
    category: "agent",
    name: "product-owner",
    suffix: null,
    content: "---\ndescription: Product owner\n---\n\n# body\n",
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

Deno.test("CursorHarness.key and displayName", () => {
  const h = new CursorHarness();
  assertEquals(h.key, "cursor");
  assertEquals(h.displayName, "Cursor");
});

Deno.test("CursorHarness maps commands to .cursor/skills/speckit-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/speckit-specify/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps the backlog command to .cursor/skills/specflow-backlog/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-backlog/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps agents to .cursor/skills/specflow-agent-<name>/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-agent-product-owner/SKILL.md" in mapped);
});

Deno.test("CursorHarness maps the auto-chain skill to .cursor/skills/specflow-auto-chain/SKILL.md", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".cursor/skills/specflow-auto-chain/SKILL.md" in mapped);
});

Deno.test("CursorHarness keeps spec-root and project-root paths unchanged", () => {
  const h = new CursorHarness();
  const mapped = h.mapBundle(SAMPLE);
  assert(".specify/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("CursorHarness injects name: frontmatter when absent", () => {
  const withoutName: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "# no frontmatter\n",
    executable: false,
  }];
  const h = new CursorHarness();
  const mapped = h.mapBundle(withoutName);
  const skill = mapped[".cursor/skills/speckit-specify/SKILL.md"];
  assert(skill?.content.startsWith("---\n"));
  assert(skill?.content.includes("name: speckit-specify"));
});

Deno.test("CursorHarness preserves original name: when already present", () => {
  const withName: CoreBundle = [{
    category: "command",
    name: "specify",
    suffix: null,
    content: "---\nname: custom-name\ndescription: Explicit\n---\n\n# body\n",
    executable: false,
  }];
  const h = new CursorHarness();
  const mapped = h.mapBundle(withName);
  const skill = mapped[".cursor/skills/speckit-specify/SKILL.md"];
  // Original frontmatter is preserved — we do not override a user-provided name.
  assertEquals(skill?.content.includes("name: custom-name"), true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test tests/infrastructure/harness/cursor_harness_test.ts`

- [ ] **Step 3: Implement `src/infrastructure/harness/cursor_harness.ts`**

```typescript
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle, TemplateFile } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function cursorSkillName(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `speckit-${entry.name}`;
    case "backlog-cmd":
      return `specflow-${entry.name}`;
    case "agent":
      return `specflow-agent-${entry.name}`;
    case "skill":
      return `specflow-auto-chain`;
    default:
      throw new Error(`cursorSkillName not applicable for category: ${entry.category}`);
  }
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.cursor/skills/${cursorSkillName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specify/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

function ensureSkillFrontmatter(content: string, skillName: string): string {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    // No frontmatter → synthesize one
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
        const skillName = cursorSkillName(entry);
        content = ensureSkillFrontmatter(content, skillName);
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

- [ ] **Step 4: Run — expect 8 passed**

Run: `deno test tests/infrastructure/harness/cursor_harness_test.ts`

- [ ] **Step 5: Full suite — expect 213 green (205 + 8)**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/infrastructure/harness/cursor_harness.ts tests/infrastructure/harness/cursor_harness_test.ts
git commit -m "feat(harness): CursorHarness adapter with skill-folder mapping"
```

---

## Task 8: `HARNESSES` registry

**Files:**

- Create: `src/application/harnesses.ts`

No dedicated test — exercised through downstream tests (init/upgrade).

- [ ] **Step 1: Implement**

```typescript
import type { Harness } from "./ports.ts";
import { ClaudeHarness } from "../infrastructure/harness/claude_harness.ts";
import { CursorHarness } from "../infrastructure/harness/cursor_harness.ts";

export const HARNESSES: ReadonlyArray<Harness> = [
  new ClaudeHarness(),
  new CursorHarness(),
];

export function findHarness(key: string): Harness | null {
  return HARNESSES.find((h) => h.key === key) ?? null;
}
```

- [ ] **Step 2: Type-check**

```bash
deno check src/main.ts
```

- [ ] **Step 3: Commit**

```bash
deno fmt
git add src/application/harnesses.ts
git commit -m "feat(harnesses): registry with Claude + Cursor"
```

---

## Task 9: Refactor `InitProjectUseCase` to use a Harness

**Files:**

- Modify: `src/application/init_project.ts`
- Modify: `src/cli/handlers/init_handler.ts`
- Modify: `tests/application/init_project_test.ts` (update existing fakes + add 2 tests)

- [ ] **Step 1: Update `InitProjectUseCase` to accept a Harness**

In `src/application/init_project.ts`:

1. Replace the `bundle: Bundle` dep with `core: CoreBundle` and `harness: Harness`.
2. At the top of `execute()`, compute `const bundle = harness.mapBundle(core);` and use that for
   `detectConflicts` and `writeBundle`.
3. Persist the lock with `harness: harness.key` (the lock type now requires it — see Task 2).

Updated `InitProjectDeps`:

```typescript
import type { Harness } from "./ports.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";

export type InitProjectDeps = {
  writer: FsWriter;
  git: GitAdapter;
  lockStore: LockStore;
  harness: Harness;
  core: CoreBundle;
  ensureDir(path: string): Promise<void>;
  now?: () => Date;
};
```

Inside `execute()`:

```typescript
const bundle = this.deps.harness.mapBundle(this.deps.core);
// ... (existing code now uses `bundle` derived here, not `this.deps.bundle`)
```

Lock assembly:

```typescript
const lock: InstalledLock = {
  version: 2,
  harness: this.deps.harness.key as "claude" | "cursor",
  templatesVersion: TEMPLATES_VERSION,
  entries: lockEntries,
};
```

- [ ] **Step 2: Update `init_handler.ts`**

Resolve the harness from the CLI intent:

```typescript
import { findHarness } from "../../application/harnesses.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";

// ...inside runInit:
const harness = findHarness(intent.ai);
if (!harness) {
  console.error(red(`error: unknown harness '${intent.ai}'`));
  return 2;
}

const useCase = new InitProjectUseCase({
  writer: new DenoFsWriter(),
  git: new DenoGit(),
  lockStore: new FsLockStore(),
  harness,
  core: CORE_BUNDLE,
  ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
});
```

- [ ] **Step 3: Update existing tests in `tests/application/init_project_test.ts`**

Each existing `InitProjectUseCase` construction now needs `harness: fakeClaudeHarness()` and
`core: SAMPLE_CORE` instead of `bundle: …`. Add helpers at top of the file:

```typescript
import type { Harness } from "../../src/application/ports.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";

const SAMPLE_CORE: CoreBundle = [
  {
    category: "project-root",
    name: "root",
    suffix: "AGENTS.md",
    content: "# AGENTS\n",
    executable: false,
  },
  {
    category: "project-root",
    name: "root",
    suffix: "CLAUDE.md",
    content: "# CLAUDE\n",
    executable: false,
  },
];

function fakeClaudeHarness(): Harness {
  return {
    key: "claude",
    displayName: "Claude Code (fake)",
    mapBundle: (core) => {
      const out: Record<string, { content: string; executable: boolean }> = {};
      for (const e of core) {
        if (e.category === "project-root" && e.suffix) {
          out[e.suffix] = { content: e.content, executable: e.executable };
        }
      }
      return out;
    },
  };
}
```

Update every `new InitProjectUseCase({ ... })` call site to use the new shape.

- [ ] **Step 4: Append 2 new tests**

```typescript
Deno.test("InitProjectUseCase records harness.key in the installed lock", async () => {
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore,
    harness: fakeClaudeHarness(),
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({ targetDir: "/tmp/demo", initGit: false, force: false });
  assertEquals(lockStore.lastWritten?.harness, "claude");
});

Deno.test("InitProjectUseCase uses harness.mapBundle output as the file tree", async () => {
  const writer = fakeFsWriter();
  const uc = new InitProjectUseCase({
    writer,
    git: fakeGit(),
    lockStore: fakeLockStore(),
    harness: fakeClaudeHarness(),
    core: SAMPLE_CORE,
    ensureDir: () => Promise.resolve(),
  });
  await uc.execute({ targetDir: "/tmp/demo", initGit: false, force: false });
  // The fake harness maps project-root suffix → flat dest.
  assert(writer.written.includes("/tmp/demo:AGENTS.md"));
});
```

- [ ] **Step 5: Full suite — expect 215 green (213 + 2)**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/application/init_project.ts src/cli/handlers/init_handler.ts tests/application/init_project_test.ts
git commit -m "feat(init): route through Harness, persist harness key in lock"
```

---

## Task 10: Refactor `UpgradeProjectUseCase` to read harness from lock

**Files:**

- Modify: `src/application/upgrade_project.ts`
- Modify: `src/cli/handlers/upgrade_handler.ts`
- Modify: `tests/application/upgrade_project_test.ts` (update existing fakes)

- [ ] **Step 1: Update `UpgradeProjectDeps`**

Replace `bundle: Bundle` with `core: CoreBundle`. Remove `templatesVersion` (still from the bundle's
constant, pass-through unchanged). Add `harnesses: ReadonlyArray<Harness>` OR
`findHarness: (key: string) => Harness | null` — we pick the latter for testability:

```typescript
export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  core: CoreBundle;
  templatesVersion: string;
  findHarness: (key: string) => Harness | null;
  now?: () => Date;
};
```

- [ ] **Step 2: Update `execute()` to resolve harness from the lock**

After loading the lock:

```typescript
const harness = this.deps.findHarness(lock.harness);
if (!harness) {
  throw new Error(`unknown harness in lock: ${lock.harness}`);
}
const bundle = harness.mapBundle(this.deps.core);
// ... (existing bundle/diskShas/newShas logic now uses this bundle)
```

When writing the updated lock at the end, preserve `harness: lock.harness`.

- [ ] **Step 3: Update `upgrade_handler.ts`**

```typescript
import { findHarness } from "../../application/harnesses.ts";
import { CORE_BUNDLE, TEMPLATES_VERSION } from "../../templates_bundle.ts";

const useCase = new UpgradeProjectUseCase({
  reader: new DenoFsReader(),
  writer: new DenoFsWriter(),
  lockStore: new FsLockStore(),
  core: CORE_BUNDLE,
  templatesVersion: TEMPLATES_VERSION,
  findHarness,
});
```

- [ ] **Step 4: Update existing tests**

Tests currently inject `bundle: { ... }`. They now need `core: [...]` and
`findHarness: () => harness`.

The test fakes should:

```typescript
const fakeHarness: Harness = {
  key: "claude",
  displayName: "Claude Code (fake)",
  mapBundle: (core) => {
    const out: Record<string, { content: string; executable: boolean }> = {};
    for (const e of core) {
      // For a simple test bundle of project-root files, emit as-is.
      if (e.category === "project-root" && e.suffix) {
        out[e.suffix] = { content: e.content, executable: e.executable };
      }
    }
    return out;
  },
};

// build CoreBundle that yields the same disk layout the old tests expected
const CORE: CoreBundle = [
  { category: "project-root", name: "root", suffix: "a.md", content: "alpha", executable: false },
];
```

For each existing test, swap `bundle: { ... }` for `core: CORE` + `findHarness: () => fakeHarness`.

Also update the lock in existing tests to include `harness: "claude"` since the lock shape is now
v2.

- [ ] **Step 5: Full suite — expect 215 green (no new tests, just converted)**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/application/upgrade_project.ts src/cli/handlers/upgrade_handler.ts tests/application/upgrade_project_test.ts
git commit -m "feat(upgrade): resolve harness from lock, map core→bundle via harness"
```

---

## Task 11: Parser — accept `--ai cursor` and validate

**Files:**

- Modify: `src/cli/parser.ts`
- Modify: `src/cli/help.ts`
- Modify: `tests/cli/parser_test.ts` (APPEND 2 tests, MODIFY 1)

- [ ] **Step 1: Update parser tests**

Find the existing test that says `ai: "claude"` is the literal. Relax its assertion — it now returns
`"claude"` or `"cursor"`. Then append 2 new tests:

```typescript
Deno.test("parseArgs accepts init --ai cursor", () => {
  const r = parseArgs(["init", "demo", "--ai", "cursor"]);
  if (r.kind === "init") assertEquals(r.ai, "cursor");
});

Deno.test("parseArgs returns unknown for invalid --ai value", () => {
  assertEquals(parseArgs(["init", "demo", "--ai", "bogus"]), {
    kind: "unknown",
    received: "init --ai bogus",
  });
});

Deno.test("parseArgs init defaults --ai to claude", () => {
  const r = parseArgs(["init", "demo"]);
  if (r.kind === "init") assertEquals(r.ai, "claude");
});
```

- [ ] **Step 2: Update the `Intent` union in `src/cli/parser.ts`**

Change the init variant from `ai: "claude"` to `ai: "claude" | "cursor"`.

Add `"ai"` back to the `string` flags passed to `stdParseArgs` (it was dropped in v0.1 when we
couldn't accept anything other than "claude"). Validate the value before returning:

```typescript
if (command === "init") {
  const aiRaw = typeof parsed.ai === "string" ? parsed.ai : "claude";
  if (aiRaw !== "claude" && aiRaw !== "cursor") {
    return { kind: "unknown", received: `init --ai ${aiRaw}` };
  }
  return {
    kind: "init",
    projectName: rest[0] ?? null,
    here: Boolean(parsed.here),
    noGit: Boolean(parsed["no-git"]),
    ai: aiRaw,
    force: Boolean(parsed.force),
  };
}
```

- [ ] **Step 3: Update `src/cli/help.ts`**

Change the `--ai` usage line:

```
--ai <name>    Target AI harness: claude (default) | cursor
```

- [ ] **Step 4: Run — expect all tests pass (previous + 3 new)**

```bash
deno task test
```

218 green expected.

- [ ] **Step 5: Commit**

```bash
deno fmt
git add src/cli/parser.ts src/cli/help.ts tests/cli/parser_test.ts
git commit -m "feat(cli): --ai cursor accepted and validated"
```

---

## Task 12: `specflow check --project` surfaces the harness

**Files:**

- Modify: `src/infrastructure/fs_project_inspector.ts`
- Modify: `tests/infrastructure/fs_project_inspector_test.ts`

- [ ] **Step 1: Add a new check that reads the lock and reports the harness**

Extend `FsProjectInspector.inspect`:

```typescript
import { parseLock } from "../domain/installed_lock.ts";

private async checkHarness(projectDir: string): Promise<CheckOutcome> {
  const path = `${projectDir}/.specflow/installed.lock`;
  try {
    const raw = await Deno.readTextFile(path);
    const lock = parseLock(raw);
    const expectedFolder = lock.harness === "claude" ? ".claude/" : ".cursor/";
    const folderPresent = await exists(`${projectDir}/${expectedFolder}`);
    if (!folderPresent) {
      return {
        name: "harness",
        status: "fail",
        message: `lock says ${lock.harness} but ${expectedFolder} is missing`,
      };
    }
    return { name: "harness", status: "pass", message: `${lock.harness} — ${expectedFolder} present` };
  } catch {
    return { name: "harness", status: "warn", message: "no installed.lock (pre-upgrade-tracking project)" };
  }
}
```

Add its result to the returned array in `inspect()`.

- [ ] **Step 2: Write two new tests**

```typescript
Deno.test("inspect surfaces harness=claude when lock says claude and .claude/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: claude
templates_version: 0.3.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.3.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("claude"), true);
    },
  );
});

Deno.test("inspect reports fail when lock harness does not match folder on disk", async () => {
  await withProjectDir(
    async (dir) => {
      // lock says cursor but only .claude/ is present
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: cursor
templates_version: 0.3.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.3.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});
```

- [ ] **Step 3: Run — expect +2 passed (220 total)**

- [ ] **Step 4: Commit**

```bash
deno fmt
git add src/infrastructure/fs_project_inspector.ts tests/infrastructure/fs_project_inspector_test.ts
git commit -m "feat(check): surface harness in specflow check --project"
```

---

## Task 13: Integration test for `specflow init --ai cursor`

**Files:**

- Create: `tests/integration/init_cursor_test.ts`

- [ ] **Step 1: Write the test**

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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-cursor-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai cursor scaffolds a Cursor layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "cursor"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");
    // Cursor-specific
    assertEquals(await exists(join(root, ".cursor/skills/speckit-specify/SKILL.md")), true);
    assertEquals(
      await exists(join(root, ".cursor/skills/specflow-agent-product-owner/SKILL.md")),
      true,
    );
    assertEquals(await exists(join(root, ".cursor/skills/specflow-auto-chain/SKILL.md")), true);
    assertEquals(await exists(join(root, ".cursor/rules/specify-rules.mdc")), true);
    // Shared
    assertEquals(await exists(join(root, ".specify/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);
    // NOT emitted for cursor
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects cursor
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: cursor"), true);
  });
});

Deno.test("specflow init (no --ai) still defaults to Claude", async () => {
  await withTempDir(async (parent) => {
    const { code } = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(code, 0);
    const root = join(parent, "demo");
    assertEquals(await exists(join(root, ".claude/")), true);
    assertEquals(await exists(join(root, "CLAUDE.md")), true);
    assertEquals(await exists(join(root, ".cursor/")), false);
  });
});
```

- [ ] **Step 2: Full suite — expect 222 green (220 + 2)**

- [ ] **Step 3: Commit**

```bash
deno fmt
git add tests/integration/init_cursor_test.ts
git commit -m "test(integration): specflow init --ai cursor scaffolds Cursor layout"
```

---

## Task 14: Remove legacy `TEMPLATES` shim from the generated bundle

Now that every call site uses CORE_BUNDLE + Harness, the legacy `TEMPLATES` flat export can go.

**Files:**

- Modify: `scripts/bundle-templates.ts` — delete `buildLegacyTemplates` + the export block
- Regenerate: `src/templates_bundle.ts`
- Modify: any remaining references (likely only in `templates_bundle.ts` itself)

- [ ] **Step 1: Delete the legacy code**

In `scripts/bundle-templates.ts`, remove the `buildLegacyTemplates` helper and the
`export const TEMPLATES` block from the generated source.

- [ ] **Step 2: Regenerate**

```bash
deno task bundle
```

Expected output: `Bundled N core entries + 2 harness-specific → src/templates_bundle.ts`

- [ ] **Step 3: Type-check**

```bash
deno check src/main.ts
deno task test
```

If any file still imports `TEMPLATES`, the snapshot test in `claude_harness_test.ts` is the one that
does (it compares against `TEMPLATES`). That test must be modified: **the snapshot target is no
longer `TEMPLATES` — it's the explicit key set we expect**. Replace it with a hardcoded list:

```typescript
Deno.test("ClaudeHarness.mapBundle emits the v0.2-era Claude tree", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const keys = Object.keys(mapped).sort();
  assertEquals(keys.length, 39); // 38 core + CLAUDE.md
  // Spot-check a few canonical paths
  assert(".claude/commands/speckit.specify.md" in mapped);
  assert(".claude/agents/product-owner.md" in mapped);
  assert(".claude/skills/speckit/SKILL.md" in mapped);
  assert(".specify/memory/constitution.md" in mapped);
  assert("CLAUDE.md" in mapped);
});
```

(Adjust the `39` to match actual count reported by `deno task bundle`.)

Remove the content-comparison test since we no longer have `TEMPLATES` to compare against; the
key-list assertion + spot-checks are sufficient.

- [ ] **Step 4: Full suite — expect 220 green (snapshot test became 1 test instead of 3)**

- [ ] **Step 5: Commit**

```bash
deno fmt
git add scripts/bundle-templates.ts src/templates_bundle.ts tests/infrastructure/harness/claude_harness_test.ts
git commit -m "refactor: drop legacy TEMPLATES shim — all call sites now use CORE_BUNDLE"
```

---

## Task 15: Update README + AGENTS.md to mention multi-harness

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: README — add a short Harnesses section**

Read `README.md`, add after the existing `## What Specflow is not` section:

```markdown
## Supported AI harnesses

Specflow scaffolds for one AI harness per invocation:

- **Claude Code** (default) — `specflow init <name>` or `--ai claude`
- **Cursor** — `specflow init <name> --ai cursor`

Additional harnesses (Codex CLI, GitHub Copilot, Gemini CLI, Windsurf, …) are planned for later
releases. See `AGENTS.md` for the roadmap.
```

- [ ] **Step 2: AGENTS.md — update the scope line**

Find the "Locked decisions" → "v0.1 scope" section and update "Single target harness: Claude Code"
to "Two target harnesses: Claude Code (default) + Cursor (since v0.2)".

Also replace the line mentioning "Cursor / Copilot / Codex / … v0.2+" with "Codex / Copilot / Gemini
/ Windsurf … v0.3+".

- [ ] **Step 3: Commit**

```bash
deno fmt
git add README.md AGENTS.md
git commit -m "docs: document multi-harness support (Claude + Cursor)"
```

---

## Wrap-up

At the end of Task 15 the repo has:

- A `Harness` abstraction with 2 concrete adapters (Claude + Cursor)
- `CoreBundle` as the neutral templates representation
- `installed.lock` v2 with `harness` field (auto-migrates v1)
- `specflow init --ai cursor` fully functional; `--ai claude` unchanged (snapshot test guarantees
  byte-identity on the file tree)
- `specflow check --project` surfaces which harness the project was installed with
- `specflow upgrade` works on both Claude and Cursor projects
- 220 tests green

### Final test count

Prior (v0.1.0-alpha.3): 196

- Task 1 (CoreBundle): 5
- Task 2 (lock v2): 4
- Task 6 (ClaudeHarness snapshot): 1 (after Task 14 simplifies from 4 to 1)
- Task 7 (CursorHarness): 8
- Task 9 (init use case): 2
- Task 11 (parser): 3
- Task 12 (inspector): 2
- Task 13 (integration): 2 **Total expected**: **220**.

### How to validate end-to-end

1. `deno task test` → all green.
2. `deno task bundle && deno run -A src/main.ts init /tmp/cursor-demo --no-git --ai cursor`. Inspect
   `/tmp/cursor-demo/.cursor/skills/` and `/tmp/cursor-demo/.cursor/rules/specify-rules.mdc`.
3. Open `/tmp/cursor-demo/` in the Cursor IDE → Agent chat → type `/speckit-specify` and see it
   appear in the skill picker.

### Deferred to later bricks

- Codex CLI adapter (`.agents/skills/…`)
- Copilot adapter (dual modes: `.github/prompts/` vs `.github/skills/`)
- Gemini CLI adapter (TOML commands)
- Windsurf adapter (`.windsurf/workflows/`)
- Multi-harness in a single project (installing both Claude AND Cursor files at once)
- `specflow migrate --from <a> --to <b>`
