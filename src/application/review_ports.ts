/**
 * The pass `specnaut review gate` leaves when the session's checkout holds, and the one thing
 * `specnaut review start` needs before it fetches anything. It lives in the worktree's own git
 * directory, beside the session records, where no file of a branch can land.
 */
export interface ReviewPass {
  /** Leaves a pass for the checkout measured against `baseTip`, replacing any earlier one. */
  grant(baseTip: string): Promise<void>;
  /** Removes the pass, if there is one. */
  revoke(): Promise<void>;
  /** Takes the pass: when it was granted, removed so it starts one review; `null` when none. */
  take(): Promise<number | null>;
}
