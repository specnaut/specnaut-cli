import type { CheckoutState } from "../domain/review_gate.ts";

/**
 * The pass `specnaut review gate` leaves when the session's checkout holds, and the one thing
 * `specnaut review start` needs before it fetches anything. It lives in the worktree's own git
 * directory, beside the session records, where no file of a branch can land.
 */

/**
 * A pass as the gate left it: `granted` is `NaN`, `baseTip` empty and `checkout` `null` where the
 * file did not say.
 */
export type GrantedPass = {
  readonly granted: number;
  readonly baseTip: string;
  readonly checkout: CheckoutState | null;
};

export interface ReviewPass {
  /** Leaves a pass for `checkout`, judged against `baseTip`, replacing any earlier one. */
  grant(baseTip: string, checkout: CheckoutState): Promise<void>;
  /** Removes the pass, if there is one. */
  revoke(): Promise<void>;
  /**
   * Takes the pass: when it was granted, for which base tip and checkout, removed so it starts
   * one review; `null` when none.
   */
  take(): Promise<GrantedPass | null>;
}
