/**
 * Structured JSON merge for `.claude/settings.json` (the Claude Code
 * settings file Specflow tags with `mergeJson: "claude-settings"`).
 *
 * Why: `.claude/settings.json` is user-owned (theme, permissions, env,
 * attribution, plugins, MCP, …) but Specflow needs to register four
 * hooks there for the bundled hook scripts to fire (#139). A fenced
 * text block — the trick we use for `.gitignore` — doesn't compose
 * with structured JSON. So we splice our hook entries into the user's
 * existing `hooks.*` arrays, keying on the hook's `command:` path.
 *
 * Merge semantics (additive-only):
 *
 *   - For each hook entry in our bundled content, find the matching
 *     user-side `matcher:` group (same matcher string OR both
 *     undefined) inside `hooks.<event>` and append our hook to its
 *     `hooks` array — IF the same `command:` path is not already
 *     present. The path-match makes re-runs idempotent.
 *   - If no matching matcher group exists, create one.
 *   - User-side groups with different matchers are NEVER touched.
 *   - All non-`hooks` user fields are passed through verbatim.
 *
 * Removal-on-unbundle (e.g. Specflow drops a hook in a future
 * release) is intentionally NOT handled here — once written, the
 * user's settings.json keeps the orphan entry. Tracked separately
 * if we ever need it.
 *
 * Pure — no IO, no Deno globals.
 */

type Hook = {
  type?: string;
  command?: string;
  // Other Claude Code hook fields (timeout, prompt, permission, etc.)
  // are preserved verbatim — we only inspect `command` for identity.
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
};

type MatcherGroup = {
  matcher?: string;
  hooks: Hook[];
};

type SettingsShape = {
  hooks?: Record<string, MatcherGroup[]>;
  // Any other user-managed top-level fields are preserved through the
  // round-trip without inspection.
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
};

/**
 * Error thrown when the on-disk settings.json is not valid JSON.
 * Surfaces a clear actionable hint at the CLI level rather than a
 * raw `SyntaxError` from `JSON.parse`.
 */
export class ClaudeSettingsParseError extends Error {
  constructor(public readonly destPath: string, override readonly cause: Error) {
    super(
      `${destPath} is not valid JSON: ${cause.message}\n` +
        `Fix the file (or back it up and re-run with --force) before re-running specflow.`,
    );
    this.name = "ClaudeSettingsParseError";
  }
}

/**
 * Merge Specflow's bundled hook entries into the user's existing
 * `.claude/settings.json` content. Returns the merged JSON as a
 * pretty-printed string (2-space indent, trailing newline).
 *
 *   - `existing`: on-disk content, or `null` when no file is present
 *     (greenfield — the bundled content is written verbatim).
 *   - `bundled`: Specflow's bundled `settings.json` content.
 *   - `destPath`: the destination relative path (used only for the
 *     error message when the existing file is malformed JSON).
 */
export function mergeClaudeSettings(
  existing: string | null,
  bundled: string,
  destPath: string,
): string {
  const bundledParsed = JSON.parse(bundled) as SettingsShape;

  if (existing === null || existing.trim().length === 0) {
    return `${JSON.stringify(bundledParsed, null, 2)}\n`;
  }

  let userParsed: SettingsShape;
  try {
    userParsed = JSON.parse(existing) as SettingsShape;
  } catch (err) {
    throw new ClaudeSettingsParseError(
      destPath,
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  const result: SettingsShape = { ...userParsed };
  const userHooks = userParsed.hooks ?? {};
  const bundledHooks = bundledParsed.hooks ?? {};
  const mergedHooks: Record<string, MatcherGroup[]> = {};

  // 1. Carry every user event group through unchanged as the starting
  //    point — we will graft Specflow entries onto these.
  for (const [event, groups] of Object.entries(userHooks)) {
    mergedHooks[event] = groups.map((g) => ({
      ...(g.matcher !== undefined ? { matcher: g.matcher } : {}),
      hooks: [...(g.hooks ?? [])],
    }));
  }

  // 2. For each bundled event/hook, find or create the matcher group
  //    and append the hook iff its `command:` path is not already in
  //    the user's existing hooks.
  for (const [event, groups] of Object.entries(bundledHooks)) {
    if (!mergedHooks[event]) mergedHooks[event] = [];
    const eventGroups = mergedHooks[event];

    for (const bundledGroup of groups) {
      let target = eventGroups.find((g) => g.matcher === bundledGroup.matcher);
      if (target === undefined) {
        target = {
          ...(bundledGroup.matcher !== undefined ? { matcher: bundledGroup.matcher } : {}),
          hooks: [],
        };
        eventGroups.push(target);
      }

      for (const bundledHook of bundledGroup.hooks ?? []) {
        const cmd = bundledHook.command;
        const alreadyPresent = cmd !== undefined &&
          target.hooks.some((h) => h.command === cmd);
        if (!alreadyPresent) target.hooks.push(bundledHook);
      }
    }
  }

  // Preserve hooks key only if non-empty.
  if (Object.keys(mergedHooks).length > 0) {
    result.hooks = mergedHooks;
  }

  return `${JSON.stringify(result, null, 2)}\n`;
}
