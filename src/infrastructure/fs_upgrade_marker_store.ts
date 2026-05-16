import { resolve } from "@std/path";
import type { UpgradeMarkerStore } from "../application/ports.ts";
import type { UpgradeMarker } from "../domain/upgrade_marker.ts";

const MARKER_REL = ".specflow/upgrade-pending.json";

export class FsUpgradeMarkerStore implements UpgradeMarkerStore {
  async read(projectDir: string): Promise<UpgradeMarker | null> {
    const path = resolve(projectDir, MARKER_REL);
    try {
      const raw = await Deno.readTextFile(path);
      const parsed = JSON.parse(raw) as UpgradeMarker;
      // Minimal shape validation — anything malformed is treated as absent.
      if (typeof parsed.from !== "string") return null;
      if (typeof parsed.to !== "string") return null;
      if (typeof parsed.at !== "string") return null;
      return { from: parsed.from, to: parsed.to, at: parsed.at };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      // Corrupt JSON / unreadable: treat as absent rather than crashing
      // the upgrade. The user will see a fresh marker next time.
      return null;
    }
  }

  async write(projectDir: string, marker: UpgradeMarker): Promise<void> {
    const path = resolve(projectDir, MARKER_REL);
    await Deno.mkdir(resolve(projectDir, ".specflow"), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(marker, null, 2) + "\n");
  }

  async delete(projectDir: string): Promise<void> {
    const path = resolve(projectDir, MARKER_REL);
    try {
      await Deno.remove(path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    }
  }
}
