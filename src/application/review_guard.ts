import { lockedCallRefusal } from "../domain/review_lock.ts";
import { isSessionId } from "../domain/session_record.ts";
import type { ReviewLock } from "./review_ports.ts";

/**
 * The guard a `PreToolUse` hook runs before every tool call (`review_lock.ts` in the domain says
 * what the lock is for). A session the lock does not hold is not judged. One it holds runs only
 * what the lock allows. An input that names no session, or names one that is not an id, is
 * judged as soon as any session is locked: the guard never lets a call through for want of an id.
 * A lock it cannot read refuses the call: the guard fails closed.
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

/** `lock` is `null` outside a repository, where no review can have started. */
export async function guardToolCall(
  lock: ReviewLock | null,
  call: GuardCall,
): Promise<GuardOutcome> {
  try {
    const id = call.sessionId !== null && isSessionId(call.sessionId) ? call.sessionId : null;
    if (lock === null || !(await lock.holds(id))) return { kind: "allowed" };
  } catch (err) {
    // Not swallowed: the failure is the refusal's reason.
    const why = err instanceof Error ? err.message : String(err);
    return { kind: "refused", why: `the review lock could not be read: ${why}` };
  }
  const why = lockedCallRefusal(call.tool, call.input);
  return why === null ? { kind: "allowed" } : { kind: "refused", why };
}
