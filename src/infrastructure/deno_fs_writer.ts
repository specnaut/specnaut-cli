import { dirname, join, resolve } from "@std/path";
import { assertSafeDestination, type Bundle } from "../domain/template.ts";
import type { BackupReport, FsWriter } from "../application/ports.ts";

const BACKUP_SUFFIX = ".specflow.bak";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

export class DenoFsWriter implements FsWriter {
  async detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]> {
    const conflicts: string[] = [];
    const resolved = resolve(targetDir);
    for (const dest of Object.keys(bundle)) {
      assertSafeDestination(dest);
      const abs = join(resolved, dest);
      if (await fileExists(abs)) conflicts.push(dest);
    }
    return conflicts.sort();
  }

  async writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport> {
    const overwrite = options.overwrite ?? false;
    const backupExisting = options.backupExisting ?? false;
    const resolved = resolve(targetDir);

    for (const dest of Object.keys(bundle)) assertSafeDestination(dest);

    if (!overwrite) {
      const conflicts = await this.detectConflicts(bundle, resolved);
      if (conflicts.length > 0) {
        throw new Error(
          `Target directory already contains ${conflicts.length} file(s) specflow manages:\n` +
            conflicts.map((c) => `  - ${c}`).join("\n"),
        );
      }
    }

    const backups: { dest: string; backupPath: string }[] = [];

    for (const [dest, file] of Object.entries(bundle)) {
      const abs = join(resolved, dest);
      await Deno.mkdir(dirname(abs), { recursive: true });

      if (backupExisting && (await fileExists(abs))) {
        const backupAbs = `${abs}${BACKUP_SUFFIX}`;
        await Deno.rename(abs, backupAbs);
        backups.push({ dest, backupPath: `${dest}${BACKUP_SUFFIX}` });
      }

      await Deno.writeTextFile(abs, file.content);
      if (file.executable && Deno.build.os !== "windows") {
        await Deno.chmod(abs, 0o755);
      }
    }

    return { backups };
  }

  async deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean },
  ): Promise<BackupReport> {
    const resolved = resolve(targetDir);
    const backups: { dest: string; backupPath: string }[] = [];

    for (const dest of paths) {
      assertSafeDestination(dest);
      const abs = join(resolved, dest);
      if (!(await fileExists(abs))) continue;

      if (options.backupExisting) {
        const backupAbs = `${abs}${BACKUP_SUFFIX}`;
        await Deno.rename(abs, backupAbs);
        backups.push({ dest, backupPath: `${dest}${BACKUP_SUFFIX}` });
      } else {
        await Deno.remove(abs);
      }
    }

    return { backups };
  }
}
