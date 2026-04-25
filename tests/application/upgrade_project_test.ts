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
