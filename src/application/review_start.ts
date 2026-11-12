import { type CheckoutState, passHolds, sameCheckout } from "../domain/review_gate.ts";
import type { ReviewPass } from "./review_ports.ts";
import type { BranchExport } from "./untrusted_review.ts";

/**
 * Starts a review that cannot trust its branch: takes the pass the checkout gate left, then
 * exports the branch as inert files (`untrusted_review.ts`) and keeps the export for the
 * review's later commands. No pass, one past its time, one granted for a base tip that is no
 * longer the base's, or for a checkout that no longer reads the same, starts nothing and fetches
 * nothing: the verdict was taken on that checkout, against that tip.
 */

export type StartDeps = {
  readonly pass: ReviewPass;
  readonly now: () => number;
  /** The base branch's tip now, as the checkout check resolves it; `null` when it cannot. */
  readonly baseTip: () => Promise<string | null>;
  /** The checkout now, read as the gate read it. */
  readonly checkout: () => Promise<CheckoutState>;
  readonly exportBranch: (source: string) => Promise<BranchExport>;
};

export type StartOutcome =
  | { readonly kind: "started"; readonly exported: BranchExport }
  | { readonly kind: "refused"; readonly why: string };

/** No pass: the gate hook did not run for this command, or did not let it through. */
export const NO_PASS = "no checkout verdict: `specnaut review gate` runs as a Claude Code " +
  "PreToolUse hook and lets this command through only when the session's checkout holds; run " +
  "`specnaut upgrade` to install the hook, or start a new session as its refusal says";

export const STALE_PASS = "the checkout verdict is out of date: run this command again";

export const MOVED_PASS =
  "the base branch moved since the checkout verdict: run this command again";

export const CHANGED_PASS = "the checkout changed since its verdict: run this command again";

export async function startReview(deps: StartDeps, source: string): Promise<StartOutcome> {
  const granted = await deps.pass.take();
  if (granted === null) return { kind: "refused", why: NO_PASS };
  if (!passHolds(granted.granted, deps.now())) return { kind: "refused", why: STALE_PASS };
  if (granted.baseTip !== await deps.baseTip()) return { kind: "refused", why: MOVED_PASS };
  const judged = granted.checkout;
  if (judged === null || !sameCheckout(judged, await deps.checkout())) {
    return { kind: "refused", why: CHANGED_PASS };
  }
  const exported = await deps.exportBranch(source);
  exported.keep();
  return { kind: "started", exported };
}
