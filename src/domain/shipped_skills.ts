import { sameBytes } from "./bytes.ts";
import { sha256HexBytes } from "./sha256.ts";
import type { BaseEntry, Untrusted } from "./script_trust.ts";

/**
 * A skill Specnaut ships, judged against the copy it ships rather than only the base's (part of the
 * instruction class, `instruction_trust.ts`). The base is not a second witness for these files: a
 * base that already carries an edited copy would vouch for it, and the merge would land it unasked.
 * So a skill file at HEAD is named when its bytes are neither the copy this binary bundles, mapped
 * through the lock at the base's tip, nor the copy that lock records as installed (by its SHA-256):
 * the project's templates may lag the binary until `specnaut upgrade`, and that lag is no edit.
 *
 * Its cost: a project that customised a shipped skill is asked about it at every merge. That is the
 * point: the customisation is an instruction no base vouches for.
 */

/** The skill folders Specnaut writes, for Claude Code and for Codex. */
export const SKILL_ROOTS = [".claude/skills/", ".agents/skills/"] as const;

/** The reason a shipped skill holding neither copy gets. */
export const SHIPPED_REASON = "differs from the copy Specnaut ships";

/** What Specnaut ships at one skill path: the bundled bytes, the digest the lock records. */
export type ShippedCopy = { readonly bytes?: Uint8Array; readonly sha256?: string };

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

async function holdsCopy(e: BaseEntry, copy: ShippedCopy): Promise<boolean> {
  if (e.kind !== "blob") return false;
  if (sameBytes(e.bytes, copy.bytes)) return true;
  return copy.sha256 !== undefined && await sha256HexBytes(e.bytes) === copy.sha256;
}
