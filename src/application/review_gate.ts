import { restartAdvice } from "../domain/checkout_trust.ts";
import {
  type CheckoutState,
  passedCommand,
  startsReview,
  unfinishedCheck,
} from "../domain/review_gate.ts";
import type { ReviewPass } from "./review_ports.ts";
import type { CheckoutOutcome } from "./verify_checkout.ts";

/**
 * The gate a `PreToolUse` hook runs before a shell command (`review_gate.ts` in the domain says
 * why it is a hook). Every command first removes any pass left earlier: a pass lives only until
 * the next command, and a gate stopped part-way leaves none. A command that does not start a
 * review is not gated. One that does is let through only when the checkout check holds for the
 * session the hook's input names, and only then is a pass left for the start, naming the checkout
 * the check was taken on (`CheckoutState` in the domain says why) and a fresh nonce, which the line
 * let through carries (`passedCommand`). The check never ends in a throw: whatever stops it, the
 * record's reads included, is a refusal naming why.
 */

export type GateDeps = {
  /** The checkout check, reading the record of the session `sessionId` and no other. */
  readonly verify: (sessionId: string) => Promise<CheckoutOutcome>;
  /** The checkout as the start reads it again. */
  readonly checkout: () => Promise<CheckoutState>;
  readonly pass: ReviewPass;
  /** A fresh pass nonce: 32 lowercase hex digits from a secure source. */
  readonly nonce: () => string;
};

export type GateInput = {
  /** The session id the harness gave the hook; `null` when its input names none. */
  readonly sessionId: string | null;
  /** The shell command about to run; `null` when the tool runs none. */
  readonly command: string | null;
};

/** `passed`: the checkout holds, and `command` is the line to run instead, carrying the nonce. */
export type GateOutcome =
  | { readonly kind: "not_gated" }
  | { readonly kind: "passed"; readonly command: string }
  | Exclude<CheckoutOutcome, { kind: "trusted" }>;

/** The label a refusal is filed under when the check itself could not finish. */
export const CHECK_PATH = "checkout check";

export async function gateReview(deps: GateDeps, input: GateInput): Promise<GateOutcome> {
  await deps.pass.revoke();
  if (input.command === null || !startsReview(input.command)) return { kind: "not_gated" };
  return await checked(deps, input.sessionId ?? "", input.command);
}

/** The verdict, and a pass when it holds. */
async function checked(deps: GateDeps, sessionId: string, command: string): Promise<GateOutcome> {
  try {
    // Read before the check: a checkout that moves while it is judged no longer reads the same.
    const checkout = await deps.checkout();
    const outcome = await deps.verify(sessionId);
    if (outcome.kind !== "trusted") return outcome;
    // The pass names the session judged, so the start locks that session and no other.
    const nonce = deps.nonce();
    await deps.pass.grant(outcome.baseTip, checkout, sessionId, nonce);
    return { kind: "passed", command: passedCommand(command, nonce) };
  } catch (err) {
    // Not swallowed: the failure is the refusal's reason, and the review does not start.
    const reasons = [{ path: CHECK_PATH, reason: unfinishedCheck(err) }];
    return { kind: "restart", reasons, advice: restartAdvice(null) };
  }
}
