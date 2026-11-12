import { dirname, join, relative, resolve } from "@std/path";
import { walk } from "@std/fs/walk";
import type { StagingStore } from "../application/ports.ts";
import { assertSafeDestination } from "../domain/destination.ts";
import {
  assertInsideProject,
  assertRemovableInProject,
  resolvedRelative,
  resolveProjectRoot,
} from "./fs_containment.ts";
import { pruneEmptyParents } from "./fs_prune.ts";
import {
  changedStagedEntryRefusal,
  linkedStagingRefusal,
  stagedEntryRefusal,
} from "./fs_refusals.ts";

const STAGING_REL = ".specnaut/upgrade-staging";

/**
 * Refuses when `.specnaut` or `.specnaut/upgrade-staging` is itself a link
 * (cli#687). Containment is checked against the PROJECT, so a staging root
 * linked to `../src` passed it and the prune deleted src/ file by file.
 */
async function assertStagingNotLinked(projectDir: string): Promise<void> {
  for (const rel of [".specnaut", STAGING_REL]) {
    const abs = resolve(projectDir, rel);
    try {
      if ((await Deno.lstat(abs)).isSymlink) throw linkedStagingRefusal(projectDir, abs);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    }
  }
}

/**
 * Throws unless `full` is a plain staged entry (cli#751): the entry itself — its
 * folders resolved, its last component as is — lies strictly inside the real
 * staging folder, and it is not itself a link. Reading binds to it as removing
 * does (cli#765): a read that followed the link reconciled the link's target as
 * the upstream copy, and the run wrote the project file and the lock before the
 * delete refused.
 *
 * The staging folder, not the project: a link under staging that leads to the
 * project's own `src/` stays inside the project, so a project bound would let a
 * delete remove a user file there. `root` + `STAGING_REL` is the real staging
 * folder only because `assertStagingNotLinked` has refused a link at either
 * level, and the trailing `/` keeps a sibling like `upgrade-staging-old/` out.
 * A leaf link is refused although removing it touches nothing outside: Specnaut
 * never stages one, so it is not a copy, and cli#687 leaves it in place.
 *
 * For the layout on disk at check time. A concurrent writer inside staging is out
 * of scope (Deno has no dirfd-relative unlink), so this is the last await before
 * the removal; a read checks the handle it opens against the `lstat` returned
 * here (`readSameEntry`). A missing entry throws `NotFound`, which each caller
 * already maps to "nothing staged".
 */
async function assertPlainStagedEntry(
  root: string,
  full: string,
  action: "read" | "delete",
): Promise<Deno.FileInfo> {
  const rel = await resolvedRelative(root, full);
  const seen = rel.startsWith(`${STAGING_REL}/`) ? await Deno.lstat(full) : null;
  if (seen === null || seen.isSymlink) {
    throw stagedEntryRefusal(root, full, join(root, rel), action);
  }
  return seen;
}

/**
 * The text of the staged entry `seen` describes, read from one handle that is
 * still that entry (cli#776): between the check and the open, the entry can be
 * swapped for a link or another file, and `open` follows whatever is there.
 * The handle's `fstat` must name the device and inode `lstat` saw, as
 * `readChecked` in `fs_tree_walker.ts` does for a checkout.
 */
async function readSameEntry(root: string, full: string, seen: Deno.FileInfo): Promise<string> {
  const file = await Deno.open(full, { read: true });
  let info: Deno.FileInfo;
  try {
    info = await file.stat();
  } catch (err) {
    file.close();
    throw err;
  }
  if (info.dev !== seen.dev || info.ino !== seen.ino) {
    file.close();
    throw changedStagedEntryRefusal(root, full);
  }
  return await new Response(file.readable).text();
}

/**
 * The staged entry `relPath` names, judged as `read` and `delete` act on it, or
 * null when nothing is staged there. One helper for both, so they cannot drift
 * apart again (cli#765): a read that followed the links a delete refused let
 * reconcile write the project file and the lock before the delete refused.
 *
 * `relPath` arrives from `ReconcilePathUseCase` as a LOCK KEY, and the lock is
 * committed and not covered by the scaffolded `.gitignore` — a cloned
 * repository supplies it (cli#574). `resolve()` also treats an absolute
 * `relPath` as the whole path, discarding the prefix entirely, so the string
 * check is doing real work here and not merely echoing a caller.
 */
async function stagedEntry(
  projectDir: string,
  relPath: string,
  action: "read" | "delete",
): Promise<{ root: string; full: string; seen: Deno.FileInfo } | null> {
  assertSafeDestination(relPath);
  await assertStagingNotLinked(projectDir);
  const root = await resolveProjectRoot(projectDir);
  const full = resolve(projectDir, STAGING_REL, relPath);
  // The entry it acts on, never where that leads: judge one, act on another (cli#751).
  await assertRemovableInProject(root, full);
  try {
    return { root, full, seen: await assertPlainStagedEntry(root, full, action) };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

export class FsStagingStore implements StagingStore {
  async list(projectDir: string): Promise<string[]> {
    const stagingDir = resolve(projectDir, STAGING_REL);
    await assertStagingNotLinked(projectDir);
    try {
      const stat = await Deno.stat(stagingDir);
      if (!stat.isDirectory) return [];
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    const out: string[] = [];
    for await (const entry of walk(stagingDir, { includeDirs: false, includeFiles: true })) {
      out.push(relative(stagingDir, entry.path).replaceAll("\\", "/"));
    }
    return out;
  }

  async read(projectDir: string, relPath: string): Promise<string | null> {
    const entry = await stagedEntry(projectDir, relPath, "read");
    if (entry === null) return null;
    try {
      return await readSameEntry(entry.root, entry.full, entry.seen);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async delete(projectDir: string, relPath: string): Promise<string[]> {
    const full = (await stagedEntry(projectDir, relPath, "delete"))?.full;
    if (full === undefined) return [];
    try {
      await Deno.remove(full);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    // The copy is gone. A folder left behind is a note, never a throw: a caller
    // would report that throw as a copy it could not clear (cli#719).
    const notes: string[] = [];
    await pruneEmptyParents(dirname(full), resolve(projectDir, STAGING_REL), notes);
    return notes;
  }

  async cleanupIfEmpty(projectDir: string): Promise<boolean> {
    const stagingDir = resolve(projectDir, STAGING_REL);
    // OUTSIDE the try, like `SpecCacheWriter.clear`'s guard and for the same
    // reason: the catch below swallows `NotFound` to make the cleanup
    // idempotent, and that is exactly what `resolveProjectRoot` raises on a
    // missing project. A refusal that becomes a silent `return false` in front
    // of a `Deno.remove` is worse than no refusal.
    //
    // `readDir` FOLLOWS a symlinked directory and lists the target's entries,
    // so an empty out-of-project directory made this decide "prune it" on
    // evidence gathered somewhere else entirely.
    await assertInsideProject(await resolveProjectRoot(projectDir), stagingDir);
    await assertStagingNotLinked(projectDir);
    try {
      const entries = [];
      for await (const _ of Deno.readDir(stagingDir)) entries.push(_);
      if (entries.length > 0) return false;
      await Deno.remove(stagingDir);
      return true;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return false;
      throw err;
    }
  }
}
