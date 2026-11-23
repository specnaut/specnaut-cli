import type { CoreBundle } from "../domain/core_bundle.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import {
  BASE_LOCK,
  type BaseEntry,
  type BundleRule,
  type Untrusted,
} from "../domain/script_trust.ts";
import { sha256Hex } from "../domain/sha256.ts";
import {
  isSkillPath,
  leavingCopies,
  lockSkillReasons,
  type ShippedCopy,
  shippedLookup,
} from "../domain/shipped_skills.ts";
import { lockShaInput } from "../domain/template.ts";
import { committedApprovals } from "./committed_approvals.ts";
import { baseLock } from "./base_lock.ts";
import { bundleForLock } from "./lock_bundle.ts";
import type { Harness } from "./ports.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";

/**
 * The skill files Specnaut ships to this project, as `shipped_skills.ts` judges them: each path the
 * lock at the base's tip records, with the digest it records, each regular file this binary
 * bundles for that lock, with its bytes, and the digest the approvals at that tip record for it
 * (`committed_approvals.ts`), honoured only on a path Specnaut ships in some letter case: one named
 * in another case is added as a copy of its own, so a renamed skill a yes covered holds under the
 * name the yes gave (`shippedLookup`). No lock there, or one this binary cannot map, ships nothing
 * here: the script check already names a lock it cannot use. Each path the lock at the merge base
 * ships and HEAD's does not is judged too (`leavingCopies`), so a HEAD lock this binary cannot read
 * leaves every path the merge base's ships.
 */

export type ShippedDeps = {
  readonly git: GitObjectReader;
  readonly core: CoreBundle;
  readonly findHarness: (key: string) => Harness | null;
};

/** The commits the rule reads: the base's tip, the merge base, and HEAD, what lands. */
export type ShippedBase = {
  readonly tip: string;
  readonly mergeBase: string;
  readonly head: string;
};

/** What the shipped-skill rule reads, beside HEAD's skill files. */
export type ShippedInput = {
  /** Each shipped skill path's copies, and each path that leaves the set, unapproved. */
  readonly copies: ReadonlyMap<string, ShippedCopy>;
  /** The lock HEAD commits, named when a skill digest it records is not a shipped copy. */
  readonly reasons: readonly Untrusted[];
  /** The lock as HEAD commits it: what a yes to those reasons covers, with the instruction files. */
  readonly covers: readonly BaseEntry[];
  /** Why the approvals at the tip were not read, or `null`. */
  readonly approvalsRefused: string | null;
};

/**
 * The approvals are read at the base's tip, never at HEAD: a branch's own approval would vouch for
 * the very skill it customises.
 */
export async function shippedInput(deps: ShippedDeps, base: ShippedBase): Promise<ShippedInput> {
  const { approvals, refused } = await committedApprovals(deps.git, base.tip);
  const copies = shippedSkills(deps, await baseLock(deps.git, base.tip));
  const copyAt = shippedLookup(copies);
  for (const [path, approvedSha256] of approvals) {
    const copy = copyAt(path);
    if (copy !== undefined) copies.set(path, { ...copy, approvedSha256 });
  }
  const head = await baseLock(deps.git, base.head);
  const mergeBase = await baseLock(deps.git, base.mergeBase);
  const shipped = new Set(shippedSkills(deps, head).keys());
  const judged = leavingCopies(copies, shippedSkills(deps, mergeBase), shipped);
  const file = await deps.git.readFile(base.head, BASE_LOCK);
  const covers: BaseEntry[] = file.kind === "blob"
    ? [{ kind: "blob", path: BASE_LOCK, bytes: file.bytes }]
    : [];
  const reasons = await lockReasons(deps, head, mergeBase);
  return { copies: judged, reasons, covers, approvalsRefused: refused };
}

/** Each skill path `lock` ships, with its copies: none for a lock this binary cannot read. */
function shippedSkills(
  deps: ShippedDeps,
  lock: InstalledLock | BundleRule,
): Map<string, ShippedCopy> {
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

/**
 * The lock HEAD commits against the merge base's (`lockSkillReasons`). A lock HEAD holds that this
 * binary cannot read names nothing here: at the next merge it is the base's, and the script check
 * names a lock at the base it cannot use.
 */
async function lockReasons(
  deps: ShippedDeps,
  head: InstalledLock | BundleRule,
  old: InstalledLock | BundleRule,
): Promise<Untrusted[]> {
  if (!("entries" in head)) return [];
  const bundled = await bundledDigests(deps, head);
  return lockSkillReasons(head.entries, "entries" in old ? old.entries : undefined, bundled);
}

/** The digest an install of this binary records for each skill it bundles for `lock`. */
async function bundledDigests(
  deps: ShippedDeps,
  lock: InstalledLock,
): Promise<Map<string, string>> {
  const bundle = bundleForLock(deps.core, lock, deps.findHarness) ?? {};
  const out = new Map<string, string>();
  for (const [path, file] of Object.entries(bundle)) {
    if (isSkillPath(path)) out.set(path, await sha256Hex(lockShaInput(file)));
  }
  return out;
}
