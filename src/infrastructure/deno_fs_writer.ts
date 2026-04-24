import { dirname, join, resolve } from "@std/path";
import { assertSafeDestination, type Bundle } from "../domain/template.ts";
import type { FsWriter } from "../application/ports.ts";

export class DenoFsWriter implements FsWriter {
  async detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]> {
    const conflicts: string[] = [];
    const resolved = resolve(targetDir);
    for (const dest of Object.keys(bundle)) {
      assertSafeDestination(dest);
      const abs = join(resolved, dest);
      try {
        await Deno.lstat(abs);
        conflicts.push(dest);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }
    return conflicts.sort();
  }

  async writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean },
  ): Promise<void> {
    const overwrite = options.overwrite ?? false;
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

    for (const [dest, file] of Object.entries(bundle)) {
      const abs = join(resolved, dest);
      await Deno.mkdir(dirname(abs), { recursive: true });
      await Deno.writeTextFile(abs, file.content);
      if (file.executable && Deno.build.os !== "windows") {
        await Deno.chmod(abs, 0o755);
      }
    }
  }
}
