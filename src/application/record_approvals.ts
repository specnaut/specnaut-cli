import { yesHolds } from "../domain/approval_verdict.ts";
import { INSTRUCTION_CLASS } from "../domain/instruction_trust.ts";
import { sha256HexBytes } from "../domain/sha256.ts";
import { isShippedCopy, SHIPPED_REASON, type ShippedCopy } from "../domain/shipped_skills.ts";
import {
  type Approvals,
  type HeadCopy,
  isApprovalKey,
  nextApprovals,
  renderApprovals,
} from "../domain/skill_approvals.ts";
import { baseApprovals } from "./base_approvals.ts";
import { instructionsNow, type Judged, type JudgeDeps, judgeInputs } from "./judge_inputs.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";
import type { InstructionBase } from "./verify_instructions.ts";

/**
 * `specnaut record-approvals`: after a user's yes to an instructions digest, the approvals file
 * (`skill_approvals.ts`) that yes leaves. HEAD is judged again at the commits given, and nothing is
 * recorded unless the yes still binds that verdict. Only a skill named for holding neither shipped
 * copy is recorded, from HEAD's bytes in git objects: a skill the branch itself changed was shown
 * only as its diff from the base, so a yes to it never approved the rest of its customisation.
 */

/** One path the yes covered: recorded with its digest, or refused and why. */
export type Recorded = { readonly path: string; readonly sha256: string };
export type Refused = { readonly path: string; readonly why: string };

export type RecordOutcome =
  | { readonly kind: "moved"; readonly digest: string }
  | {
    readonly kind: "recorded";
    readonly approved: readonly Recorded[];
    readonly refused: readonly Refused[];
    /** The whole file as the write leaves it, or `null` when HEAD's copy already says it. */
    readonly text: string | null;
    /** Why HEAD's copy could not be read, when it could not: the write replaces it whole. */
    readonly unread: string | null;
  };

export async function recordApprovals(
  deps: JudgeDeps,
  base: InstructionBase,
  yes: string,
): Promise<RecordOutcome> {
  const judged = await judgeInputs(deps, base);
  const now = instructionsNow(judged);
  if (!yesHolds(yes, now)) return { kind: "moved", digest: now.digest };
  const { approved, refused } = await fresh(deps.git, base.head, namedShipped(judged));
  const previous = await baseApprovals(deps.git, base.head);
  const copies = judged.shipped?.copies ?? new Map();
  const head = await headCopies(deps.git, base.head, previous.approvals, copies);
  const next = nextApprovals(
    previous.approvals,
    head,
    new Map(approved.map((a) => [a.path, a.sha256])),
  );
  const text = renderApprovals(next);
  const same = previous.refused === null && text === renderApprovals(previous.approvals);
  return {
    kind: "recorded",
    approved,
    refused,
    text: same ? null : text,
    unread: previous.refused,
  };
}

/** The paths the instruction verdict names for holding neither shipped copy, and only those. */
function namedShipped(judged: Judged): string[] {
  return judged.verdicts.flatMap((v) =>
    v.class === INSTRUCTION_CLASS && !v.trusted && v.reason === SHIPPED_REASON ? [v.path] : []
  );
}

/**
 * Each of `paths` as HEAD commits it, hashed. Refused: a path no approval may name, one that is not
 * a regular file at HEAD, and one HEAD also holds in another letter case, which a case-blind disk
 * would give the session instead.
 */
async function fresh(git: GitObjectReader, head: string, paths: readonly string[]) {
  const folded = new Set(paths.map((p) => p.toLowerCase()));
  const listed = await git.listCommit(head, (p) => folded.has(p.toLowerCase()));
  const approved: Recorded[] = [];
  const refused: Refused[] = [];
  for (const path of paths) {
    const same = listed.filter((e) => e.path.toLowerCase() === path.toLowerCase());
    const e = same.length === 1 && same[0].path === path ? same[0] : undefined;
    if (!isApprovalKey(path)) refused.push({ path, why: "is not a path an approval may name" });
    else if (same.length > 1) refused.push({ path, why: "is at HEAD in another letter case too" });
    else if (e?.kind !== "blob") refused.push({ path, why: "is not a regular file at HEAD" });
    else approved.push({ path, sha256: await sha256HexBytes(e.bytes) });
  }
  return { approved, refused };
}

/** What HEAD holds at each previously approved path, read from git objects. */
async function headCopies(
  git: GitObjectReader,
  head: string,
  previous: Approvals,
  copies: ReadonlyMap<string, ShippedCopy>,
): Promise<Map<string, HeadCopy>> {
  const out = new Map<string, HeadCopy>();
  for (const path of previous.keys()) {
    const file = await git.readFile(head, path);
    const copy = copies.get(path);
    if (file.kind !== "blob") continue;
    const customised = copy !== undefined && !await isShippedCopy(file.bytes, copy);
    out.set(path, { sha256: await sha256HexBytes(file.bytes), customised });
  }
  return out;
}
