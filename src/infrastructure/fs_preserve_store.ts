import { dirname, join } from "@std/path";
import {
  EMPTY_PRESERVE_CONFIG,
  parsePreserveConfig,
  type PreserveConfig,
  serializePreserveConfig,
} from "../domain/preserve_config.ts";
import type { PreserveStore } from "../application/ports.ts";

/**
 * Reads / writes the project-level preserve manifest at
 * `.specflow/preserve.yml`. Mirrors `FsLockStore`: an absent file reads as
 * `EMPTY_PRESERVE_CONFIG`, and a malformed file degrades to empty via the
 * pure `parsePreserveConfig` (which never throws) — a broken manifest must
 * surface a warning at the handler, never abort init/upgrade.
 */
export class FsPreserveStore implements PreserveStore {
  preservePath(projectDir: string): string {
    return join(projectDir, ".specflow/preserve.yml");
  }

  async read(projectDir: string): Promise<PreserveConfig> {
    const path = this.preservePath(projectDir);
    try {
      const raw = await Deno.readTextFile(path);
      return parsePreserveConfig(raw);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return EMPTY_PRESERVE_CONFIG;
      throw err;
    }
  }

  async write(projectDir: string, cfg: PreserveConfig): Promise<void> {
    const path = this.preservePath(projectDir);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, serializePreserveConfig(cfg));
  }
}
