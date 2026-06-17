import { resolve } from "@std/path";
import type { UpgradeMarkerStore } from "../application/ports.ts";
import type { UpgradeMarker } from "../domain/upgrade_marker.ts";

const MARKER_REL = ".specnaut/upgrade-pending.json";

export class FsUpgradeMarkerStore implements UpgradeMarkerStore {
  async read(projectDir: string): Promise<UpgradeMarker | null> {
    const path = resolve(projectDir, MARKER_REL);
    let raw: string;
    try {
      raw = await Deno.readTextFile(path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      // Other I/O errors (permission, EMFILE, etc.) propagate.
      throw err;
    }
    try {
      const parsed = JSON.parse(raw) as UpgradeMarker;
      // Minimal shape validation — anything malformed is treated as absent.
      if (typeof parsed.from !== "string") return null;
      if (typeof parsed.to !== "string") return null;
      if (typeof parsed.at !== "string") return null;
      return { from: parsed.from, to: parsed.to, at: parsed.at };
    } catch (_err) {
      // Corrupt JSON: treat as absent. The user will get a fresh marker next upgrade.
      return null;
    }
  }

  async write(projectDir: string, marker: UpgradeMarker): Promise<void> {
    const path = resolve(projectDir, MARKER_REL);
    await Deno.mkdir(resolve(projectDir, ".specnaut"), { recursive: true });
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
