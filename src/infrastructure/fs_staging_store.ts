import { dirname, relative, resolve } from "@std/path";
import { walk } from "@std/fs/walk";
import type { StagingStore } from "../application/ports.ts";
import { assertSafeDestination } from "../domain/template.ts";
import { assertInsideProject, resolveProjectRoot } from "./fs_containment.ts";
import { pruneEmptyParents } from "./fs_prune.ts";
import { linkedStagingRefusal } from "./fs_refusals.ts";

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
    // `relPath` arrives from `ReconcilePathUseCase` as a LOCK KEY, and the lock
    // is committed and not covered by the scaffolded `.gitignore` — a cloned
    // repository supplies it (cli#574). `resolve()` also treats an absolute
    // `relPath` as the whole path, discarding the prefix entirely, so the
    // string check is doing real work here and not merely echoing a caller.
    assertSafeDestination(relPath);
    await assertStagingNotLinked(projectDir);
    const full = resolve(projectDir, STAGING_REL, relPath);
    await assertInsideProject(await resolveProjectRoot(projectDir), full);
    try {
      return await Deno.readTextFile(full);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async delete(projectDir: string, relPath: string): Promise<string[]> {
    assertSafeDestination(relPath);
    await assertStagingNotLinked(projectDir);
    const full = resolve(projectDir, STAGING_REL, relPath);
    await assertInsideProject(await resolveProjectRoot(projectDir), full);
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
