import { type CheckoutState, isPassNonce, passHolds, sameCheckout } from "../domain/review_gate.ts";
import { isSessionId } from "../domain/session_record.ts";
import type { RecordedReview, ReviewPass } from "./review_ports.ts";
import type { BranchExport } from "./untrusted_review.ts";
import { UnexpectedHead } from "./untrusted_review_ports.ts";

/**
 * Starts a review that cannot trust its branch: takes the pass the checkout gate left, then
 * exports the branch as inert files (`untrusted_review.ts`) and keeps the export for the
 * review's later commands. No pass, one the gate gave another line (its nonce is not the one this
 * command carries), one past its time, one granted for a base tip that is no
 * longer the base's, or for a checkout that no longer reads the same, starts nothing and fetches
 * nothing: the verdict was taken on that checkout, against that tip. The session the gate judged
 * is locked before the branch is fetched (`review_lock.ts` in the domain), so nothing of the branch
 * reaches a session the lock does not hold; once it is exported, the lock records its head, its
 * logs folder, the base tip the pass was judged against and the toolchain folders that tip's
 * `gates.yml` declares: the one head, folder and base, and the only toolchain, the session's
 * sandboxed runs may then name. An export the lock could not record is not kept.
 */

export type StartDeps = {
  readonly pass: ReviewPass;
  /** The nonce this command carries (`REVIEW_PASS_VAR`), or `null` when it carries none. */
  readonly nonce: string | null;
  readonly now: () => number;
  /** The base branch's tip now, as the checkout check resolves it; `null` when it cannot. */
  readonly baseTip: () => Promise<string | null>;
  /** The checkout now, read as the gate read it. */
  readonly checkout: () => Promise<CheckoutState>;
  /** Locks the session `sessionId` until it ends. */
  readonly lock: (sessionId: string) => Promise<void>;
  /** Records in the session's lock the head exported and the folder for its logs. */
  readonly record: (sessionId: string, review: RecordedReview) => Promise<void>;
  /** Exports `source`; a fetched head other than `expectedSha`, when given, is refused. */
  readonly exportBranch: (source: string, expectedSha?: string) => Promise<BranchExport>;
  /** The toolchain folders `gates.yml` at the commit `base` declares (`gates_toolchain.ts`). */
  readonly toolchain: (base: string) => Promise<readonly string[]>;
};

export type StartOutcome =
  | { readonly kind: "started"; readonly exported: BranchExport }
  | { readonly kind: "refused"; readonly why: string };

/** No pass: the gate hook did not run for this command, or did not let it through. */
export const NO_PASS = "no checkout verdict: `specnaut review gate` runs as a Claude Code " +
  "PreToolUse hook and lets this command through only when the session's checkout holds; run " +
  "`specnaut upgrade` to install the hook, or start a new session as its refusal says";

export const NOT_THIS_COMMAND = "the checkout verdict was given to another command line: run " +
  "`specnaut review start` alone, as its own command, so the review-gate hook passes that line";

export const STALE_PASS = "the checkout verdict is out of date: run this command again";

export const MOVED_PASS =
  "the base branch moved since the checkout verdict: run this command again";

export const CHANGED_PASS = "the checkout changed since its verdict: run this command again";

export const NO_SESSION = "the checkout verdict names no session to lock: run this command again";

/**
 * Said after a head other than the expected one: the session was locked before the fetch, and no
 * lock is ever lifted, so the review of the new head is a new session's.
 */
export const LOCKED_AFTER_MISMATCH = "this session stays under the review lock: start a new " +
  "session to review the branch at the head the remote reports now";

export async function startReview(
  deps: StartDeps,
  source: string,
  expectedSha?: string,
): Promise<StartOutcome> {
  const granted = await deps.pass.take();
  if (granted === null) return { kind: "refused", why: NO_PASS };
  if (!isPassNonce(deps.nonce) || granted.nonce !== deps.nonce) {
    return { kind: "refused", why: NOT_THIS_COMMAND };
  }
  if (!passHolds(granted.granted, deps.now())) return { kind: "refused", why: STALE_PASS };
  if (granted.baseTip !== await deps.baseTip()) return { kind: "refused", why: MOVED_PASS };
  const judged = granted.checkout;
  if (judged === null || !sameCheckout(judged, await deps.checkout())) {
    return { kind: "refused", why: CHANGED_PASS };
  }
  if (!isSessionId(granted.session)) return { kind: "refused", why: NO_SESSION };
  await deps.lock(granted.session);
  const exported = await exportOrRefusal(deps, source, expectedSha);
  if (typeof exported === "string") return { kind: "refused", why: exported };
  const toolchain = await deps.toolchain(granted.baseTip);
  await deps.record(granted.session, { ...recorded(exported), base: granted.baseTip, toolchain });
  exported.keep();
  return { kind: "started", exported };
}

/** The export, or why it is refused once the session is locked: a head other than expected. */
async function exportOrRefusal(
  deps: StartDeps,
  source: string,
  expectedSha: string | undefined,
): Promise<BranchExport | string> {
  try {
    return await deps.exportBranch(source, expectedSha);
  } catch (err) {
    if (!(err instanceof UnexpectedHead)) throw err;
    return `${err.message}; ${LOCKED_AFTER_MISMATCH}`;
  }
}

const recorded = (exported: BranchExport) => ({ head: exported.sha, logs: exported.logs });
