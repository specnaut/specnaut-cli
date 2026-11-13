import type { CoreBundle } from "../domain/core_bundle.ts";
import { isSkillPath, type ShippedCopy } from "../domain/shipped_skills.ts";
import { baseLock } from "./base_lock.ts";
import { bundleForLock } from "./lock_bundle.ts";
import type { Harness } from "./ports.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";

/**
 * The skill files Specnaut ships to this project, as `shipped_skills.ts` judges them: each path the
 * lock at the base's tip records, with the digest it records, and each regular file this binary
 * bundles for that lock, with its bytes. No lock there, or one this binary cannot map, ships
 * nothing here: the script check already names a lock it cannot use.
 */

export type ShippedDeps = {
  readonly git: GitObjectReader;
  readonly core: CoreBundle;
  readonly findHarness: (key: string) => Harness | null;
};

export async function shippedSkills(
  deps: ShippedDeps,
  baseTip: string,
): Promise<Map<string, ShippedCopy>> {
  const lock = await baseLock(deps.git, baseTip);
  const shipped = new Map<string, ShippedCopy>();
  if (!("entries" in lock)) return shipped;
  for (const [path, entry] of lock.entries) {
    if (isSkillPath(path)) shipped.set(path, { sha256: entry.sha256 });
  }
  const bundle = bundleForLock(deps.core, lock, deps.findHarness) ?? {};
  const enc = new TextEncoder();
  for (const [path, file] of Object.entries(bundle)) {
    if (!isSkillPath(path) || file.symlinkTo !== undefined) continue;
    shipped.set(path, { ...shipped.get(path), bytes: enc.encode(file.content) });
  }
  return shipped;
}
