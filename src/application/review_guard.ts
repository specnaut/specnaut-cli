import {
  lockedCallRefusal,
  lockedExecRefusal,
  lockedLogOf,
  type LockedReview,
} from "../domain/review_lock.ts";
import { isSessionId } from "../domain/session_record.ts";
import type { ReviewLock } from "./review_ports.ts";

/**
 * The guard a `PreToolUse` hook runs before every tool call (`review_lock.ts` in the domain says
 * what the lock is for). A session the lock does not hold is not judged. One it holds runs only
 * what the lock allows. An input that names no session, or names one that is not an id, is
 * judged as soon as any session is locked: the guard never lets a call through for want of an id.
 * A lock it cannot read refuses the call: the guard fails closed. The `--log` of a sandboxed run is
 * judged by where it resolves, never by how it is spelt.
 */

export type GuardCall = {
  /** The session id the harness gave the hook; `null` when its input names none. */
  readonly sessionId: string | null;
  /** The tool about to run; `null` when the input names none. */
  readonly tool: string | null;
  readonly input: unknown;
};

export type GuardOutcome = { readonly kind: "allowed" } | {
  readonly kind: "refused";
  readonly why: string;
};

/**
 * Where a `--log` file would be made, its folder's real path; `null` when it does not resolve.
 */
export type RealLog = (path: string) => Promise<string | null>;

/** `lock` is `null` outside a repository, where no review can have started. */
export async function guardToolCall(
  lock: ReviewLock | null,
  call: GuardCall,
  realLog: RealLog,
): Promise<GuardOutcome> {
  let review: LockedReview | null;
  try {
    const id = call.sessionId !== null && isSessionId(call.sessionId) ? call.sessionId : null;
    review = lock === null ? null : await lock.held(id);
  } catch (err) {
    // Not swallowed: the failure is the refusal's reason.
    const why = err instanceof Error ? err.message : String(err);
    return { kind: "refused", why: `the review lock could not be read: ${why}` };
  }
  if (review === null) return { kind: "allowed" };
  const named = lockedLogOf(call.tool, call.input);
  const log = named === null ? null : await realLog(named);
  const why = lockedCallRefusal(call.tool, call.input, review, log);
  return why === null ? { kind: "allowed" } : { kind: "refused", why };
}

/**
 * Why `specnaut sandbox exec` refuses to run while its checkout is locked (`lockedExecRefusal`),
 * or `null`; `lock` is `null` outside a repository. The request's `log` is already resolved: the
 * path judged here is the one the run opens.
 */
export async function execLockRefusal(
  lock: ReviewLock | null,
  request: { readonly toolchain: readonly string[]; readonly log: string | null },
): Promise<string | null> {
  const held = lock === null ? [] : await lock.all();
  return lockedExecRefusal(held, request.toolchain, request.log);
}
