import { restartAdvice } from "../domain/checkout_trust.ts";
import { startsReview, unfinishedCheck } from "../domain/review_gate.ts";
import type { ReviewPass } from "./review_ports.ts";
import type { CheckoutOutcome } from "./verify_checkout.ts";

/**
 * The gate a `PreToolUse` hook runs before a shell command (`review_gate.ts` in the domain says
 * why it is a hook). Every command first removes any pass left earlier: a pass lives only until
 * the next command, and a gate stopped part-way leaves none. A command that does not start a
 * review is not gated. One that does is let through only when the checkout check holds for the
 * session the hook's input names, and only then is a pass left for the start. The check never
 * ends in a throw: whatever stops it, the record's reads included, is a refusal naming why.
 */

export type GateDeps = {
  /** The checkout check, reading the record of the session `sessionId` and no other. */
  readonly verify: (sessionId: string) => Promise<CheckoutOutcome>;
  readonly pass: ReviewPass;
};

export type GateInput = {
  /** The session id the harness gave the hook; `null` when its input names none. */
  readonly sessionId: string | null;
  /** The shell command about to run; `null` when the tool runs none. */
  readonly command: string | null;
};

export type GateOutcome = { readonly kind: "not_gated" } | CheckoutOutcome;

/** The label a refusal is filed under when the check itself could not finish. */
export const CHECK_PATH = "checkout check";

export async function gateReview(deps: GateDeps, input: GateInput): Promise<GateOutcome> {
  await deps.pass.revoke();
  if (input.command === null || !startsReview(input.command)) return { kind: "not_gated" };
  const outcome = await checked(deps, input.sessionId ?? "");
  if (outcome.kind === "trusted") await deps.pass.grant(outcome.baseTip);
  return outcome;
}

async function checked(deps: GateDeps, sessionId: string): Promise<CheckoutOutcome> {
  try {
    return await deps.verify(sessionId);
  } catch (err) {
    // Not swallowed: the failure is the refusal's reason, and the review does not start.
    const reasons = [{ path: CHECK_PATH, reason: unfinishedCheck(err) }];
    return { kind: "restart", reasons, advice: restartAdvice(null) };
  }
}
