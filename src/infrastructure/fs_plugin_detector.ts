import { isAbsolute, join, normalize, resolve, SEPARATOR } from "@std/path";
import type { PluginDetector } from "../application/ports.ts";

/**
 * Resolves whether a Claude Code plugin is installed, and what it serves.
 *
 * ## The layout, and the bug that came from guessing it (cli#606)
 *
 * This used to probe `~/.claude/plugins/cache/<name>` and return
 * `stat.isDirectory`. That is not where a plugin lives. Claude Code writes:
 *
 *     ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
 *
 * so `cache/` holds MARKETPLACE names. The old probe could only return `true`
 * if a marketplace happened to be named `specnaut-plugin`, and it therefore
 * returned `false` for every real installation. Because
 * `computeUpgradePlan` computes `covered = pluginInstalled && …`, the whole
 * binary → plugin migration was dead code, and `checkPluginGap` diagnosed every
 * project as if the plugin were absent. Neither failure said anything: the
 * safe-default fallback (cannot detect ⇒ do not migrate ⇒ lose nothing) is what
 * let it go unnoticed since the feature shipped.
 *
 * ## Two sources, in order
 *
 * 1. **`installed_plugins.json`**, the registry Claude Code maintains. Keys are
 *    `<plugin>@<marketplace>` and each record carries an explicit `installPath`,
 *    so nothing depends on a directory-depth convention that may change.
 * 2. **A walk of the cache**, when the registry is absent or unparseable. An
 *    install plainly present on disk should not be hidden by a corrupt JSON
 *    file.
 *
 * ## Any marketplace counts
 *
 * Written down because the alternative is defensible and this is a decision,
 * not an accident: the PLUGIN NAME is the identity. Specnaut does not control
 * which marketplace a user adds — a fork, a mirror or an internal marketplace
 * are all legitimate — so pinning one would report a genuine install as absent
 * and silently disable migration for that user. If several marketplaces ship
 * the same plugin name, the first resolvable install wins; they are the same
 * plugin by the only name we have.
 *
 * ## Failure is always "not installed"
 *
 * Every error path returns `false` rather than throwing. Detection failure must
 * degrade to "no migration" — a detector that throws takes `specnaut upgrade`
 * down with it, and one that guesses `true` deletes files the plugin will not
 * serve.
 *
 * The home directory is captured at construction so tests can override it
 * without touching real env vars or the real filesystem.
 */
export class FsPluginDetector implements PluginDetector {
  constructor(
    private readonly home: string | null = Deno.env.get("HOME") ?? null,
  ) {}

  async isPluginInstalled(name: string): Promise<boolean> {
    return (await this.resolveInstallRoot(name)) !== null;
  }

  /**
   * Does the INSTALLED plugin actually carry `pluginRelPath`?
   *
   * `PLUGIN_COVERED_PATHS_CLAUDE` is compile-time: it describes what the plugin
   * is expected to ship, not what the user's installed version does. A user on
   * an older release has files covered by the list that their plugin has never
   * heard of, and migrating those deletes the project's only copy and puts
   * nothing in its place. This asks the tree instead of assuming.
   *
   * `pluginRelPath` is plugin-root-relative (`skills/board/SKILL.md`). Anything
   * absolute, or escaping the plugin directory, answers `false` — the argument
   * is assembled from a destination path, so it must not become a way to ask
   * about arbitrary files.
   */
  async pluginHasPath(name: string, pluginRelPath: string): Promise<boolean> {
    const root = await this.resolveInstallRoot(name);
    if (root === null) return false;
    if (pluginRelPath === "" || isAbsolute(pluginRelPath)) return false;

    const target = resolve(root, normalize(pluginRelPath));
    const rootResolved = resolve(root);
    if (target !== rootResolved && !target.startsWith(rootResolved + SEPARATOR)) {
      return false;
    }
    try {
      await Deno.stat(target);
      return true;
    } catch {
      return false;
    }
  }

  /** The plugin's install directory — the root its `skills/`, `agents/` sit in. */
  private async resolveInstallRoot(name: string): Promise<string | null> {
    if (this.home === null) return null;
    return (await this.fromRegistry(name)) ?? (await this.fromCacheWalk(name));
  }

  private async fromRegistry(name: string): Promise<string | null> {
    const path = join(this.home!, ".claude/plugins/installed_plugins.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch {
      return null; // absent or malformed — the cache walk is the fallback
    }
    const plugins = (parsed as { plugins?: unknown })?.plugins;
    if (typeof plugins !== "object" || plugins === null) return null;

    for (const [key, records] of Object.entries(plugins as Record<string, unknown>)) {
      // `<plugin>@<marketplace>`. Match on the plugin half only — see "Any
      // marketplace counts" above. A key with no `@` is not this shape; skip it
      // rather than guessing.
      if (!key.startsWith(`${name}@`)) continue;
      for (const rec of Array.isArray(records) ? records : []) {
        const p = (rec as { installPath?: unknown })?.installPath;
        if (typeof p !== "string" || p === "") continue;
        if (await isDir(p)) return p;
      }
    }
    return null;
  }

  /**
   * Walk `cache/<marketplace>/<name>/<version>/` when the registry cannot
   * answer. The deepest existing directory is the plugin root; a plugin dir
   * with no version beneath it is taken as the root itself, because that shape
   * has appeared in the wild and refusing it would report a real install as
   * absent.
   */
  private async fromCacheWalk(name: string): Promise<string | null> {
    const cache = join(this.home!, ".claude/plugins/cache");
    let marketplaces: Deno.DirEntry[];
    try {
      marketplaces = await Array.fromAsync(Deno.readDir(cache));
    } catch {
      return null;
    }
    for (const mk of marketplaces.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!mk.isDirectory) continue;
      const pluginDir = join(cache, mk.name, name);
      if (!(await isDir(pluginDir))) continue;

      let versions: Deno.DirEntry[] = [];
      try {
        versions = await Array.fromAsync(Deno.readDir(pluginDir));
      } catch {
        return pluginDir;
      }
      // Highest-sorting version directory, which approximates "newest" without
      // parsing SemVer — the probe only needs A valid root, not the best one.
      const dirs = versions.filter((v) => v.isDirectory)
        .sort((a, b) => b.name.localeCompare(a.name));
      return dirs.length > 0 ? join(pluginDir, dirs[0].name) : pluginDir;
    }
    return null;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}
