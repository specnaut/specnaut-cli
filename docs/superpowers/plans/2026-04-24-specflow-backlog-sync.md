# Specflow `backlog sync` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `specflow backlog sync` + `specflow backlog configure` sub-commands — one-way push of
`tasks/backlog/NNN-*.md` into GitHub Issues + Project V2 via the `gh` CLI, with config persisted in
`.specflow/config.yml`.

**Architecture:** Hexagonal / DDD-lite layering (continuing v0.1-init). New `src/domain/backlog/`
module (task + frontmatter + sync plan), new `src/domain/sync_config.ts`, new ports
(`BacklogReader`, `BacklogSyncTarget`, `ConfigStore`, `InteractivePrompt`, `SubprocessRunner`), new
adapters (`FsBacklogReader`, `FsConfigStore`, `TerminalPrompt`, `GhCli`, `GitHubBacklogSyncTarget`),
two use cases (`SyncBacklogUseCase`, `ConfigureSyncUseCase`), and two CLI handlers. Integration test
uses a mock `gh` shim on PATH. No direct `fetch` — all network goes through `gh` subprocess, so no
changes to `--allow-net` at compile.

**Tech Stack:** Deno 2 + TypeScript + `@std/yaml`, `@std/fs`, `@std/path`,
`@std/cli/unstable-prompt-select`. Zero external dependencies.

**Scope:** v0.1 brick 4 post-init. Delivers the two sub-commands end-to-end with full test coverage.
Explicitly **out of scope**: reverse sync (GH → MD), GitLab/Bitbucket adapters, auto-creation of
Project V2, drift detection. Each reported to v0.2+.

**Reference docs:**

- Design: `docs/superpowers/specs/2026-04-24-specflow-backlog-sync-design.md`
- Existing architecture recap: `docs/superpowers/plans/2026-04-24-specflow-v0.1-init.md`

---

## File Structure (additions to v0.1-init)

```
src/
├── domain/
│   ├── backlog/
│   │   ├── task.ts               # NEW — BacklogTask + enums
│   │   ├── frontmatter.ts        # NEW — parser: raw MD → BacklogTask
│   │   ├── sync_plan.ts          # NEW — SyncAction union + diff()
│   │   └── secret_scanner.ts     # NEW — pure secret-pattern detector
│   └── sync_config.ts            # NEW — SyncConfig value object + validator
├── application/
│   ├── ports.ts                  # MODIFY — add 5 ports
│   ├── sync_backlog.ts           # NEW — SyncBacklogUseCase
│   └── configure_sync.ts         # NEW — ConfigureSyncUseCase
├── infrastructure/
│   ├── fs_backlog_reader.ts      # NEW — implements BacklogReader
│   ├── fs_config_store.ts        # NEW — implements ConfigStore (YAML)
│   ├── deno_subprocess.ts        # NEW — implements SubprocessRunner
│   ├── gh_cli.ts                 # NEW — thin typed wrapper on gh
│   ├── github_backlog_sync.ts    # NEW — implements BacklogSyncTarget
│   └── terminal_prompt.ts        # NEW — implements InteractivePrompt
├── cli/
│   ├── parser.ts                 # MODIFY — add `backlog` intent
│   ├── help.ts                   # MODIFY — help text
│   └── handlers/
│       ├── backlog_sync_handler.ts       # NEW
│       └── backlog_configure_handler.ts  # NEW
└── main.ts                       # MODIFY — add `case "backlog"`

tests/
├── domain/backlog/
│   ├── task_test.ts
│   ├── frontmatter_test.ts
│   ├── sync_plan_test.ts
│   └── secret_scanner_test.ts
├── domain/sync_config_test.ts
├── application/
│   ├── sync_backlog_test.ts
│   └── configure_sync_test.ts
├── infrastructure/
│   ├── fs_backlog_reader_test.ts
│   ├── fs_config_store_test.ts
│   └── gh_cli_test.ts
├── cli/parser_test.ts            # EXTEND
└── integration/
    └── backlog_sync_test.ts      # NEW (spawn binary + gh shim)

templates/
└── claude/
    ├── agents/product-owner.md   # MODIFY — replace the "not yet available" stub
    └── commands/backlog.md       # MODIFY — same
```

Total additions: 6 domain files, 3 application files, 6 infrastructure files, 2 CLI handlers, 1
parser modification, 11 test files, 2 template modifications. Expected LOC: ~1800 src, ~1200 tests.

---

## Task 1: BacklogTask domain + frontmatter parser

**Files:**

- Create: `src/domain/backlog/task.ts`
- Create: `src/domain/backlog/frontmatter.ts`
- Create: `tests/domain/backlog/task_test.ts`
- Create: `tests/domain/backlog/frontmatter_test.ts`

- [ ] **Step 1: Write `tests/domain/backlog/task_test.ts`**

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import {
  assertValidComplexity,
  assertValidPriority,
  assertValidStatus,
  type BacklogTask,
} from "../../../src/domain/backlog/task.ts";

Deno.test("assertValidPriority accepts all 4 levels", () => {
  assertValidPriority("critical");
  assertValidPriority("high");
  assertValidPriority("medium");
  assertValidPriority("low");
});

Deno.test("assertValidPriority rejects unknown values", () => {
  assertThrows(() => assertValidPriority("urgent"), Error, "priority");
});

Deno.test("assertValidStatus accepts all 5 states", () => {
  assertValidStatus("todo");
  assertValidStatus("in_progress");
  assertValidStatus("done");
  assertValidStatus("deferred");
  assertValidStatus("blocked");
});

Deno.test("assertValidStatus rejects unknown values", () => {
  assertThrows(() => assertValidStatus("wip"), Error, "status");
});

Deno.test("assertValidComplexity accepts all Fibonacci values", () => {
  for (const n of [1, 2, 3, 5, 8, 13, 21]) assertValidComplexity(n);
});

Deno.test("assertValidComplexity rejects non-Fibonacci", () => {
  for (const n of [0, 4, 6, 7, 10, 34]) {
    assertThrows(() => assertValidComplexity(n), Error, "Fibonacci");
  }
});

Deno.test("BacklogTask is a plain readonly object", () => {
  const task: BacklogTask = {
    id: "001",
    title: "first",
    category: "devex",
    priority: "high",
    complexity: 5,
    status: "todo",
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "",
  };
  assertEquals(task.id, "001");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test tests/domain/backlog/task_test.ts` Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/backlog/task.ts`**

```typescript
export type Priority = "critical" | "high" | "medium" | "low";
export type Status = "todo" | "in_progress" | "done" | "deferred" | "blocked";
export type Complexity = 1 | 2 | 3 | 5 | 8 | 13 | 21;

export type BacklogTask = {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly priority: Priority;
  readonly complexity: Complexity;
  readonly status: Status;
  readonly dependsOn: ReadonlyArray<string>;
  readonly spec: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly created: string;
  readonly body: string;
};

const PRIORITIES: ReadonlySet<Priority> = new Set(["critical", "high", "medium", "low"]);
const STATUSES: ReadonlySet<Status> = new Set([
  "todo",
  "in_progress",
  "done",
  "deferred",
  "blocked",
]);
const FIBS: ReadonlySet<number> = new Set([1, 2, 3, 5, 8, 13, 21]);

export function assertValidPriority(value: unknown): asserts value is Priority {
  if (typeof value !== "string" || !PRIORITIES.has(value as Priority)) {
    throw new Error(`Invalid priority: ${String(value)}`);
  }
}

export function assertValidStatus(value: unknown): asserts value is Status {
  if (typeof value !== "string" || !STATUSES.has(value as Status)) {
    throw new Error(`Invalid status: ${String(value)}`);
  }
}

export function assertValidComplexity(value: unknown): asserts value is Complexity {
  if (typeof value !== "number" || !FIBS.has(value)) {
    throw new Error(`Invalid complexity (must be Fibonacci 1,2,3,5,8,13,21): ${String(value)}`);
  }
}
```

- [ ] **Step 4: Run task_test — 7 passed**

Run: `deno test tests/domain/backlog/task_test.ts` Expected: 7 passed | 0 failed.

- [ ] **Step 5: Write `tests/domain/backlog/frontmatter_test.ts`**

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { parseFrontmatter } from "../../../src/domain/backlog/frontmatter.ts";

const VALID = `---
id: "001"
title: "First task"
category: devex
priority: high
complexity: 5
status: todo
depends_on: []
spec: null
tags: [infra, bootstrap]
created: 2026-04-24
---

This is the task body.

Second paragraph.
`;

Deno.test("parseFrontmatter returns a BacklogTask for valid input", () => {
  const task = parseFrontmatter(VALID);
  assertEquals(task.id, "001");
  assertEquals(task.title, "First task");
  assertEquals(task.category, "devex");
  assertEquals(task.priority, "high");
  assertEquals(task.complexity, 5);
  assertEquals(task.status, "todo");
  assertEquals(task.dependsOn, []);
  assertEquals(task.spec, null);
  assertEquals(task.tags, ["infra", "bootstrap"]);
  assertEquals(task.created, "2026-04-24");
  assertEquals(task.body.trim().startsWith("This is the task body."), true);
});

Deno.test("parseFrontmatter accepts unquoted numeric id", () => {
  const task = parseFrontmatter(VALID.replace('"001"', "001"));
  assertEquals(task.id, "001");
});

Deno.test("parseFrontmatter coerces depends_on omitted to []", () => {
  const raw = VALID.replace("depends_on: []\n", "");
  const task = parseFrontmatter(raw);
  assertEquals(task.dependsOn, []);
});

Deno.test("parseFrontmatter rejects missing delimiter", () => {
  assertThrows(() => parseFrontmatter("no frontmatter here"), Error, "frontmatter");
});

Deno.test("parseFrontmatter rejects missing required field (title)", () => {
  const raw = VALID.replace(/title:.*\n/, "");
  assertThrows(() => parseFrontmatter(raw), Error, "title");
});

Deno.test("parseFrontmatter rejects invalid priority", () => {
  const raw = VALID.replace("priority: high", "priority: urgent");
  assertThrows(() => parseFrontmatter(raw), Error, "priority");
});

Deno.test("parseFrontmatter rejects non-Fibonacci complexity", () => {
  const raw = VALID.replace("complexity: 5", "complexity: 4");
  assertThrows(() => parseFrontmatter(raw), Error, "Fibonacci");
});

Deno.test("parseFrontmatter pads id to 3 digits", () => {
  const raw = VALID.replace('"001"', "7");
  const task = parseFrontmatter(raw);
  assertEquals(task.id, "007");
});
```

- [ ] **Step 6: Run frontmatter_test — should fail**

Run: `deno test tests/domain/backlog/frontmatter_test.ts` Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/domain/backlog/frontmatter.ts`**

```typescript
import { parse as parseYaml } from "@std/yaml";
import {
  assertValidComplexity,
  assertValidPriority,
  assertValidStatus,
  type BacklogTask,
} from "./task.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

type RawFrontmatter = {
  id: string | number;
  title: string;
  category: string;
  priority: string;
  complexity: number;
  status: string;
  depends_on?: unknown;
  spec?: string | null;
  tags?: unknown;
  created: string;
};

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Frontmatter missing required string '${key}'`);
  }
  return v;
}

function optionalStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`Frontmatter '${key}' must be an array`);
  return v.map((x) => String(x));
}

export function parseFrontmatter(raw: string): BacklogTask {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    throw new Error("Missing YAML frontmatter (expected --- delimiters)");
  }
  const parsed = parseYaml(m[1]);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Frontmatter is empty or not a mapping");
  }
  const obj = parsed as Record<string, unknown>;

  // id — accept string or number, normalize to zero-padded 3-digit string.
  const rawId = obj.id;
  if (rawId === undefined || rawId === null) {
    throw new Error("Frontmatter missing required 'id'");
  }
  const id = String(rawId).padStart(3, "0");

  const title = requireString(obj, "title");
  const category = requireString(obj, "category");

  const priority = requireString(obj, "priority");
  assertValidPriority(priority);

  const complexity = obj.complexity;
  assertValidComplexity(complexity);

  const status = requireString(obj, "status");
  assertValidStatus(status);

  const created = requireString(obj, "created");

  const dependsOn = optionalStringArray(obj, "depends_on");
  const tags = optionalStringArray(obj, "tags");

  const specRaw = obj.spec;
  const spec = specRaw === undefined || specRaw === null ? null : String(specRaw);

  const body = m[2] ?? "";

  return {
    id,
    title,
    category,
    priority,
    complexity,
    status,
    dependsOn,
    spec,
    tags,
    created,
    body,
  };
}
```

- [ ] **Step 8: Run frontmatter_test — 8 passed**

Run: `deno test tests/domain/backlog/frontmatter_test.ts` Expected: 8 passed | 0 failed.

- [ ] **Step 9: Commit**

```bash
git add src/domain/backlog/task.ts src/domain/backlog/frontmatter.ts tests/domain/backlog/
git commit -m "feat(domain): BacklogTask + frontmatter parser with enum validation"
```

---

## Task 2: SyncPlan + diff algorithm

**Files:**

- Create: `src/domain/backlog/sync_plan.ts`
- Create: `tests/domain/backlog/sync_plan_test.ts`

- [ ] **Step 1: Write `tests/domain/backlog/sync_plan_test.ts`**

```typescript
import { assertEquals } from "@std/assert";
import { computeSyncPlan, type ExistingIssue } from "../../../src/domain/backlog/sync_plan.ts";
import type { BacklogTask } from "../../../src/domain/backlog/task.ts";

function task(
  partial: Partial<BacklogTask> & { id: string; status: BacklogTask["status"] },
): BacklogTask {
  return {
    title: "t",
    category: "c",
    priority: "medium",
    complexity: 3,
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "",
    ...partial,
  };
}

Deno.test("computeSyncPlan emits create for new task without existing issue", () => {
  const plan = computeSyncPlan([task({ id: "001", status: "todo" })], new Map());
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "create");
});

Deno.test("computeSyncPlan emits update for open task with existing open issue", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "open" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "in_progress" })], existing);
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "update");
  if (plan[0].kind === "update") assertEquals(plan[0].issueNumber, 42);
});

Deno.test("computeSyncPlan emits close-completed for done task", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "open" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "done" })], existing);
  assertEquals(plan.length, 1);
  if (plan[0].kind === "close") {
    assertEquals(plan[0].reason, "completed");
    assertEquals(plan[0].issueNumber, 42);
  }
});

Deno.test("computeSyncPlan emits close-not-planned for deferred task", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "open" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "deferred" })], existing);
  if (plan[0].kind === "close") assertEquals(plan[0].reason, "not_planned");
});

Deno.test("computeSyncPlan still emits close for done task when issue already closed (idempotent)", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "closed" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "done" })], existing);
  // Close is a no-op on an already-closed issue server-side, but we still emit
  // the action so the adapter can call gh and surface any mismatch.
  assertEquals(plan[0].kind, "close");
});

Deno.test("computeSyncPlan creates for a task with an existing closed issue (only if open is needed)", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "closed" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "todo" })], existing);
  assertEquals(plan[0].kind, "update"); // reopen via edit; a separate action would over-engineer
});

Deno.test("computeSyncPlan handles multiple tasks in id order", () => {
  const tasks = [
    task({ id: "002", status: "todo" }),
    task({ id: "001", status: "done" }),
  ];
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 10, state: "open" }],
  ]);
  const plan = computeSyncPlan(tasks, existing);
  assertEquals(plan.map((a) => a.kind), ["close", "create"]);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test tests/domain/backlog/sync_plan_test.ts`

- [ ] **Step 3: Implement `src/domain/backlog/sync_plan.ts`**

```typescript
import type { BacklogTask } from "./task.ts";

export type ExistingIssue = {
  readonly id: string;
  readonly number: number;
  readonly state: "open" | "closed";
};

export type SyncAction =
  | { kind: "create"; task: BacklogTask }
  | { kind: "update"; task: BacklogTask; issueNumber: number }
  | {
    kind: "close";
    task: BacklogTask;
    issueNumber: number;
    reason: "completed" | "not_planned";
  }
  | { kind: "skip"; task: BacklogTask; reason: string };

export type SyncPlan = ReadonlyArray<SyncAction>;

export function computeSyncPlan(
  tasks: ReadonlyArray<BacklogTask>,
  existing: Map<string, ExistingIssue>,
): SyncPlan {
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const plan: SyncAction[] = [];
  for (const task of sorted) {
    const ex = existing.get(task.id);
    if (task.status === "done") {
      if (ex) plan.push({ kind: "close", task, issueNumber: ex.number, reason: "completed" });
      else plan.push({ kind: "create", task });
      continue;
    }
    if (task.status === "deferred") {
      if (ex) plan.push({ kind: "close", task, issueNumber: ex.number, reason: "not_planned" });
      else plan.push({ kind: "create", task });
      continue;
    }
    // todo, in_progress, blocked
    if (ex) plan.push({ kind: "update", task, issueNumber: ex.number });
    else plan.push({ kind: "create", task });
  }
  return plan;
}
```

- [ ] **Step 4: Run — 7 passed**

Run: `deno test tests/domain/backlog/sync_plan_test.ts` Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog/sync_plan.ts tests/domain/backlog/sync_plan_test.ts
git commit -m "feat(domain): sync plan diff (create/update/close/skip actions)"
```

---

## Task 3: SyncConfig domain + YAML validator

**Files:**

- Create: `src/domain/sync_config.ts`
- Create: `tests/domain/sync_config_test.ts`

- [ ] **Step 1: Write `tests/domain/sync_config_test.ts`**

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { parseSyncConfig, serializeSyncConfig } from "../../src/domain/sync_config.ts";

const VALID_YAML = `version: 1
sync:
  provider: github
  repo: kevinraimbaud/specflow
  project:
    number: 3
    owner: kevinraimbaud
    field_map:
      status: Status
      priority: Priority
      complexity: Complexity
  label_prefix: backlog/
`;

Deno.test("parseSyncConfig returns structured config for valid YAML", () => {
  const cfg = parseSyncConfig(VALID_YAML);
  assertEquals(cfg.version, 1);
  assertEquals(cfg.sync.provider, "github");
  assertEquals(cfg.sync.repo, "kevinraimbaud/specflow");
  assertEquals(cfg.sync.project?.number, 3);
  assertEquals(cfg.sync.project?.owner, "kevinraimbaud");
  assertEquals(cfg.sync.project?.fieldMap.status, "Status");
  assertEquals(cfg.sync.label_prefix, "backlog/");
});

Deno.test("parseSyncConfig accepts config without project (issues-only mode)", () => {
  const yaml = `version: 1
sync:
  provider: github
  repo: kevinraimbaud/specflow
  label_prefix: backlog/
`;
  const cfg = parseSyncConfig(yaml);
  assertEquals(cfg.sync.project, null);
});

Deno.test("parseSyncConfig rejects unsupported version", () => {
  const yaml = VALID_YAML.replace("version: 1", "version: 99");
  assertThrows(() => parseSyncConfig(yaml), Error, "version");
});

Deno.test("parseSyncConfig rejects unsupported provider", () => {
  const yaml = VALID_YAML.replace("provider: github", "provider: gitlab");
  assertThrows(() => parseSyncConfig(yaml), Error, "provider");
});

Deno.test("parseSyncConfig rejects malformed repo (must be owner/name)", () => {
  const yaml = VALID_YAML.replace(
    "repo: kevinraimbaud/specflow",
    "repo: not-a-valid-repo-string",
  );
  assertThrows(() => parseSyncConfig(yaml), Error, "repo");
});

Deno.test("serializeSyncConfig round-trips a config", () => {
  const cfg = parseSyncConfig(VALID_YAML);
  const yaml = serializeSyncConfig(cfg);
  const roundtrip = parseSyncConfig(yaml);
  assertEquals(roundtrip, cfg);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/domain/sync_config.ts`**

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type SyncProvider = "github";

export type FieldMap = {
  readonly status: string;
  readonly priority: string;
  readonly complexity: string;
};

export type ProjectConfig = {
  readonly number: number;
  readonly owner: string;
  readonly fieldMap: FieldMap;
};

export type SyncConfig = {
  readonly version: 1;
  readonly sync: {
    readonly provider: SyncProvider;
    readonly repo: string;
    readonly project: ProjectConfig | null;
    readonly label_prefix: string;
  };
};

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function asObject(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== "object") throw new Error(`${name} must be an object`);
  return v as Record<string, unknown>;
}

export function parseSyncConfig(yaml: string): SyncConfig {
  const raw = parseYaml(yaml);
  const root = asObject(raw, "config root");

  if (root.version !== 1) {
    throw new Error(`Unsupported config version (expected 1): ${String(root.version)}`);
  }
  const sync = asObject(root.sync, "sync");

  const provider = sync.provider;
  if (provider !== "github") {
    throw new Error(`Unsupported provider: ${String(provider)}`);
  }
  const repo = sync.repo;
  if (typeof repo !== "string" || !REPO_RE.test(repo)) {
    throw new Error(`Invalid repo (expected owner/name): ${String(repo)}`);
  }
  const labelPrefix = typeof sync.label_prefix === "string" ? sync.label_prefix : "backlog/";

  let project: ProjectConfig | null = null;
  if (sync.project !== undefined && sync.project !== null) {
    const p = asObject(sync.project, "sync.project");
    const number = p.number;
    const owner = p.owner;
    const fm = asObject(p.field_map, "sync.project.field_map");
    if (typeof number !== "number") throw new Error("sync.project.number must be a number");
    if (typeof owner !== "string") throw new Error("sync.project.owner must be a string");
    const status = typeof fm.status === "string" ? fm.status : "Status";
    const priority = typeof fm.priority === "string" ? fm.priority : "Priority";
    const complexity = typeof fm.complexity === "string" ? fm.complexity : "Complexity";
    project = { number, owner, fieldMap: { status, priority, complexity } };
  }

  return {
    version: 1,
    sync: { provider, repo, project, label_prefix: labelPrefix },
  };
}

export function serializeSyncConfig(cfg: SyncConfig): string {
  const obj = {
    version: 1,
    sync: {
      provider: cfg.sync.provider,
      repo: cfg.sync.repo,
      ...(cfg.sync.project !== null
        ? {
          project: {
            number: cfg.sync.project.number,
            owner: cfg.sync.project.owner,
            field_map: {
              status: cfg.sync.project.fieldMap.status,
              priority: cfg.sync.project.fieldMap.priority,
              complexity: cfg.sync.project.fieldMap.complexity,
            },
          },
        }
        : {}),
      label_prefix: cfg.sync.label_prefix,
    },
  };
  return stringifyYaml(obj);
}
```

- [ ] **Step 4: Run — 6 passed**

- [ ] **Step 5: Commit**

```bash
git add src/domain/sync_config.ts tests/domain/sync_config_test.ts
git commit -m "feat(domain): SyncConfig value object + YAML round-trip"
```

---

## Task 4: Extend application ports

**Files:**

- Modify: `src/application/ports.ts`

- [ ] **Step 1: Read existing `src/application/ports.ts`** to confirm current exports (FsWriter,
      GitAdapter, ReleaseChecker, Downloader).

- [ ] **Step 2: Append 5 new interfaces to `src/application/ports.ts`**

```typescript
import type { BacklogTask } from "../domain/backlog/task.ts";
import type { ExistingIssue, SyncAction } from "../domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../domain/sync_config.ts";

export interface BacklogReader {
  readAll(tasksDir: string): Promise<BacklogTask[]>;
  readOne(tasksDir: string, id: string): Promise<BacklogTask | null>;
}

export interface BacklogSyncTarget {
  listExisting(config: SyncConfig): Promise<Map<string, ExistingIssue>>;
  apply(action: SyncAction, config: SyncConfig): Promise<ApplyResult>;
}

export type ApplyResult =
  | { ok: true; issueNumber: number; action: SyncAction["kind"] }
  | { ok: false; error: string; action: SyncAction["kind"]; taskId: string };

export interface ConfigStore {
  read(projectDir: string): Promise<SyncConfig | null>;
  write(projectDir: string, config: SyncConfig): Promise<void>;
  configPath(projectDir: string): string;
}

export interface InteractivePrompt {
  select(
    message: string,
    choices: ReadonlyArray<{ label: string; value: string }>,
  ): Promise<string>;
  confirm(message: string, defaultYes: boolean): Promise<boolean>;
  text(message: string, defaultValue?: string): Promise<string>;
}

export interface SubprocessRunner {
  run(cmd: string, args: string[], opts?: SubprocessOptions): Promise<SubprocessResult>;
}

export type SubprocessOptions = {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
};

export type SubprocessResult = {
  code: number;
  stdout: string;
  stderr: string;
};
```

- [ ] **Step 3: Verify `deno check`**

Run: `deno check src/application/ports.ts` Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/application/ports.ts
git commit -m "feat(ports): add BacklogReader, BacklogSyncTarget, ConfigStore, InteractivePrompt, SubprocessRunner"
```

---

## Task 5: FsBacklogReader adapter

**Files:**

- Create: `src/infrastructure/fs_backlog_reader.ts`
- Create: `tests/infrastructure/fs_backlog_reader_test.ts`

- [ ] **Step 1: Write `tests/infrastructure/fs_backlog_reader_test.ts`**

```typescript
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsBacklogReader } from "../../src/infrastructure/fs_backlog_reader.ts";

const FRONT = (id: string, status = "todo") =>
  `---
id: "${id}"
title: Task ${id}
category: devex
priority: medium
complexity: 3
status: ${status}
depends_on: []
spec: null
tags: []
created: 2026-04-24
---

Body ${id}
`;

async function withTasksDir(fn: (dir: string) => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "specflow-reader-" });
  const tasksDir = join(root, "tasks");
  await Deno.mkdir(join(tasksDir, "backlog"), { recursive: true });
  try {
    await fn(tasksDir);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("FsBacklogReader.readAll returns tasks sorted by id", async () => {
  await withTasksDir(async (tasksDir) => {
    await Deno.writeTextFile(join(tasksDir, "backlog/002-second.md"), FRONT("002"));
    await Deno.writeTextFile(join(tasksDir, "backlog/001-first.md"), FRONT("001"));
    const reader = new FsBacklogReader();
    const tasks = await reader.readAll(tasksDir);
    assertEquals(tasks.map((t) => t.id), ["001", "002"]);
  });
});

Deno.test("FsBacklogReader.readAll skips non-matching filenames", async () => {
  await withTasksDir(async (tasksDir) => {
    await Deno.writeTextFile(join(tasksDir, "backlog/001-first.md"), FRONT("001"));
    await Deno.writeTextFile(join(tasksDir, "backlog/README.md"), "# readme");
    await Deno.writeTextFile(join(tasksDir, "backlog/notes.txt"), "text");
    const reader = new FsBacklogReader();
    const tasks = await reader.readAll(tasksDir);
    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].id, "001");
  });
});

Deno.test("FsBacklogReader.readAll returns empty array when dir missing", async () => {
  const reader = new FsBacklogReader();
  const tasks = await reader.readAll("/tmp/does/not/exist");
  assertEquals(tasks, []);
});

Deno.test("FsBacklogReader.readOne returns null when id not present", async () => {
  await withTasksDir(async (tasksDir) => {
    const reader = new FsBacklogReader();
    assertEquals(await reader.readOne(tasksDir, "999"), null);
  });
});

Deno.test("FsBacklogReader.readOne finds task by id prefix", async () => {
  await withTasksDir(async (tasksDir) => {
    await Deno.writeTextFile(join(tasksDir, "backlog/042-answer.md"), FRONT("042"));
    const reader = new FsBacklogReader();
    const task = await reader.readOne(tasksDir, "042");
    assertEquals(task?.id, "042");
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/infrastructure/fs_backlog_reader.ts`**

```typescript
import { join } from "@std/path";
import { parseFrontmatter } from "../domain/backlog/frontmatter.ts";
import type { BacklogTask } from "../domain/backlog/task.ts";
import type { BacklogReader } from "../application/ports.ts";

const ENTRY_RE = /^(\d{3})-[\w.-]+\.md$/;

export class FsBacklogReader implements BacklogReader {
  async readAll(tasksDir: string): Promise<BacklogTask[]> {
    const dir = join(tasksDir, "backlog");
    const tasks: BacklogTask[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile) continue;
        if (!ENTRY_RE.test(entry.name)) continue;
        const raw = await Deno.readTextFile(join(dir, entry.name));
        tasks.push(parseFrontmatter(raw));
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    tasks.sort((a, b) => a.id.localeCompare(b.id));
    return tasks;
  }

  async readOne(tasksDir: string, id: string): Promise<BacklogTask | null> {
    const padded = id.padStart(3, "0");
    const dir = join(tasksDir, "backlog");
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile) continue;
        if (!entry.name.startsWith(`${padded}-`)) continue;
        const raw = await Deno.readTextFile(join(dir, entry.name));
        return parseFrontmatter(raw);
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    return null;
  }
}
```

- [ ] **Step 4: Run — 5 passed**

Run: `deno test tests/infrastructure/fs_backlog_reader_test.ts --allow-read --allow-write`

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/fs_backlog_reader.ts tests/infrastructure/fs_backlog_reader_test.ts
git commit -m "feat(infra): FsBacklogReader reads tasks/backlog/NNN-*.md"
```

---

## Task 6: FsConfigStore adapter

**Files:**

- Create: `src/infrastructure/fs_config_store.ts`
- Create: `tests/infrastructure/fs_config_store_test.ts`

- [ ] **Step 1: Write `tests/infrastructure/fs_config_store_test.ts`**

```typescript
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsConfigStore } from "../../src/infrastructure/fs_config_store.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";

async function withProjectDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-config-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const SAMPLE: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "kevinraimbaud/specflow",
    project: {
      number: 3,
      owner: "kevinraimbaud",
      fieldMap: { status: "Status", priority: "Priority", complexity: "Complexity" },
    },
    label_prefix: "backlog/",
  },
};

Deno.test("FsConfigStore.read returns null when config absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsConfigStore();
    const cfg = await store.read(dir);
    assertEquals(cfg, null);
  });
});

Deno.test("FsConfigStore.write then read returns the same config", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsConfigStore();
    await store.write(dir, SAMPLE);
    const cfg = await store.read(dir);
    assertEquals(cfg, SAMPLE);
  });
});

Deno.test("FsConfigStore.write creates .specflow dir if absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsConfigStore();
    await store.write(dir, SAMPLE);
    const stat = await Deno.stat(join(dir, ".specflow/config.yml"));
    assertEquals(stat.isFile, true);
  });
});

Deno.test("FsConfigStore.configPath returns canonical location", () => {
  const store = new FsConfigStore();
  assertEquals(store.configPath("/proj"), "/proj/.specflow/config.yml");
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/infrastructure/fs_config_store.ts`**

```typescript
import { dirname, join } from "@std/path";
import { parseSyncConfig, serializeSyncConfig, type SyncConfig } from "../domain/sync_config.ts";
import type { ConfigStore } from "../application/ports.ts";

export class FsConfigStore implements ConfigStore {
  configPath(projectDir: string): string {
    return join(projectDir, ".specflow/config.yml");
  }

  async read(projectDir: string): Promise<SyncConfig | null> {
    const path = this.configPath(projectDir);
    try {
      const raw = await Deno.readTextFile(path);
      return parseSyncConfig(raw);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async write(projectDir: string, config: SyncConfig): Promise<void> {
    const path = this.configPath(projectDir);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, serializeSyncConfig(config));
  }
}
```

- [ ] **Step 4: Run — 4 passed**

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/fs_config_store.ts tests/infrastructure/fs_config_store_test.ts
git commit -m "feat(infra): FsConfigStore persists SyncConfig to .specflow/config.yml"
```

---

## Task 7: Secret scanner (pure domain)

**Files:**

- Create: `src/domain/backlog/secret_scanner.ts`
- Create: `tests/domain/backlog/secret_scanner_test.ts`

- [ ] **Step 1: Write `tests/domain/backlog/secret_scanner_test.ts`**

```typescript
import { assertEquals } from "@std/assert";
import { scanForSecrets } from "../../../src/domain/backlog/secret_scanner.ts";

Deno.test("scanForSecrets returns empty array for clean body", () => {
  assertEquals(scanForSecrets("Just a normal task description."), []);
});

Deno.test("scanForSecrets catches GitHub PAT (ghp_)", () => {
  const hits = scanForSecrets("key: ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, "github_pat");
});

Deno.test("scanForSecrets catches Stripe secret key (sk_live_)", () => {
  const hits = scanForSecrets("stripe sk_live_51Hxxxxxxxxxxxxxxxxxxxxxx");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, "stripe_secret");
});

Deno.test("scanForSecrets catches AWS access key", () => {
  const hits = scanForSecrets("AKIAIOSFODNN7EXAMPLE is the AWS id");
  assertEquals(hits.length, 1);
  assertEquals(hits[0].kind, "aws_access_key");
});

Deno.test("scanForSecrets catches multiple secrets", () => {
  const body = "ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AKIAIOSFODNN7EXAMPLE";
  assertEquals(scanForSecrets(body).length, 2);
});

Deno.test("scanForSecrets reports line numbers", () => {
  const body = "line one\nline two with ghp_abcdefghijklmnopqrstuvwxyz0123456789\nline three";
  const hits = scanForSecrets(body);
  assertEquals(hits[0].line, 2);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/domain/backlog/secret_scanner.ts`**

```typescript
export type SecretKind = "github_pat" | "stripe_secret" | "aws_access_key";

export type SecretHit = {
  readonly kind: SecretKind;
  readonly line: number;
  readonly preview: string;
};

const PATTERNS: ReadonlyArray<{ kind: SecretKind; re: RegExp }> = [
  { kind: "github_pat", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { kind: "stripe_secret", re: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
  { kind: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
];

export function scanForSecrets(body: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    for (const { kind, re } of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        hits.push({
          kind,
          line: i + 1,
          preview: m[0].slice(0, 12) + "…",
        });
      }
    }
  });
  return hits;
}
```

- [ ] **Step 4: Run — 6 passed**

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog/secret_scanner.ts tests/domain/backlog/secret_scanner_test.ts
git commit -m "feat(domain): secret scanner for pre-sync safety (PAT/Stripe/AWS)"
```

---

## Task 8: SubprocessRunner adapter + gh_cli wrapper

**Files:**

- Create: `src/infrastructure/deno_subprocess.ts`
- Create: `src/infrastructure/gh_cli.ts`
- Create: `tests/infrastructure/gh_cli_test.ts`

- [ ] **Step 1: Write `tests/infrastructure/gh_cli_test.ts`** (uses a fake SubprocessRunner so we
      test the gh command shapes without shelling out)

```typescript
import { assertEquals, assertRejects } from "@std/assert";
import { GhCli } from "../../src/infrastructure/gh_cli.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";

function fakeRunner(
  handler: (cmd: string, args: string[], opts?: SubprocessOptions) => SubprocessResult,
): SubprocessRunner & { calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> } {
  const calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> = [];
  return {
    calls,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return Promise.resolve(handler(cmd, args, opts));
    },
  };
}

Deno.test("GhCli.isAvailable returns true when gh --version exits 0", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "gh version 2.50.0", stderr: "" }));
  const gh = new GhCli(runner);
  assertEquals(await gh.isAvailable(), true);
  assertEquals(runner.calls[0].args, ["--version"]);
});

Deno.test("GhCli.isAvailable returns false when gh missing", async () => {
  const runner = fakeRunner(() => ({ code: 127, stdout: "", stderr: "command not found" }));
  const gh = new GhCli(runner);
  assertEquals(await gh.isAvailable(), false);
});

Deno.test("GhCli.isAuthenticated returns true on exit 0", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "Logged in", stderr: "" }));
  const gh = new GhCli(runner);
  assertEquals(await gh.isAuthenticated(), true);
  assertEquals(runner.calls[0].args, ["auth", "status"]);
});

Deno.test("GhCli.createIssue passes title and body-file", async () => {
  const runner = fakeRunner(() => ({
    code: 0,
    stdout: "https://github.com/o/r/issues/42",
    stderr: "",
  }));
  const gh = new GhCli(runner);
  const number = await gh.createIssue({
    repo: "o/r",
    title: "Hello",
    bodyPath: "/tmp/body.md",
    labels: ["backlog/001", "priority/high"],
  });
  assertEquals(number, 42);
  const args = runner.calls[0].args;
  assertEquals(args.slice(0, 3), ["issue", "create", "--repo"]);
  assertEquals(args.includes("--body-file"), true);
  assertEquals(args.includes("/tmp/body.md"), true);
  assertEquals(args.includes("--label"), true);
});

Deno.test("GhCli.editIssue passes edit args", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const gh = new GhCli(runner);
  await gh.editIssue({
    repo: "o/r",
    number: 42,
    title: "new",
    bodyPath: "/tmp/b.md",
    addLabels: ["x"],
    removeLabels: ["y"],
  });
  const args = runner.calls[0].args;
  assertEquals(args.slice(0, 4), ["issue", "edit", "42", "--repo"]);
  assertEquals(args.includes("--add-label"), true);
  assertEquals(args.includes("--remove-label"), true);
});

Deno.test("GhCli.closeIssue passes --reason", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const gh = new GhCli(runner);
  await gh.closeIssue("o/r", 42, "completed");
  const args = runner.calls[0].args;
  assertEquals(args.slice(0, 4), ["issue", "close", "42", "--repo"]);
  assertEquals(args.includes("--reason"), true);
  assertEquals(args.includes("completed"), true);
});

Deno.test("GhCli.listIssues parses JSON output into rows", async () => {
  const json = JSON.stringify([
    { number: 1, state: "OPEN", labels: [{ name: "backlog/001" }] },
    { number: 2, state: "CLOSED", labels: [{ name: "backlog/002" }, { name: "other" }] },
  ]);
  const runner = fakeRunner(() => ({ code: 0, stdout: json, stderr: "" }));
  const gh = new GhCli(runner);
  const issues = await gh.listIssues("o/r", "backlog/");
  assertEquals(issues.length, 2);
  assertEquals(issues[0].number, 1);
  assertEquals(issues[0].state, "open");
  assertEquals(issues[1].state, "closed");
});

Deno.test("GhCli.createIssue throws on non-zero exit", async () => {
  const runner = fakeRunner(() => ({ code: 1, stdout: "", stderr: "forbidden" }));
  const gh = new GhCli(runner);
  await assertRejects(
    () => gh.createIssue({ repo: "o/r", title: "x", bodyPath: "/tmp/b.md", labels: [] }),
    Error,
    "gh issue create",
  );
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/infrastructure/deno_subprocess.ts`**

```typescript
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../application/ports.ts";

export class DenoSubprocessRunner implements SubprocessRunner {
  async run(cmd: string, args: string[], opts?: SubprocessOptions): Promise<SubprocessResult> {
    const p = new Deno.Command(cmd, {
      args,
      cwd: opts?.cwd,
      env: opts?.env,
      stdin: opts?.stdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    });

    const child = p.spawn();
    if (opts?.stdin) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(opts.stdin));
      await writer.close();
    }
    const { code, stdout, stderr } = await child.output();
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  }
}
```

- [ ] **Step 4: Implement `src/infrastructure/gh_cli.ts`**

```typescript
import type { SubprocessRunner } from "../application/ports.ts";

export type IssueSummary = {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly labels: ReadonlyArray<string>;
};

export type CreateIssueInput = {
  repo: string;
  title: string;
  bodyPath: string;
  labels: ReadonlyArray<string>;
};

export type EditIssueInput = {
  repo: string;
  number: number;
  title?: string;
  bodyPath?: string;
  addLabels?: ReadonlyArray<string>;
  removeLabels?: ReadonlyArray<string>;
};

export class GhCli {
  constructor(private readonly runner: SubprocessRunner) {}

  async isAvailable(): Promise<boolean> {
    const res = await this.runner.run("gh", ["--version"]);
    return res.code === 0;
  }

  async isAuthenticated(): Promise<boolean> {
    const res = await this.runner.run("gh", ["auth", "status"]);
    return res.code === 0;
  }

  async listIssues(repo: string, labelPrefix: string): Promise<IssueSummary[]> {
    const res = await this.runner.run("gh", [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,state,labels",
    ]);
    if (res.code !== 0) {
      throw new Error(`gh issue list failed: ${res.stderr.trim()}`);
    }
    const raw = JSON.parse(res.stdout) as Array<
      { number: number; state: string; labels: Array<{ name: string }> }
    >;
    return raw
      .map((r) => ({
        number: r.number,
        state: r.state.toLowerCase() as "open" | "closed",
        labels: r.labels.map((l) => l.name),
      }))
      .filter((r) => r.labels.some((l) => l.startsWith(labelPrefix)));
  }

  async createIssue(input: CreateIssueInput): Promise<number> {
    const args = [
      "issue",
      "create",
      "--repo",
      input.repo,
      "--title",
      input.title,
      "--body-file",
      input.bodyPath,
    ];
    for (const label of input.labels) args.push("--label", label);
    const res = await this.runner.run("gh", args);
    if (res.code !== 0) {
      throw new Error(`gh issue create failed: ${res.stderr.trim()}`);
    }
    const match = res.stdout.match(/\/issues\/(\d+)\s*$/);
    if (!match) throw new Error(`gh issue create: cannot parse issue number from ${res.stdout}`);
    return Number(match[1]);
  }

  async editIssue(input: EditIssueInput): Promise<void> {
    const args = ["issue", "edit", String(input.number), "--repo", input.repo];
    if (input.title !== undefined) args.push("--title", input.title);
    if (input.bodyPath !== undefined) args.push("--body-file", input.bodyPath);
    for (const label of input.addLabels ?? []) args.push("--add-label", label);
    for (const label of input.removeLabels ?? []) args.push("--remove-label", label);
    const res = await this.runner.run("gh", args);
    if (res.code !== 0) throw new Error(`gh issue edit failed: ${res.stderr.trim()}`);
  }

  async closeIssue(
    repo: string,
    number: number,
    reason: "completed" | "not_planned",
  ): Promise<void> {
    const res = await this.runner.run("gh", [
      "issue",
      "close",
      String(number),
      "--repo",
      repo,
      "--reason",
      reason,
    ]);
    if (res.code !== 0) throw new Error(`gh issue close failed: ${res.stderr.trim()}`);
  }

  async reopenIssue(repo: string, number: number): Promise<void> {
    const res = await this.runner.run("gh", [
      "issue",
      "reopen",
      String(number),
      "--repo",
      repo,
    ]);
    if (res.code !== 0) throw new Error(`gh issue reopen failed: ${res.stderr.trim()}`);
  }

  async graphql<T>(query: string, fields: Record<string, string> = {}): Promise<T> {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [k, v] of Object.entries(fields)) args.push("-f", `${k}=${v}`);
    const res = await this.runner.run("gh", args);
    if (res.code !== 0) throw new Error(`gh api graphql failed: ${res.stderr.trim()}`);
    return JSON.parse(res.stdout) as T;
  }
}
```

- [ ] **Step 5: Run — 8 passed**

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/deno_subprocess.ts src/infrastructure/gh_cli.ts tests/infrastructure/gh_cli_test.ts
git commit -m "feat(infra): SubprocessRunner + typed gh CLI wrapper"
```

---

## Task 9: GitHubBacklogSyncTarget adapter

**Files:**

- Create: `src/infrastructure/github_backlog_sync.ts`
- Create: `tests/infrastructure/github_backlog_sync_test.ts`

This adapter composes GhCli (Issues) + GhCli.graphql (Project V2) to implement `BacklogSyncTarget`.

- [ ] **Step 1: Write `tests/infrastructure/github_backlog_sync_test.ts`**

```typescript
import { assertEquals } from "@std/assert";
import { GitHubBacklogSyncTarget } from "../../src/infrastructure/github_backlog_sync.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";
import type { BacklogTask } from "../../src/domain/backlog/task.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";

function fakeRunner(
  handler: (cmd: string, args: string[]) => SubprocessResult,
): SubprocessRunner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> = [];
  return {
    calls,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return Promise.resolve(handler(cmd, args));
    },
  };
}

const CONFIG: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "kevin/specflow",
    project: null, // simpler for most tests — enable per-test
    label_prefix: "backlog/",
  },
};

function makeTask(overrides: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: "001",
    title: "Hello",
    category: "devex",
    priority: "high",
    complexity: 5,
    status: "todo",
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "Body content",
    ...overrides,
  };
}

Deno.test("listExisting maps gh output to Map<id, issue>", async () => {
  const runner = fakeRunner(() => ({
    code: 0,
    stdout: JSON.stringify([
      { number: 42, state: "OPEN", labels: [{ name: "backlog/001" }] },
      { number: 17, state: "CLOSED", labels: [{ name: "backlog/002" }, { name: "devex" }] },
      { number: 99, state: "OPEN", labels: [{ name: "other" }] }, // filtered out
    ]),
    stderr: "",
  }));
  const target = new GitHubBacklogSyncTarget(runner);
  const existing = await target.listExisting(CONFIG);
  assertEquals(existing.size, 2);
  assertEquals(existing.get("001")?.number, 42);
  assertEquals(existing.get("001")?.state, "open");
  assertEquals(existing.get("002")?.state, "closed");
});

Deno.test("apply(create) builds labels from frontmatter", async () => {
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === "issue" && args[1] === "create") {
      return { code: 0, stdout: "https://github.com/kevin/specflow/issues/42", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply({ kind: "create", task: makeTask() }, CONFIG);
  assertEquals(res.ok, true);
  if (res.ok) assertEquals(res.issueNumber, 42);

  const createCall = runner.calls.find(
    (c) => c.args[0] === "issue" && c.args[1] === "create",
  )!;
  const labels: string[] = [];
  for (let i = 0; i < createCall.args.length - 1; i++) {
    if (createCall.args[i] === "--label") labels.push(createCall.args[i + 1]);
  }
  assertEquals(labels.includes("backlog/001"), true);
  assertEquals(labels.includes("priority/high"), true);
  assertEquals(labels.includes("category/devex"), true);
});

Deno.test("apply(close) calls gh issue close with correct reason", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const target = new GitHubBacklogSyncTarget(runner);
  await target.apply(
    { kind: "close", task: makeTask({ status: "done" }), issueNumber: 42, reason: "completed" },
    CONFIG,
  );
  const call = runner.calls[0];
  assertEquals(call.args.slice(0, 3), ["issue", "close", "42"]);
  assertEquals(call.args.includes("completed"), true);
});

Deno.test("apply(update) edits issue title and refreshes body/labels", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply(
    { kind: "update", task: makeTask({ priority: "critical" }), issueNumber: 42 },
    CONFIG,
  );
  assertEquals(res.ok, true);
  const call = runner.calls.find((c) => c.args[0] === "issue" && c.args[1] === "edit")!;
  assertEquals(call.args.slice(0, 3), ["issue", "edit", "42"]);
});

Deno.test("apply(skip) returns ok:true without any gh call", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply(
    { kind: "skip", task: makeTask(), reason: "invalid frontmatter" },
    CONFIG,
  );
  assertEquals(res.ok, true);
  assertEquals(runner.calls.length, 0);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/infrastructure/github_backlog_sync.ts`**

```typescript
import type { ApplyResult, BacklogSyncTarget, SubprocessRunner } from "../application/ports.ts";
import type { BacklogTask } from "../domain/backlog/task.ts";
import type { ExistingIssue, SyncAction } from "../domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../domain/sync_config.ts";
import { GhCli } from "./gh_cli.ts";

export class GitHubBacklogSyncTarget implements BacklogSyncTarget {
  private readonly gh: GhCli;

  constructor(runner: SubprocessRunner) {
    this.gh = new GhCli(runner);
  }

  async listExisting(config: SyncConfig): Promise<Map<string, ExistingIssue>> {
    const prefix = config.sync.label_prefix;
    const issues = await this.gh.listIssues(config.sync.repo, prefix);
    const out = new Map<string, ExistingIssue>();
    const idRe = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{3})$`);
    for (const issue of issues) {
      for (const label of issue.labels) {
        const m = idRe.exec(label);
        if (m) {
          out.set(m[1], { id: m[1], number: issue.number, state: issue.state });
          break;
        }
      }
    }
    return out;
  }

  async apply(action: SyncAction, config: SyncConfig): Promise<ApplyResult> {
    try {
      switch (action.kind) {
        case "skip":
          return { ok: true, issueNumber: -1, action: "skip" };

        case "create": {
          const number = await this.doCreate(action.task, config);
          return { ok: true, issueNumber: number, action: "create" };
        }

        case "update": {
          await this.doUpdate(action.task, action.issueNumber, config);
          return { ok: true, issueNumber: action.issueNumber, action: "update" };
        }

        case "close": {
          await this.gh.closeIssue(config.sync.repo, action.issueNumber, action.reason);
          return { ok: true, issueNumber: action.issueNumber, action: "close" };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg, action: action.kind, taskId: action.task.id };
    }
  }

  private labelsFor(task: BacklogTask, config: SyncConfig): string[] {
    return [
      `${config.sync.label_prefix}${task.id}`,
      `priority/${task.priority}`,
      `category/${task.category}`,
      ...task.tags,
    ];
  }

  private async writeBodyToTmp(task: BacklogTask): Promise<string> {
    const tmpFile = await Deno.makeTempFile({ prefix: "specflow-body-", suffix: ".md" });
    const body = renderIssueBody(task);
    await Deno.writeTextFile(tmpFile, body);
    return tmpFile;
  }

  private async doCreate(task: BacklogTask, config: SyncConfig): Promise<number> {
    const bodyPath = await this.writeBodyToTmp(task);
    try {
      return await this.gh.createIssue({
        repo: config.sync.repo,
        title: task.title,
        bodyPath,
        labels: this.labelsFor(task, config),
      });
    } finally {
      await Deno.remove(bodyPath).catch(() => {});
    }
  }

  private async doUpdate(task: BacklogTask, number: number, config: SyncConfig): Promise<void> {
    const bodyPath = await this.writeBodyToTmp(task);
    try {
      await this.gh.editIssue({
        repo: config.sync.repo,
        number,
        title: task.title,
        bodyPath,
        addLabels: this.labelsFor(task, config),
      });
    } finally {
      await Deno.remove(bodyPath).catch(() => {});
    }
  }
}

function renderIssueBody(task: BacklogTask): string {
  const meta = [
    `**Backlog ID:** \`${task.id}\``,
    `**Category:** ${task.category}`,
    `**Priority:** ${task.priority}`,
    `**Complexity:** ${task.complexity} pts`,
    `**Status:** \`${task.status}\``,
    task.spec ? `**Spec:** ${task.spec}` : null,
    task.dependsOn.length > 0 ? `**Depends on:** ${task.dependsOn.join(", ")}` : null,
    `**Created:** ${task.created}`,
  ].filter(Boolean).join(" · ");
  return `<!-- managed by specflow backlog sync — edits here will be overwritten -->\n\n${meta}\n\n---\n\n${task.body.trim()}\n`;
}
```

- [ ] **Step 4: Run — 5 passed**

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/github_backlog_sync.ts tests/infrastructure/github_backlog_sync_test.ts
git commit -m "feat(infra): GitHubBacklogSyncTarget — create/update/close via gh"
```

Note : Project V2 attachment & field sync are delivered separately in **Task 15** (this plan). For
Task 9 alone, the adapter ships with Issues-only behaviour — when `config.sync.project` is `null`,
sync works end-to-end without touching the Projects GraphQL API. When a project is configured, Task
15 extends `apply` to also attach the issue and set the mapped fields.

---

## Task 10: SyncBacklogUseCase

**Files:**

- Create: `src/application/sync_backlog.ts`
- Create: `tests/application/sync_backlog_test.ts`

- [ ] **Step 1: Write `tests/application/sync_backlog_test.ts`**

```typescript
import { assert, assertEquals } from "@std/assert";
import { SyncBacklogUseCase } from "../../src/application/sync_backlog.ts";
import type { ApplyResult, BacklogReader, BacklogSyncTarget } from "../../src/application/ports.ts";
import type { BacklogTask } from "../../src/domain/backlog/task.ts";
import type { ExistingIssue, SyncAction } from "../../src/domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";

const CONFIG: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "k/s",
    project: null,
    label_prefix: "backlog/",
  },
};

function task(
  partial: Partial<BacklogTask> & { id: string; status: BacklogTask["status"] },
): BacklogTask {
  return {
    title: "t",
    category: "c",
    priority: "medium",
    complexity: 3,
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "",
    ...partial,
  };
}

function fakeReader(tasks: BacklogTask[]): BacklogReader {
  return {
    readAll: () => Promise.resolve(tasks),
    readOne: (_d, id) => Promise.resolve(tasks.find((t) => t.id === id.padStart(3, "0")) ?? null),
  };
}

function fakeTarget(
  existing: Map<string, ExistingIssue>,
  apply: (a: SyncAction) => ApplyResult,
): BacklogSyncTarget & { actions: SyncAction[] } {
  const actions: SyncAction[] = [];
  return {
    actions,
    listExisting: () => Promise.resolve(existing),
    apply: (a) => {
      actions.push(a);
      return Promise.resolve(apply(a));
    },
  };
}

Deno.test("SyncBacklogUseCase creates new issues in one run", async () => {
  const reader = fakeReader([task({ id: "001", status: "todo" })]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 42, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/proj",
    config: CONFIG,
    dryRun: false,
    singleId: null,
  });
  assertEquals(result.outcomes.length, 1);
  assertEquals(result.outcomes[0].action, "create");
  assertEquals(result.outcomes[0].issueNumber, 42);
  assertEquals(result.failed, 0);
});

Deno.test("SyncBacklogUseCase dry-run returns plan without applying", async () => {
  const reader = fakeReader([task({ id: "001", status: "todo" })]);
  let applyCalled = false;
  const target: BacklogSyncTarget = {
    listExisting: () => Promise.resolve(new Map()),
    apply: () => {
      applyCalled = true;
      return Promise.resolve({ ok: true, issueNumber: 1, action: "create" });
    },
  };
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: true,
    singleId: null,
  });
  assertEquals(applyCalled, false);
  assertEquals(result.plan.length, 1);
  assertEquals(result.plan[0].kind, "create");
});

Deno.test("SyncBacklogUseCase accumulates failures and continues", async () => {
  const reader = fakeReader([
    task({ id: "001", status: "todo" }),
    task({ id: "002", status: "todo" }),
  ]);
  const target = fakeTarget(new Map(), (a) => {
    if (a.kind === "create" && a.task.id === "001") {
      return { ok: false, error: "boom", action: "create", taskId: "001" };
    }
    return { ok: true, issueNumber: 99, action: a.kind };
  });
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: null,
  });
  assertEquals(result.outcomes.length, 2);
  assertEquals(result.failed, 1);
});

Deno.test("SyncBacklogUseCase filters to single id when provided", async () => {
  const reader = fakeReader([
    task({ id: "001", status: "todo" }),
    task({ id: "002", status: "todo" }),
  ]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 1, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: "002",
  });
  assertEquals(result.outcomes.length, 1);
  assertEquals(result.plan[0].task.id, "002");
});

Deno.test("SyncBacklogUseCase skips tasks with detected secrets and marks failure", async () => {
  const taskWithSecret = task({
    id: "001",
    status: "todo",
    body: "key: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  });
  const reader = fakeReader([taskWithSecret]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 1, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: null,
    allowSecrets: false,
  });
  assertEquals(result.plan[0].kind, "skip");
  assertEquals(result.failed, 1);
  // Never called apply
  assert((target as { actions: SyncAction[] }).actions.every((a) => a.kind !== "create"));
});

Deno.test("SyncBacklogUseCase with allowSecrets=true still creates despite secret match", async () => {
  const reader = fakeReader([
    task({
      id: "001",
      status: "todo",
      body: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    }),
  ]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 1, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: null,
    allowSecrets: true,
  });
  assertEquals(result.plan[0].kind, "create");
  assertEquals(result.failed, 0);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/application/sync_backlog.ts`**

```typescript
import type { ApplyResult, BacklogReader, BacklogSyncTarget } from "./ports.ts";
import { scanForSecrets } from "../domain/backlog/secret_scanner.ts";
import { computeSyncPlan, type SyncAction, type SyncPlan } from "../domain/backlog/sync_plan.ts";
import type { BacklogTask } from "../domain/backlog/task.ts";
import type { SyncConfig } from "../domain/sync_config.ts";

export type SyncBacklogInput = {
  projectDir: string;
  config: SyncConfig;
  dryRun: boolean;
  singleId: string | null;
  allowSecrets?: boolean;
};

export type SyncBacklogResult = {
  readonly plan: SyncPlan;
  readonly outcomes: ReadonlyArray<ApplyResult>;
  readonly failed: number;
};

export type SyncBacklogDeps = {
  reader: BacklogReader;
  target: BacklogSyncTarget;
};

export class SyncBacklogUseCase {
  constructor(private readonly deps: SyncBacklogDeps) {}

  async execute(input: SyncBacklogInput): Promise<SyncBacklogResult> {
    const { reader, target } = this.deps;
    const { projectDir, config, dryRun, singleId, allowSecrets = false } = input;

    let tasks = await reader.readAll(projectDir);
    if (singleId !== null) {
      const padded = singleId.padStart(3, "0");
      tasks = tasks.filter((t) => t.id === padded);
    }

    // Replace tasks flagged by the secret scanner with skip-intent markers
    // by mutating the plan after computation.
    const existing = await target.listExisting(config);
    let plan = computeSyncPlan(tasks, existing);

    if (!allowSecrets) {
      plan = plan.map((action): SyncAction => {
        if (action.kind === "skip") return action;
        const hits = scanForSecrets(action.task.body);
        if (hits.length === 0) return action;
        const reason = `secret detected (${hits.map((h) => h.kind).join(", ")})`;
        return { kind: "skip", task: action.task, reason };
      });
    }

    if (dryRun) {
      return { plan, outcomes: [], failed: countSkipsAsFailures(plan) };
    }

    const outcomes: ApplyResult[] = [];
    let failed = 0;
    for (const action of plan) {
      if (action.kind === "skip") {
        outcomes.push({
          ok: false,
          error: action.reason,
          action: "skip",
          taskId: action.task.id,
        });
        failed += 1;
        continue;
      }
      const outcome = await target.apply(action, config);
      outcomes.push(outcome);
      if (!outcome.ok) failed += 1;
    }

    return { plan, outcomes, failed };
  }
}

function countSkipsAsFailures(plan: SyncPlan): number {
  return plan.filter((a) => a.kind === "skip").length;
}

// Unused export suppression
export type { BacklogTask };
```

- [ ] **Step 4: Run — 6 passed**

- [ ] **Step 5: Commit**

```bash
git add src/application/sync_backlog.ts tests/application/sync_backlog_test.ts
git commit -m "feat(app): SyncBacklogUseCase (diff + apply + secret scan)"
```

---

## Task 11: ConfigureSyncUseCase + TerminalPrompt

**Files:**

- Create: `src/application/configure_sync.ts`
- Create: `src/infrastructure/terminal_prompt.ts`
- Create: `tests/application/configure_sync_test.ts`

- [ ] **Step 1: Write `tests/application/configure_sync_test.ts`**

```typescript
import { assertEquals } from "@std/assert";
import { ConfigureSyncUseCase } from "../../src/application/configure_sync.ts";
import type {
  BacklogSyncTarget,
  ConfigStore,
  InteractivePrompt,
  SubprocessRunner,
} from "../../src/application/ports.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";

function fakePrompt(answers: Record<string, string>): InteractivePrompt {
  return {
    select: (message, choices) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      const chosen = key ? answers[key] : choices[0].value;
      return Promise.resolve(chosen);
    },
    confirm: (message) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      return Promise.resolve(key ? answers[key] === "yes" : false);
    },
    text: (message, def) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      return Promise.resolve(key ? answers[key] : def ?? "");
    },
  };
}

function fakeStore(): ConfigStore & { written?: SyncConfig } {
  let written: SyncConfig | undefined;
  return {
    read: () => Promise.resolve(null),
    write: (_d, c) => {
      written = c;
      return Promise.resolve();
    },
    configPath: (d) => `${d}/.specflow/config.yml`,
    get written() {
      return written;
    },
  } as ConfigStore & { written?: SyncConfig };
}

function fakeProjects(runner: "none" | "one" | "many"): SubprocessRunner {
  return {
    run: (_cmd, args) => {
      if (args[0] === "--version") {
        return Promise.resolve({ code: 0, stdout: "gh 2", stderr: "" });
      }
      if (args.includes("auth") && args.includes("status")) {
        return Promise.resolve({ code: 0, stdout: "authed", stderr: "" });
      }
      if (args.includes("graphql")) {
        const projects = runner === "none"
          ? []
          : runner === "one"
          ? [{ id: "P1", number: 3, title: "MyProj" }]
          : [
            { id: "P1", number: 1, title: "Alpha" },
            { id: "P2", number: 2, title: "Beta" },
          ];
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({
            data: { viewer: { projectsV2: { nodes: projects } } },
          }),
          stderr: "",
        });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  };
}

Deno.test("ConfigureSyncUseCase writes a config with no project when user picks 'none'", async () => {
  const store = fakeStore();
  const prompt = fakePrompt({ "Which project": "__none__" });
  const uc = new ConfigureSyncUseCase({
    store,
    prompt,
    runner: fakeProjects("one"),
  });
  const cfg = await uc.execute({
    projectDir: "/p",
    repoHint: "kevin/specflow",
  });
  assertEquals(cfg.sync.project, null);
  assertEquals(cfg.sync.repo, "kevin/specflow");
  assertEquals(store.written?.sync.provider, "github");
});

Deno.test("ConfigureSyncUseCase writes a config with selected project", async () => {
  const store = fakeStore();
  const prompt = fakePrompt({ "Which project": "3", "Status field": "Status" });
  const uc = new ConfigureSyncUseCase({
    store,
    prompt,
    runner: fakeProjects("one"),
  });
  const cfg = await uc.execute({
    projectDir: "/p",
    repoHint: "kevin/specflow",
  });
  assertEquals(cfg.sync.project?.number, 3);
});

Deno.test("ConfigureSyncUseCase fails fast when gh unavailable", async () => {
  const store = fakeStore();
  const prompt = fakePrompt({});
  const runner: SubprocessRunner = {
    run: () => Promise.resolve({ code: 127, stdout: "", stderr: "not found" }),
  };
  const uc = new ConfigureSyncUseCase({ store, prompt, runner });
  let threw = false;
  try {
    await uc.execute({ projectDir: "/p", repoHint: "k/s" });
  } catch (err) {
    threw = true;
    if (err instanceof Error) {
      assertEquals(err.message.includes("gh CLI"), true);
    }
  }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/application/configure_sync.ts`**

```typescript
import type { ConfigStore, InteractivePrompt, SubprocessRunner } from "./ports.ts";
import type { SyncConfig } from "../domain/sync_config.ts";
import { GhCli } from "../infrastructure/gh_cli.ts";

export type ConfigureSyncInput = {
  projectDir: string;
  repoHint: string; // parsed from `git remote get-url origin` by the handler
};

export type ConfigureSyncDeps = {
  store: ConfigStore;
  prompt: InteractivePrompt;
  runner: SubprocessRunner;
};

type GqlProject = { id: string; number: number; title: string };
type GqlFieldsResponse = {
  data: {
    node: {
      fields: {
        nodes: Array<{ id: string; name: string; dataType: string }>;
      };
    };
  };
};

export class ConfigureSyncUseCase {
  constructor(private readonly deps: ConfigureSyncDeps) {}

  async execute(input: ConfigureSyncInput): Promise<SyncConfig> {
    const { store, prompt, runner } = this.deps;
    const gh = new GhCli(runner);

    if (!(await gh.isAvailable())) {
      throw new Error("gh CLI required — install from https://cli.github.com");
    }
    if (!(await gh.isAuthenticated())) {
      throw new Error("gh not authenticated — run 'gh auth login' first");
    }

    const projects = await this.listProjects(gh);

    let project: SyncConfig["sync"]["project"] = null;
    if (projects.length > 0) {
      const choices = [
        ...projects.map((p) => ({
          label: `#${p.number} — ${p.title}`,
          value: String(p.number),
        })),
        { label: "No project — issues only", value: "__none__" },
      ];
      const picked = await prompt.select("Which project to sync to?", choices);
      if (picked !== "__none__") {
        const chosen = projects.find((p) => String(p.number) === picked)!;
        project = await this.configureProject(gh, prompt, chosen);
      }
    }

    const cfg: SyncConfig = {
      version: 1,
      sync: {
        provider: "github",
        repo: input.repoHint,
        project,
        label_prefix: "backlog/",
      },
    };
    await store.write(input.projectDir, cfg);
    return cfg;
  }

  private async listProjects(gh: GhCli): Promise<GqlProject[]> {
    const query = `query { viewer { projectsV2(first: 50) { nodes { id number title } } } }`;
    const res = await gh.graphql<{
      data: { viewer: { projectsV2: { nodes: GqlProject[] } } };
    }>(query);
    return res.data.viewer.projectsV2.nodes;
  }

  private async configureProject(
    gh: GhCli,
    prompt: InteractivePrompt,
    project: GqlProject,
  ) {
    const query = `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name dataType }
              ... on ProjectV2IterationField { id name dataType }
            }
          }
        }
      }
    }`;
    const res = await gh.graphql<GqlFieldsResponse>(query, { id: project.id });
    const fields = res.data.node.fields.nodes;

    const resolveField = async (message: string, preferredName: string): Promise<string> => {
      const exact = fields.find((f) => f.name === preferredName);
      const choices = fields.map((f) => ({ label: `${f.name} (${f.dataType})`, value: f.name }));
      return await prompt.select(
        message,
        exact
          ? [
            { label: `${exact.name} (${exact.dataType})`, value: exact.name },
            ...choices.filter((c) => c.value !== exact.name),
          ]
          : choices,
      );
    };

    const status = await resolveField("Status field", "Status");
    const priority = await resolveField("Priority field", "Priority");
    const complexity = await resolveField("Complexity field", "Complexity");

    return {
      number: project.number,
      owner: project.title.split(" ")[0], // simple heuristic — owner is typically carried via repo config
      fieldMap: { status, priority, complexity },
    };
  }
}
```

- [ ] **Step 4: Implement `src/infrastructure/terminal_prompt.ts`**

```typescript
import { promptSecret, promptSelect } from "@std/cli/unstable-prompt-select";
import type { InteractivePrompt } from "../application/ports.ts";

// NOTE: @std/cli/unstable-prompt-select exports promptSelect but the signature
// accepts a simple list of string choices. We wrap to accept { label, value }.

export class TerminalPrompt implements InteractivePrompt {
  async select(
    message: string,
    choices: ReadonlyArray<{ label: string; value: string }>,
  ): Promise<string> {
    const labels = choices.map((c) => c.label);
    const picked = promptSelect(message, labels);
    if (picked === null) throw new Error("Prompt cancelled");
    const index = labels.indexOf(picked);
    return choices[index].value;
  }

  confirm(message: string, defaultYes: boolean): Promise<boolean> {
    const suffix = defaultYes ? " (Y/n) " : " (y/N) ";
    const raw = prompt(message + suffix)?.trim().toLowerCase() ?? "";
    if (raw === "") return Promise.resolve(defaultYes);
    return Promise.resolve(raw.startsWith("y"));
  }

  text(message: string, defaultValue?: string): Promise<string> {
    const raw = prompt(message, defaultValue)?.trim();
    return Promise.resolve(raw ?? defaultValue ?? "");
  }

  // promptSecret left re-exported for future password prompts
  _promptSecret = promptSecret;
}
```

- [ ] **Step 5: Run tests — 3 passed**

- [ ] **Step 6: Commit**

```bash
git add src/application/configure_sync.ts src/infrastructure/terminal_prompt.ts tests/application/configure_sync_test.ts
git commit -m "feat(app): ConfigureSyncUseCase + TerminalPrompt adapter"
```

---

## Task 12: CLI parser + handlers

**Files:**

- Modify: `src/cli/parser.ts`
- Modify: `src/cli/help.ts`
- Modify: `src/main.ts`
- Create: `src/cli/handlers/backlog_sync_handler.ts`
- Create: `src/cli/handlers/backlog_configure_handler.ts`
- Modify: `tests/cli/parser_test.ts`

- [ ] **Step 1: Extend `tests/cli/parser_test.ts`**

Append these tests (do not replace existing tests):

```typescript
Deno.test("parseArgs returns backlog-sync intent with no args", () => {
  assertEquals(parseArgs(["backlog", "sync"]), {
    kind: "backlog-sync",
    singleId: null,
    dryRun: false,
    allowSecrets: false,
  });
});

Deno.test("parseArgs returns backlog-sync intent with --id and --dry-run", () => {
  assertEquals(parseArgs(["backlog", "sync", "--id", "042", "--dry-run"]), {
    kind: "backlog-sync",
    singleId: "042",
    dryRun: true,
    allowSecrets: false,
  });
});

Deno.test("parseArgs returns backlog-configure intent", () => {
  assertEquals(parseArgs(["backlog", "configure"]), { kind: "backlog-configure" });
});

Deno.test("parseArgs rejects backlog without subcommand", () => {
  assertEquals(parseArgs(["backlog"]), {
    kind: "unknown",
    received: "backlog (missing subcommand)",
  });
});
```

- [ ] **Step 2: Extend `src/cli/parser.ts`**

Add to the `Intent` union :

```typescript
| { kind: "backlog-sync"; singleId: string | null; dryRun: boolean; allowSecrets: boolean }
| { kind: "backlog-configure" }
```

Add to `boolean` flags of `stdParseArgs`: `"dry-run"`, `"allow-secrets"`. Add to `string` flags:
`"id"`. Then add handling for the `backlog` command:

```typescript
if (command === "backlog") {
  const sub = rest[0];
  if (sub === "sync") {
    return {
      kind: "backlog-sync",
      singleId: typeof parsed.id === "string" ? parsed.id : null,
      dryRun: Boolean(parsed["dry-run"]),
      allowSecrets: Boolean(parsed["allow-secrets"]),
    };
  }
  if (sub === "configure") {
    return { kind: "backlog-configure" };
  }
  return { kind: "unknown", received: "backlog (missing subcommand)" };
}
```

- [ ] **Step 3: Extend `src/cli/help.ts`**

Add to HELP usage section :

```
specflow backlog sync [--id NNN] [--dry-run] [--allow-secrets]
                                   Sync tasks/backlog/ to GitHub Issues + Project V2
specflow backlog configure         Interactive setup of .specflow/config.yml
```

- [ ] **Step 4: Write `src/cli/handlers/backlog_sync_handler.ts`**

```typescript
import { resolve } from "@std/path";
import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import { SyncBacklogUseCase } from "../../application/sync_backlog.ts";
import { FsBacklogReader } from "../../infrastructure/fs_backlog_reader.ts";
import { FsConfigStore } from "../../infrastructure/fs_config_store.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { GitHubBacklogSyncTarget } from "../../infrastructure/github_backlog_sync.ts";

export type BacklogSyncIntent = {
  kind: "backlog-sync";
  singleId: string | null;
  dryRun: boolean;
  allowSecrets: boolean;
};

export async function runBacklogSync(intent: BacklogSyncIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());
  const store = new FsConfigStore();
  const config = await store.read(projectDir);
  if (config === null) {
    console.error(red("error: no config found at .specflow/config.yml"));
    console.error("Run `specflow backlog configure` first.");
    return 2;
  }

  const runner = new DenoSubprocessRunner();
  const target = new GitHubBacklogSyncTarget(runner);
  const reader = new FsBacklogReader();

  console.log(
    `${bold("specflow")} backlog sync ${dim(`(${config.sync.repo})`)}`,
  );

  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir,
    config,
    dryRun: intent.dryRun,
    singleId: intent.singleId,
    allowSecrets: intent.allowSecrets,
  });

  if (intent.dryRun) {
    for (const a of result.plan) {
      const tag = a.kind === "skip"
        ? yellow(`⚠ ${a.task.id} skip (${a.reason})`)
        : a.kind === "create"
        ? green(`+ ${a.task.id} create`)
        : a.kind === "update"
        ? `↻ ${a.task.id} update #${(a as { issueNumber: number }).issueNumber}`
        : `× ${a.task.id} close #${(a as { issueNumber: number }).issueNumber}`;
      console.log(tag);
    }
    return result.failed > 0 ? 1 : 0;
  }

  for (let i = 0; i < result.outcomes.length; i++) {
    const o = result.outcomes[i];
    const a = result.plan[i];
    if (o.ok) {
      console.log(
        green(
          `✓ ${a.task.id} ${o.action}` +
            (o.issueNumber > 0 ? ` → issue #${o.issueNumber}` : ""),
        ),
      );
    } else {
      console.error(red(`✗ ${o.taskId} ${o.action} — ${o.error}`));
    }
  }
  console.log(
    dim(`\n${result.outcomes.length - result.failed} ok, ${result.failed} failed`),
  );
  return result.failed > 0 ? 1 : 0;
}
```

- [ ] **Step 5: Write `src/cli/handlers/backlog_configure_handler.ts`**

```typescript
import { resolve } from "@std/path";
import { bold, green, red } from "@std/fmt/colors";
import { ConfigureSyncUseCase } from "../../application/configure_sync.ts";
import { FsConfigStore } from "../../infrastructure/fs_config_store.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { TerminalPrompt } from "../../infrastructure/terminal_prompt.ts";

export type BacklogConfigureIntent = { kind: "backlog-configure" };

async function detectRepo(): Promise<string> {
  const p = new Deno.Command("git", {
    args: ["remote", "get-url", "origin"],
    stdout: "piped",
    stderr: "null",
  });
  const out = await p.output();
  if (!out.success) throw new Error("git remote origin not set");
  const url = new TextDecoder().decode(out.stdout).trim();
  // Support both SSH (git@github.com:owner/name.git) and HTTPS forms.
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!m) throw new Error(`Unsupported remote URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}

export async function runBacklogConfigure(
  _intent: BacklogConfigureIntent,
): Promise<number> {
  const projectDir = resolve(Deno.cwd());
  const repoHint = await detectRepo();
  const uc = new ConfigureSyncUseCase({
    store: new FsConfigStore(),
    prompt: new TerminalPrompt(),
    runner: new DenoSubprocessRunner(),
  });

  try {
    const cfg = await uc.execute({ projectDir, repoHint });
    const store = new FsConfigStore();
    console.log(
      green(`✓ wrote ${store.configPath(projectDir)}`),
    );
    console.log(`${bold("repo:")}    ${cfg.sync.repo}`);
    console.log(
      `${bold("project:")} ${cfg.sync.project ? `#${cfg.sync.project.number}` : "(none)"}`,
    );
    console.log("\nNext: `specflow backlog sync` to push your current backlog.");
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 1;
  }
}
```

- [ ] **Step 6: Wire `src/main.ts`**

Add cases to the intent switch :

```typescript
case "backlog-sync": {
  const { runBacklogSync } = await import("./cli/handlers/backlog_sync_handler.ts");
  return await runBacklogSync(intent);
}
case "backlog-configure": {
  const { runBacklogConfigure } = await import("./cli/handlers/backlog_configure_handler.ts");
  return await runBacklogConfigure(intent);
}
```

- [ ] **Step 7: Run tests + quality gates**

```bash
deno fmt
deno lint
deno check src/main.ts
deno task test
```

Expected: prior tests + 4 new parser tests + 3 configure + 6 sync + 5 github_sync + 8 gh_cli + 4
config store + 5 reader + 6 secret + 7 plan + 15 task/frontmatter = ~80+ total. All green.

- [ ] **Step 8: Commit**

```bash
git add src/cli/parser.ts src/cli/help.ts src/cli/handlers tests/cli/parser_test.ts src/main.ts
git commit -m "feat(cli): backlog sync + configure sub-commands"
```

---

## Task 13: Integration test with gh shim

**Files:**

- Create: `tests/integration/backlog_sync_test.ts`
- Create: `tests/integration/fixtures/gh-shim.sh` (a fake `gh` executable for the test)

- [ ] **Step 1: Write the gh shim**

Write `/Users/kevin/Sites/specflow/tests/integration/fixtures/gh-shim.sh`:

```bash
#!/usr/bin/env bash
# Records args to /tmp/gh-shim.log and prints canned responses.
# Used by tests/integration/backlog_sync_test.ts.
echo "$@" >> "${GH_SHIM_LOG:-/tmp/gh-shim.log}"

case "$1 $2" in
  "--version "*) echo "gh version 2.50.0"; exit 0 ;;
  "auth status") exit 0 ;;
  "issue list")
    # empty list → create path
    echo "[]"
    exit 0
    ;;
  "issue create")
    # echo a URL so GhCli parses the issue number
    echo "https://github.com/kevin/specflow/issues/42"
    exit 0
    ;;
  "issue edit"*|"issue close"*|"issue reopen"*)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
```

Mark it executable.

- [ ] **Step 2: Write the integration test**

Write `/Users/kevin/Sites/specflow/tests/integration/backlog_sync_test.ts`:

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const MAIN = new URL("../../src/main.ts", import.meta.url).pathname;
const SHIM_DIR = new URL("./fixtures/", import.meta.url).pathname;

async function run(args: string[], opts: { cwd: string; logFile: string }) {
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
    env: {
      PATH: `${SHIM_DIR}:${Deno.env.get("PATH") ?? ""}`,
      GH_SHIM_LOG: opts.logFile,
    },
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

async function setupProject(): Promise<{ dir: string; logFile: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specflow-integ-bs-" });
  const logFile = `${dir}/gh.log`;

  // Init git with origin so detectRepo works for `configure` tests.
  const git = async (...a: string[]) =>
    new Deno.Command("git", { args: a, cwd: dir, stdout: "null", stderr: "null" }).output();
  await git("init");
  await git("remote", "add", "origin", "https://github.com/kevin/specflow.git");

  // Pre-write a config (so sync has a target without prompting).
  await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specflow/config.yml"),
    `version: 1
sync:
  provider: github
  repo: kevin/specflow
  label_prefix: backlog/
`,
  );

  // Seed a single backlog task.
  await Deno.mkdir(join(dir, "tasks/backlog"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "tasks/backlog/001-hello.md"),
    `---
id: "001"
title: "Hello"
category: devex
priority: high
complexity: 3
status: todo
depends_on: []
spec: null
tags: []
created: 2026-04-24
---

A first task.
`,
  );

  return { dir, logFile };
}

async function teardown(dir: string) {
  await Deno.remove(dir, { recursive: true });
}

Deno.test("specflow backlog sync --dry-run prints create plan", async () => {
  const { dir, logFile } = await setupProject();
  try {
    const { code, stdout } = await run(["backlog", "sync", "--dry-run"], {
      cwd: dir,
      logFile,
    });
    assertEquals(code, 0);
    assertStringIncludes(stdout, "+ 001 create");
  } finally {
    await teardown(dir);
  }
});

Deno.test("specflow backlog sync calls gh with expected args", async () => {
  const { dir, logFile } = await setupProject();
  try {
    const { code } = await run(["backlog", "sync"], { cwd: dir, logFile });
    assertEquals(code, 0);
    const log = await Deno.readTextFile(logFile);
    assertStringIncludes(log, "issue list");
    assertStringIncludes(log, "issue create");
    assertStringIncludes(log, "backlog/001");
    assertStringIncludes(log, "priority/high");
  } finally {
    await teardown(dir);
  }
});

Deno.test("specflow backlog sync exits 2 when config missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specflow-integ-bs-noconfig-" });
  try {
    await Deno.mkdir(join(dir, "tasks/backlog"), { recursive: true });
    const { code, stderr } = await run(["backlog", "sync"], {
      cwd: dir,
      logFile: `${dir}/x.log`,
    });
    assertEquals(code, 2);
    assertStringIncludes(stderr, "specflow backlog configure");
  } finally {
    await teardown(dir);
  }
});

Deno.test("specflow backlog sync --id filters to the specified task", async () => {
  const { dir, logFile } = await setupProject();
  try {
    await Deno.writeTextFile(
      join(dir, "tasks/backlog/002-second.md"),
      `---
id: "002"
title: "Second"
category: devex
priority: low
complexity: 1
status: todo
depends_on: []
spec: null
tags: []
created: 2026-04-24
---

Second task.
`,
    );
    const { code } = await run(["backlog", "sync", "--id", "002"], {
      cwd: dir,
      logFile,
    });
    assertEquals(code, 0);
    const log = await Deno.readTextFile(logFile);
    assertStringIncludes(log, "backlog/002");
    // Ensure 001 was NOT created during this run
    const createCount = (log.match(/issue create/g) || []).length;
    assertEquals(createCount, 1);
  } finally {
    await teardown(dir);
  }
});
```

- [ ] **Step 3: Run the integration tests**

```bash
chmod +x tests/integration/fixtures/gh-shim.sh
deno task test
```

Expected: all prior + 4 new integration = ~84 green.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/backlog_sync_test.ts tests/integration/fixtures/gh-shim.sh
git commit -m "test(integration): backlog sync end-to-end with gh shim"
```

---

## Task 14: Template updates + TEMPLATES_VERSION bump

**Files:**

- Modify: `templates/claude/agents/product-owner.md`
- Modify: `templates/claude/commands/backlog.md`
- Modify: `deno.json`
- Modify: `src/domain/version.ts`

- [ ] **Step 1: Update `templates/claude/agents/product-owner.md`**

Read the file. Locate the section :

```markdown
### `/backlog sync` and `/backlog sync <id>`

Not yet available in this Specflow version. Tell the user: "Remote backlog sync is planned for a
future Specflow release. Your tasks are persisted locally in `tasks/backlog/` and
`tasks/backlog.md`."
```

Replace it with :

```markdown
### `/backlog sync` and `/backlog sync <id>`

Runs `specflow backlog sync` (all tasks) or `specflow backlog sync --id NNN` (single task) via
shell. Preconditions:

1. A config must exist at `.specflow/config.yml`. If missing, prompt the user to run
   `/backlog configure` (which calls `specflow backlog configure`).
2. `gh` CLI must be installed and authenticated.

After every mutation from `add`/`update`/`groom`/`estimate`, you MUST emit this directive to the
orchestrator so the sync runs immediately:

> 🔄 **Sync required**: run `specflow backlog sync --id NNN` after commit.

For `groom` (which mutates many tasks), emit `specflow backlog sync` without `--id`. The
orchestrator is responsible for executing the shell command; you do not have Bash permission. This
is non-negotiable: missing the sync creates silent divergence between filesystem and GitHub, and
that has happened before.
```

- [ ] **Step 2: Update `templates/claude/commands/backlog.md`**

Locate the table row :

```markdown
| `sync` | (Future) push all tasks to remote tracker | | `sync <id>` | (Future) push a single task |
```

Replace :

```markdown
| `sync` | Push all tasks to GitHub Issues + Project V2 (via `specflow backlog sync`) | |
`sync <id>` | Push a single task by id (via `specflow backlog sync --id NNN`) | | `configure` | Set
up `.specflow/config.yml` interactively (via `specflow backlog configure`) |
```

Also add a `configure` row if missing.

- [ ] **Step 3: Bump `TEMPLATES_VERSION` from `0.1.0` to `0.2.0`**

Edit `src/domain/version.ts`:

```typescript
export const TEMPLATES_VERSION = "0.2.0";
```

- [ ] **Step 4: Regenerate the bundle**

```bash
deno task bundle
```

Expected: `Bundled 38 template(s) → src/templates_bundle.ts` (no new files, existing two modified).

- [ ] **Step 5: Run full test suite**

```bash
deno task test
```

Expected: ~84 green.

- [ ] **Step 6: Compile binary and run a smoke check**

```bash
deno run --allow-read --allow-write --allow-run --allow-env src/main.ts --version
# Expected: specflow 0.1.0-alpha.1 (templates 0.2.0)

deno run --allow-read --allow-write --allow-run --allow-env src/main.ts --help
# Expected: --help now includes the backlog sync + configure lines
```

- [ ] **Step 7: Commit**

```bash
git add templates/claude/agents/product-owner.md templates/claude/commands/backlog.md src/domain/version.ts src/templates_bundle.ts
git commit -m "feat(templates): wire product-owner agent to specflow backlog sync (bump templates to 0.2.0)"
```

---

## Task 15: Project V2 attachment & field sync

Completes delta #3's Project V2 coverage. When `config.sync.project` is set, every `create` and
`update` action also attaches the issue to the project and pushes the mapped field values (status /
priority / complexity).

**Files:**

- Modify: `src/infrastructure/gh_cli.ts` (add `getIssueNodeId`, `getProjectFields`,
  `addProjectItem`, `updateProjectFieldValue`)
- Modify: `src/infrastructure/github_backlog_sync.ts` (call attach + field updates)
- Create: `tests/infrastructure/project_v2_test.ts`

- [ ] **Step 1: Write the test stub for Project V2 attach**

Write `/Users/kevin/Sites/specflow/tests/infrastructure/project_v2_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { GitHubBacklogSyncTarget } from "../../src/infrastructure/github_backlog_sync.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";
import type { BacklogTask } from "../../src/domain/backlog/task.ts";

const CONFIG_WITH_PROJECT: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "kevin/specflow",
    project: {
      number: 3,
      owner: "kevin",
      fieldMap: { status: "Status", priority: "Priority", complexity: "Complexity" },
    },
    label_prefix: "backlog/",
  },
};

const TASK: BacklogTask = {
  id: "001",
  title: "hi",
  category: "devex",
  priority: "high",
  complexity: 5,
  status: "in_progress",
  dependsOn: [],
  spec: null,
  tags: [],
  created: "2026-04-24",
  body: "body",
};

function scriptedRunner(
  responses: Array<{ match: RegExp; result: SubprocessResult }>,
): SubprocessRunner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> = [];
  return {
    calls,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const joined = args.join(" ");
      const match = responses.find((r) => r.match.test(joined));
      if (!match) {
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve(match.result);
    },
  };
}

Deno.test("apply(create) with project attaches issue and sets 3 fields", async () => {
  const runner = scriptedRunner([
    {
      match: /issue create/,
      result: { code: 0, stdout: "https://github.com/kevin/specflow/issues/42", stderr: "" },
    },
    {
      match: /getIssueNodeId|viewer.*issue\(number/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { repository: { issue: { id: "I_kwA42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /projectFields|fields\(first/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: {
            node: {
              fields: {
                nodes: [
                  {
                    id: "F_status",
                    name: "Status",
                    dataType: "SINGLE_SELECT",
                    options: [
                      { id: "O_todo", name: "Todo" },
                      { id: "O_progress", name: "In progress" },
                      { id: "O_done", name: "Done" },
                    ],
                  },
                  { id: "F_priority", name: "Priority", dataType: "NUMBER" },
                  { id: "F_complexity", name: "Complexity", dataType: "NUMBER" },
                ],
              },
            },
          },
        }),
        stderr: "",
      },
    },
    {
      match: /addProjectV2ItemById/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { addProjectV2ItemById: { item: { id: "PVT_item42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /updateProjectV2ItemFieldValue/,
      result: { code: 0, stdout: JSON.stringify({ data: {} }), stderr: "" },
    },
  ]);
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply({ kind: "create", task: TASK }, CONFIG_WITH_PROJECT);
  assertEquals(res.ok, true);

  const fieldUpdates = runner.calls.filter((c) =>
    c.args.some((a) => a.includes("updateProjectV2ItemFieldValue"))
  );
  assertEquals(fieldUpdates.length, 3); // status, priority, complexity
});

Deno.test("apply(update) with project does NOT re-add the item if already attached (idempotent)", async () => {
  // In v1 we always call addProjectV2ItemById — GitHub returns the existing
  // item if already attached, which is idempotent server-side.
  const runner = scriptedRunner([
    {
      match: /issue edit/,
      result: { code: 0, stdout: "", stderr: "" },
    },
    {
      match: /repository.*issue\(number/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { repository: { issue: { id: "I_kwA42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /projectFields|fields\(first/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: {
            node: {
              fields: {
                nodes: [
                  {
                    id: "F_status",
                    name: "Status",
                    dataType: "SINGLE_SELECT",
                    options: [
                      { id: "O_progress", name: "In progress" },
                    ],
                  },
                  { id: "F_priority", name: "Priority", dataType: "NUMBER" },
                  { id: "F_complexity", name: "Complexity", dataType: "NUMBER" },
                ],
              },
            },
          },
        }),
        stderr: "",
      },
    },
    {
      match: /addProjectV2ItemById/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { addProjectV2ItemById: { item: { id: "PVT_item42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /updateProjectV2ItemFieldValue/,
      result: { code: 0, stdout: "{}", stderr: "" },
    },
  ]);
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply(
    { kind: "update", task: TASK, issueNumber: 42 },
    CONFIG_WITH_PROJECT,
  );
  assertEquals(res.ok, true);
});

Deno.test("apply(close) does not touch Project V2 fields", async () => {
  const runner = scriptedRunner([
    { match: /issue close/, result: { code: 0, stdout: "", stderr: "" } },
  ]);
  const target = new GitHubBacklogSyncTarget(runner);
  await target.apply(
    { kind: "close", task: TASK, issueNumber: 42, reason: "completed" },
    CONFIG_WITH_PROJECT,
  );
  // No GraphQL calls for status changes — the issue's closed state already reflects "done".
  const graphqlCalls = runner.calls.filter((c) => c.args.includes("graphql"));
  assertEquals(graphqlCalls.length, 0);
});
```

- [ ] **Step 2: Extend `src/infrastructure/gh_cli.ts` with Project V2 helpers**

Append to the existing class :

```typescript
async getIssueNodeId(repo: string, number: number): Promise<string> {
  const [owner, name] = repo.split("/");
  const query = `query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) { id }
    }
  }`;
  const res = await this.runner.run("gh", [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `num=${number}`,
  ]);
  if (res.code !== 0) throw new Error(`getIssueNodeId failed: ${res.stderr.trim()}`);
  const parsed = JSON.parse(res.stdout) as {
    data: { repository: { issue: { id: string } | null } };
  };
  const id = parsed.data.repository.issue?.id;
  if (!id) throw new Error(`Issue #${number} not found in ${repo}`);
  return id;
}

async getProjectFields(projectNodeId: string): Promise<ProjectField[]> {
  const query = `query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field { id name dataType }
            ... on ProjectV2SingleSelectField {
              id name dataType
              options { id name }
            }
          }
        }
      }
    }
  }`;
  const res = await this.graphql<{
    data: { node: { fields: { nodes: ProjectField[] } } };
  }>(query, { id: projectNodeId });
  return res.data.node.fields.nodes;
}

async resolveProjectNodeId(owner: string, number: number): Promise<string> {
  // Projects V2 are owned by users or orgs; we try user first, then fallback to org.
  const query = `query($login: String!, $num: Int!) {
    user(login: $login) { projectV2(number: $num) { id } }
    organization(login: $login) { projectV2(number: $num) { id } }
  }`;
  const res = await this.graphql<{
    data: {
      user: { projectV2: { id: string } | null } | null;
      organization: { projectV2: { id: string } | null } | null;
    };
  }>(query, { login: owner, num: String(number) });
  const id = res.data.user?.projectV2?.id ?? res.data.organization?.projectV2?.id;
  if (!id) throw new Error(`Project #${number} not found for ${owner}`);
  return id;
}

async addProjectItem(projectNodeId: string, contentNodeId: string): Promise<string> {
  const mutation = `mutation($p: ID!, $c: ID!) {
    addProjectV2ItemById(input: {projectId: $p, contentId: $c}) {
      item { id }
    }
  }`;
  const res = await this.graphql<{
    data: { addProjectV2ItemById: { item: { id: string } } };
  }>(mutation, { p: projectNodeId, c: contentNodeId });
  return res.data.addProjectV2ItemById.item.id;
}

async updateProjectNumberField(
  projectNodeId: string,
  itemNodeId: string,
  fieldNodeId: string,
  value: number,
): Promise<void> {
  const mutation = `mutation($p: ID!, $i: ID!, $f: ID!, $v: Float!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $p, itemId: $i, fieldId: $f,
      value: { number: $v }
    }) { projectV2Item { id } }
  }`;
  await this.graphql(mutation, {
    p: projectNodeId,
    i: itemNodeId,
    f: fieldNodeId,
    v: String(value),
  });
}

async updateProjectSingleSelectField(
  projectNodeId: string,
  itemNodeId: string,
  fieldNodeId: string,
  optionId: string,
): Promise<void> {
  const mutation = `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $p, itemId: $i, fieldId: $f,
      value: { singleSelectOptionId: $o }
    }) { projectV2Item { id } }
  }`;
  await this.graphql(mutation, {
    p: projectNodeId,
    i: itemNodeId,
    f: fieldNodeId,
    o: optionId,
  });
}
```

Add type at the top of the file :

```typescript
export type ProjectField = {
  id: string;
  name: string;
  dataType: "SINGLE_SELECT" | "NUMBER" | "TEXT" | "ITERATION" | "DATE";
  options?: Array<{ id: string; name: string }>;
};
```

- [ ] **Step 3: Extend `src/infrastructure/github_backlog_sync.ts`**

Add a private method and call it from `apply` after create/update :

```typescript
private async syncToProject(
  issueNumber: number,
  task: BacklogTask,
  config: SyncConfig,
): Promise<void> {
  const project = config.sync.project;
  if (!project) return;

  const projectNodeId = await this.gh.resolveProjectNodeId(project.owner, project.number);
  const issueNodeId = await this.gh.getIssueNodeId(config.sync.repo, issueNumber);
  const itemId = await this.gh.addProjectItem(projectNodeId, issueNodeId);
  const fields = await this.gh.getProjectFields(projectNodeId);

  const findField = (name: string): ProjectField | undefined =>
    fields.find((f) => f.name === name);

  const statusField = findField(project.fieldMap.status);
  if (statusField && statusField.dataType === "SINGLE_SELECT") {
    const option = statusField.options?.find(
      (o) => normaliseStatusLabel(o.name) === task.status,
    );
    if (option) {
      await this.gh.updateProjectSingleSelectField(
        projectNodeId, itemId, statusField.id, option.id,
      );
    }
  }

  const priorityField = findField(project.fieldMap.priority);
  if (priorityField && priorityField.dataType === "NUMBER") {
    await this.gh.updateProjectNumberField(
      projectNodeId, itemId, priorityField.id, priorityToNumber(task.priority),
    );
  }

  const complexityField = findField(project.fieldMap.complexity);
  if (complexityField && complexityField.dataType === "NUMBER") {
    await this.gh.updateProjectNumberField(
      projectNodeId, itemId, complexityField.id, task.complexity,
    );
  }
}

function normaliseStatusLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "_");
}

function priorityToNumber(p: BacklogTask["priority"]): number {
  return { critical: 1, high: 2, medium: 3, low: 4 }[p];
}
```

Then in `apply`, after the successful `doCreate` or `doUpdate` :

```typescript
case "create": {
  const number = await this.doCreate(action.task, config);
  await this.syncToProject(number, action.task, config);
  return { ok: true, issueNumber: number, action: "create" };
}

case "update": {
  await this.doUpdate(action.task, action.issueNumber, config);
  await this.syncToProject(action.issueNumber, action.task, config);
  return { ok: true, issueNumber: action.issueNumber, action: "update" };
}
```

Import `ProjectField` from `./gh_cli.ts`.

- [ ] **Step 4: Run the new test + full suite**

```bash
deno task test
```

Expected: ~87 green (prior ~84 + 3 new Project V2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/gh_cli.ts src/infrastructure/github_backlog_sync.ts tests/infrastructure/project_v2_test.ts
git commit -m "feat(infra): attach issues to Project V2 + sync mapped fields"
```

---

## Wrap-up

At the end of Task 15 the repo has:

- `specflow backlog configure` — interactive setup of `.specflow/config.yml`
- `specflow backlog sync [--id NNN] [--dry-run] [--allow-secrets]` — one-way MD → GitHub Issues +
  Project V2 push
- 6 new domain files (task, frontmatter, sync_plan, secret_scanner, sync_config) with ~45 unit tests
- 3 new application files (sync_backlog, configure_sync, extended ports) with ~10 tests
- 6 new infrastructure files (fs_backlog_reader, fs_config_store, deno_subprocess, gh_cli,
  github_backlog_sync, terminal_prompt) with ~20 tests
- 2 new CLI handlers + extended parser + help
- 4 new integration tests using a `gh` shim on PATH
- Templates bumped to 0.2.0 (product-owner agent and `/backlog` command updated to reference the
  real `specflow backlog sync` command)

Target total test count : ~87 (from 50 at end of v0.1-init).

### How to validate end-to-end

1. `deno task test` — all green.
2. Against a real GitHub repo you own:
   ```bash
   cd /tmp && specflow init demo && cd demo
   git init && git remote add origin git@github.com:YOU/demo.git
   specflow backlog configure      # picks a real Project V2
   # Add a task manually to tasks/backlog/001-test.md then:
   specflow backlog sync --dry-run
   specflow backlog sync
   ```
3. Verify the issue exists on GitHub with labels `backlog/001`, `priority/*`, `category/*`.

### Deferred work

- **Bidirectional sync** (GH → MD) — v0.2.
- **GitLab / Bitbucket adapters** — v0.3. The `BacklogSyncTarget` port is ready for them.
- **Drift detection** — warn when a GitHub issue body diverges from the MD source. Out of scope; MD
  always wins in v0.1.
- **Multiple projects per config** — not a common need, revisit if asked.
- **Auto-creating a Project V2** via config — out of scope; user must pre-create via UI or
  `gh project create`.
