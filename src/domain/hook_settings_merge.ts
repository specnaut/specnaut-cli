/**
 * The hook splice shared by every JSON file Specnaut registers hooks in:
 * `.claude/settings.json` (`mergeJson: "claude-settings"`) and
 * `.codex/hooks.json` (`mergeJson: "codex-hooks"`). Both use the same shape —
 * `hooks.<event>` holds matcher groups, each a `hooks` array of commands.
 *
 * Ownership rule (plan § 11, "Consequence for the merge"): an entry whose
 * command is exactly one Specnaut registers — the shapes of `hook_command.ts`,
 * including the scripts Specnaut retired from `.claude/hooks/` — is Specnaut's,
 * and the bundled entry for that `<file>` replaces it in place. Codex commands
 * pin a hash, so they change with every script change; matching on the command
 * string, as the splice used to, would pile up one stale entry per release.
 * Every other entry is the user's and is never touched — including one that
 * merely mentions a Specnaut script, such as a wrapper that calls one.
 *
 * Pure — no IO, no Deno globals.
 */

import { SPECNAUT_HOOK_SHAPES } from "./hook_command.ts";

type Hook = {
  type?: string;
  command?: string;
  // Other hook fields (timeout, statusMessage, …) are preserved verbatim —
  // only `command` is inspected for identity.
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
};

type MatcherGroup = {
  matcher?: string;
  hooks: Hook[];
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
};

/** `hooks` as both harnesses spell it: event → matcher groups. */
export type HookMap = Record<string, MatcherGroup[]>;

/** What every `mergeJson` flavor returns: the file to write, and whether it differs from disk. */
export type JsonMergeResult = { readonly content: string; readonly changed: boolean };

/**
 * Error thrown when the on-disk file of a JSON merge is not valid JSON.
 * Surfaces a clear actionable hint at the CLI level rather than a raw
 * `SyntaxError` from `JSON.parse`.
 */
export class JsonMergeParseError extends Error {
  constructor(public readonly destPath: string, override readonly cause: Error) {
    super(
      `${destPath} is not valid JSON: ${cause.message}\n` +
        `Fix the file (or back it up and re-run with --force) before re-running specnaut.`,
    );
    this.name = "JsonMergeParseError";
  }
}

/** The Specnaut hook script `command` runs, by basename, or `null` when it runs none. */
export function specnautHookFile(command: string | undefined): string | null {
  if (command === undefined) return null;
  for (const shape of SPECNAUT_HOOK_SHAPES) {
    const m = shape.exec(command);
    if (m !== null) return m[1];
  }
  return null;
}

/** Whether a hook entry's command is Specnaut's to rewrite — see the module doc. */
export function isSpecnautHook(command: string | undefined): boolean {
  return specnautHookFile(command) !== null;
}

/**
 * Parse the user's side of a merge. `null` means greenfield (absent or blank
 * file), where the bundled content is written verbatim.
 */
// deno-lint-ignore no-explicit-any
export function parseUserJson(existing: string | null, destPath: string): any | null {
  if (existing === null || existing.trim().length === 0) return null;
  try {
    return JSON.parse(existing);
  } catch (err) {
    throw new JsonMergeParseError(destPath, err instanceof Error ? err : new Error(String(err)));
  }
}

/** Serialise a merge (2-space indent, trailing newline) and compare it with what is on disk. */
export function jsonMergeResult(value: unknown, existing: string | null): JsonMergeResult {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  return { content, changed: content !== existing };
}

/**
 * Splice the bundled hook entries into the user's.
 *
 *   - A bundled `.specnaut/hooks/` entry replaces, in place, the first entry for
 *     the same script in the group with its matcher; absent one, it is appended
 *     to that group (created when missing).
 *   - Any other entry for a script the bundle registers — a duplicate, a copy
 *     left in a group whose matcher changed — is removed, so each Specnaut
 *     registration appears once. A group emptied that way goes with it.
 *   - A bundled entry that runs no `.specnaut/hooks/` script keeps the
 *     original rule: appended unless the same command is already there.
 */
export function spliceHooks(user: HookMap, bundled: HookMap): HookMap {
  const merged: HookMap = {};
  for (const [event, groups] of Object.entries(user)) {
    merged[event] = groups.map((g) => ({ ...g, hooks: [...(g.hooks ?? [])] }));
  }
  const placed = new Set<Hook>();
  for (const [event, groups] of Object.entries(bundled)) {
    const eventGroups = merged[event] ??= [];
    for (const bundledGroup of groups) {
      const target = groupFor(eventGroups, bundledGroup.matcher);
      for (const hook of bundledGroup.hooks ?? []) place(target, hook, placed);
    }
  }
  return dropSuperseded(merged, placed);
}

function groupFor(groups: MatcherGroup[], matcher: string | undefined): MatcherGroup {
  const found = groups.find((g) => g.matcher === matcher);
  if (found !== undefined) return found;
  const created: MatcherGroup = { ...(matcher !== undefined ? { matcher } : {}), hooks: [] };
  groups.push(created);
  return created;
}

function place(target: MatcherGroup, hook: Hook, placed: Set<Hook>): void {
  const file = specnautHookFile(hook.command);
  if (file === null) {
    const present = hook.command !== undefined &&
      target.hooks.some((h) => h.command === hook.command);
    if (!present) target.hooks.push(hook);
    return;
  }
  const at = target.hooks.findIndex((h) => !placed.has(h) && specnautHookFile(h.command) === file);
  if (at >= 0) target.hooks[at] = hook;
  else target.hooks.push(hook);
  placed.add(hook);
}

/** Remove every entry for a bundled script other than the one the bundle placed. */
function dropSuperseded(merged: HookMap, placed: ReadonlySet<Hook>): HookMap {
  const files = new Set([...placed].map((h) => specnautHookFile(h.command)));
  const superseded = (h: Hook) => !placed.has(h) && files.has(specnautHookFile(h.command));
  const out: HookMap = {};
  for (const [event, groups] of Object.entries(merged)) {
    const kept = groups.flatMap((g) => {
      const hooks = g.hooks.filter((h) => !superseded(h));
      return hooks.length === 0 && g.hooks.length > 0 ? [] : [{ ...g, hooks }];
    });
    if (kept.length > 0 || groups.length === 0) out[event] = kept;
  }
  return out;
}

/**
 * The `codex-hooks` flavor: `.codex/hooks.json` holds Codex's hook
 * registrations and nothing else Specnaut ships, so the merge is the splice
 * alone. Every other key the user set is passed through verbatim.
 */
export function mergeCodexHooks(
  existing: string | null,
  bundled: string,
  destPath: string,
): JsonMergeResult {
  const ours = JSON.parse(bundled) as { hooks?: HookMap };
  const user = parseUserJson(existing, destPath);
  if (user === null) return jsonMergeResult(ours, existing);
  const hooks = spliceHooks(user.hooks ?? {}, ours.hooks ?? {});
  return jsonMergeResult(Object.keys(hooks).length > 0 ? { ...user, hooks } : user, existing);
}
