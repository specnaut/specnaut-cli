import type {
  BackupReport,
  FsReader,
  FsWriter,
  Harness,
  LockStore,
  StagingStore,
} from "../../src/application/ports.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";

/** In-memory ports shared by the `UpgradeProjectUseCase` tests. */

/**
 * `deletePaths` against an in-memory disk: a dest whose resolved path (`links`)
 * fails `within` is refused, as the real writer refuses it; the rest are deleted.
 */
function fakeDelete(
  paths: ReadonlyArray<string>,
  within: ((rel: string) => boolean) | undefined,
  links: Record<string, string>,
  deleted: string[],
): Promise<BackupReport> {
  const refused: string[] = [];
  for (const p of paths) {
    if (within && !within(links[p] ?? p)) refused.push(p);
    else deleted.push(p);
  }
  // A note per deleted path — more often than the real writer, which notes only
  // a folder it could not tidy — so a test can see notes reach the output.
  return Promise.resolve({
    backups: [],
    skippedSkipIfExists: [],
    refused,
    notes: deleted.filter((p) => paths.includes(p)).map((p) => `note: tidied after ${p}`),
  });
}

/**
 * @param links Where a dest really lands, for a project with symlinks: the
 *   path `deletePaths` hands to its `within` predicate. Unlisted dests resolve
 *   to themselves.
 */
export function fakeWriter(links: Record<string, string> = {}): FsWriter & {
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
      return fakeDelete(paths, options.within, links, deleted);
    },
  };
}

/**
 * An in-memory staging tree. `deleted` records every prune, so a test can tell
 * "pruned" from "never there".
 */
export function fakeStagingStore(
  initial: string[] = [],
): StagingStore & { staged: Set<string>; deleted: string[] } {
  const staged = new Set(initial);
  const deleted: string[] = [];
  return {
    staged,
    deleted,
    list: () => Promise.resolve([...staged]),
    read: (_d, rel) => Promise.resolve(staged.has(rel) ? "STAGED" : null),
    delete: (_d, rel) => {
      staged.delete(rel);
      deleted.push(rel);
      return Promise.resolve();
    },
    cleanupIfEmpty: () => Promise.resolve(staged.size === 0),
  };
}

/**
 * An in-memory reader. `links` puts a symlink at a path: `readEntry` reports
 * it as one, and `readText` reads through it to the file it lands on, as the
 * real reader does.
 */
export function fakeReader(
  files: Record<string, string>,
  links: Record<string, { target: string; resolved: string | null }> = {},
): FsReader {
  return {
    readText: (_d, rel) => {
      const link = links[rel];
      if (link !== undefined) return Promise.resolve(files[link.resolved ?? ""] ?? null);
      return Promise.resolve(files[rel] ?? null);
    },
    readEntry: (_d, rel) => {
      const link = links[rel];
      if (link !== undefined) return Promise.resolve({ kind: "symlink", ...link });
      const content = files[rel];
      return Promise.resolve(content === undefined ? null : { kind: "file", content });
    },
  };
}

export function fakeLockStore(
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

export function fakeHarness(managedRoots?: ReadonlyArray<string>): Harness {
  return {
    key: "claude",
    displayName: "Claude Code (fake)",
    ...(managedRoots ? { managedRoots } : {}),
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

export const findFakeHarness = (key: string) => key === "claude" ? fakeHarness() : null;

// Build a CoreBundle whose mapBundle output matches what the old `bundle:` literal produced.
export function coreFromBundle(
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
