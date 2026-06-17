import { dirname, join } from "@std/path";
import { type InstalledLock, parseLock, serializeLock } from "../domain/installed_lock.ts";
import type { LockStore } from "../application/ports.ts";

export class FsLockStore implements LockStore {
  lockPath(projectDir: string): string {
    return join(projectDir, ".specnaut/installed.lock");
  }

  async read(projectDir: string): Promise<InstalledLock | null> {
    const path = this.lockPath(projectDir);
    try {
      const raw = await Deno.readTextFile(path);
      return parseLock(raw);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async write(projectDir: string, lock: InstalledLock): Promise<void> {
    const path = this.lockPath(projectDir);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, serializeLock(lock));
  }
}
