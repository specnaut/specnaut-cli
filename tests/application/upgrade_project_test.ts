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
import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";
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

function fakeLockStore(
  initial: InstalledLock | null,
): LockStore & { last: InstalledLock | null; writes: number } {
  let last = initial;
  // `last` is pre-seeded with the input lock, so `last !== null` is true before
  // anything happens — an assertion on it cannot distinguish "written" from
  // "never touched". The counter can, and a dry-run assertion needs it.
  let writes = 0;
  return {
    get last() {
      return last;
    },
    get writes() {
      return writes;
    },
    read: () => Promise.resolve(last),
    write: (_d, lock) => {
      last = lock;
      writes += 1;
      return Promise.resolve();
    },
    lockPath: (d) => `${d}/.specnaut/installed.lock`,
  };
}

function fakeHarness(): Harness {
  return {
    key: "claude",
    displayName: "Claude Code (fake)",
    mapBundle: (core) => {
      // Flags are carried through, not dropped. The first version copied only
      // `content` and `executable`, so `skipIfExists`, `mergeBlock` and
      // `managedSection` were unreachable at this layer — every branch keyed on
      // them was untestable here, and a test that tried read as passing while
      // exercising nothing.
      const out: Record<string, Record<string, unknown>> = {};
      for (const e of core) {
        const entry = e as unknown as Record<string, unknown>;
        if (e.category === "project-root" && e.suffix) {
          out[e.suffix] = {
            content: e.content,
            executable: e.executable,
            ...(entry.skipIfExists !== undefined ? { skipIfExists: entry.skipIfExists } : {}),
            ...(entry.mergeBlock !== undefined ? { mergeBlock: entry.mergeBlock } : {}),
            ...(entry.managedSection !== undefined ? { managedSection: entry.managedSection } : {}),
          };
        }
      }
      return out as never;
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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

/**
 * `serves` models what the INSTALLED plugin actually carries (cli#606).
 *
 * It defaults to "everything it covers", which is what these tests assumed
 * before the path-level probe existed — so their expectations are unchanged.
 * Pass a narrower predicate to model a user on an older plugin release, where
 * migrating a covered-but-unserved path would delete the project's only copy.
 */
function fakePluginDetector(
  installed: boolean,
  serves: (pluginRelPath: string) => boolean = () => true,
) {
  return {
    isPluginInstalled: (_n: string) => Promise.resolve(installed),
    pluginHasPath: (_n: string, p: string) => Promise.resolve(installed && serves(p)),
  };
}

Deno.test("UpgradeProjectUseCase: vanilla on-disk + plugin installed → backed up + deleted + dropped from lock", async () => {
  const sha = await sha256Hex("vanilla content");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
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

/**
 * cli#606 AC4 — the migration must ask the installed tree, not the list.
 *
 * `PLUGIN_COVERED_PATHS_CLAUDE` says what the plugin is EXPECTED to ship. A
 * user on an older plugin release has covered paths their build has never heard
 * of. Migrating one of those deletes the project's only copy and nothing takes
 * over serving it — the file is simply gone from a working project until the
 * user notices and runs `upgrade` again after uninstalling.
 *
 * That risk is what made the coverage widening in #605 worth gating. This is
 * the assertion that the gate is real: same covered dest, same installed
 * plugin, only the installed tree's contents differ.
 */
Deno.test("UpgradeProjectUseCase: covered dest the installed plugin does NOT serve is never migrated", async () => {
  const sha = await sha256Hex("vanilla content");
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
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
    // Installed, but this build carries nothing.
    pluginDetector: fakePluginDetector(true, () => false),
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  // Scoped to the dest itself: the use case also deletes staging copies under
  // `.specnaut/upgrade-staging/`, which is routine housekeeping and not what
  // this test is about. An earlier version asserted `deleted` was empty and
  // failed on that.
  assertEquals(
    writer.deleted.includes(PLUGIN_DEST),
    false,
    "a file the installed plugin does not serve was deleted from the project — " +
      "nothing would have replaced it",
  );
  assertEquals(
    lockStore.last?.entries.has(PLUGIN_DEST),
    true,
    "the lock entry was dropped, so the next upgrade cannot even see the file",
  );
  assertEquals(
    writer.written.has(PLUGIN_DEST),
    true,
    "the binary should keep owning it and apply the upstream update as normal",
  );
});

Deno.test("UpgradeProjectUseCase: customized on-disk + plugin installed → preserved with pluginAvailable=true (no delete)", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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
    versionScheme: "semver",
    specBackend: "local",
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

Deno.test("UpgradeProjectUseCase: writes upstream content to .specnaut/upgrade-staging/ for preserves", async () => {
  // One bundle file, customized on disk (preserve case).
  const lockEntries = new Map<string, LockEntry>();
  lockEntries.set(".claude/agents/developer.md", {
    sha256: "lock-sha-original",
    installedAt: "2026-01-01T00:00:00.000Z",
    templatesVersion: "1.4.0",
  });
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.4.0",
    entries: lockEntries,
  };

  const reader = fakeReader({
    ".claude/agents/developer.md": "USER LOCAL VERSION\n",
  });
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);

  const core = coreFromBundle({
    ".claude/agents/developer.md": { content: "NEW UPSTREAM VERSION\n", executable: false },
  });

  const uc = new UpgradeProjectUseCase({
    reader,
    writer,
    lockStore,
    core,
    templatesVersion: "1.5.0",
    findHarness: findFakeHarness,
  });

  await uc.execute({ projectDir: "/tmp/proj", dryRun: false, force: false });

  const staged = writer.written.get(
    ".specnaut/upgrade-staging/.claude/agents/developer.md",
  );
  if (staged !== "NEW UPSTREAM VERSION\n") {
    throw new Error(`staging content mismatch: ${staged}`);
  }
  // The project file itself is NOT in writer.written (preserve action skips it).
  if (writer.written.has(".claude/agents/developer.md")) {
    throw new Error("preserve case should not overwrite the project file");
  }
});

Deno.test("UpgradeProjectUseCase: does NOT write staging for auto-update files", async () => {
  // Bundle file matches lock SHA on disk → auto-update case (no preserve).
  const lockEntries = new Map<string, LockEntry>();
  lockEntries.set(".claude/agents/developer.md", {
    // Set to the sha256 of "OLD CONTENT\n" so disk matches lock → auto-update.
    sha256: await sha256Hex("OLD CONTENT\n"),
    installedAt: "2026-01-01T00:00:00.000Z",
    templatesVersion: "1.4.0",
  });
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.4.0",
    entries: lockEntries,
  };

  const reader = fakeReader({ ".claude/agents/developer.md": "OLD CONTENT\n" });
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const core = coreFromBundle({
    ".claude/agents/developer.md": { content: "NEW CONTENT\n", executable: false },
  });

  const uc = new UpgradeProjectUseCase({
    reader,
    writer,
    lockStore,
    core,
    templatesVersion: "1.5.0",
    findHarness: findFakeHarness,
  });
  await uc.execute({ projectDir: "/tmp/proj", dryRun: false, force: false });

  if (writer.written.has(".specnaut/upgrade-staging/.claude/agents/developer.md")) {
    throw new Error("auto-update should not stage upstream content");
  }
});

// ── Parent-managed upgrade suppression (009-parent-managed-init) ─────────────

Deno.test("UpgradeProjectUseCase: lock.parentManaged=true filters agentic dests from the plan and writes", async () => {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map(), // parent-managed lock never had agentic entries (FR-012)
    parentManaged: true,
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({}), // no .claude/ on disk — it was deliberately removed
    writer,
    lockStore,
    core: coreFromBundle({
      ".specnaut/memory/constitution.md": { content: "toolkit\n", executable: false },
      ".claude/skills/specnaut/SKILL.md": { content: "skill\n", executable: false },
      ".claude/agents/developer.md": { content: "agent\n", executable: false },
      ".claude/commands/specnaut.md": { content: "cmd\n", executable: false },
    }),
    templatesVersion: "0.8.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
  assertEquals(result.status, "applied");
  if (result.status === "applied") {
    // No agentic dest appears anywhere in the plan.
    for (const action of result.plan) {
      assert(
        !action.dest.startsWith(".claude/skills/") &&
          !action.dest.startsWith(".claude/agents/") &&
          !action.dest.startsWith(".claude/commands/"),
        `agentic dest leaked into plan: ${action.dest}`,
      );
    }
  }
  // Toolkit file added; agentic files never written / resurrected.
  assertEquals(writer.written.get(".specnaut/memory/constitution.md"), "toolkit\n");
  assertEquals(writer.written.has(".claude/skills/specnaut/SKILL.md"), false);
  assertEquals(writer.written.has(".claude/agents/developer.md"), false);
  assertEquals(writer.written.has(".claude/commands/specnaut.md"), false);
  // Lock keeps parentManaged and no agentic entries (FR-012).
  assertEquals(lockStore.last?.parentManaged, true);
  assertEquals(lockStore.last?.entries.has(".claude/skills/specnaut/SKILL.md"), false);
});

Deno.test("UpgradeProjectUseCase: parentManagedOverride re-derives + persists on a legacy lock without the field", async () => {
  // Legacy lock — no parent_managed field — but the handler re-derived
  // parent-managed=true and passes it as an override.
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.7.0",
    entries: new Map(),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({}),
    writer,
    lockStore,
    core: coreFromBundle({
      ".specnaut/memory/constitution.md": { content: "toolkit\n", executable: false },
      ".claude/agents/developer.md": { content: "agent\n", executable: false },
    }),
    templatesVersion: "0.8.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({
    projectDir: "/p",
    dryRun: false,
    force: false,
    parentManagedOverride: true,
  });
  assertEquals(result.status, "applied");
  assertEquals(writer.written.has(".claude/agents/developer.md"), false);
  assertEquals(writer.written.get(".specnaut/memory/constitution.md"), "toolkit\n");
  // The re-derived decision is persisted into the rewritten lock.
  assertEquals(lockStore.last?.parentManaged, true);
});

Deno.test("UpgradeProjectUseCase: legacy lock + parentManagedOverride persists parent_managed even when up-to-date", async () => {
  // Up-to-date case: disk + lock + bundle all match (no file work). A legacy
  // lock (no parent_managed field) plus a handler-derived override of `true`
  // must still rewrite the lock with the corrected field — otherwise the
  // decision never reaches disk until an unrelated file change occurs
  // (009-parent-managed-init / FR-007).
  const content = "toolkit\n";
  const sha = await sha256Hex(content);
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.8.0",
    // Only a non-agentic toolkit entry; agentic dests are suppressed by the
    // override so they never enter the plan.
    entries: new Map([[".specnaut/memory/constitution.md", {
      sha256: sha,
      installedAt: "2026-05-01T00:00:00Z",
      templatesVersion: "0.8.0",
    }]]),
  };
  const writer = fakeWriter();
  const lockStore = fakeLockStore(lock);
  const uc = new UpgradeProjectUseCase({
    reader: fakeReader({ ".specnaut/memory/constitution.md": content }),
    writer,
    lockStore,
    core: coreFromBundle({
      ".specnaut/memory/constitution.md": { content, executable: false },
      ".claude/agents/developer.md": { content: "agent\n", executable: false },
    }),
    templatesVersion: "0.8.0",
    findHarness: findFakeHarness,
  });
  const result = await uc.execute({
    projectDir: "/p",
    dryRun: false,
    force: false,
    parentManagedOverride: true,
  });
  // No file work (the only non-suppressed file is unchanged).
  assertEquals(result.status, "up-to-date");
  // But the lock was still rewritten with the corrected field.
  assertEquals(lockStore.last?.parentManaged, true);
  // Metadata-only: no files written.
  assertEquals(writer.written.size, 0);
});

// ─── #572: a stale lock entry for a file that already matches the bundle ───

Deno.test(
  "UpgradeProjectUseCase re-stamps an `unchanged` dest whose lock entry is stale",
  async () => {
    // The state a project reaches by tracking the templates forward by hand,
    // or by upgrading with an older binary: the FILE is current, the LOCK is
    // not. `computeUpgradePlan` classifies this `unchanged` — correctly, there
    // is nothing to write — and the lock rebuild used to carry the entry over
    // verbatim, so the recorded sha matched neither the file nor the bundle.
    // Forever: `upgrade` had nothing to write, and `--reset-baseline` never
    // reaches `lock.entries`. The only remedy left was editing the lock by
    // hand, which is the opposite of what a lock is for.
    const content = "current bundle content";
    const currentSha = await sha256Hex(content);
    const staleSha = await sha256Hex("what an older binary wrote");
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.12.0",
      entries: new Map([["a.md", {
        sha256: staleSha,
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "1.12.0",
      }]]),
    };
    const store = fakeLockStore(lock);
    const writer = fakeWriter();
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer,
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });

    // The version REPORTED is the one now recorded, not the one that was. A
    // run that repaired the lock and then announced the old version would be
    // telling the operator the repair did not happen.
    assertEquals(result.status, "up-to-date");
    assert("currentVersion" in result);
    assertEquals(result.currentVersion, "4.0.1");

    assertEquals(store.writes, 1, "the lock is written even when no file is");
    const saved = store.last;
    assert(saved !== null);
    const entry = saved.entries.get("a.md");
    assert(entry !== undefined, "the entry must survive the rebuild");
    assertEquals(
      entry.sha256,
      currentSha,
      "an unchanged dest records what is on disk, which is the bundle",
    );
    assertEquals(entry.templatesVersion, "4.0.1");
    // NOT re-stamped: the content matches the bundle but it did not arrive
    // now, and overwriting a known date with a false one buys nothing.
    assertEquals(entry.installedAt, "2026-05-26T00:00:00Z");
    // And nothing was written — this is a lock repair, not a file write.
    assertEquals(writer.written.size, 0);
  },
);

Deno.test(
  "UpgradeProjectUseCase records NO entry for an unwritten preserve with no prior entry",
  async () => {
    // The shape a template rename produces: the lock still carries the old
    // path, so the new one has no entry at all. It is preserved, so the run
    // refuses to touch it — and the rebuild's fallback used to record a sha for
    // it anyway. First the BUNDLE's, asserting a byte-identity the file does
    // not have; then, when that was fixed, the USER's — which is worse, because
    // the next run reads it as the installed baseline, classifies the file
    // `auto-update`, and overwrites it with no `.specnaut.bak`.
    //
    // Recording nothing keeps the file as untracked as it was. The next run
    // reaches the same branch and preserves it again.
    const diskContent = "the maintainer's own version";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      entries: new Map([["old-name.md", {
        sha256: await sha256Hex("whatever"),
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "2.0.1",
      }]]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": diskContent }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({
        "a.md": { content: "the template's version", executable: false },
      }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({
      projectDir: "/p",
      dryRun: false,
      force: false,
      isDeclaredPreserved: (dest: string) => dest === "a.md",
    });

    assertEquals(
      store.last?.entries.has("a.md"),
      false,
      "a file the run refused to touch gets no entry describing it",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase does not turn a customized preserve into a vanilla baseline",
  async () => {
    // The regression the first version of this fix shipped, in the shape that
    // destroys work: TWO runs. Nothing in the suite pinned this, which is why
    // six injected-defect probes and 1473 green tests missed it.
    const userEdit = "the user's own edit";
    const shipped = "what the template ships";
    const emptyLock = (): InstalledLock => ({
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.12.0",
      entries: new Map(),
    });

    // Run 1 — untracked and diverged: `preserve/customized`. Not written.
    const store1 = fakeLockStore(emptyLock());
    const writer1 = fakeWriter();
    const uc1 = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": userEdit }),
      writer: writer1,
      lockStore: store1,
      core: coreFromBundle({ "a.md": { content: shipped, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc1.execute({ projectDir: "/p", dryRun: false, force: false });
    // `written` also captures the staging copy under .specnaut/upgrade-staging/,
    // which is the point of staging — so the assertion is about the DEST itself.
    assertEquals(writer1.written.has("a.md"), false, "run 1 must not write the file");
    assertEquals(
      store1.last?.entries.has("a.md"),
      false,
      "run 1 must not adopt the user's content as the installed baseline",
    );

    // Run 2 — fed run 1's lock. If run 1 had recorded the user's sha, this run
    // would see disk === lock, classify `auto-update`, and overwrite with no
    // backup, because a plain upgrade passes backupExisting: false.
    const store2 = fakeLockStore(store1.last);
    const writer2 = fakeWriter();
    const uc2 = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": userEdit }),
      writer: writer2,
      lockStore: store2,
      core: coreFromBundle({ "a.md": { content: shipped, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc2.execute({ projectDir: "/p", dryRun: false, force: false });
    assertEquals(
      writer2.written.has("a.md"),
      false,
      "run 2 must still preserve it — a plain upgrade must never silently overwrite a user edit",
    );
    assertEquals(
      writer2.backupsRequested,
      false,
      "and no backup was needed, because the file was never written",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase writes no lock on a dry run, even when the lock is stale",
  async () => {
    // The early return's repair sits ABOVE the `input.dryRun` check, so a
    // preview wrote the lock — on the ordinary post-release state, which is
    // files current and version string behind. A preview that writes is not a
    // preview, and the comment beneath it asserted the opposite.
    const content = "current";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.12.0",
      entries: new Map([["a.md", {
        sha256: await sha256Hex("stale"),
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "1.12.0",
      }]]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: true, force: false });
    assertEquals(store.writes, 0, "a preview writes nothing, including the lock");
  },
);

Deno.test(
  "UpgradeProjectUseCase repairs a lock whose only staleness is the version string",
  async () => {
    // The two trigger clauses were true simultaneously in every fixture, so
    // deleting either left the suite green. This is the `staleVersion`-only
    // case: every entry's sha is already correct and only the header is behind
    // — which is exactly the report/record divergence this ticket closes.
    const content = "current";
    const sha = await sha256Hex(content);
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      entries: new Map([["a.md", {
        sha256: sha,
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "2.0.1",
      }]]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    const result = await uc.execute({ projectDir: "/p", dryRun: false, force: false });
    assertEquals(store.writes, 1);
    assertEquals(store.last?.templatesVersion, "4.0.1");
    assert("currentVersion" in result);
    assertEquals(result.currentVersion, "4.0.1");
  },
);

Deno.test(
  "UpgradeProjectUseCase re-stamps a stale `unchanged` entry on a run that also has real work",
  async () => {
    // The previous test's project is entirely `unchanged`, so it takes the
    // `up-to-date` early return and never reaches the lock rebuild. This one
    // adds a second file that genuinely needs writing, which is what a real
    // upgrade looks like — and it is the only shape that exercises the rebuild
    // loop's own re-stamp. Two fixes, two paths, two witnesses.
    const stable = "already current";
    const stableSha = await sha256Hex(stable);
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.12.0",
      entries: new Map([
        ["stable.md", {
          sha256: await sha256Hex("what an older binary wrote"),
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "1.12.0",
        }],
        ["moving.md", {
          sha256: await sha256Hex("old"),
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "1.12.0",
        }],
      ]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "stable.md": stable, "moving.md": "old" }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({
        "stable.md": { content: stable, executable: false },
        "moving.md": { content: "new", executable: false },
      }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });

    const entries = store.last?.entries;
    assert(entries !== undefined);
    // The one that was written.
    assertEquals(entries.get("moving.md")?.sha256, await sha256Hex("new"));
    assertEquals(entries.get("moving.md")?.templatesVersion, "4.0.1");
    // And the one that was NOT written, but already held the bundle's content.
    assertEquals(entries.get("stable.md")?.sha256, stableSha);
    assertEquals(entries.get("stable.md")?.templatesVersion, "4.0.1");
    assertEquals(entries.get("stable.md")?.installedAt, "2026-05-26T00:00:00Z");
  },
);

Deno.test(
  "UpgradeProjectUseCase repairs stale and absent entries when the version already matches",
  async () => {
    // Isolates the two things every other fixture had true simultaneously.
    // Here the HEADER already reads 4.0.1, so `staleVersion` is false and the
    // only reason to write is a per-entry defect. Two of them:
    //
    //   stale.md   — unchanged, entry present, sha behind
    //   absent.md  — unchanged, NO entry at all
    //
    // The second is the one that used to force a lock rewrite on every single
    // run and then heal nothing: the detection counted `undefined !== sha` as
    // stale, and the repair skipped it. Meanwhile the rebuild loop adopted the
    // identical state. One rule, two implementations, opposite outcomes.
    const stale = "stable content";
    const absent = "also stable";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "4.0.1",
      entries: new Map([["stale.md", {
        sha256: await sha256Hex("what an older binary wrote"),
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "4.0.1",
      }]]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "stale.md": stale, "absent.md": absent }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({
        "stale.md": { content: stale, executable: false },
        "absent.md": { content: absent, executable: false },
      }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });

    assertEquals(store.writes, 1, "a per-entry defect is reason enough to write");
    const entries = store.last?.entries;
    assert(entries !== undefined);
    assertEquals(entries.get("stale.md")?.sha256, await sha256Hex(stale));
    assertEquals(
      entries.get("absent.md")?.sha256,
      await sha256Hex(absent),
      "an absent entry is healed, not skipped — otherwise the rewrite repeats forever",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase does not stage a preserve the lock cannot speak for",
  async () => {
    // `ReconcilePathUseCase` answers `no-lock-entry` for a dest the lock does
    // not carry, so staging one produces a path `reconcile --status` lists
    // forever and `reconcile <path>` refuses. Since #572 an unwritten preserve
    // with no prior entry deliberately gets no entry — which is exactly the
    // population that would strand there.
    const userEdit = "the user's own edit";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.12.0",
      entries: new Map(),
    };
    const writer = fakeWriter();
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": userEdit }),
      writer,
      lockStore: fakeLockStore(lock),
      core: coreFromBundle({ "a.md": { content: "shipped", executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });
    assertEquals(
      writer.written.has(".specnaut/upgrade-staging/a.md"),
      false,
      "nothing is staged for a reconcile that would reject it",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase's up-to-date path derives its entries instead of copying them",
  async () => {
    // The `staleVersion` clause made this branch the ordinary post-release
    // path, and it used to carry `lock.entries` verbatim — so an orphan row the
    // bundle no longer contains survived here while the rebuild loop dropped
    // it. Two lock builders, opposite rules, and the common one had the laxer
    // set.
    const content = "current";
    const sha = await sha256Hex(content);
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      entries: new Map([
        ["a.md", {
          sha256: sha,
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "2.0.1",
        }],
        // A row for a dest the bundle no longer ships.
        ["gone.md", {
          sha256: await sha256Hex("removed upstream"),
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "1.12.0",
        }],
      ]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });

    const entries = store.last?.entries;
    assert(entries !== undefined);
    assertEquals(
      entries.has("gone.md"),
      false,
      "a row the bundle no longer carries is dropped here too",
    );
    // And the entry-level version advances with the header, so `staleSince`
    // cannot fire on a file that was never behind.
    assertEquals(entries.get("a.md")?.templatesVersion, "4.0.1");
    assertEquals(entries.get("a.md")?.installedAt, "2026-05-26T00:00:00Z");
  },
);

Deno.test(
  "UpgradeProjectUseCase's two lock paths agree on the entry version",
  async () => {
    // The same state, run through both builders, must produce the same entry.
    // It did not: the early return keyed its repair on the sha alone, so an
    // entry could keep a lagging `templatesVersion` while the header advanced —
    // which makes `staleSince` report "behind since 1.12.0" about a file that
    // matches the bundle, and `--reset-baseline` is bounded by exactly that
    // predicate.
    const stable = "stable";
    const stableSha = await sha256Hex(stable);
    const mkLock = (): InstalledLock => ({
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.12.0",
      entries: new Map([["stable.md", {
        sha256: stableSha,
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "1.12.0",
      }]]),
    });

    // Path A: everything unchanged -> the up-to-date early return.
    const storeA = fakeLockStore(mkLock());
    await new UpgradeProjectUseCase({
      reader: fakeReader({ "stable.md": stable }),
      writer: fakeWriter(),
      lockStore: storeA,
      core: coreFromBundle({ "stable.md": { content: stable, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    }).execute({ projectDir: "/p", dryRun: false, force: false });

    // Path B: the same dest, on a run that also has real work -> the rebuild loop.
    const base = mkLock();
    const lockB: InstalledLock = {
      ...base,
      entries: new Map([
        ...base.entries,
        ["moving.md", {
          sha256: await sha256Hex("old"),
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "1.12.0",
        }],
      ]),
    };
    const storeB = fakeLockStore(lockB);
    await new UpgradeProjectUseCase({
      reader: fakeReader({ "stable.md": stable, "moving.md": "old" }),
      writer: fakeWriter(),
      lockStore: storeB,
      core: coreFromBundle({
        "stable.md": { content: stable, executable: false },
        "moving.md": { content: "new", executable: false },
      }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    }).execute({ projectDir: "/p", dryRun: false, force: false });

    assertEquals(
      storeA.last?.entries.get("stable.md"),
      storeB.last?.entries.get("stable.md"),
      "identical state must produce an identical entry, whichever path built it",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase does not adopt a skipIfExists file on the up-to-date path",
  async () => {
    // The rebuild loop refuses to record a `skipIfExists` file the run did not
    // write — it is the user's, and adopting it makes every later upgrade call
    // it "customized" and offer to overwrite it. The up-to-date path derives
    // its entries independently, so it needs the same refusal, and nothing
    // tested that it had one.
    const content = "the user's own AGENTS.md";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      entries: new Map(),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "owned.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: [{
        category: "project-root" as const,
        name: "root",
        suffix: "owned.md",
        content,
        executable: false,
        skipIfExists: true,
      }] as unknown as CoreBundle,
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });
    assertEquals(
      store.last?.entries.has("owned.md"),
      false,
      "a file the user already had is theirs; the lock must not adopt it",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase repairs a header that lags entries which are already current",
  async () => {
    // The one state `staleEntries` cannot see: every entry already carries the
    // right sha AND the right version, and only the header is behind. Without
    // its own clause nothing would trigger a write, and the run would keep
    // reporting a version it does not record.
    const content = "current";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      entries: new Map([["a.md", {
        sha256: await sha256Hex(content),
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "4.0.1",
      }]]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });
    assertEquals(store.writes, 1, "a lagging header is reason enough on its own");
    assertEquals(store.last?.templatesVersion, "4.0.1");
  },
);

Deno.test(
  "UpgradeProjectUseCase drops a skipIfExists entry on the up-to-date path too",
  async () => {
    // The divergence the unification was supposed to close and did not. The
    // rebuild loop drops a `skipIfExists` dest whenever the run did not write
    // it — whether or not the lock already carried an entry. The helper's first
    // version also required `existing === undefined`, so a dest WITH an entry
    // was kept and re-stamped with the BUNDLE's sha: the adoption the rebuild
    // loop's own comment refuses in as many words, arriving through the other
    // door. It also self-reverted — a run with real work dropped the entry, the
    // next no-op run put it back.
    const content = "the user's own AGENTS.md";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      // The entry exists. That is the whole point of this fixture — the
      // previous one seeded an empty map and so exercised only the branch that
      // already worked.
      entries: new Map([["owned.md", {
        sha256: await sha256Hex(content),
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "2.0.1",
      }]]),
    };
    const store = fakeLockStore(lock);
    const uc = new UpgradeProjectUseCase({
      reader: fakeReader({ "owned.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: [{
        category: "project-root" as const,
        name: "root",
        suffix: "owned.md",
        content,
        executable: false,
        skipIfExists: true,
      }] as unknown as CoreBundle,
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    });
    await uc.execute({ projectDir: "/p", dryRun: false, force: false });
    assertEquals(
      store.last?.entries.has("owned.md"),
      false,
      "a skipIfExists dest is dropped on BOTH paths, entry or no entry",
    );
  },
);

Deno.test(
  "UpgradeProjectUseCase repairs an entry whose version lags while the header is current",
  async () => {
    // The `staleEntries` version axis, isolated. Every other fixture had the
    // header stale too, so dropping this axis left the suite green.
    const content = "current";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "4.0.1",
      entries: new Map([["a.md", {
        sha256: await sha256Hex(content),
        installedAt: "2026-05-26T00:00:00Z",
        templatesVersion: "2.0.1",
      }]]),
    };
    const store = fakeLockStore(lock);
    await new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    }).execute({ projectDir: "/p", dryRun: false, force: false });

    assertEquals(store.writes, 1, "a lagging entry version is stale on its own");
    assertEquals(store.last?.entries.get("a.md")?.templatesVersion, "4.0.1");
  },
);

Deno.test(
  "UpgradeProjectUseCase repairs a lock whose only defect is an orphan row",
  async () => {
    // The `staleEntries` orphan axis, isolated. Header current, every surviving
    // entry current, and one row for a dest the bundle no longer ships. Without
    // this axis nothing triggers a write and the row lives forever.
    const content = "current";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "4.0.1",
      entries: new Map([
        ["a.md", {
          sha256: await sha256Hex(content),
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "4.0.1",
        }],
        ["gone.md", {
          sha256: await sha256Hex("removed upstream"),
          installedAt: "2026-05-26T00:00:00Z",
          templatesVersion: "4.0.1",
        }],
      ]),
    };
    const store = fakeLockStore(lock);
    await new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      core: coreFromBundle({ "a.md": { content, executable: false } }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    }).execute({ projectDir: "/p", dryRun: false, force: false });

    assertEquals(store.writes, 1, "an orphan row is stale on its own");
    assertEquals(store.last?.entries.has("gone.md"), false);
  },
);

Deno.test(
  "UpgradeProjectUseCase adopts an untracked dest that already holds the bundle's bytes",
  async () => {
    // The `!matchesBundle` conjunct of the no-entry refusal, isolated. The
    // refusal exists so an unwritten dest is never described by an entry that
    // did not come from it — but a file whose bytes ARE the bundle's is
    // described truthfully by the bundle's sha, and it reaches this branch as
    // `unchanged` (the plan tests `diskSha === newSha` before it tests the
    // lock, so a byte-identical file is `unchanged` whether or not it is
    // tracked). Dropping the conjunct refuses those too, and the project keeps
    // a file Specnaut ships permanently outside the lock: no `auto-update`
    // when the template moves on, and a `customized` preserve the first time
    // it does. Every other fixture here has either an entry or a diverged
    // disk, so the conjunct had no witness and its removal left the suite
    // green.
    const content = "identical to the bundle";
    const lock: InstalledLock = {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "2.0.1",
      // No entry for `a.md` — the state this branch heals.
      entries: new Map(),
    };
    const store = fakeLockStore(lock);
    await new UpgradeProjectUseCase({
      reader: fakeReader({ "a.md": content }),
      writer: fakeWriter(),
      lockStore: store,
      // `b.md` is absent from disk, so the plan is not all-`unchanged` and the
      // run goes through the rebuild loop rather than the up-to-date early
      // return. Without it this fixture exercises `deriveUnchangedEntries`,
      // which reaches the same conclusion by a different route — and the
      // conjunct under test stays unwatched.
      core: coreFromBundle({
        "a.md": { content, executable: false },
        "b.md": { content: "new upstream", executable: false },
      }),
      findHarness: findFakeHarness,
      templatesVersion: "4.0.1",
    }).execute({ projectDir: "/p", dryRun: false, force: false });

    assertEquals(
      store.last?.entries.get("a.md")?.sha256,
      await sha256Hex(content),
      "an untracked file holding the bundle's bytes is adopted, at the bundle's sha",
    );
    assertEquals(
      store.last?.entries.get("a.md")?.templatesVersion,
      "4.0.1",
      "and at this run's templates version — the content is this bundle's",
    );
  },
);
