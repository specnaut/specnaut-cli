import type { CheckoutState } from "../domain/review_gate.ts";
import type { LockedReview } from "../domain/review_lock.ts";

/**
 * The pass `specnaut review gate` leaves when the session's checkout holds, and the one thing
 * `specnaut review start` needs before it fetches anything. It lives in the worktree's own git
 * directory, beside the session records, where no file of a branch can land.
 */

/**
 * A pass as the gate left it: `granted` is `NaN`, `baseTip`, `session` and `nonce` empty and
 * `checkout` `null` where the file did not say. `session` is the id on the hook's input the gate
 * judged; `nonce` is the one the gate put on the line it let through.
 */
export type GrantedPass = {
  readonly granted: number;
  readonly baseTip: string;
  readonly checkout: CheckoutState | null;
  readonly session: string;
  readonly nonce: string;
};

export interface ReviewPass {
  /**
   * Leaves a pass for `checkout`, judged against `baseTip` for the session `session`, taken only
   * by the line that carries `nonce`, replacing any earlier one.
   */
  grant(baseTip: string, checkout: CheckoutState, session: string, nonce: string): Promise<void>;
  /** Removes the pass, if there is one. */
  revoke(): Promise<void>;
  /**
   * Takes the pass: when it was granted, for which base tip and checkout, removed so it starts
   * one review; `null` when none.
   */
  take(): Promise<GrantedPass | null>;
}

/**
 * The review lock of one checkout (`review_lock.ts` in the domain): a session `specnaut review
 * start` locked stays locked until it ends. It lives beside the pass, in the worktree's own git
 * directory, so no file of a branch can plant or remove one, and no command removes one: the
 * lock is the session's for as long as the branch's text is in its context.
 */
export interface ReviewLock {
  /** Locks the session `sessionId`; a lock already there stays as it is. */
  lock(sessionId: string): Promise<void>;
  /** Records in the session's entry the head its review exported and the folder for its logs. */
  record(sessionId: string, review: RecordedReview): Promise<void>;
  /**
   * What the lock of the session `sessionId` records (`UNKNOWN_REVIEW` where it names nothing), or
   * `null` when it is not locked; for `null`, `UNKNOWN_REVIEW` when any session is.
   */
  held(sessionId: string | null): Promise<LockedReview | null>;
  /** What every lock of this checkout records, whichever session holds it. */
  all(): Promise<readonly LockedReview[]>;
}

/** What `review start` records in a session's lock once the branch is exported. */
export type RecordedReview = {
  readonly head: string;
  readonly logs: string;
  /** The base branch's tip the start was judged against: the one `--base` a script may name. */
  readonly base?: string;
};
