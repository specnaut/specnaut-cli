import { join } from "@std/path";
import type { PluginDetector } from "../application/ports.ts";

/**
 * Probes the Claude Code plugins cache (`~/.claude/plugins/cache/<name>/`)
 * to detect whether a given plugin is installed.
 *
 * The cache path is the location Claude Code writes installed plugin
 * archives to per the discover-plugins docs. If the directory exists,
 * the plugin is installed. If it doesn't, or the home directory can't
 * be resolved, or the path resolves to a file instead of a directory,
 * the plugin is treated as not installed (safe-default fallback —
 * matches the architect's Q4 trade-off ruling: detection failure ⇒
 * no migration ⇒ no data loss).
 *
 * The home directory is captured at construction time so tests can
 * override it without touching real env vars or the real filesystem.
 */
export class FsPluginDetector implements PluginDetector {
  constructor(
    private readonly home: string | null = Deno.env.get("HOME") ?? null,
  ) {}

  async isPluginInstalled(name: string): Promise<boolean> {
    if (this.home === null) return false;
    const path = join(this.home, ".claude/plugins/cache", name);
    try {
      const stat = await Deno.stat(path);
      return stat.isDirectory;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return false;
      throw err;
    }
  }
}
