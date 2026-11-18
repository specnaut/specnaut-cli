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

import { RETIRED_HOOK_SCRIPTS, SPECNAUT_HOOK_SHAPES } from "./hook_command.ts";
import { type JsonMergeResult, jsonMergeResult, parseUserJson } from "./json_merge.ts";
import { terminalText } from "./terminal_text.ts";

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

/** The Specnaut hook script `command` runs, by basename, or `null` when it runs none. */
export function specnautHookFile(command: string | undefined): string | null {
  if (command === undefined) return null;
  for (const shape of SPECNAUT_HOOK_SHAPES) {
    const m = shape.exec(command);
    if (m !== null) return m[1];
  }
  return null;
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
 *   - An entry for a script Specnaut retired (`RETIRED_HOOK_SCRIPTS`) is removed,
 *     and a group emptied that way goes with it.
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

/** Remove every entry for a bundled script other than the one the bundle placed, and every retired one. */
function dropSuperseded(merged: HookMap, placed: ReadonlySet<Hook>): HookMap {
  const files = new Set([...placed].map((h) => specnautHookFile(h.command)));
  const superseded = (h: Hook) => {
    const file = specnautHookFile(h.command);
    return !placed.has(h) && (files.has(file) || (file !== null && RETIRED_HOOK_SCRIPTS.has(file)));
  };
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

/** The launcher every bash hook of the Claude registration starts through. */
const LAUNCHER = "run-hook.sh";

/**
 * What the splice owes the person running the upgrade about the user's entries it kept: one that
 * runs a script the bundle starts through the launcher, but not through it — a customised copy of
 * an older registration, say. The splice never touches the user's entry, so the launched one is
 * placed beside it while the kept one still looks bash up on the PATH the session inherits, where
 * an entry inside the repository can supply it. Said, never fixed: the entry is the user's.
 */
export function keptHookNotes(user: HookMap, bundled: HookMap, dest: string): string[] {
  const launched = commandsOf(bundled).filter((c) => c.includes(LAUNCHER)).map(specnautHookFile);
  const scripts = [...new Set(launched)].filter((f): f is string => f !== null);
  return commandsOf(user).flatMap((command) => {
    if (specnautHookFile(command) !== null || command.includes(LAUNCHER)) return [];
    const script = scripts.find((s) => names(command, s));
    if (script === undefined) return [];
    return [
      `${dest}: kept your hook entry ${terminalText(command)} — it runs ${script}.sh, but not ` +
      `through ${LAUNCHER}: it starts bash from the PATH the session inherits, where an entry ` +
      `inside the repository can supply it. Specnaut's own entry runs beside it; remove yours, ` +
      `or launch it as Specnaut's is`,
    ];
  });
}

/**
 * Whether `command` names `<script>.sh` as a whole file name: at the start, or after a slash, a
 * backslash (a Windows path), a quote or a blank.
 */
const names = (command: string, script: string) =>
  new RegExp(`(?:^|[\\\\/"'\\s])${script}\\.sh(?![\\w.-])`).test(command);

/** Every string command of every group of `hooks`. */
function commandsOf(hooks: HookMap): string[] {
  return Object.values(hooks).flat().flatMap((g) => g.hooks ?? [])
    .flatMap((h) => typeof h.command === "string" ? [h.command] : []);
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
