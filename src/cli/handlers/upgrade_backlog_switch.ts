import { findHarness } from "../harnesses.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";
import { DenoFsWriter } from "../../infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../infrastructure/fs_lock_store.ts";
import { isAgenticPath } from "../../domain/parent_managed.ts";
import { CORE_BUNDLE, TEMPLATES_VERSION } from "../../templates_bundle.ts";
import { type BacklogBackend, type InstalledLock } from "../../domain/installed_lock.ts";
import { sha256Hex } from "../../domain/sha256.ts";

export type SwitchResult = {
  readonly switched: boolean;
  readonly from: BacklogBackend;
  /**
   * Project-relative paths of every `.specnaut.bak` this switch left behind —
   * from the overwrites AND from the deletes. The caller prints them; the
   * function itself never writes to stdout.
   */
  readonly backups: ReadonlyArray<string>;
};

/**
 * One-shot routine: switch the recorded backlog backend, re-render the
 * bundled backlog skill files for the new backend, and update the lock.
 *
 * Existing user data (markdown files for local, GitHub issues for github)
 * is NOT migrated — the caller logs that explicitly.
 */
export async function switchBacklogBackend(
  projectDir: string,
  newBackend: BacklogBackend,
  /**
   * The escape hatch the refusal below advertises. It used to advertise a flag
   * that never reached this function — the signature took two parameters and
   * the call site passed two — so re-running with `--force` re-entered the
   * identical throw. An error message naming a remedy that does not exist is
   * worse than one naming none: it sends the reader in a circle.
   */
  force = false,
): Promise<SwitchResult> {
  const lockStore = new FsLockStore();
  const lock = await lockStore.read(projectDir);
  if (lock === null) {
    throw new Error(
      "no .specnaut/installed.lock found. Run `specnaut init --here --force` first.",
    );
  }
  const from = lock.backlogBackend;
  if (from === newBackend) return { switched: false, from, backups: [] };

  const harness = findHarness(lock.harness);
  if (!harness) throw new Error(`unknown harness in lock: ${lock.harness}`);

  // A parent-managed target inherits agentic files (incl. the backlog skill)
  // from the providing workspace — they were never written locally (FR-012).
  // Drop agentic dests from both bundles so a backend switch neither writes
  // nor re-tracks them in the lock. Mirrors UpgradeProjectUseCase's filtering.
  const dropAgentic = (b: Record<string, { content: string; executable: boolean }>) =>
    lock.parentManaged
      ? Object.fromEntries(Object.entries(b).filter(([dest]) => !isAgenticPath(dest)))
      : b;

  const newBundle = dropAgentic(harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: newBackend,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
  }));
  const oldBundle = dropAgentic(harness.mapBundle(CORE_BUNDLE, {
    backlogBackend: from,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
  }));

  const writer = new DenoFsWriter();
  const reader = new DenoFsReader();

  // Identify backlog-skill + backlog-script destinations by diffing the two
  // bundles: any path that differs (or is exclusive to one bundle) is part
  // of the backlog skill surface.
  const partial: Record<string, { content: string; executable: boolean }> = {};
  const oldOnly = new Set<string>();
  for (const [dest, file] of Object.entries(newBundle)) {
    const oldFile = oldBundle[dest];
    if (oldFile === undefined || oldFile.content !== file.content) {
      partial[dest] = file;
    }
  }
  for (const dest of Object.keys(oldBundle)) {
    if (newBundle[dest] === undefined) oldOnly.add(dest);
  }

  // Customization guard: refuse to switch if any of the on-disk skill files
  // were customized vs the recorded SHA. Force-overwrite is the user's
  // escape hatch.
  const customized: string[] = [];
  for (const dest of Object.keys(partial)) {
    const onDisk = await reader.readText(projectDir, dest);
    if (onDisk === null) continue;
    const lockEntry = lock.entries.get(dest);
    if (!lockEntry) {
      // FAIL CLOSED. This used to `continue`, which reads as "no entry, nothing
      // to compare, carry on" — and carrying on means the write below runs with
      // `backupExisting: false`. So a file the lock cannot speak for was
      // overwritten without a backup, precisely because nothing was known about
      // it.
      //
      // Since #572 an unwritten preserve with no prior entry deliberately gets
      // no entry, which grew that population: the very files a user edited are
      // the ones the lock stops describing. Absence of evidence is not evidence
      // of vanilla, and `--force` is the escape hatch that already exists for a
      // deliberate overwrite.
      customized.push(dest);
      continue;
    }
    const sha = await sha256Hex(onDisk);
    if (sha !== lockEntry.sha256) customized.push(dest);
  }
  if (customized.length > 0 && !force) {
    throw new Error(
      `refusing to switch backlog backend: the following files were customized locally:\n` +
        customized.map((c) => `  - ${c}`).join("\n") +
        `\n\nReview the diffs, then re-run \`specnaut upgrade --backlog ${newBackend} --force\` ` +
        `to overwrite them (existing files are backed up to *.specnaut.bak).`,
    );
  }

  // The refusal above promises "existing files are backed up to *.specnaut.bak".
  // This passed `false`, so the promise was false — inert only while the force
  // path was unreachable, and this change is about making that path reachable.
  // Order matters: wiring `--force` before this would have converted a refusal
  // into a silent data-loss button, on exactly the edits the refusal protects.
  //
  // Keyed on `force`, and only on `force`, because that is the exact scope of
  // the promise: a switch that clears the guard has proved every dest it
  // overwrites is vanilla, and copying files Specnaut generated and can
  // regenerate buried the one backup that matters under thirty that do not.
  const report = await writer.writeBundle(partial, projectDir, {
    overwrite: true,
    backupExisting: force,
  });
  // A switch removes the files the old backend owned — on `local → github`
  // that is `.specnaut/backlog.md`, the user's entire backlog. Unconditional
  // here, unlike the write above: the customization guard walks only what gets
  // WRITTEN, so nothing has established that a dest about to be deleted is
  // vanilla. Both reports are kept: a backup nobody is told about is
  // indistinguishable from a deletion, and "items were NOT migrated
  // automatically" reads as "they are gone" when the line that says where they
  // went is missing.
  const removed = oldOnly.size > 0
    ? await writer.deletePaths([...oldOnly], projectDir, { backupExisting: true })
    : null;

  const updatedEntries = new Map(lock.entries);
  for (const [dest, file] of Object.entries(partial)) {
    updatedEntries.set(dest, {
      sha256: await sha256Hex(file.content),
      installedAt: new Date().toISOString(),
      templatesVersion: TEMPLATES_VERSION,
    });
  }
  for (const dest of oldOnly) updatedEntries.delete(dest);

  const newLock: InstalledLock = {
    version: 2,
    harness: lock.harness,
    backlogBackend: newBackend,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
    templatesVersion: lock.templatesVersion,
    entries: updatedEntries,
    // Preserve the parent-managed decision across a backend switch — dropping
    // it would silently re-enable agentic provisioning on the next upgrade
    // (009-parent-managed-init / FR-012). Mirrors upgrade_project.ts:301 and
    // init_project.ts:181.
    ...(lock.parentManaged ? { parentManaged: true as const } : {}),
  };
  await lockStore.write(projectDir, newLock);
  return {
    switched: true,
    from,
    backups: [...report.backups, ...(removed?.backups ?? [])].map((b) => b.backupPath),
  };
}
