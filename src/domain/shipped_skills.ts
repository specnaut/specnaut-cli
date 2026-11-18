import { sameBytes } from "./bytes.ts";
import { sha256HexBytes } from "./sha256.ts";
import type { LockEntry } from "./installed_lock.ts";
import { BASE_LOCK, type BaseEntry, type Untrusted } from "./script_trust.ts";

/**
 * A skill Specnaut ships, judged against the copy it ships rather than only the base's (part of the
 * instruction class, `instruction_trust.ts`). The base is not a second witness for these files: a
 * base that already carries an edited copy would vouch for it, and the merge would land it unasked.
 * So a skill file at HEAD is named when its bytes are neither the copy this binary bundles, mapped
 * through the lock at the base's tip, nor the copy that lock records as installed (by its SHA-256):
 * the project's templates may lag the binary until `specnaut upgrade`, and that lag is no edit.
 *
 * Its cost: a project that customised a shipped skill is asked about it once per content. A yes at
 * the landing is recorded at the base's tip (`skill_approvals.ts`), bound to the SHA-256 of those
 * bytes, and holds them from then on; one byte changed, and the copy is asked about again. The
 * approval answers this rule only: it never quiets a reason the branch's own change gets.
 *
 * The lock is a key too, so a branch's change to it is judged here: a digest it re-stamps
 * ({@link lockSkillReasons}), and a path it stops shipping ({@link leavingCopies}). The approvals
 * file is the one way a copy Specnaut does not ship is accepted.
 */

/** The skill folders Specnaut writes, for Claude Code and for Codex. */
export const SKILL_ROOTS = [".claude/skills/", ".agents/skills/"] as const;

/** The reason a shipped skill holding neither copy gets. */
export const SHIPPED_REASON = "differs from the copy Specnaut ships";

/**
 * What Specnaut ships at one skill path: the bundled bytes, the digest the lock records, and the
 * digest of the customised copy a user approved, read at the base's tip.
 */
export type ShippedCopy = {
  readonly bytes?: Uint8Array;
  readonly sha256?: string;
  readonly approvedSha256?: string;
};

/** Whether `path` is in a folder Specnaut writes skills to. */
export const isSkillPath = (path: string): boolean => SKILL_ROOTS.some((r) => path.startsWith(r));

/**
 * Each of HEAD's skill files that Specnaut ships (`shipped`, by path) and that holds neither copy.
 * A link where Specnaut ships a file is named: it reads as some other file.
 */
export async function shippedReasons(
  head: readonly BaseEntry[],
  shipped: ReadonlyMap<string, ShippedCopy>,
): Promise<Untrusted[]> {
  const out: Untrusted[] = [];
  for (const e of head) {
    const copy = isSkillPath(e.path) ? shipped.get(e.path) : undefined;
    if (copy !== undefined && !await holdsCopy(e, copy)) {
      out.push({ path: e.path, reason: SHIPPED_REASON });
    }
  }
  return out;
}

/**
 * The copies HEAD's skills are judged against (`tip`), with each path that leaves the shipped set
 * added: one the merge base's lock ships (`mergeBase`, its copies) and HEAD's (`head`, its paths)
 * no longer does, its entry dropped or its harness switched so the bundle stops mapping it. Once
 * that lock lands, the base vouches for the skill as an ordinary file and never asks about it as a
 * shipped one again; so it is judged here, against the copy shipped (the tip's, else the merge
 * base's), and no approval holds it: this is the last merge at which it is a shipped skill.
 */
export function leavingCopies(
  tip: ReadonlyMap<string, ShippedCopy>,
  mergeBase: ReadonlyMap<string, ShippedCopy>,
  head: ReadonlySet<string>,
): Map<string, ShippedCopy> {
  const out = new Map(tip);
  for (const [path, old] of mergeBase) {
    if (head.has(path)) continue;
    const { approvedSha256: _, ...copy } = tip.get(path) ?? old;
    out.set(path, copy);
  }
  return out;
}

/** Whether `bytes` are a copy Specnaut ships: the bundled one, or the one the lock records. */
export async function isShippedCopy(bytes: Uint8Array, copy: ShippedCopy): Promise<boolean> {
  if (sameBytes(bytes, copy.bytes)) return true;
  return copy.sha256 !== undefined && await sha256HexBytes(bytes) === copy.sha256;
}

async function holdsCopy(e: BaseEntry, copy: ShippedCopy): Promise<boolean> {
  if (e.kind !== "blob") return false;
  if (await isShippedCopy(e.bytes, copy)) return true;
  return copy.approvedSha256 !== undefined && await sha256HexBytes(e.bytes) === copy.approvedSha256;
}

/** The reason the lock gets when HEAD's records a skill digest no shipped copy has. */
export const LOCK_SKILL_REASON = "records a skill digest that is not the copy Specnaut ships";

/**
 * The lock as HEAD commits it (`head`, its entries) against the merge base's (`mergeBase`): a skill
 * entry whose digest the branch changed, to one that is not this binary's bundled copy (`bundled`,
 * by path), names the lock. An upgrade branch writes the bundle's digests, so it stays silent; a
 * digest re-stamped to a customised copy would vouch for it at every later merge, unasked.
 */
export function lockSkillReasons(
  head: ReadonlyMap<string, LockEntry>,
  mergeBase: ReadonlyMap<string, LockEntry> | undefined,
  bundled: ReadonlyMap<string, string>,
): Untrusted[] {
  const changed = [...head].some(([path, e]) =>
    isSkillPath(path) && mergeBase?.get(path)?.sha256 !== e.sha256 &&
    bundled.get(path) !== e.sha256
  );
  return changed ? [{ path: BASE_LOCK, reason: LOCK_SKILL_REASON }] : [];
}
