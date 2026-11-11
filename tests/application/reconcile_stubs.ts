import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";
import type {
  BackupReport,
  FsReader,
  FsWriter,
  LockStore,
  StagingStore,
} from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";

/** In-memory ports for the reconcile use cases' tests: a lock tracking one agent file. */

export function mockLock(): InstalledLock {
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
    specBackend: "local",
    templatesVersion: "1.6.0",
    entries,
  };
}

export class StubReader implements FsReader {
  constructor(private files: Record<string, string>) {}
  readText(_dir: string, rel: string): Promise<string | null> {
    return Promise.resolve(this.files[rel] ?? null);
  }
  readEntry(_dir: string, rel: string) {
    const content = this.files[rel];
    return Promise.resolve(content === undefined ? null : { kind: "file" as const, content });
  }
  listFiles(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

export class StubWriter implements FsWriter {
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

export class StubLockStore implements LockStore {
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

export class StubStagingStore implements StagingStore {
  constructor(private files: Record<string, string>) {}
  list(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.files));
  }
  read(_: string, rel: string): Promise<string | null> {
    return Promise.resolve(this.files[rel] ?? null);
  }
  delete(_: string, rel: string): Promise<string[]> {
    delete this.files[rel];
    return Promise.resolve([]);
  }
  cleanupIfEmpty(): Promise<boolean> {
    return Promise.resolve(Object.keys(this.files).length === 0);
  }
}
