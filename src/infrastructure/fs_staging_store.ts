import { relative, resolve } from "@std/path";
import { walk } from "@std/fs/walk";
import type { StagingStore } from "../application/ports.ts";

const STAGING_REL = ".specflow/upgrade-staging";

export class FsStagingStore implements StagingStore {
  async list(projectDir: string): Promise<string[]> {
    const stagingDir = resolve(projectDir, STAGING_REL);
    try {
      const stat = await Deno.stat(stagingDir);
      if (!stat.isDirectory) return [];
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    const out: string[] = [];
    for await (const entry of walk(stagingDir, { includeDirs: false, includeFiles: true })) {
      out.push(relative(stagingDir, entry.path));
    }
    return out;
  }

  async read(projectDir: string, relPath: string): Promise<string | null> {
    const full = resolve(projectDir, STAGING_REL, relPath);
    try {
      return await Deno.readTextFile(full);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async delete(projectDir: string, relPath: string): Promise<void> {
    const full = resolve(projectDir, STAGING_REL, relPath);
    try {
      await Deno.remove(full);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    }
    // Best-effort: clean up now-empty parent dirs up to the staging root.
    let parent = resolve(full, "..");
    const stagingDir = resolve(projectDir, STAGING_REL);
    while (parent !== stagingDir && parent.startsWith(stagingDir)) {
      try {
        const entries = [];
        for await (const _ of Deno.readDir(parent)) entries.push(_);
        if (entries.length > 0) break;
        await Deno.remove(parent);
      } catch {
        break;
      }
      parent = resolve(parent, "..");
    }
  }

  async cleanupIfEmpty(projectDir: string): Promise<boolean> {
    const stagingDir = resolve(projectDir, STAGING_REL);
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
