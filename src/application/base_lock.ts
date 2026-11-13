import { type InstalledLock, parseLock } from "../domain/installed_lock.ts";
import { BASE_LOCK, type BundleRule } from "../domain/script_trust.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";

/**
 * The lock read at the base's tip: the one home of that read, for the script check's bundle rule and
 * the instruction class's shipped skills. The lock in the work tree is the branch's own.
 */

/** The lock at the base's tip, parsed, or the rule that applies without one. */
export async function baseLock(
  git: GitObjectReader,
  baseTip: string,
): Promise<InstalledLock | BundleRule> {
  const file = await git.readFile(baseTip, BASE_LOCK);
  if (file.kind === "absent") return { kind: "no_lock_at_base" };
  if (file.kind === "not_regular") return unavailable("is not a regular file");
  try {
    return parseLock(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  } catch (err) {
    // Reported as the verdict's reason: the caller prints it on the lock's UNTRUSTED line.
    return unavailable(err instanceof Error ? err.message : String(err));
  }
}

export const unavailable = (why: string): BundleRule => ({ kind: "unavailable", why });
