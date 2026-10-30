import { dirname, join } from "@std/path";
import { assertInsideProject, resolveProjectRoot } from "./fs_containment.ts";
import { parseCloudConfig, renderCloudConfig } from "../domain/cloud/cloud_config.ts";
import type { CloudConfig } from "../domain/cloud/cloud_config.ts";
import type { BacklogConfigStore, CloudConfigStore } from "../application/backlog_config_ports.ts";

/**
 * Reads and writes the project's `.specnaut/backlog-config.yml`. Mirrors
 * `FsLockStore`: the store owns the path, the containment guard in front of
 * every write, and the rule that only `NotFound` means "absent".
 */
export class FsBacklogConfigStore implements BacklogConfigStore, CloudConfigStore {
  configPath(projectDir: string): string {
    return join(projectDir, ".specnaut", "backlog-config.yml");
  }

  async readCloudConfig(projectDir: string): Promise<CloudConfig | null> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.configPath(projectDir));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    return parseCloudConfig(text);
  }

  async writeCloudConfig(projectDir: string, apiUrl: string, projectKey: string): Promise<void> {
    await this.write(projectDir, renderCloudConfig(apiUrl, projectKey));
  }

  async writeStubIfAbsent(projectDir: string, stub: string): Promise<boolean> {
    try {
      await Deno.stat(this.configPath(projectDir));
      return false; // never clobber an existing config
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    await this.write(projectDir, stub);
    return true;
  }

  /** The one write path: the guard, then the directory, then the file (cli#574). */
  private async write(projectDir: string, body: string): Promise<void> {
    const path = this.configPath(projectDir);
    await assertInsideProject(await resolveProjectRoot(projectDir), path);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
}
