/**
 * The plugin declarations of `.claude/settings.json` (#642): the marketplace
 * Specnaut publishes to and the plugins it enables — how a merge treats them,
 * and what it says about them. Split from `claude_settings_merge.ts`, which
 * calls the merge as its step 4.
 *
 * A key the user already has is theirs, whatever its value:
 * `"specnaut-cockpit@specnaut-marketplace": false` is how a project opts out,
 * and it holds across every upgrade. Only a key that is absent is added — with
 * one exception: a marketplace still pointed at Specnaut's own source, current
 * or legacy (cli#783), gets this release's source, or every project would stay
 * on the first release that wrote it. Only `source` is replaced; any other key
 * on the entry stays.
 *
 * Pure — no IO, no Deno globals.
 */

import {
  classifyDeclaration,
  describeSource,
  specnautMarketplaceRef,
} from "./specnaut_marketplace.ts";

// deno-lint-ignore no-explicit-any
type Settings = Record<string, any>;
const FIELDS = ["extraKnownMarketplaces", "enabledPlugins"] as const;

/** The user's plugin declarations with Specnaut's merged in, per the rule above. */
export function mergePluginDeclarations(user: Settings, bundled: Settings): Settings {
  const out: Settings = {};
  for (const field of FIELDS) {
    const bundledMap = bundled[field];
    if (!bundledMap || typeof bundledMap !== "object") continue;
    const merged = { ...(user[field] && typeof user[field] === "object" ? user[field] : {}) };
    for (const [key, value] of Object.entries(bundledMap)) {
      if (!(key in merged)) merged[key] = value;
      else if (field === "extraKnownMarketplaces" && isOurs(merged[key])) {
        merged[key] = { ...merged[key], source: (value as { source?: unknown })?.source };
      }
    }
    out[field] = merged;
  }
  return out;
}

/** Specnaut's own declaration, at any release: re-pinned or repaired, never kept. */
function isOurs(entry: unknown): boolean {
  const kind = classifyDeclaration(entry);
  return kind === "current" || kind === "legacy";
}

/**
 * What a merge did to the plugin declarations, in sentences for the person
 * running `specnaut upgrade`. A plugin Specnaut enables runs code when
 * installed, so it is never added silently; and a Specnaut marketplace
 * pointed somewhere else is kept, but said (#642).
 */
export function pluginNotes(user: Settings, bundled: Settings, dest: string): string[] {
  const notes: string[] = [];
  for (const [key, value] of Object.entries(bundled.extraKnownMarketplaces ?? {})) {
    const note = marketplaceNote(dest, key, user.extraKnownMarketplaces?.[key], value);
    if (note !== null) notes.push(note);
  }
  for (const [key, value] of Object.entries(bundled.enabledPlugins ?? {})) {
    if (value === true && !(key in (user.enabledPlugins ?? {}))) {
      notes.push(
        `${dest}: enabled ${key} — Claude Code offers to install it when the project is ` +
          `trusted; it runs code in Claude Code. Set it to false to decline`,
      );
    }
  }
  return notes;
}

/** The one sentence a merge owes about marketplace `key`, or `null` when nothing changed. */
function marketplaceNote(dest: string, key: string, entry: unknown, ours: unknown): string | null {
  const bundledSource = (ours as { source?: unknown })?.source;
  const userSource = (entry as { source?: unknown } | null | undefined)?.source;
  const where = describeSource(bundledSource);
  switch (classifyDeclaration(entry)) {
    case "absent":
      return `${dest}: declared the marketplace ${key} (${where})`;
    case "current": {
      const was = specnautMarketplaceRef(userSource);
      const now = specnautMarketplaceRef(bundledSource);
      return was === now ? null : `${dest}: re-pinned the marketplace ${key} from ${was} to ${now}`;
    }
    case "legacy":
      return `${dest}: repaired the marketplace ${key} — Claude Code could not refresh its ` +
        `github source, so the cockpit never loaded; it now reads the catalog by URL (${where})`;
    case "foreign":
      return `${dest}: kept the marketplace ${key} pointed at ${describeSource(userSource)}, ` +
        `not Specnaut's (${where}) — it receives Specnaut's updates only if that source does`;
  }
}
