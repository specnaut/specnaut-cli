import { SCRIPTS_DIR, type Untrusted } from "./script_trust.ts";
import { APPROVALS_FILE } from "./skill_approvals.ts";
import { REASON } from "./trust_reason.ts";

/**
 * Whether a user's yes still binds the tree judged now. A merge that stopped on an untrusted
 * verdict goes on under the yes the user gave to one digest; this is where that digest is compared
 * with the one computed from the tree as it now stands. It lives in the binary because a script of
 * the tree cannot judge an approval that covers changes to the scripts themselves.
 *
 * A held approval means binding, not consent: the tree is the one the digest named. Whether the
 * user said yes is the phase's to know.
 */

export const APPROVAL_CLASSES = ["scripts", "instructions"] as const;
export type ApprovalClass = typeof APPROVAL_CLASSES[number];

/** The digest the user said yes to, per class; a class absent was not approved. */
export type ApprovedDigests = { readonly [C in ApprovalClass]?: string };

/** One class as the verifier judged it now. */
export type ClassNow = {
  readonly trusted: boolean;
  readonly digest: string;
  /** False when the verdict holds a reason no yes covers, whatever the digest. */
  readonly approvable: boolean;
};

/** One approved class: whether its yes holds, and the digest judged now. */
export type ApprovalLine = {
  readonly class: ApprovalClass;
  readonly holds: boolean;
  readonly digest: string;
};

/** The approved classes' lines, and whether every class is trusted or held by its yes. */
export type ApprovalVerdict = { readonly lines: readonly ApprovalLine[]; readonly holds: boolean };

export function approvalVerdict(
  approved: ApprovedDigests,
  now: Readonly<Record<ApprovalClass, ClassNow>>,
): ApprovalVerdict {
  const lines = APPROVAL_CLASSES.flatMap((c): ApprovalLine[] => {
    const yes = approved[c];
    if (yes === undefined) return [];
    return [{ class: c, holds: yesHolds(yes, now[c]), digest: now[c].digest }];
  });
  const held = (c: ApprovalClass) => lines.some((l) => l.class === c && l.holds);
  return { lines, holds: APPROVAL_CLASSES.every((c) => now[c].trusted || held(c)) };
}

/** Whether the yes given to digest `yes` binds the class as judged now. */
export const yesHolds = (yes: string, now: ClassNow): boolean =>
  now.approvable && yes === now.digest;

/**
 * The reasons a yes can bind: each names bytes `SCRIPTS_DIGEST` covers, or a file's absence, which
 * it covers too. A link (the digest holds its path, never its target nor what it leads to), a
 * non-file, an unreadable entry, a hard link (its bytes can change under another name), a
 * submodule or a walk that stopped are not: no digest names what would run, so no yes holds it.
 */
const APPROVABLE: ReadonlySet<string> = new Set([
  REASON.differs,
  REASON.notOnBase,
  REASON.firstInstall,
  REASON.missing,
  REASON.caseDiffers,
  REASON.lineEndings,
  REASON.behind,
  REASON.baseNotRegular,
]);

/**
 * Whether a yes can cover the scripts' verdict: only a reason inside the scripts folder whose bytes
 * the digest names. A reason outside it (the local base ahead of origin, the lock at the base) is
 * one no yes makes hold, so the merge stops on it whatever the digest says.
 */
export function scriptsApprovable(untrusted: readonly Untrusted[]): boolean {
  return untrusted.every((u) => u.path.startsWith(`${SCRIPTS_DIR}/`) && APPROVABLE.has(u.reason));
}

/**
 * Whether a yes can cover the instructions' verdict: any but a branch's change to the approvals
 * file (`skill_approvals.ts`). Only the landing writes it, after a yes; a branch that wrote its own
 * would vouch for itself at the next merge. HEAD that commits no such file (`atHead`, read from git
 * objects, never from the walk's reason) lands none: a deletion revokes every approval, and a file
 * only the base added is a rebase, so a yes holds either. Its name in another letter case holds
 * nothing.
 */
export function instructionsApprovable(untrusted: readonly Untrusted[], atHead: boolean): boolean {
  return untrusted.every((u) =>
    u.path.toLowerCase() !== APPROVALS_FILE || (u.path === APPROVALS_FILE && !atHead)
  );
}
