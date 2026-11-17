/**
 * Structured JSON merge for `.claude/settings.json` (the Claude Code
 * settings file Specnaut tags with `mergeJson: "claude-settings"`).
 *
 * Why: `.claude/settings.json` is user-owned (theme, permissions, env,
 * attribution, plugins, MCP, …) but Specnaut needs to register its hooks
 * there for the bundled hook scripts to fire (#139). A fenced text block —
 * the trick we use for `.gitignore` — doesn't compose with structured JSON.
 *
 * Merge semantics:
 *
 *   - Hook entries are spliced into the user's `hooks.*` arrays by
 *     `spliceHooks` (`hook_settings_merge.ts`), which owns the rule for
 *     which entries are Specnaut's.
 *   - `permissions.ask` loses the release rules Specnaut used to add
 *     (`RETIRED_ASK_RULES`) and keeps every other rule of the user's, in order.
 *     A bundled rule, if one ever returns, joins as a set union. `allow` is
 *     never touched.
 *   - `permissions.deny` gains each bundled rule the user lacks, after the
 *     user's own, which stay in order: the credential reads no seat needs (the
 *     product owner receives issue text as data, and a subagent's Read reaches
 *     outside the project with no approval step). Claude Code applies a Read
 *     rule to Grep and Glob as well.
 *   - `extraKnownMarketplaces` and `enabledPlugins` gain each bundled key the
 *     user does not have, and keep every key they do — `false` included, which
 *     is how a project declines a plugin Specnaut enables (#642). Specnaut's
 *     own marketplace source is re-pinned (`claude_plugin_declarations.ts`).
 *   - All other user fields are passed through verbatim.
 *
 * Removal is explicit: a hook leaves through `RETIRED_HOOK_SCRIPTS`, an ask rule
 * through `RETIRED_ASK_RULES`. Anything not named there stays.
 *
 * Pure — no IO, no Deno globals.
 */

import { type HookMap, spliceHooks } from "./hook_settings_merge.ts";
import { type JsonMergeResult, jsonMergeResult, parseUserJson } from "./json_merge.ts";
import { mergePluginDeclarations, pluginNotes } from "./claude_plugin_declarations.ts";

/** The ask rules Specnaut added before its release guard was retired, matched exactly. */
const RETIRED_ASK_RULES: ReadonlySet<string> = new Set([
  "Bash(gh release create *)",
  "Bash(gh release edit *--draft*)",
  "Bash(gh run rerun *)",
  "Bash(*release/tag.sh*)",
  "Bash(*release/release-github.sh*)",
  "Bash(*release/release-gitlab.sh*)",
  "Bash(gh release edit *)",
  "Bash(gh release upload *)",
  "Bash(glab release create *)",
  "Bash(gh release new *)",
]);

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

  // 3. The ask rules: the retired ones leave, the user's stay in order, and a
  //    bundled one joins. A list or a block emptied this way goes with it.
  const bundledAsk: string[] = bundledParsed.permissions?.ask ?? [];
  const userPerms = userParsed.permissions;
  const ask = ((userPerms?.ask ?? []) as string[]).filter((r) => !RETIRED_ASK_RULES.has(r));
  for (const rule of bundledAsk) if (!ask.includes(rule)) ask.push(rule);
  const deny = [...((userPerms?.deny ?? []) as string[])];
  for (const rule of (bundledParsed.permissions?.deny ?? []) as string[]) {
    if (!deny.includes(rule)) deny.push(rule);
  }
  if (userPerms !== undefined || ask.length > 0 || deny.length > 0) {
    const { ask: _dropped, deny: _denied, ...rest } = userPerms ?? {};
    const permissions = {
      ...rest,
      ...(ask.length > 0 ? { ask } : {}),
      ...(deny.length > 0 ? { deny } : {}),
    };
    if (Object.keys(permissions).length > 0) result.permissions = permissions;
    else delete result.permissions;
  }

  // 4. Plugin declarations (#642, cli#783): `claude_plugin_declarations.ts`.
  Object.assign(result, mergePluginDeclarations(userParsed, bundledParsed));

  // Preserve hooks key only if non-empty.
  if (Object.keys(mergedHooks).length > 0) result.hooks = mergedHooks;
  else delete result.hooks;

  return jsonMergeResult(result, existing);
}

/**
 * What a merge did to the plugin declarations, in sentences for the person
 * running `specnaut upgrade` (`claude_plugin_declarations.ts`).
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
  return pluginNotes(user, JSON.parse(bundled) as SettingsShape, dest);
}
