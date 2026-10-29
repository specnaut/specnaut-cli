/**
 * Structured JSON merge for `.claude/settings.json` (the Claude Code
 * settings file Specnaut tags with `mergeJson: "claude-settings"`).
 *
 * Why: `.claude/settings.json` is user-owned (theme, permissions, env,
 * attribution, plugins, MCP, …) but Specnaut needs to register its hooks
 * there for the bundled hook scripts to fire (#139). A fenced text block —
 * the trick we use for `.gitignore` — doesn't compose with structured JSON.
 *
 * Merge semantics (additive-only):
 *
 *   - Hook entries are spliced into the user's `hooks.*` arrays by
 *     `spliceHooks` (`hook_settings_merge.ts`), which owns the rule for
 *     which entries are Specnaut's.
 *   - `permissions.ask` is a set union: the user's rules first, in their
 *     order, then each bundled rule not already present. Ask rules are how
 *     Specnaut guarantees a prompt before a publish (#610) — Claude Code
 *     evaluates `ask` before `allow`, so they hold against a broader allow
 *     the user added. `allow` and `deny` are never touched: an ask rule
 *     adds a prompt, it never grants or forbids anything.
 *   - `extraKnownMarketplaces` and `enabledPlugins` gain each bundled key the
 *     user does not have, and keep every key they do — `false` included, which
 *     is how a project declines a plugin Specnaut enables (#642).
 *   - All other user fields are passed through verbatim.
 *
 * Removal-on-unbundle (e.g. Specnaut drops a hook in a future
 * release) is intentionally NOT handled here — once written, the
 * user's settings.json keeps the orphan entry. Tracked separately
 * if we ever need it.
 *
 * Pure — no IO, no Deno globals.
 */

import {
  type HookMap,
  type JsonMergeResult,
  jsonMergeResult,
  parseUserJson,
  spliceHooks,
} from "./hook_settings_merge.ts";

type SettingsShape = {
  hooks?: HookMap;
  // Any other user-managed top-level fields are preserved through the
  // round-trip without inspection.
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
};

/**
 * Merge Specnaut's bundled hook entries into the user's existing
 * `.claude/settings.json` content. Returns the merged JSON as a
 * pretty-printed string (2-space indent, trailing newline), and whether it
 * differs from what is on disk.
 *
 *   - `existing`: on-disk content, or `null` when no file is present
 *     (greenfield — the bundled content is written verbatim).
 *   - `bundled`: Specnaut's bundled `settings.json` content.
 *   - `destPath`: the destination relative path (used only for the
 *     error message when the existing file is malformed JSON).
 */
export function mergeClaudeSettings(
  existing: string | null,
  bundled: string,
  destPath: string,
): JsonMergeResult {
  const bundledParsed = JSON.parse(bundled) as SettingsShape;
  const userParsed = parseUserJson(existing, destPath) as SettingsShape | null;
  if (userParsed === null) return jsonMergeResult(bundledParsed, existing);

  const result: SettingsShape = { ...userParsed };
  // 1–2. Specnaut's hook entries, spliced into the user's.
  const mergedHooks = spliceHooks(userParsed.hooks ?? {}, bundledParsed.hooks ?? {});

  // 3. Union the bundled ask rules into the user's, without reordering or
  //    dropping anything of theirs.
  const bundledAsk = bundledParsed.permissions?.ask ?? [];
  if (bundledAsk.length > 0) {
    const userPerms = userParsed.permissions ?? {};
    const ask: string[] = [...(userPerms.ask ?? [])];
    for (const rule of bundledAsk) if (!ask.includes(rule)) ask.push(rule);
    result.permissions = { ...userPerms, ask };
  }

  // 4. Plugin declarations (#642): the marketplace Specnaut publishes to and
  //    the plugins it enables. A key the user already has is theirs, whatever
  //    its value: `"specnaut-cockpit@specnaut-marketplace": false` is how a
  //    project opts out, and it holds across every upgrade. Only a key that is
  //    absent is added — with one exception: a marketplace still pointed at
  //    Specnaut's own source is re-pinned to this release, or every project
  //    would stay on the first release that wrote it.
  for (const field of ["extraKnownMarketplaces", "enabledPlugins"] as const) {
    const bundledMap = bundledParsed[field];
    if (!bundledMap || typeof bundledMap !== "object") continue;
    const userMap = userParsed[field] && typeof userParsed[field] === "object"
      ? userParsed[field]
      : {};
    const merged = { ...userMap };
    for (const [key, value] of Object.entries(bundledMap)) {
      const isOurs = field === "extraKnownMarketplaces" && key in merged &&
        sameSource(merged[key]?.source, (value as { source?: unknown })?.source);
      if (!(key in merged) || isOurs) merged[key] = value;
    }
    result[field] = merged;
  }

  // Preserve hooks key only if non-empty.
  if (Object.keys(mergedHooks).length > 0) {
    result.hooks = mergedHooks;
  }

  return jsonMergeResult(result, existing);
}

type SourceLike = { source?: unknown; repo?: unknown; url?: unknown; path?: unknown };

/** Same marketplace location, whatever the ref: the type, the repository and the path. */
function sameSource(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const x = a as SourceLike;
  const y = b as SourceLike;
  return x.source === y.source && x.repo === y.repo && x.url === y.url && x.path === y.path;
}

/**
 * What a merge did to the plugin declarations, in sentences for the person
 * running `specnaut upgrade`. A plugin Specnaut enables runs code when
 * installed, so it is never added silently; and a Specnaut marketplace
 * pointed somewhere else is kept, but said (#642).
 */
export function pluginDeclarationNotes(
  existing: string | null,
  bundled: string,
  dest: string,
): string[] {
  // Throws like the merge does: the writer merges first, so a malformed file
  // never reaches here, and a caller that skipped the merge is told why.
  const user = parseUserJson(existing, dest) as SettingsShape | null;
  if (user === null) return [];
  const ours = JSON.parse(bundled) as SettingsShape;
  const notes: string[] = [];
  for (const [key, value] of Object.entries(ours.extraKnownMarketplaces ?? {})) {
    const bundledSource = (value as { source?: SourceLike })?.source;
    const userSource = user.extraKnownMarketplaces?.[key]?.source as SourceLike | undefined;
    const where = `${bundledSource?.repo ?? bundledSource?.url}@${
      (bundledSource as { ref?: string })?.ref
    }`;
    if (userSource === undefined) {
      notes.push(`${dest}: declared the marketplace ${key} (${where})`);
    } else if (sameSource(userSource, bundledSource)) {
      const was = (userSource as { ref?: string }).ref;
      const now = (bundledSource as { ref?: string })?.ref;
      if (was !== now) {
        notes.push(`${dest}: re-pinned the marketplace ${key} from ${was} to ${now}`);
      }
    } else {
      notes.push(
        `${dest}: kept the marketplace ${key} pointed at ` +
          `${
            userSource.repo ?? userSource.url ?? "a custom source"
          }, not Specnaut's (${where}) — ` +
          "it receives Specnaut's updates only if that source does",
      );
    }
  }
  for (const [key, value] of Object.entries(ours.enabledPlugins ?? {})) {
    if (value === true && !(key in (user.enabledPlugins ?? {}))) {
      notes.push(
        `${dest}: enabled ${key} — Claude Code offers to install it when the project is ` +
          `trusted; it runs code in Claude Code. Set it to false to decline`,
      );
    }
  }
  return notes;
}
