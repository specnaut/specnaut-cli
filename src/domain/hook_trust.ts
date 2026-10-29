/**
 * Whether the hook-trust note is due (plan § 5, "Whether the Codex trust note
 * is due").
 *
 * A harness that hashes its hook registrations runs none of them until the user
 * trusts them, and stops again after any change to what it hashed. Specnaut's
 * commands pin `.specnaut/hooks/SHA256SUMS`, so a change to the registry file
 * or to any file in the hooks folder voids the trust. The harness declares those
 * paths (`Harness.hookTrust`); this module decides from the paths a run changed,
 * so no handler checks a harness name.
 *
 * Pure — no IO, no Deno globals.
 */

import { type HookMap, parseUserJson, specnautHookFile } from "./hook_settings_merge.ts";

/** What a harness that hashes its hook registrations declares. */
export type HookTrust = {
  /** Dests whose change voids the trust: a file, or a folder written with a trailing `/`. */
  readonly paths: readonly string[];
  /** The registration file whose entries the note lists. */
  readonly registry: string;
  /** What the user has to do, and what does not run until they do it. */
  readonly note: string;
};

/**
 * Whether `dest` is under one of the trusted paths. A file path matches only
 * itself — `.codex/hooks.json.specnaut.bak` is a backup, not the registry.
 */
export function hookTrustCovers(trust: HookTrust, dest: string): boolean {
  return trust.paths.some((p) => dest === p || (p.endsWith("/") && dest.startsWith(p)));
}

/**
 * Whether a run that changed `changedDests` (the files it wrote, plus the JSON
 * merges whose content changed) must print the trust note. `undefined` trust —
 * a harness that does not hash its hooks — is never due.
 */
export function hookTrustDue(
  trust: HookTrust | undefined,
  changedDests: Iterable<string>,
): boolean {
  if (trust === undefined) return false;
  for (const dest of changedDests) if (hookTrustCovers(trust, dest)) return true;
  return false;
}

/** The entries of a registry file, split by owner. */
export type RegisteredHooks = {
  /** Specnaut's scripts, by file name, sorted and unique. */
  readonly specnaut: readonly string[];
  /** Every other command, in file order: the user is about to trust them too. */
  readonly foreign: readonly string[];
};

/**
 * Split the registry's commands into Specnaut's and everyone else's, by the
 * ownership rule of `hook_settings_merge.ts`. Trusting is all or nothing, so a
 * command Specnaut did not install is named before the user trusts it.
 *
 * `null` (no file) registers nothing; a file that does not parse throws
 * `JsonMergeParseError` naming `registryPath`.
 */
export function registeredHooks(registry: string | null, registryPath: string): RegisteredHooks {
  const parsed = parseUserJson(registry, registryPath);
  const hooks: HookMap = isRecord(parsed?.hooks) ? parsed.hooks : {};
  const specnaut = new Set<string>();
  const foreign: string[] = [];
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = typeof hook?.command === "string" ? hook.command : undefined;
        const file = specnautHookFile(command);
        if (file !== null) specnaut.add(`${file}.sh`);
        else if (command !== undefined) foreign.push(command);
      }
    }
  }
  return { specnaut: [...specnaut].sort(), foreign };
}

// deno-lint-ignore no-explicit-any
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
