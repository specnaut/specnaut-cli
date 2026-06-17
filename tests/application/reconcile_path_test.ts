import { assertEquals } from "@std/assert";
import { ReconcilePathUseCase } from "../../src/application/reconcile_path.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";
import type {
  BackupReport,
  FsReader,
  FsWriter,
  LockStore,
  StagingStore,
} from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";

function mockLock(): InstalledLock {
  const entries = new Map<string, LockEntry>();
  entries.set(".claude/agents/developer.md", {
    sha256: "old-sha",
    installedAt: "2026-01-01T00:00:00.000Z",
    templatesVersion: "1.4.0",
  });
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    templatesVersion: "1.6.0",
    entries,
  };
}

class StubReader implements FsReader {
  constructor(private files: Record<string, string>) {}
  readText(_dir: string, rel: string): Promise<string | null> {
    return Promise.resolve(this.files[rel] ?? null);
  }
}

class StubWriter implements FsWriter {
  written: Record<string, string> = {};
  deleted: string[] = [];
  detectConflicts(): Promise<string[]> {
    return Promise.resolve([]);
  }
  writeBundle(
    bundle: Bundle,
    _targetDir: string,
    _options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport> {
    for (const [k, v] of Object.entries(bundle)) this.written[k] = v.content;
    return Promise.resolve({ backups: [], skippedSkipIfExists: [] });
  }
  deletePaths(
    paths: ReadonlyArray<string>,
    _targetDir: string,
    _options: { backupExisting: boolean },
  ): Promise<BackupReport> {
    for (const p of paths) this.deleted.push(p);
    return Promise.resolve({ backups: [], skippedSkipIfExists: [] });
  }
}

class StubLockStore implements LockStore {
  constructor(public lock: InstalledLock) {}
  read(): Promise<InstalledLock | null> {
    return Promise.resolve(this.lock);
  }
  write(_: string, l: InstalledLock): Promise<void> {
    this.lock = l;
    return Promise.resolve();
  }
  lockPath(): string {
    return "/dev/null";
  }
}

class StubStagingStore implements StagingStore {
  constructor(private files: Record<string, string>) {}
  list(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.files));
  }
  read(_: string, rel: string): Promise<string | null> {
    return Promise.resolve(this.files[rel] ?? null);
  }
  delete(_: string, rel: string): Promise<void> {
    delete this.files[rel];
    return Promise.resolve();
  }
  cleanupIfEmpty(): Promise<boolean> {
    return Promise.resolve(Object.keys(this.files).length === 0);
  }
}

Deno.test(
  "reconcile --accept-upstream: writes upstream, backs up local, updates lock",
  async () => {
    const reader = new StubReader({
      ".claude/agents/developer.md": "LOCAL\n",
    });
    const writer = new StubWriter();
    const lockStore = new StubLockStore(mockLock());
    const staging = new StubStagingStore({
      ".claude/agents/developer.md": "UPSTREAM\n",
    });
    const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
    const result = await uc.execute({
      projectDir: "/tmp/proj",
      path: ".claude/agents/developer.md",
      mode: "accept-upstream",
      now: () => new Date("2026-05-16T00:00:00.000Z"),
    });
    assertEquals(result.status, "ok");

    // Wrote upstream to project path:
    assertEquals(writer.written[".claude/agents/developer.md"], "UPSTREAM\n");

    // Backed up local:
    assertEquals(
      writer.written[".claude/agents/developer.md.specnaut.bak"],
      "LOCAL\n",
    );

    // Updated lock entry SHA:
    const expectedSha = await sha256Hex("UPSTREAM\n");
    assertEquals(
      lockStore.lock.entries.get(".claude/agents/developer.md")?.sha256,
      expectedSha,
    );
  },
);

Deno.test(
  "reconcile --accept-current: leaves project alone, locks current SHA",
  async () => {
    const reader = new StubReader({ ".claude/agents/developer.md": "LOCAL\n" });
    const writer = new StubWriter();
    const lockStore = new StubLockStore(mockLock());
    const staging = new StubStagingStore({ ".claude/agents/developer.md": "UPSTREAM\n" });
    const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
    const result = await uc.execute({
      projectDir: "/tmp/proj",
      path: ".claude/agents/developer.md",
      mode: "accept-current",
      now: () => new Date("2026-05-16T00:00:00.000Z"),
    });
    assertEquals(result.status, "ok");

    // No project write (project file untouched):
    assertEquals(
      writer.written[".claude/agents/developer.md"],
      undefined,
    );

    // Lock SHA matches local content:
    const expectedSha = await sha256Hex("LOCAL\n");
    assertEquals(
      lockStore.lock.entries.get(".claude/agents/developer.md")?.sha256,
      expectedSha,
    );
  },
);

Deno.test("reconcile: errors when staging file missing", async () => {
  const reader = new StubReader({ ".claude/agents/developer.md": "LOCAL\n" });
  const writer = new StubWriter();
  const lockStore = new StubLockStore(mockLock());
  const staging = new StubStagingStore({});
  const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
  const result = await uc.execute({
    projectDir: "/tmp/proj",
    path: ".claude/agents/developer.md",
    mode: "accept-upstream",
    now: () => new Date(),
  });
  assertEquals(result.status, "no-staging");
});

Deno.test("reconcile: errors when lock entry missing", async () => {
  const reader = new StubReader({ ".claude/agents/developer.md": "LOCAL\n" });
  const writer = new StubWriter();
  const lockStore = new StubLockStore({ ...mockLock(), entries: new Map() });
  const staging = new StubStagingStore({ ".claude/agents/developer.md": "UPSTREAM\n" });
  const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
  const result = await uc.execute({
    projectDir: "/tmp/proj",
    path: ".claude/agents/developer.md",
    mode: "accept-upstream",
    now: () => new Date(),
  });
  assertEquals(result.status, "no-lock-entry");
});
