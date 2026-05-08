import { assert, assertEquals } from "@std/assert";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import type {
  BackupReport,
  FsReader,
  FsWriter,
  Harness,
  LockStore,
} from "../../src/application/ports.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";

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
      return Promise.resolve({ backups: [], skippedSkipIfExists: [] } as BackupReport);
    },
    deletePaths: (paths, _t, options) => {
      if (options.backupExisting) deleteBackupsRequested = true;
      for (const p of paths) deleted.push(p);
      return Promise.resolve({ backups: [], skippedSkipIfExists: [] } as BackupReport);
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

function fakeHarness(): Harness {
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

const findFakeHarness = (key: string) => key === "claude" ? fakeHarness() : null;

// Build a CoreBundle whose mapBundle output matches what the old `bundle:` literal produced.
function coreFromBundle(
  bundle: Record<string, { content: string; executable: boolean }>,
): CoreBundle {
  return Object.entries(bundle).map(([dest, file]) => ({
    category: "project-root" as const,
    name: "root",
    suffix: dest,
    content: file.content,
    executable: file.executable,
  }));
}

Deno.test("UpgradeProjectUseCase errors when lock is missing", async () => {
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({}),
    writer: fakeWriter(),
    lockStore: fakeLockStore(null),
    core: coreFromBundle({ "a.md": { content: "alpha", executable: false } }),
    findHarness: findFakeHarness,
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
    version: 2,
    harness: "claude",
    backlogBackend: "local",
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
    core: coreFromBundle({ "a.md": { content, executable: false } }),
    findHarness: findFakeHarness,
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
    version: 2,
    harness: "claude",
    backlogBackend: "local",
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
    core: coreFromBundle({ "a.md": { content: newContent, executable: false } }),
    findHarness: findFakeHarness,
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
    version: 2,
    harness: "claude",
    backlogBackend: "local",
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
    core: coreFromBundle({
      "clean.md": { content: "NEW", executable: false },
      "custom.md": { content: "OUR-NEW", executable: false },
    }),
    findHarness: findFakeHarness,
    templatesVersion: "0.3.0",
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.get("clean.md"), "NEW");
  assertEquals(writer.written.has("custom.md"), false);
});

Deno.test("UpgradeProjectUseCase with --force overwrites preserve actions with backup", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
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
    core: coreFromBundle({ "a.md": { content: "OURS-NEW", executable: false } }),
    findHarness: findFakeHarness,
    templatesVersion: "0.3.0",
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: true });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.get("a.md"), "OURS-NEW");
  assertEquals(writer.backupsRequested, true);
});

Deno.test("UpgradeProjectUseCase deletes clean orphans (lock entry + on disk + matches lock SHA + not in bundle)", async () => {
  const orphanContent = "old\n";
  const orphanSha = await sha256Hex(orphanContent);
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
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
    backlogBackend: "local",
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
    backlogBackend: "local",
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

// ── Plugin migration end-to-end (#73 slice 6) ──────────────────────────────

const PLUGIN_DEST = ".claude/agents/product-owner.md";

function fakePluginDetector(installed: boolean) {
  return { isPluginInstalled: (_n: string) => Promise.resolve(installed) };
}

Deno.test("UpgradeProjectUseCase: vanilla on-disk + plugin installed → backed up + deleted + dropped from lock", async () => {
  const sha = await sha256Hex("vanilla content");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map([[
      PLUGIN_DEST,
      { sha256: sha, installedAt: "2026-05-01T00:00:00Z", templatesVersion: "0.7.0" },
    ]]),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ [PLUGIN_DEST]: "vanilla content" }),
    writer,
    lockStore,
    core: coreFromBundle({
      [PLUGIN_DEST]: { content: "upstream update", executable: false },
    }),
    templatesVersion: "0.7.1",
    findHarness: findFakeHarness,
    pluginDetector: fakePluginDetector(true),
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  // File deleted with backup (the on-disk copy must be recoverable)
  assertEquals(writer.deleted, [PLUGIN_DEST]);
  assertEquals(writer.deleteBackupsRequested, true);
  // Lock no longer references the migrated file
  assertEquals(lockStore.last?.entries.has(PLUGIN_DEST), false);
  // No write happened — the plugin owns the file now
  assertEquals(writer.written.has(PLUGIN_DEST), false);
});

Deno.test("UpgradeProjectUseCase: customized on-disk + plugin installed → preserved with pluginAvailable=true (no delete)", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map([[
      PLUGIN_DEST,
      {
        sha256: await sha256Hex("original"),
        installedAt: "2026-05-01T00:00:00Z",
        templatesVersion: "0.7.0",
      },
    ]]),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ [PLUGIN_DEST]: "user-edited content" }),
    writer,
    lockStore,
    core: coreFromBundle({
      [PLUGIN_DEST]: { content: "upstream update", executable: false },
    }),
    templatesVersion: "0.7.1",
    findHarness: findFakeHarness,
    pluginDetector: fakePluginDetector(true),
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  // File preserved — NOT deleted
  assertEquals(writer.deleted.includes(PLUGIN_DEST), false);
  // Lock still tracks it (preserve, not migrate)
  assertEquals(lockStore.last?.entries.has(PLUGIN_DEST), true);
  // The plan should mark it as preserve with pluginAvailable=true
  if (result.status === "applied") {
    const action = result.plan.find((a) => a.dest === PLUGIN_DEST);
    assertEquals(action?.kind, "preserve");
    if (action?.kind === "preserve") {
      assertEquals(action.pluginAvailable, true);
    }
  }
});

Deno.test("UpgradeProjectUseCase: missing on-disk + plugin installed → deferred (no add-new, no lock entry)", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map([[
      PLUGIN_DEST,
      {
        sha256: await sha256Hex("original"),
        installedAt: "2026-05-01T00:00:00Z",
        templatesVersion: "0.7.0",
      },
    ]]),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({}), // user deleted the file
    writer,
    lockStore,
    core: coreFromBundle({
      [PLUGIN_DEST]: { content: "upstream update", executable: false },
    }),
    templatesVersion: "0.7.1",
    findHarness: findFakeHarness,
    pluginDetector: fakePluginDetector(true),
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  // No file written (would have been add-new without plugin)
  assertEquals(writer.written.has(PLUGIN_DEST), false);
  // Lock entry dropped
  assertEquals(lockStore.last?.entries.has(PLUGIN_DEST), false);
});

Deno.test("UpgradeProjectUseCase: vanilla on-disk + plugin NOT installed → existing auto-update behavior (no delete)", async () => {
  const sha = await sha256Hex("vanilla content");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map([[
      PLUGIN_DEST,
      { sha256: sha, installedAt: "2026-05-01T00:00:00Z", templatesVersion: "0.7.0" },
    ]]),
  };
  const writer = fakeWriter();
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ [PLUGIN_DEST]: "vanilla content" }),
    writer,
    lockStore: fakeLockStore(lock),
    core: coreFromBundle({
      [PLUGIN_DEST]: { content: "upstream update", executable: false },
    }),
    templatesVersion: "0.7.1",
    findHarness: findFakeHarness,
    pluginDetector: fakePluginDetector(false),
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  // Auto-update: file written with new content, NOT deleted
  assertEquals(writer.written.get(PLUGIN_DEST), "upstream update");
  assertEquals(writer.deleted.includes(PLUGIN_DEST), false);
});
