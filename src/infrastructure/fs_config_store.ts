import { dirname, join } from "@std/path";
import { parseSyncConfig, serializeSyncConfig, type SyncConfig } from "../domain/sync_config.ts";
import type { ConfigStore } from "../application/ports.ts";

export class FsConfigStore implements ConfigStore {
  configPath(projectDir: string): string {
    return join(projectDir, ".specflow/config.yml");
  }

  async read(projectDir: string): Promise<SyncConfig | null> {
    const path = this.configPath(projectDir);
    try {
      const raw = await Deno.readTextFile(path);
      return parseSyncConfig(raw);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  async write(projectDir: string, config: SyncConfig): Promise<void> {
    const path = this.configPath(projectDir);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, serializeSyncConfig(config));
  }
}
