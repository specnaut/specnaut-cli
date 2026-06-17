import { dirname, join, resolve } from "@std/path";
import { assertSafeDestination, type Bundle } from "../domain/template.ts";
import { mergeIntoFile } from "../domain/merge_block.ts";
import { mergeClaudeSettings } from "../domain/claude_settings_merge.ts";
import type { BackupReport, FsWriter } from "../application/ports.ts";

const BACKUP_SUFFIX = ".specnaut.bak";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

export class DenoFsWriter implements FsWriter {
  async detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]> {
    const conflicts: string[] = [];
    const resolved = resolve(targetDir);
    for (const [dest, file] of Object.entries(bundle)) {
      assertSafeDestination(dest);
      // Mergeable files merge non-destructively into any pre-existing content,
      // so they are never conflicts.
      if (file.mergeBlock !== undefined) continue;
      // JSON-merged files (e.g. `.claude/settings.json`) are also merged
      // structurally into any pre-existing user content — never a conflict.
      if (file.mergeJson !== undefined) continue;
      // Skip-if-exists files (placeholders like AGENTS.md) silently leave
      // the user's existing file alone — also never a conflict.
      if (file.skipIfExists === true) continue;
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
          `Target directory already contains ${conflicts.length} file(s) specnaut manages:\n` +
            conflicts.map((c) => `  - ${c}`).join("\n"),
        );
      }
    }

    const backups: { dest: string; backupPath: string }[] = [];
    const skippedSkipIfExists: string[] = [];

    for (const [dest, file] of Object.entries(bundle)) {
      const abs = join(resolved, dest);
      await Deno.mkdir(dirname(abs), { recursive: true });

      // Mergeable files are never backed up: merge is non-destructive and
      // writing a backup of an unchanged user file is noisy. They also
      // bypass the overwrite/conflict path entirely.
      if (file.mergeBlock !== undefined) {
        const existing = await readIfExists(abs);
        const merged = mergeIntoFile(existing, file.content, file.mergeBlock);
        await Deno.writeTextFile(abs, merged);
        continue;
      }

      // JSON-merged files: same non-destructive contract as mergeBlock,
      // but the splice rule is structured (per-flavor) rather than a
      // fenced text block.
      if (file.mergeJson !== undefined) {
        const existing = await readIfExists(abs);
        // Currently only one flavor — switch when more land.
        const merged = mergeClaudeSettings(existing, file.content, dest);
        await Deno.writeTextFile(abs, merged);
        continue;
      }

      // Skip-if-exists placeholders: only write if the file is absent
      // AND the caller didn't request overwrite. With overwrite=true
      // (i.e. `--force` from init or any upgrade call), the placeholder
      // is treated like an owned file: the existing content is backed
      // up and the bundle content is written. This preserves the
      // existing `upgrade --force` semantics for files that init
      // originally created (lock-tracked → standard upgrade path).
      if (
        file.skipIfExists === true && !overwrite && (await fileExists(abs))
      ) {
        skippedSkipIfExists.push(dest);
        continue;
      }

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

    return { backups, skippedSkipIfExists };
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

    return { backups, skippedSkipIfExists: [] };
  }
}
