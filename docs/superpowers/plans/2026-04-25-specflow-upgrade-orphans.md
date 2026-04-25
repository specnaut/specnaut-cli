# Specflow upgrade orphan handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `specflow upgrade` clean up files that were tracked in the lock but no longer exist
in the new templates bundle, instead of silently dropping them from the lock and leaving them on
disk.

**Architecture:** New `remove` action variant in `domain/upgrade_plan.ts`, with `wasCustomized` flag
distinguishing clean orphans (auto-delete) from customized ones (preserve unless `--force`).
`FsWriter` port gains `deletePaths(paths, dir, { backupExisting })`. Use case applies removals
between conflict-detect and lock-writeback. CLI handler renders two new plan-summary groups.

**Tech Stack:** Deno 2 + TypeScript. No new dependencies.

**Scope reference:** `docs/superpowers/specs/2026-04-25-specflow-upgrade-orphans-design.md`

---

## File Structure (changes)

```
src/
├── domain/upgrade_plan.ts                              MODIFY (add `remove` action + plan logic)
├── application/ports.ts                                MODIFY (FsWriter.deletePaths)
├── application/upgrade_project.ts                      MODIFY (handle remove actions)
├── infrastructure/deno_fs_writer.ts                    MODIFY (implement deletePaths)
└── cli/handlers/upgrade_handler.ts                     MODIFY (render remove groups)

tests/
├── domain/upgrade_plan_test.ts                         MODIFY (+3 tests)
├── application/upgrade_project_test.ts                 MODIFY (+3 tests, widen fake)
├── application/init_project_test.ts                    MODIFY (widen fake to satisfy port)
├── infrastructure/deno_fs_writer_test.ts               MODIFY (+2 tests)
└── integration/upgrade_test.ts                         MODIFY (+1 end-to-end test)
```

Expected net test count: 288 → 297.

---

## Task 1: Domain — `remove` action variant + `computeUpgradePlan` extension

**Files:**

- Modify: `src/domain/upgrade_plan.ts`
- Modify: `tests/domain/upgrade_plan_test.ts`

- [ ] **Step 1: Append 3 failing tests to `tests/domain/upgrade_plan_test.ts`**

At the END of the file, append:

```typescript
Deno.test("computeUpgradePlan emits remove for clean orphan (lock + on disk + matches lock SHA + not in new bundle)", async () => {
  const sha = await sha256Hex("orphan content");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["a.md", {
        sha256: await sha256Hex("a"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
      ["orphan.md", {
        sha256: sha,
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const diskShas = new Map([["a.md", await sha256Hex("a")], ["orphan.md", sha]]);
  const newShas = new Map([["a.md", await sha256Hex("a")]]);
  const plan = computeUpgradePlan(diskShas, lock, newShas);
  const remove = plan.find((p) => p.kind === "remove");
  assert(remove !== undefined);
  if (remove?.kind === "remove") {
    assertEquals(remove.dest, "orphan.md");
    assertEquals(remove.wasCustomized, false);
    assertEquals(remove.oldSha, sha);
  }
});

Deno.test("computeUpgradePlan emits remove with wasCustomized=true when disk diverges from lock SHA", async () => {
  const lockSha = await sha256Hex("original");
  const diskSha = await sha256Hex("user-edited");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["orphan.md", {
        sha256: lockSha,
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const diskShas = new Map([["orphan.md", diskSha]]);
  const newShas = new Map<string, string>();
  const plan = computeUpgradePlan(diskShas, lock, newShas);
  const remove = plan.find((p) => p.kind === "remove");
  assert(remove !== undefined);
  if (remove?.kind === "remove") {
    assertEquals(remove.dest, "orphan.md");
    assertEquals(remove.wasCustomized, true);
    assertEquals(remove.oldSha, lockSha);
  }
});

Deno.test("computeUpgradePlan emits no action for orphan-not-on-disk (user already deleted)", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["orphan.md", {
        sha256: await sha256Hex("original"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const diskShas = new Map<string, string>();
  const newShas = new Map<string, string>();
  const plan = computeUpgradePlan(diskShas, lock, newShas);
  assertEquals(plan.find((p) => p.kind === "remove"), undefined);
});
```

The test file already imports `sha256Hex` and the `InstalledLock` type. Verify by inspecting the
file's existing imports — if not, add:

```typescript
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { assert } from "@std/assert";
```

- [ ] **Step 2: Run — expect 3 failures**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/domain/upgrade_plan_test.ts
```

Expected: existing tests still pass, 3 new tests fail (no `remove` actions emitted yet).

- [ ] **Step 3: Modify `src/domain/upgrade_plan.ts`**

Replace the file content with EXACTLY:

```typescript
import type { InstalledLock } from "./installed_lock.ts";

export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | { kind: "preserve"; dest: string; reason: "customized" }
  | { kind: "add-new"; dest: string }
  | { kind: "unchanged"; dest: string }
  | { kind: "remove"; dest: string; oldSha: string; wasCustomized: boolean };

export type UpgradePlan = ReadonlyArray<UpgradeAction>;

/**
 * Compute the upgrade plan from three SHA256 snapshots:
 *   - `diskShas` : current content SHA of each file (absent = not on disk)
 *   - `lock`     : the .specflow/installed.lock
 *   - `newShas`  : SHA of each file in the binary's embedded templates
 *
 * Emits one UpgradeAction per destination in the new bundle, plus a `remove`
 * action for each lock entry that is no longer in the new bundle but is
 * still on disk. Orphan entries that are not on disk produce no action — the
 * caller drops them from the new lock implicitly by iterating only `newShas`.
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

  // Orphans: lock entries not in newShas. Emit `remove` if still on disk.
  const orphanDests = [...lock.entries.keys()]
    .filter((dest) => !newShas.has(dest))
    .sort();
  for (const dest of orphanDests) {
    const diskSha = diskShas.get(dest);
    if (diskSha === undefined) continue;
    const lockSha = lock.entries.get(dest)!.sha256;
    actions.push({
      kind: "remove",
      dest,
      oldSha: lockSha,
      wasCustomized: diskSha !== lockSha,
    });
  }

  return actions;
}
```

- [ ] **Step 4: Run — expect all tests pass**

```bash
deno test tests/domain/upgrade_plan_test.ts
```

Expected: existing tests still pass, plus 3 new tests pass.

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 291 passed | 0 failed` (288 baseline + 3 new). Existing upgrade tests continue to
pass because they don't involve orphan entries.

- [ ] **Step 6: Commit**

```bash
git add src/domain/upgrade_plan.ts \
        tests/domain/upgrade_plan_test.ts \
        src/templates_bundle.ts
git commit -m "feat(domain): UpgradePlan emits remove actions for orphan lock entries"
```

---

## Task 2: Infrastructure — `FsWriter.deletePaths` port + DenoFsWriter impl

**Files:**

- Modify: `src/application/ports.ts`
- Modify: `src/infrastructure/deno_fs_writer.ts`
- Modify: `tests/infrastructure/deno_fs_writer_test.ts`
- Modify: `tests/application/upgrade_project_test.ts` (widen fake to satisfy port)
- Modify: `tests/application/init_project_test.ts` (widen fake to satisfy port)

- [ ] **Step 1: Widen the FsWriter port in `src/application/ports.ts`**

Find the `FsWriter` interface (currently has `detectConflicts` and `writeBundle`). Add a third
method:

```typescript
export interface FsWriter {
  detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]>;
  writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport>;
  deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean },
  ): Promise<BackupReport>;
}
```

- [ ] **Step 2: Update test fakes to satisfy the new port**

In `tests/application/upgrade_project_test.ts`, find the `fakeWriter()` helper. Add a `deletePaths`
stub that records what was requested:

```typescript
function fakeWriter(): FsWriter & {
  written: Map<string, string>;
  backupsRequested: boolean;
  deleted: string[];
  deleteBackupsRequested: boolean;
} {
  const written = new Map<string, string>();
  let backupsRequested = false;
  const deleted: string[] = [];
  let deleteBackupsRequested = false;
  return {
    get written() {
      return written;
    },
    get backupsRequested() {
      return backupsRequested;
    },
    get deleted() {
      return deleted;
    },
    get deleteBackupsRequested() {
      return deleteBackupsRequested;
    },
    detectConflicts: () => Promise.resolve([]),
    writeBundle: (bundle, _t, options) => {
      if (options?.backupExisting) backupsRequested = true;
      for (const [dest, file] of Object.entries(bundle)) {
        written.set(dest, file.content);
      }
      return Promise.resolve({ backups: [] } as BackupReport);
    },
    deletePaths: (paths, _t, options) => {
      if (options.backupExisting) deleteBackupsRequested = true;
      for (const p of paths) deleted.push(p);
      return Promise.resolve({ backups: [] } as BackupReport);
    },
  };
}
```

In `tests/application/init_project_test.ts`, find the `fakeFsWriter()` helper. Add a no-op
`deletePaths` stub (init never calls delete):

```typescript
function fakeFsWriter(conflicts: string[] = []): FsWriter & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    detectConflicts: () => Promise.resolve(conflicts),
    writeBundle: (bundle, targetDir) => {
      for (const dest of Object.keys(bundle)) written.push(`${targetDir}:${dest}`);
      return Promise.resolve({ backups: [] });
    },
    deletePaths: () => Promise.resolve({ backups: [] }),
  };
}
```

There is also an inline `writer: FsWriter` literal in init_project_test.ts (the "force=true" /
"returns backups" tests). For each such literal, add
`deletePaths: () => Promise.resolve({ backups: [] })`.

After this step, `deno check src/main.ts` must pass.

- [ ] **Step 3: Append 2 failing tests to `tests/infrastructure/deno_fs_writer_test.ts`**

At the END of the file, append:

```typescript
Deno.test("DenoFsWriter.deletePaths deletes specified files; missing files silently skipped", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specflow-fswriter-delete-" });
  try {
    await Deno.mkdir(join(dir, "sub"), { recursive: true });
    await Deno.writeTextFile(join(dir, "a.md"), "a");
    await Deno.writeTextFile(join(dir, "sub/b.md"), "b");

    const writer = new DenoFsWriter();
    const report = await writer.deletePaths(
      ["a.md", "sub/b.md", "missing.md"],
      dir,
      { backupExisting: false },
    );

    assertEquals(report.backups.length, 0);
    assertEquals(await exists(join(dir, "a.md")), false);
    assertEquals(await exists(join(dir, "sub/b.md")), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DenoFsWriter.deletePaths with backupExisting renames to .specflow.bak before delete", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specflow-fswriter-delete-bak-" });
  try {
    await Deno.writeTextFile(join(dir, "a.md"), "alpha");

    const writer = new DenoFsWriter();
    const report = await writer.deletePaths(
      ["a.md"],
      dir,
      { backupExisting: true },
    );

    assertEquals(report.backups.length, 1);
    assertEquals(report.backups[0].dest, "a.md");
    assertEquals(report.backups[0].backupPath, "a.md.specflow.bak");
    assertEquals(await exists(join(dir, "a.md")), false);
    assertEquals(await exists(join(dir, "a.md.specflow.bak")), true);
    const bakContent = await Deno.readTextFile(join(dir, "a.md.specflow.bak"));
    assertEquals(bakContent, "alpha");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
```

If `exists` and `join` are not yet imported in this file, add:

```typescript
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
```

- [ ] **Step 4: Run — expect FAIL**

```bash
deno test tests/infrastructure/deno_fs_writer_test.ts
```

Expected: `deletePaths is not a function` errors on the 2 new tests.

- [ ] **Step 5: Implement `deletePaths` in `src/infrastructure/deno_fs_writer.ts`**

Inside the `DenoFsWriter` class, add a `deletePaths` method. Place it after `writeBundle`:

```typescript
  async deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean },
  ): Promise<BackupReport> {
    const resolved = resolve(targetDir);
    const backups: { dest: string; backupPath: string }[] = [];

    for (const dest of paths) {
      assertSafeDestination(dest);
      const abs = join(resolved, dest);
      if (!(await fileExists(abs))) continue;

      if (options.backupExisting) {
        const backupAbs = `${abs}${BACKUP_SUFFIX}`;
        await Deno.rename(abs, backupAbs);
        backups.push({ dest, backupPath: `${dest}${BACKUP_SUFFIX}` });
      } else {
        await Deno.remove(abs);
      }
    }

    return { backups };
  }
```

The method reuses the existing `assertSafeDestination`, `fileExists`, `BACKUP_SUFFIX`, and
`BackupReport` import already present in the file.

- [ ] **Step 6: Run — expect 2 passed**

```bash
deno test tests/infrastructure/deno_fs_writer_test.ts
```

Expected: existing tests still pass, plus 2 new tests pass.

- [ ] **Step 7: Run the full suite**

```bash
deno task test
```

Expected: `ok | 293 passed | 0 failed` (291 + 2 new). The fake-writer widening from Step 2 keeps
existing application-layer tests green.

- [ ] **Step 8: Commit**

```bash
git add src/application/ports.ts \
        src/infrastructure/deno_fs_writer.ts \
        tests/infrastructure/deno_fs_writer_test.ts \
        tests/application/upgrade_project_test.ts \
        tests/application/init_project_test.ts \
        src/templates_bundle.ts
git commit -m "feat(fs): FsWriter.deletePaths with optional .specflow.bak backup"
```

---

## Task 3: Application — `UpgradeProjectUseCase` handles `remove`

**Files:**

- Modify: `src/application/upgrade_project.ts`
- Modify: `tests/application/upgrade_project_test.ts`

- [ ] **Step 1: Append 3 failing tests to `tests/application/upgrade_project_test.ts`**

At the END of the file, append:

```typescript
Deno.test("UpgradeProjectUseCase deletes clean orphans (lock entry + on disk + matches lock SHA + not in bundle)", async () => {
  const orphanContent = "old\n";
  const orphanSha = await sha256Hex(orphanContent);
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["a.md", {
        sha256: await sha256Hex("alpha"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
      ["orphan.md", {
        sha256: orphanSha,
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ "a.md": "alpha", "orphan.md": orphanContent }),
    writer,
    lockStore: fakeLockStore(lock),
    core: coreFromBundle({ "a.md": { content: "alpha", executable: false } }),
    templatesVersion: "0.7.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  assertEquals(writer.deleted, ["orphan.md"]);
  assertEquals(writer.deleteBackupsRequested, false);
});

Deno.test("UpgradeProjectUseCase preserves customized orphan without --force, drops lock entry", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["a.md", {
        sha256: await sha256Hex("alpha"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
      ["orphan.md", {
        sha256: await sha256Hex("original"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ "a.md": "alpha", "orphan.md": "user-edited" }),
    writer,
    lockStore,
    core: coreFromBundle({ "a.md": { content: "alpha", executable: false } }),
    templatesVersion: "0.7.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  // Without --force, the customized orphan is left on disk
  assertEquals(writer.deleted.includes("orphan.md"), false);
  // Lock no longer has the orphan entry
  assertEquals(lockStore.last?.entries.has("orphan.md"), false);
  // up-to-date OR applied; the key invariant is the lock entry is gone
  assert(result.status === "applied" || result.status === "up-to-date");
});

Deno.test("UpgradeProjectUseCase with --force deletes customized orphan with backup", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    templatesVersion: "0.6.1",
    entries: new Map([
      ["orphan.md", {
        sha256: await sha256Hex("original"),
        installedAt: "2026-04-25T00:00:00Z",
        templatesVersion: "0.6.1",
      }],
    ]),
  };
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ "orphan.md": "user-edited" }),
    writer,
    lockStore: fakeLockStore(lock),
    core: coreFromBundle({}),
    templatesVersion: "0.7.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: true });
  assertEquals(result.status, "applied");
  assertEquals(writer.deleted, ["orphan.md"]);
  assertEquals(writer.deleteBackupsRequested, true);
});
```

- [ ] **Step 2: Run — expect 3 failures**

```bash
cd /Users/kevin/Sites/specflow
deno test tests/application/upgrade_project_test.ts
```

Expected: existing tests still pass, 3 new tests fail (use case doesn't process `remove` actions
yet).

- [ ] **Step 3: Modify `src/application/upgrade_project.ts`**

Find the `execute()` method. Locate the section after `computeUpgradePlan` is called and before
`toWrite` is built. The current `hasActualWork` check looks like:

```typescript
const hasActualWork = plan.some((a) =>
  a.kind === "auto-update" || a.kind === "add-new" ||
  (a.kind === "preserve" && input.force)
);
if (!hasActualWork && plan.every((a) => a.kind === "unchanged")) {
  return { status: "up-to-date", currentVersion: lock.templatesVersion };
}
```

Replace with:

```typescript
const hasActualWork = plan.some((a) =>
  a.kind === "auto-update" ||
  a.kind === "add-new" ||
  (a.kind === "preserve" && input.force) ||
  (a.kind === "remove" && (!a.wasCustomized || input.force))
);
if (!hasActualWork) {
  return { status: "up-to-date", currentVersion: lock.templatesVersion };
}
```

(Drops the `every === unchanged` clause; `hasActualWork` covers it.)

Find the section that calls `writer.writeBundle` and assigns to `backupReport`. After that block,
BEFORE the lock writeback, add the orphan-removal handling:

```typescript
const cleanRemovals = plan
  .filter((a): a is Extract<typeof a, { kind: "remove" }> =>
    a.kind === "remove" && !a.wasCustomized
  )
  .map((a) => a.dest);
const customizedRemovals = plan
  .filter((a): a is Extract<typeof a, { kind: "remove" }> => a.kind === "remove" && a.wasCustomized)
  .map((a) => a.dest);

let extraBackups: ReadonlyArray<{ dest: string; backupPath: string }> = [];
if (cleanRemovals.length > 0) {
  const r = await writer.deletePaths(cleanRemovals, input.projectDir, { backupExisting: false });
  extraBackups = [...extraBackups, ...r.backups];
}
if (input.force && customizedRemovals.length > 0) {
  const r = await writer.deletePaths(customizedRemovals, input.projectDir, {
    backupExisting: true,
  });
  extraBackups = [...extraBackups, ...r.backups];
}
```

The lock writeback already iterates `newShas`, so orphan entries are dropped naturally. No change
needed there.

The final return value's `backups` array should include the writer-bundle backups AND the
orphan-delete backups. Find the existing return:

```typescript
return {
  status: "applied",
  plan,
  fromVersion: lock.templatesVersion,
  toVersion: templatesVersion,
  backups: backupReport.backups.map((b) => b.dest),
};
```

Update to merge the two backup sources:

```typescript
return {
  status: "applied",
  plan,
  fromVersion: lock.templatesVersion,
  toVersion: templatesVersion,
  backups: [...backupReport.backups, ...extraBackups].map((b) => b.dest),
};
```

- [ ] **Step 4: Run — expect all tests pass**

```bash
deno test tests/application/upgrade_project_test.ts
```

Expected: existing tests still pass, plus 3 new tests pass.

- [ ] **Step 5: Run the full suite**

```bash
deno task test
```

Expected: `ok | 296 passed | 0 failed` (293 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/application/upgrade_project.ts \
        tests/application/upgrade_project_test.ts \
        src/templates_bundle.ts
git commit -m "feat(upgrade): apply remove actions — auto-delete clean orphans, --force for customized"
```

---

## Task 4: CLI handler renders `remove` summary groups

**Files:**

- Modify: `src/cli/handlers/upgrade_handler.ts`

The handler's `renderSummary` function currently prints groups for `auto-update`, `added`, and
`preserve`. Add two new groups for `remove` actions, mirroring the existing patterns.

- [ ] **Step 1: Update `renderSummary` in `src/cli/handlers/upgrade_handler.ts`**

Find the `renderSummary` function. The existing groups object looks like:

```typescript
const groups = {
  auto: plan.filter((a) => a.kind === "auto-update"),
  preserve: plan.filter((a) => a.kind === "preserve"),
  added: plan.filter((a) => a.kind === "add-new"),
  unchanged: plan.filter((a) => a.kind === "unchanged"),
};
```

Replace with:

```typescript
const groups = {
  auto: plan.filter((a) => a.kind === "auto-update"),
  preserve: plan.filter((a) => a.kind === "preserve"),
  added: plan.filter((a) => a.kind === "add-new"),
  unchanged: plan.filter((a) => a.kind === "unchanged"),
  removed: plan.filter((a) => a.kind === "remove" && !a.wasCustomized),
  orphanPreserved: plan.filter((a) => a.kind === "remove" && a.wasCustomized),
};
```

After the existing block that prints the `groups.preserve` section (the "customized locally (not
touched)" header), add two new blocks:

```typescript
if (groups.removed.length > 0) {
  console.log(bold("  removed (no longer in templates)"));
  for (const a of groups.removed) console.log(red(`    ✗ ${a.dest}`));
  console.log();
}
if (groups.orphanPreserved.length > 0) {
  console.log(bold("  removed but customized (not touched without --force)"));
  for (const a of groups.orphanPreserved) console.log(yellow(`    ⚠ ${a.dest}`));
  console.log();
}
```

Find the trailing summary line:

```typescript
console.log(
  dim(
    `  ${groups.auto.length} auto-update, ${groups.preserve.length} preserved, ` +
      `${groups.added.length} added, ${groups.unchanged.length} unchanged`,
  ),
);
```

Replace with:

```typescript
console.log(
  dim(
    `  ${groups.auto.length} auto-update, ${groups.preserve.length} preserved, ` +
      `${groups.added.length} added, ${groups.removed.length} removed, ` +
      `${groups.orphanPreserved.length} orphan-preserved, ${groups.unchanged.length} unchanged`,
  ),
);
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kevin/Sites/specflow
deno check src/main.ts
```

Expected: exit 0.

- [ ] **Step 3: Run the full suite**

```bash
deno task test
```

Expected: `ok | 296 passed | 0 failed` (no new tests; just verifying no existing test on the handler
broke).

- [ ] **Step 4: Commit**

```bash
git add src/cli/handlers/upgrade_handler.ts src/templates_bundle.ts
git commit -m "feat(upgrade): render removed and orphan-preserved groups in plan summary"
```

---

## Task 5: Integration test for end-to-end orphan removal

**Files:**

- Modify: `tests/integration/upgrade_test.ts`

End-to-end test: spawn a real `specflow init` to set up a project, then hand-inject a fake orphan
lock entry pointing at a file we create. Run `specflow upgrade` and assert the orphan is deleted and
dropped from the lock.

- [ ] **Step 1: Append 1 test to `tests/integration/upgrade_test.ts`**

At the END of the file, append:

```typescript
Deno.test("upgrade auto-deletes a clean orphan and drops it from the lock", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const orphanRel = ".claude/commands/specflow.fake-orphan.md";
    const orphanAbs = join(projectDir, orphanRel);
    const orphanContent = "fake orphan content\n";
    await Deno.writeTextFile(orphanAbs, orphanContent);

    // Compute SHA-256 of the orphan content (matches the lock format).
    const buf = new TextEncoder().encode(orphanContent);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const orphanSha = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Inject a fake orphan entry into the existing installed.lock.
    const lockPath = join(projectDir, ".specflow/installed.lock");
    const lockYaml = await Deno.readTextFile(lockPath);
    const injected = lockYaml.replace(
      /(entries:\s*\n)/,
      `$1  ${orphanRel}:\n` +
        `    sha256: ${orphanSha}\n` +
        `    installed_at: "2026-04-25T00:00:00Z"\n` +
        `    templates_version: "0.7.0"\n`,
    );
    await Deno.writeTextFile(lockPath, injected);

    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);

    // Orphan file deleted on disk.
    assertEquals(await exists(orphanAbs), false);

    // Lock no longer contains the orphan entry.
    const newLockYaml = await Deno.readTextFile(lockPath);
    assertEquals(newLockYaml.includes("specflow.fake-orphan.md"), false);
  });
});
```

If `exists` is not yet imported in this file, add the import. The other helpers (`runSpecflow`,
`withTempDir`, `join`) are already used by existing tests in the file.

- [ ] **Step 2: Run the integration test**

```bash
cd /Users/kevin/Sites/specflow
deno test --allow-all tests/integration/upgrade_test.ts
```

Expected: existing upgrade tests still pass, plus 1 new test passes.

- [ ] **Step 3: Run the full suite**

```bash
deno task test
```

Expected: `ok | 297 passed | 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/upgrade_test.ts src/templates_bundle.ts
git commit -m "test(integration): upgrade auto-deletes clean orphans"
```

---

## Wrap-up

At the end of Task 5 the repo has:

- `UpgradeAction` includes a `remove` variant with `wasCustomized` flag.
- `computeUpgradePlan` emits `remove` actions for orphan lock entries still on disk; orphans not on
  disk are silently dropped from the new lock.
- `FsWriter.deletePaths(paths, dir, { backupExisting })` ports + implementation.
- `UpgradeProjectUseCase` auto-deletes clean orphans and (with `--force`) backups + deletes
  customized orphans. Lock entries always dropped.
- `specflow upgrade` prints two new plan-summary groups: "removed" and "removed but customized".
- 297 tests green.

### End-to-end validation

```bash
rm -rf /tmp/sf-orphan && mkdir /tmp/sf-orphan && cd /tmp/sf-orphan
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts init demo --no-git
cd demo
echo "fake content" > .claude/commands/specflow.fake.md
# Hand-edit .specflow/installed.lock to add an entry for that file...
# (or skip the manual injection — the integration test in Task 5 covers it)
deno run --allow-all /Users/kevin/Sites/specflow/src/main.ts upgrade
# Expected output: "removed (no longer in templates)" group with the orphan file
ls .claude/commands/specflow.fake.md  # No such file or directory
cd /Users/kevin/Sites/specflow
rm -rf /tmp/sf-orphan
```

### Release (after merge)

- Squash-merge `fix/upgrade-orphans` to main.
- Bump `deno.json` and `src/domain/version.ts` from `0.6.0-alpha.1` to `0.6.0-alpha.2`.
- `templates/manifest.json` stays at `0.7.0` (no template content changes).
- Re-run `deno task bundle` (no-op since templates didn't change).
- Commit, tag `v0.6.0-alpha.2`, push main + tag.
