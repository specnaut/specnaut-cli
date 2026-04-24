# Specflow `upgrade` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `specflow upgrade [--dry-run] [--force]` that updates templates in an existing
project to the binary's embedded version, auto-updating unmodified files and preserving (with diff
display) files the user customized locally.

**Architecture:** Hexagonal/DDD continued. New domain: `installed_lock.ts` (YAML value object),
`upgrade_plan.ts` (pure diff algorithm), `diff.ts` (unified diff renderer), `sha256.ts` (shared hash
util). New ports: `LockStore`, `FsReader`. New adapters: `FsLockStore`, `FsReader`. New use case:
`UpgradeProjectUseCase`. `InitProjectUseCase` is modified to write the lock at init time. New CLI
intent `upgrade`, new handler. `.specflow.bak` backups reuse the existing `backupExisting` flag on
`FsWriter`.

**Tech Stack:** Deno 2 + TypeScript + `@std/yaml`, `@std/fmt/colors`. `crypto.subtle.digest` for
SHA256. No external deps.

**Scope:** ships `specflow upgrade` end-to-end. Explicitly out of scope: rollback, 3-way merge
(rejected in brainstorm), binary upgrade (that's `self-update`), auto-publish Homebrew.

**Reference docs:**

- Design: `docs/superpowers/specs/2026-04-25-specflow-upgrade-design.md`
- Previous plans: v0.1-init, backlog-sync, release-ready

---

## File Structure (additions)

```
src/
├── domain/
│   ├── sha256.ts                  # NEW — hex SHA-256 of UTF-8 string (extracted from self_update)
│   ├── installed_lock.ts          # NEW — InstalledLock + parse/serialize
│   ├── upgrade_plan.ts            # NEW — UpgradeAction union + computeUpgradePlan()
│   └── diff.ts                    # NEW — unified-diff renderer for 2 strings
├── application/
│   ├── ports.ts                   # MODIFY — add LockStore + FsReader
│   ├── init_project.ts            # MODIFY — persist lock on init
│   └── upgrade_project.ts         # NEW — UpgradeProjectUseCase
├── infrastructure/
│   ├── fs_lock_store.ts           # NEW — FsLockStore via @std/yaml
│   └── fs_reader.ts               # NEW — DenoFsReader adapter
├── cli/
│   ├── parser.ts                  # MODIFY — add upgrade intent
│   ├── help.ts                    # MODIFY — usage line
│   └── handlers/
│       └── upgrade_handler.ts     # NEW — renders diff + confirms + applies
├── application/
│   └── self_update.ts             # MODIFY — use shared sha256 util (optional cleanup)
└── main.ts                        # MODIFY — dispatch upgrade intent

tests/
├── domain/
│   ├── sha256_test.ts
│   ├── installed_lock_test.ts
│   ├── upgrade_plan_test.ts
│   └── diff_test.ts
├── application/
│   ├── init_project_test.ts       # EXTEND — verify lock written at init
│   └── upgrade_project_test.ts    # NEW
├── infrastructure/
│   └── fs_lock_store_test.ts      # NEW
└── integration/
    └── upgrade_test.ts            # NEW
```

---

## Task 1: Extract shared `sha256Hex` helper

**Files:**

- Create: `src/domain/sha256.ts`
- Create: `tests/domain/sha256_test.ts`
- Modify: `src/application/self_update.ts` — import shared util

- [ ] **Step 1: Write the failing test**

Write `/Users/kevin/Sites/specflow/tests/domain/sha256_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../src/domain/sha256.ts";

Deno.test("sha256Hex of empty string is the known constant", async () => {
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("sha256Hex of a short string", async () => {
  assertEquals(
    await sha256Hex("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

Deno.test("sha256Hex is deterministic", async () => {
  const a = await sha256Hex("hello world");
  const b = await sha256Hex("hello world");
  assertEquals(a, b);
});

Deno.test("sha256Hex handles unicode correctly", async () => {
  // UTF-8 bytes of "é" = 0xC3 0xA9
  const digest = await sha256Hex("é");
  assertEquals(digest.length, 64);
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `deno test tests/domain/sha256_test.ts`

- [ ] **Step 3: Implement `src/domain/sha256.ts`**

```typescript
/**
 * Lowercase hex SHA-256 of the UTF-8 encoding of `input`.
 * Shared helper — used by self-update (binary checksum) and upgrade (file
 * integrity tracking in .specflow/installed.lock).
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Same as `sha256Hex` but for already-encoded bytes (e.g. downloaded binary).
 */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 4: Run — expect 4 passed**

- [ ] **Step 5: Update `src/application/self_update.ts` to use the shared util**

READ the file. Find the `sha256Hex` private function at the bottom. Delete it. Replace the call site
(inside `execute`) to use the imported helper:

```typescript
import { sha256HexBytes } from "../domain/sha256.ts";
// …
const actualSha = await sha256HexBytes(bytes);
```

Remove the now-dead internal function.

- [ ] **Step 6: Full suite — expect 156 + 4 = 160 green**

Run: `deno task test`

- [ ] **Step 7: Commit**

```bash
deno fmt
git add src/domain/sha256.ts src/application/self_update.ts tests/domain/sha256_test.ts
git commit -m "refactor(domain): extract shared sha256Hex util (self-update + upgrade)"
```

Pre-commit hook must pass.

---

## Task 2: `InstalledLock` domain + YAML round-trip

**Files:**

- Create: `src/domain/installed_lock.ts`
- Create: `tests/domain/installed_lock_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import {
  type InstalledLock,
  type LockEntry,
  parseLock,
  serializeLock,
} from "../../src/domain/installed_lock.ts";

const VALID_YAML = `version: 1
templates_version: 0.2.0
entries:
  ".claude/commands/speckit.specify.md":
    sha256: abc123
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: 0.2.0
  AGENTS.md:
    sha256: def456
    installed_at: "2026-04-25T10:00:00Z"
    templates_version: 0.2.0
`;

Deno.test("parseLock returns a structured lock for valid YAML", () => {
  const lock = parseLock(VALID_YAML);
  assertEquals(lock.version, 1);
  assertEquals(lock.templatesVersion, "0.2.0");
  assertEquals(lock.entries.size, 2);
  const speckit = lock.entries.get(".claude/commands/speckit.specify.md");
  assertEquals(speckit?.sha256, "abc123");
  assertEquals(speckit?.installedAt, "2026-04-25T10:00:00Z");
});

Deno.test("parseLock rejects unsupported version", () => {
  const yaml = VALID_YAML.replace("version: 1", "version: 42");
  assertThrows(() => parseLock(yaml), Error, "version");
});

Deno.test("parseLock rejects missing templates_version", () => {
  const yaml = VALID_YAML.replace(/templates_version:.*\n/, "");
  assertThrows(() => parseLock(yaml), Error, "templates_version");
});

Deno.test("serializeLock round-trips", () => {
  const lock: InstalledLock = {
    version: 1,
    templatesVersion: "0.3.0",
    entries: new Map<string, LockEntry>([
      ["CLAUDE.md", {
        sha256: "aaa",
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.3.0",
      }],
    ]),
  };
  const yaml = serializeLock(lock);
  const roundtrip = parseLock(yaml);
  assertEquals(roundtrip.version, lock.version);
  assertEquals(roundtrip.templatesVersion, lock.templatesVersion);
  assertEquals(
    roundtrip.entries.get("CLAUDE.md")?.sha256,
    "aaa",
  );
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/domain/installed_lock.ts`**

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export type LockEntry = {
  readonly sha256: string;
  readonly installedAt: string;
  readonly templatesVersion: string;
};

export type InstalledLock = {
  readonly version: 1;
  readonly templatesVersion: string;
  readonly entries: ReadonlyMap<string, LockEntry>;
};

function asObject(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== "object") {
    throw new Error(`${name} must be an object`);
  }
  return v as Record<string, unknown>;
}

export function parseLock(yaml: string): InstalledLock {
  const root = asObject(parseYaml(yaml), "lock root");

  if (root.version !== 1) {
    throw new Error(`Unsupported lock version (expected 1): ${String(root.version)}`);
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
  return { version: 1, templatesVersion, entries };
}

export function serializeLock(lock: InstalledLock): string {
  const entriesObj: Record<string, Record<string, string>> = {};
  // Sort by key for stable output
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
    version: 1,
    templates_version: lock.templatesVersion,
    entries: entriesObj,
  });
}
```

- [ ] **Step 4: Run — expect 4 passed**

- [ ] **Step 5: Full suite — expect 164 green (160 + 4)**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/domain/installed_lock.ts tests/domain/installed_lock_test.ts
git commit -m "feat(domain): InstalledLock + YAML round-trip"
```

---

## Task 3: Diff renderer

**Files:**

- Create: `src/domain/diff.ts`
- Create: `tests/domain/diff_test.ts`

Implements a minimal unified-diff renderer for two UTF-8 strings. Not pixel-compatible with
`git diff`; sufficient for humans reading terminal output.

- [ ] **Step 1: Write the failing test**

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { renderUnifiedDiff } from "../../src/domain/diff.ts";

Deno.test("renderUnifiedDiff of identical strings returns empty string", () => {
  assertEquals(renderUnifiedDiff("same\ncontent\n", "same\ncontent\n", "a", "b"), "");
});

Deno.test("renderUnifiedDiff shows added line", () => {
  const diff = renderUnifiedDiff(
    "line1\n",
    "line1\nline2\n",
    "old",
    "new",
  );
  assertStringIncludes(diff, "--- old");
  assertStringIncludes(diff, "+++ new");
  assertStringIncludes(diff, "+line2");
});

Deno.test("renderUnifiedDiff shows removed line", () => {
  const diff = renderUnifiedDiff("a\nb\n", "a\n", "old", "new");
  assertStringIncludes(diff, "-b");
});

Deno.test("renderUnifiedDiff shows modified line", () => {
  const diff = renderUnifiedDiff("hello\n", "hi\n", "old", "new");
  assertStringIncludes(diff, "-hello");
  assertStringIncludes(diff, "+hi");
});

Deno.test("renderUnifiedDiff preserves at least one context line", () => {
  const oldText = "a\nb\nc\nd\ne\n";
  const newText = "a\nb\nCHANGED\nd\ne\n";
  const diff = renderUnifiedDiff(oldText, newText, "old", "new");
  // Context lines prefixed by space
  assert(diff.includes(" b"));
  assert(diff.includes(" d"));
  assertStringIncludes(diff, "-c");
  assertStringIncludes(diff, "+CHANGED");
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/domain/diff.ts`**

Use a simple LCS-based line diff. Not minimal unified-diff format, but readable.

```typescript
/**
 * Render a unified-ish diff of two text blobs. Not bit-compatible with
 * `git diff` — just enough to help a human review a local customization
 * against a new template.
 *
 * The output contains:
 *   --- {oldLabel}
 *   +++ {newLabel}
 *   {context lines prefixed with space, added with +, removed with -}
 *
 * Returns an empty string when both inputs are identical.
 */
export function renderUnifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string,
): string {
  if (oldText === newText) return "";

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS table (lengths only).
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const out: string[] = [];
  out.push(`--- ${oldLabel}`);
  out.push(`+++ ${newLabel}`);

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`-${oldLines[i]}`);
      i++;
    } else {
      out.push(`+${newLines[j]}`);
      j++;
    }
  }
  while (i < m) {
    out.push(`-${oldLines[i]}`);
    i++;
  }
  while (j < n) {
    out.push(`+${newLines[j]}`);
    j++;
  }

  return out.join("\n") + "\n";
}
```

- [ ] **Step 4: Run — expect 5 passed**

- [ ] **Step 5: Full — expect 169 green**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/domain/diff.ts tests/domain/diff_test.ts
git commit -m "feat(domain): LCS-based unified diff renderer for upgrade output"
```

---

## Task 4: `UpgradePlan` domain + `computeUpgradePlan`

**Files:**

- Create: `src/domain/upgrade_plan.ts`
- Create: `tests/domain/upgrade_plan_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import { computeUpgradePlan, type UpgradeAction } from "../../src/domain/upgrade_plan.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

const emptyLock: InstalledLock = {
  version: 1,
  templatesVersion: "0.1.0",
  entries: new Map(),
};

function lockWith(path: string, sha: string): InstalledLock {
  return {
    version: 1,
    templatesVersion: "0.1.0",
    entries: new Map([[
      path,
      { sha256: sha, installedAt: "2026-04-25T00:00:00Z", templatesVersion: "0.1.0" },
    ]]),
  };
}

Deno.test("computeUpgradePlan emits add-new for file not on disk and not in lock", () => {
  const plan = computeUpgradePlan(
    new Map(),
    emptyLock,
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "add-new");
  if (plan[0].kind === "add-new") assertEquals(plan[0].dest, "CLAUDE.md");
});

Deno.test("computeUpgradePlan emits unchanged when disk matches new bundle", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "same-sha"]]),
    lockWith("CLAUDE.md", "same-sha"),
    new Map([["CLAUDE.md", "same-sha"]]),
  );
  assertEquals(plan[0].kind, "unchanged");
});

Deno.test("computeUpgradePlan emits auto-update when disk matches lock but differs from new", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "old-sha"]]),
    lockWith("CLAUDE.md", "old-sha"),
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "auto-update");
  if (plan[0].kind === "auto-update") {
    assertEquals(plan[0].oldSha, "old-sha");
    assertEquals(plan[0].newSha, "new-sha");
  }
});

Deno.test("computeUpgradePlan emits preserve when disk diverges from lock and new bundle", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "user-sha"]]),
    lockWith("CLAUDE.md", "original-sha"),
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "preserve");
});

Deno.test("computeUpgradePlan emits preserve when no lock entry and disk differs", () => {
  const plan = computeUpgradePlan(
    new Map([["CLAUDE.md", "user-sha"]]),
    emptyLock,
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "preserve");
});

Deno.test("computeUpgradePlan re-adds file that user deleted (was in lock)", () => {
  const plan = computeUpgradePlan(
    new Map(), // file deleted from disk
    lockWith("CLAUDE.md", "original-sha"),
    new Map([["CLAUDE.md", "new-sha"]]),
  );
  assertEquals(plan[0].kind, "add-new");
});

Deno.test("computeUpgradePlan does not emit actions for files removed from the new bundle", () => {
  const plan = computeUpgradePlan(
    new Map([["old.md", "a-sha"]]),
    lockWith("old.md", "a-sha"),
    new Map(), // new bundle no longer has old.md
  );
  assertEquals(plan.length, 0);
});

Deno.test("computeUpgradePlan sorts actions by dest for deterministic output", () => {
  const plan = computeUpgradePlan(
    new Map(),
    emptyLock,
    new Map([
      ["z.md", "z"],
      ["a.md", "a"],
      ["m.md", "m"],
    ]),
  );
  assertEquals(plan.map((a: UpgradeAction) => a.dest), ["a.md", "m.md", "z.md"]);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/domain/upgrade_plan.ts`**

```typescript
import type { InstalledLock } from "./installed_lock.ts";

export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | { kind: "preserve"; dest: string; reason: "customized" }
  | { kind: "add-new"; dest: string }
  | { kind: "unchanged"; dest: string };

export type UpgradePlan = ReadonlyArray<UpgradeAction>;

/**
 * Compute the upgrade plan from three SHA256 snapshots:
 *   - `diskShas` : current content SHA of each file (null if absent)
 *   - `lock`     : the .specflow/installed.lock
 *   - `newShas`  : SHA of each file in the binary's embedded templates
 *
 * Emits one UpgradeAction per destination in the new bundle. Files that
 * exist in the lock but NOT in the new bundle are ignored (caller handles
 * the lock cleanup separately — see design §5 edge case).
 */
export function computeUpgradePlan(
  diskShas: Map<string, string>,
  lock: InstalledLock,
  newShas: Map<string, string>,
): UpgradePlan {
  const actions: UpgradeAction[] = [];
  const sortedDests = [...newShas.keys()].sort();

  for (const dest of sortedDests) {
    const newSha = newShas.get(dest)!;
    const diskSha = diskShas.get(dest);
    const lockSha = lock.entries.get(dest)?.sha256;

    if (diskSha === undefined) {
      actions.push({ kind: "add-new", dest });
      continue;
    }
    if (diskSha === newSha) {
      actions.push({ kind: "unchanged", dest });
      continue;
    }
    if (lockSha === undefined) {
      actions.push({ kind: "preserve", dest, reason: "customized" });
      continue;
    }
    if (diskSha === lockSha) {
      actions.push({ kind: "auto-update", dest, oldSha: lockSha, newSha });
      continue;
    }
    actions.push({ kind: "preserve", dest, reason: "customized" });
  }

  return actions;
}
```

- [ ] **Step 4: Run — expect 8 passed**

- [ ] **Step 5: Full — expect 177 green**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/domain/upgrade_plan.ts tests/domain/upgrade_plan_test.ts
git commit -m "feat(domain): computeUpgradePlan — 4-way diff of disk/lock/bundle"
```

---

## Task 5: Ports — `LockStore` + `FsReader`

**Files:**

- Modify: `src/application/ports.ts`

- [ ] **Step 1: Read existing ports.ts** to preserve all exports.

- [ ] **Step 2: Append at end of file**

```typescript
import type { InstalledLock } from "../domain/installed_lock.ts";

export interface LockStore {
  read(projectDir: string): Promise<InstalledLock | null>;
  write(projectDir: string, lock: InstalledLock): Promise<void>;
  lockPath(projectDir: string): string;
}

export interface FsReader {
  readText(projectDir: string, rel: string): Promise<string | null>;
}
```

- [ ] **Step 3: Type-check**

Run: `deno check src/main.ts` Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
deno fmt
git add src/application/ports.ts
git commit -m "feat(ports): LockStore + FsReader interfaces"
```

---

## Task 6: `FsLockStore` adapter

**Files:**

- Create: `src/infrastructure/fs_lock_store.ts`
- Create: `tests/infrastructure/fs_lock_store_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

async function withProjectDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-lockstore-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const SAMPLE: InstalledLock = {
  version: 1,
  templatesVersion: "0.3.0",
  entries: new Map([
    ["CLAUDE.md", {
      sha256: "aaa",
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: "0.3.0",
    }],
  ]),
};

Deno.test("FsLockStore.read returns null when absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsLockStore();
    assertEquals(await store.read(dir), null);
  });
});

Deno.test("FsLockStore.write then read round-trips", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsLockStore();
    await store.write(dir, SAMPLE);
    const read = await store.read(dir);
    assertEquals(read?.templatesVersion, "0.3.0");
    assertEquals(read?.entries.get("CLAUDE.md")?.sha256, "aaa");
  });
});

Deno.test("FsLockStore.write creates .specflow dir if absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsLockStore();
    await store.write(dir, SAMPLE);
    const stat = await Deno.stat(join(dir, ".specflow/installed.lock"));
    assertEquals(stat.isFile, true);
  });
});

Deno.test("FsLockStore.lockPath returns canonical location", () => {
  const store = new FsLockStore();
  assertEquals(store.lockPath("/proj"), "/proj/.specflow/installed.lock");
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/infrastructure/fs_lock_store.ts`**

```typescript
import { dirname, join } from "@std/path";
import { type InstalledLock, parseLock, serializeLock } from "../domain/installed_lock.ts";
import type { LockStore } from "../application/ports.ts";

export class FsLockStore implements LockStore {
  lockPath(projectDir: string): string {
    return join(projectDir, ".specflow/installed.lock");
  }

  async read(projectDir: string): Promise<InstalledLock | null> {
    const path = this.lockPath(projectDir);
    try {
      const raw = await Deno.readTextFile(path);
      return parseLock(raw);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async write(projectDir: string, lock: InstalledLock): Promise<void> {
    const path = this.lockPath(projectDir);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, serializeLock(lock));
  }
}
```

- [ ] **Step 4: Run — 4 passed**

- [ ] **Step 5: Commit**

```bash
deno fmt
git add src/infrastructure/fs_lock_store.ts tests/infrastructure/fs_lock_store_test.ts
git commit -m "feat(infra): FsLockStore persists InstalledLock to .specflow/installed.lock"
```

---

## Task 7: `DenoFsReader` adapter

**Files:**

- Create: `src/infrastructure/fs_reader.ts`

Tiny adapter. No dedicated test file — it's used (and indirectly exercised) by the
`upgrade_project_test.ts` integration in Task 9.

- [ ] **Step 1: Implement**

```typescript
import { join } from "@std/path";
import type { FsReader } from "../application/ports.ts";

export class DenoFsReader implements FsReader {
  async readText(projectDir: string, rel: string): Promise<string | null> {
    try {
      return await Deno.readTextFile(join(projectDir, rel));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }
}
```

- [ ] **Step 2: Type-check + full suite — expect all green (no behavioural change yet)**

```bash
deno check src/main.ts
deno task test
```

- [ ] **Step 3: Commit**

```bash
deno fmt
git add src/infrastructure/fs_reader.ts
git commit -m "feat(infra): DenoFsReader for lightweight fs reads"
```

---

## Task 8: Init writes the lock file

**Files:**

- Modify: `src/application/init_project.ts`
- Modify: `src/cli/handlers/init_handler.ts`
- Modify: `tests/application/init_project_test.ts` (append 1 test, update existing fakes)

- [ ] **Step 1: Extend `InitProjectDeps`**

READ `src/application/init_project.ts`. Replace the `InitProjectDeps` type:

```typescript
import type { LockStore } from "./ports.ts";

export type InitProjectDeps = {
  writer: FsWriter;
  git: GitAdapter;
  lockStore: LockStore;
  bundle: Bundle;
  ensureDir(path: string): Promise<void>;
  now?: () => Date; // test seam
};
```

- [ ] **Step 2: Extend `execute()` to persist the lock after successful write**

Add the import at the top:

```typescript
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import { TEMPLATES_VERSION } from "../domain/version.ts";
```

At the end of the success path (after `writer.writeBundle`, before the git block), add:

```typescript
const now = (this.deps.now ?? (() => new Date()))().toISOString();
const entries = new Map<string, LockEntry>();
for (const [dest, file] of Object.entries(bundle)) {
  entries.set(dest, {
    sha256: await sha256Hex(file.content),
    installedAt: now,
    templatesVersion: TEMPLATES_VERSION,
  });
}
const lock: InstalledLock = {
  version: 1,
  templatesVersion: TEMPLATES_VERSION,
  entries,
};
await this.deps.lockStore.write(input.targetDir, lock);
```

Return `lockWritten: true` in the `InitResult.initialized`:

```typescript
export type InitResult =
  | {
    status: "initialized";
    filesWritten: number;
    warnings: string[];
    backups: string[];
    lockWritten: boolean;
  }
  | { status: "conflicts"; conflicts: string[] };
```

- [ ] **Step 3: Update `init_handler.ts`**

READ the file. Update the `InitProjectUseCase` construction to include the new deps:

```typescript
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
// …
const useCase = new InitProjectUseCase({
  writer: new DenoFsWriter(),
  git: new DenoGit(),
  lockStore: new FsLockStore(),
  bundle: TEMPLATES,
  ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
});
```

- [ ] **Step 4: Update existing `tests/application/init_project_test.ts` fakes**

READ the file. Every test builds an `InitProjectUseCase`. They need a fake `LockStore` now. Add a
helper at top of the file:

```typescript
import type { LockStore } from "../../src/application/ports.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

function fakeLockStore(): LockStore & { written: InstalledLock | null } {
  let written: InstalledLock | null = null;
  return {
    written,
    read: () => Promise.resolve(null),
    write: (_d, lock) => {
      Object.assign(arguments[1], {}); // no-op
      // Just record — the `written` closure below captures by reference.
      Object.defineProperty(
        Object.getPrototypeOf(arguments[0]),
        "written",
        { value: lock, writable: true, configurable: true },
      );
      return Promise.resolve();
    },
    lockPath: (d) => `${d}/.specflow/installed.lock`,
  };
}
```

The above is convoluted. Use a **simpler** plain-object helper :

```typescript
function fakeLockStore(): LockStore & { lastWritten: InstalledLock | null } {
  const state: { lastWritten: InstalledLock | null } = { lastWritten: null };
  return {
    get lastWritten() {
      return state.lastWritten;
    },
    read: () => Promise.resolve(null),
    write: (_d, lock) => {
      state.lastWritten = lock;
      return Promise.resolve();
    },
    lockPath: (d) => `${d}/.specflow/installed.lock`,
  };
}
```

Then, in every `InitProjectUseCase` constructor call, add `lockStore: fakeLockStore()`.

For a couple tests that need to assert the lock was written (test below), capture the lock store:

```typescript
const lockStore = fakeLockStore();
const uc = new InitProjectUseCase({ writer: …, git: …, lockStore, bundle, ensureDir: … });
// later: assertEquals(lockStore.lastWritten?.entries.size, Object.keys(bundle).length);
```

- [ ] **Step 5: Add a new test asserting the lock is written**

APPEND to `tests/application/init_project_test.ts`:

```typescript
Deno.test("InitProjectUseCase persists an installed.lock with SHA256 of every file", async () => {
  const lockStore = fakeLockStore();
  const uc = new InitProjectUseCase({
    writer: fakeFsWriter(),
    git: fakeGit(),
    lockStore,
    bundle: {
      "a.md": { content: "alpha", executable: false },
      "b.md": { content: "beta", executable: false },
    },
    ensureDir: () => Promise.resolve(),
    now: () => new Date("2026-04-25T10:00:00Z"),
  });
  await uc.execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: false,
  });
  const written = lockStore.lastWritten;
  assert(written !== null, "lock not written");
  assertEquals(written!.entries.size, 2);
  const aEntry = written!.entries.get("a.md");
  assert(aEntry !== undefined);
  assertEquals(aEntry!.installedAt, "2026-04-25T10:00:00.000Z");
  // SHA256 of "alpha"
  assertEquals(
    aEntry!.sha256,
    "4e3c4c23a6a6ad1eea2e75a4d69b3c9fc5b33c64c8fcc2c7c9d89f5c41b4f56b", // placeholder — recompute
  );
});
```

**NOTE**: the SHA256 value above is a placeholder — compute the real value with
`deno eval 'console.log(await (async () => { const b = new TextEncoder().encode("alpha"); const d = await crypto.subtle.digest("SHA-256", b); return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, "0")).join(""); })())'`
before writing the test. Or just check `aEntry!.sha256.length === 64` if you want to skip the
exact-value check.

Simpler assertion:

```typescript
assertEquals(aEntry!.sha256.length, 64);
assertEquals(typeof aEntry!.sha256, "string");
```

That avoids the recompute. Use that form.

- [ ] **Step 6: Run full suite — expect 178 green (177 + 1 new)**

- [ ] **Step 7: Commit**

```bash
deno fmt
git add src/application/init_project.ts src/cli/handlers/init_handler.ts tests/application/init_project_test.ts
git commit -m "feat(init): write .specflow/installed.lock at init time"
```

Pre-commit hook must pass.

---

## Task 9: `UpgradeProjectUseCase`

**Files:**

- Create: `src/application/upgrade_project.ts`
- Create: `tests/application/upgrade_project_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assert, assertEquals } from "@std/assert";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import type { BackupReport, FsReader, FsWriter, LockStore } from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

function fakeWriter(): FsWriter & { written: Map<string, string>; backupsRequested: boolean } {
  const written = new Map<string, string>();
  let backupsRequested = false;
  return {
    get written() {
      return written;
    },
    get backupsRequested() {
      return backupsRequested;
    },
    detectConflicts: () => Promise.resolve([]),
    writeBundle: (bundle, _t, options) => {
      if (options?.backupExisting) backupsRequested = true;
      for (const [dest, file] of Object.entries(bundle)) {
        written.set(dest, file.content);
      }
      return Promise.resolve({ backups: [] } as BackupReport);
    },
  };
}

function fakeReader(files: Record<string, string>): FsReader {
  return {
    readText: (_d, rel) => Promise.resolve(files[rel] ?? null),
  };
}

function fakeLockStore(initial: InstalledLock | null): LockStore & { last: InstalledLock | null } {
  let last = initial;
  return {
    get last() {
      return last;
    },
    read: () => Promise.resolve(last),
    write: (_d, lock) => {
      last = lock;
      return Promise.resolve();
    },
    lockPath: (d) => `${d}/.specflow/installed.lock`,
  };
}

async function shaMap(obj: Record<string, string>): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) m.set(k, await sha256Hex(v));
  return m;
}

Deno.test("UpgradeProjectUseCase errors when lock is missing", async () => {
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({}),
    writer: fakeWriter(),
    lockStore: fakeLockStore(null),
    bundle: { "a.md": { content: "alpha", executable: false } },
    templatesVersion: "0.3.0",
  });
  let threw = false;
  try {
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  } catch (err) {
    threw = true;
    assert(err instanceof Error);
    assert(err.message.includes("installed.lock"));
  }
  assertEquals(threw, true);
});

Deno.test("UpgradeProjectUseCase returns up-to-date when disk + lock + bundle all match", async () => {
  const content = "content";
  const sha = await sha256Hex(content);
  const lock: InstalledLock = {
    version: 1,
    templatesVersion: "0.3.0",
    entries: new Map([["a.md", {
      sha256: sha,
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: "0.3.0",
    }]]),
  };
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ "a.md": content }),
    writer: fakeWriter(),
    lockStore: fakeLockStore(lock),
    bundle: { "a.md": { content, executable: false } },
    templatesVersion: "0.3.0",
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "up-to-date");
});

Deno.test("UpgradeProjectUseCase returns planned (no writes) in dry-run", async () => {
  const oldContent = "OLD";
  const newContent = "NEW";
  const oldSha = await sha256Hex(oldContent);
  const lock: InstalledLock = {
    version: 1,
    templatesVersion: "0.2.0",
    entries: new Map([["a.md", {
      sha256: oldSha,
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: "0.2.0",
    }]]),
  };
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ "a.md": oldContent }),
    writer,
    lockStore: fakeLockStore(lock),
    bundle: { "a.md": { content: newContent, executable: false } },
    templatesVersion: "0.3.0",
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: true, force: false });
  assertEquals(result.status, "planned");
  if (result.status === "planned") {
    assertEquals(result.plan[0].kind, "auto-update");
  }
  assertEquals(writer.written.size, 0);
});

Deno.test("UpgradeProjectUseCase applies auto-update and skips preserve", async () => {
  const oldSha = await sha256Hex("OLD");
  const lock: InstalledLock = {
    version: 1,
    templatesVersion: "0.2.0",
    entries: new Map([
      ["clean.md", {
        sha256: oldSha,
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.2.0",
      }],
      ["custom.md", {
        sha256: await sha256Hex("ORIGINAL"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.2.0",
      }],
    ]),
  };
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({
      "clean.md": "OLD",
      "custom.md": "USER-EDITED",
    }),
    writer,
    lockStore: fakeLockStore(lock),
    bundle: {
      "clean.md": { content: "NEW", executable: false },
      "custom.md": { content: "OUR-NEW", executable: false },
    },
    templatesVersion: "0.3.0",
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.get("clean.md"), "NEW");
  assertEquals(writer.written.has("custom.md"), false);
});

Deno.test("UpgradeProjectUseCase with --force overwrites preserve actions with backup", async () => {
  const lock: InstalledLock = {
    version: 1,
    templatesVersion: "0.2.0",
    entries: new Map([["a.md", {
      sha256: await sha256Hex("ORIGINAL"),
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: "0.2.0",
    }]]),
  };
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ "a.md": "USER-EDITED" }),
    writer,
    lockStore: fakeLockStore(lock),
    bundle: { "a.md": { content: "OURS-NEW", executable: false } },
    templatesVersion: "0.3.0",
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: true });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.get("a.md"), "OURS-NEW");
  assertEquals(writer.backupsRequested, true);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/application/upgrade_project.ts`**

```typescript
import type { FsReader, FsWriter, LockStore } from "./ports.ts";
import type { Bundle, TemplateFile } from "../domain/template.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import { computeUpgradePlan, type UpgradePlan } from "../domain/upgrade_plan.ts";

export type UpgradeProjectInput = {
  projectDir: string;
  dryRun: boolean;
  force: boolean;
};

export type UpgradeProjectResult =
  | { status: "up-to-date"; currentVersion: string }
  | {
    status: "planned";
    plan: UpgradePlan;
    fromVersion: string;
    toVersion: string;
  }
  | {
    status: "applied";
    plan: UpgradePlan;
    fromVersion: string;
    toVersion: string;
    backups: ReadonlyArray<string>;
  };

export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  bundle: Bundle;
  templatesVersion: string;
  now?: () => Date;
};

export class UpgradeProjectUseCase {
  constructor(private readonly deps: UpgradeProjectDeps) {}

  async execute(input: UpgradeProjectInput): Promise<UpgradeProjectResult> {
    const { reader, writer, lockStore, bundle, templatesVersion } = this.deps;

    const lock = await lockStore.read(input.projectDir);
    if (lock === null) {
      throw new Error(
        "no .specflow/installed.lock found. Run `specflow init --here --force` to enable upgrades.",
      );
    }

    // SHA every file on disk (only ones we care about — the ones in our bundle or lock).
    const destPaths = new Set<string>([
      ...Object.keys(bundle),
      ...lock.entries.keys(),
    ]);
    const diskShas = new Map<string, string>();
    for (const dest of destPaths) {
      const content = await reader.readText(input.projectDir, dest);
      if (content !== null) diskShas.set(dest, await sha256Hex(content));
    }

    // SHA every file in the new bundle.
    const newShas = new Map<string, string>();
    for (const [dest, file] of Object.entries(bundle)) {
      newShas.set(dest, await sha256Hex(file.content));
    }

    const plan = computeUpgradePlan(diskShas, lock, newShas);

    const hasActualWork = plan.some((a) =>
      a.kind === "auto-update" || a.kind === "add-new" ||
      (a.kind === "preserve" && input.force)
    );
    if (!hasActualWork && plan.every((a) => a.kind === "unchanged")) {
      return { status: "up-to-date", currentVersion: lock.templatesVersion };
    }

    if (input.dryRun) {
      return {
        status: "planned",
        plan,
        fromVersion: lock.templatesVersion,
        toVersion: templatesVersion,
      };
    }

    // Assemble partial bundle of files to actually write.
    const toWrite: Bundle = {};
    for (const action of plan) {
      if (
        action.kind === "auto-update" ||
        action.kind === "add-new" ||
        (action.kind === "preserve" && input.force)
      ) {
        const file = bundle[action.dest];
        if (file) toWrite[action.dest] = file;
      }
    }

    const backupReport = await writer.writeBundle(toWrite, input.projectDir, {
      overwrite: true,
      backupExisting: input.force,
    });

    // Update lock:
    //  - new entries for files we just wrote
    //  - drop entries that no longer exist in the new bundle (cleanup)
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    const updatedEntries = new Map<string, LockEntry>();
    for (const [dest] of newShas) {
      const existing = lock.entries.get(dest);
      const sha = await shaOfBundle(bundle[dest]);
      const wrote = toWrite[dest] !== undefined;
      updatedEntries.set(dest, {
        sha256: wrote ? sha : existing?.sha256 ?? sha,
        installedAt: wrote ? now : (existing?.installedAt ?? now),
        templatesVersion: wrote
          ? templatesVersion
          : (existing?.templatesVersion ?? templatesVersion),
      });
    }
    // Entries in lock but no longer in bundle are dropped (not copied over).
    const newLock: InstalledLock = {
      version: 1,
      templatesVersion,
      entries: updatedEntries,
    };
    await lockStore.write(input.projectDir, newLock);

    return {
      status: "applied",
      plan,
      fromVersion: lock.templatesVersion,
      toVersion: templatesVersion,
      backups: backupReport.backups.map((b) => b.dest),
    };
  }
}

async function shaOfBundle(file: TemplateFile | undefined): Promise<string> {
  if (!file) return "";
  return await sha256Hex(file.content);
}
```

- [ ] **Step 4: Run — 5 passed**

- [ ] **Step 5: Full — expect 183 green (178 + 5)**

- [ ] **Step 6: Commit**

```bash
deno fmt
git add src/application/upgrade_project.ts tests/application/upgrade_project_test.ts
git commit -m "feat(app): UpgradeProjectUseCase orchestrating diff + apply + lock update"
```

---

## Task 10: `upgrade` CLI — parser, help, handler, main

**Files:**

- Modify: `src/cli/parser.ts`
- Modify: `src/cli/help.ts`
- Modify: `src/main.ts`
- Create: `src/cli/handlers/upgrade_handler.ts`
- Modify: `tests/cli/parser_test.ts` (APPEND 2 tests)

- [ ] **Step 1: Append parser tests**

```typescript
Deno.test("parseArgs returns upgrade intent", () => {
  assertEquals(parseArgs(["upgrade"]), {
    kind: "upgrade",
    dryRun: false,
    force: false,
  });
});

Deno.test("parseArgs returns upgrade intent with --dry-run --force", () => {
  assertEquals(parseArgs(["upgrade", "--dry-run", "--force"]), {
    kind: "upgrade",
    dryRun: true,
    force: true,
  });
});
```

- [ ] **Step 2: Extend `src/cli/parser.ts`**

Add to Intent union:

```typescript
| { kind: "upgrade"; dryRun: boolean; force: boolean }
```

(`--force` and `--dry-run` are already in the boolean flag set from prior tasks.)

Add the `upgrade` command branch:

```typescript
if (command === "upgrade") {
  return {
    kind: "upgrade",
    dryRun: Boolean(parsed["dry-run"]),
    force: Boolean(parsed.force),
  };
}
```

- [ ] **Step 3: Update `src/cli/help.ts`**

Add usage line after the existing commands:

```
specflow upgrade [--dry-run] [--force]
                                   Update project templates to the binary's version
```

- [ ] **Step 4: Write `src/cli/handlers/upgrade_handler.ts`**

```typescript
import { resolve } from "@std/path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { UpgradeProjectUseCase } from "../../application/upgrade_project.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { TEMPLATES, TEMPLATES_VERSION } from "../../templates_bundle.ts";
import { renderUnifiedDiff } from "../../domain/diff.ts";
import type { UpgradePlan } from "../../domain/upgrade_plan.ts";

export type UpgradeIntent = {
  kind: "upgrade";
  dryRun: boolean;
  force: boolean;
};

function renderSummary(plan: UpgradePlan, from: string, to: string) {
  const groups = {
    auto: plan.filter((a) => a.kind === "auto-update"),
    preserve: plan.filter((a) => a.kind === "preserve"),
    added: plan.filter((a) => a.kind === "add-new"),
    unchanged: plan.filter((a) => a.kind === "unchanged"),
  };

  console.log(
    `\n${bold("specflow upgrade")} — templates ${dim(from)} → ${cyan(to)}\n`,
  );

  if (groups.auto.length > 0) {
    console.log(bold("  auto-update (unchanged locally)"));
    for (const a of groups.auto) console.log(green(`    ✓ ${a.dest}`));
    console.log();
  }
  if (groups.added.length > 0) {
    console.log(bold("  new files to add"));
    for (const a of groups.added) console.log(green(`    + ${a.dest}`));
    console.log();
  }
  if (groups.preserve.length > 0) {
    console.log(bold("  customized locally (not touched)"));
    for (const a of groups.preserve) console.log(yellow(`    ⚠ ${a.dest}`));
    console.log();
  }

  console.log(
    dim(
      `  ${groups.auto.length} auto-update, ${groups.preserve.length} preserved, ` +
        `${groups.added.length} added, ${groups.unchanged.length} unchanged`,
    ),
  );
}

export async function runUpgrade(intent: UpgradeIntent): Promise<number> {
  const projectDir = resolve(Deno.cwd());

  const useCase = new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    bundle: TEMPLATES,
    templatesVersion: TEMPLATES_VERSION,
  });

  let result;
  try {
    result = await useCase.execute({
      projectDir,
      dryRun: intent.dryRun,
      force: intent.force,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 2;
  }

  if (result.status === "up-to-date") {
    console.log(green(`✓ already up to date (templates ${result.currentVersion})`));
    return 0;
  }

  renderSummary(result.plan, result.fromVersion, result.toVersion);

  // Show diffs for preserved files
  const preserves = result.plan.filter((a) => a.kind === "preserve");
  if (preserves.length > 0 && !intent.force) {
    console.log(
      dim(
        "\nFor customized files, review the diff below and merge manually if desired.\n" +
          "Re-run with --force to overwrite them (edits will be backed up to .specflow.bak).\n",
      ),
    );
    for (const action of preserves) {
      const file = TEMPLATES[action.dest];
      if (!file) continue;
      const diskContent = await new DenoFsReader().readText(projectDir, action.dest);
      if (diskContent === null) continue;
      console.log(bold(`\n---- diff: ${action.dest} ----`));
      console.log(renderUnifiedDiff(
        diskContent,
        file.content,
        `local (current)`,
        `binary (${result.toVersion})`,
      ));
    }
  }

  if (result.status === "planned") {
    console.log(dim("\n(dry-run — no files written)"));
    return 0;
  }

  // applied
  if (result.backups.length > 0) {
    console.log();
    for (const b of result.backups) {
      console.log(dim(`↳ backed up ${b} → ${b}.specflow.bak`));
    }
  }
  console.log();
  console.log(green(`✓ upgraded to templates ${result.toVersion}`));
  return 0;
}
```

- [ ] **Step 5: Wire `src/main.ts`**

Add case before `unknown`:

```typescript
case "upgrade": {
  const { runUpgrade } = await import("./cli/handlers/upgrade_handler.ts");
  return await runUpgrade(intent);
}
```

- [ ] **Step 6: Run full suite + quality gates**

```bash
deno fmt
deno lint
deno check src/main.ts
deno task test
```

Expected: 183 + 2 parser = 185 green.

- [ ] **Step 7: Commit**

```bash
git add src/cli/parser.ts src/cli/help.ts src/cli/handlers/upgrade_handler.ts src/main.ts tests/cli/parser_test.ts
git commit -m "feat(cli): specflow upgrade [--dry-run] [--force] command"
```

---

## Task 11: Integration test

**Files:**

- Create: `tests/integration/upgrade_test.ts`

End-to-end: spawn real binary, init a project, modify a file, upgrade, assert behaviour.

- [ ] **Step 1: Write the test**

```typescript
import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";

const MAIN = new URL("../../src/main.ts", import.meta.url).pathname;

async function runSpecflow(
  args: string[],
  opts: { cwd: string },
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-upgrade-integ-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("upgrade on freshly-init'd project is up-to-date", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);
    assertStringIncludes(upgrade.stdout, "already up to date");
  });
});

Deno.test("upgrade fails with clear message when lock missing", async () => {
  await withTempDir(async (dir) => {
    // No init — just empty tempdir, no .specflow/installed.lock
    const upgrade = await runSpecflow(["upgrade"], { cwd: dir });
    assertEquals(upgrade.code, 2);
    assertStringIncludes(upgrade.stderr, "installed.lock");
  });
});

Deno.test("upgrade --dry-run shows plan without writing when user customized a file", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    // Simulate a user edit to AGENTS.md — our local copy differs from what
    // the bundle produced. Since the bundle and binary are at the same version,
    // the plan will report "preserve" for this file.
    const agentsPath = join(projectDir, "AGENTS.md");
    const original = await Deno.readTextFile(agentsPath);
    await Deno.writeTextFile(agentsPath, original + "\n\n# User customization\n");

    const upgrade = await runSpecflow(["upgrade", "--dry-run"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);
    assertStringIncludes(upgrade.stdout, "AGENTS.md");
    assertStringIncludes(upgrade.stdout, "customized locally");
    // Verify the file was not modified
    const after = await Deno.readTextFile(agentsPath);
    assertEquals(after.includes("# User customization"), true);
  });
});

Deno.test("upgrade --force overwrites a customized file with backup", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const agentsPath = join(projectDir, "AGENTS.md");
    const original = await Deno.readTextFile(agentsPath);
    await Deno.writeTextFile(agentsPath, original + "\n# User customization\n");

    const upgrade = await runSpecflow(["upgrade", "--force"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);

    const backupExists = await exists(`${agentsPath}.specflow.bak`);
    assertEquals(backupExists, true);

    const bak = await Deno.readTextFile(`${agentsPath}.specflow.bak`);
    assertEquals(bak.includes("# User customization"), true);

    const after = await Deno.readTextFile(agentsPath);
    assertEquals(after.includes("# User customization"), false);
  });
});
```

- [ ] **Step 2: Run full suite**

```bash
deno task test
```

Expected: 185 + 4 = 189 green. The integration tests may take a few seconds since they spawn
subprocesses.

- [ ] **Step 3: Commit**

```bash
deno fmt
git add tests/integration/upgrade_test.ts
git commit -m "test(integration): specflow upgrade end-to-end (up-to-date, dry-run, force)"
```

---

## Task 12: README — document `specflow upgrade`

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Read `README.md`**

- [ ] **Step 2: Append an Upgrade section**

After the existing "Installation" section and before "Development setup" (check current README
order; adjust placement if different), add:

```markdown
## Upgrading an existing project

When you update the `specflow` binary (via `specflow self-update` or Homebrew), the bundled
templates may have changed. To pull those changes into a project you previously `init`'d:

\`\`\`bash specflow upgrade --dry-run # see what would change specflow upgrade # apply safely —
files you customized are preserved specflow upgrade --force # overwrite customized files (backed up
to .specflow.bak) \`\`\`

Specflow tracks the SHA256 of each template in `.specflow/installed.lock` so it can detect your
local edits and avoid overwriting them. Commit this lock file with your project.
```

NOTE: Triple backticks shown with `\`` above — write LITERAL triple backticks in the file.

- [ ] **Step 3: Commit**

```bash
deno fmt
git add README.md
git commit -m "docs(readme): document specflow upgrade flow"
```

---

## Wrap-up

At the end of Task 12 the repo has:

- `specflow upgrade [--dry-run] [--force]` — diff-and-prompt template upgrade with 4 action kinds
  (auto-update / preserve / add-new / unchanged)
- `.specflow/installed.lock` SHA256 tracking, written at init and updated at upgrade
- Pure `computeUpgradePlan` + unified diff renderer (domain-level, 13 tests)
- README section documenting the upgrade flow

### Final test count

Prior (release-ready merged): 156

- Task 1 sha256 util: 4
- Task 2 installed_lock: 4
- Task 3 diff renderer: 5
- Task 4 upgrade_plan: 8
- Task 6 fs_lock_store: 4
- Task 8 init writes lock: 1
- Task 9 upgrade use case: 5
- Task 10 parser: 2
- Task 11 integration: 4

**Total expected: 156 + 37 = 193 green.** (Plan estimated 179, this came in higher because
upgrade_plan got 8 tests instead of 6 and diff got 5.)

### How to validate end-to-end

1. `deno task test` — all green.
2. Compile and smoke test:
   ```bash
   deno task build
   rm -rf /tmp/upgrade-demo
   ./dist/specflow-macos-arm64 init /tmp/upgrade-demo --no-git
   # Edit /tmp/upgrade-demo/AGENTS.md and add some custom lines
   cd /tmp/upgrade-demo
   ../../../Sites/specflow/dist/specflow-macos-arm64 upgrade --dry-run
   # Observe: auto-update for speckit commands, preserve for AGENTS.md with diff
   ```

### Deferred work

- 3-way merge automatique (design rejected option B)
- Migration lock format (v1 → v2 forward-compat) when templates layout changes dramatically
- Windows `.ps1` upgrade flow (currently inherits from bash-ish flow; Deno runtime is cross-platform
  so should work)
- Auto-push Homebrew formula on release
