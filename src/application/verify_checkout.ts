import { CHECKOUT_SCOPE } from "../domain/checkout_scope.ts";
import { judgeCheckout, restartAdvice } from "../domain/checkout_trust.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { Untrusted } from "../domain/script_trust.ts";
import type { CheckoutTreeWalker } from "./script_trust_ports.ts";
import { verifyScripts, type VerifyScriptsDeps } from "./verify_scripts.ts";

/**
 * Whether the session's checkout may be trusted to review a branch it does not trust: the rule is
 * {@link judgeCheckout}'s, the base is `specnaut verify-scripts`' (origin's copy of the default
 * branch), and the branch is named by its head's full sha, already fetched as objects. Every way
 * the check cannot conclude is a failure with a reason, never a pass; a throw from git is the
 * caller's to report as one.
 */

export type VerifyCheckoutDeps = VerifyScriptsDeps & { readonly checkout: CheckoutTreeWalker };

export type CheckoutOutcome =
  | { readonly kind: "trusted"; readonly baseTip: string }
  | {
    readonly kind: "restart";
    readonly reasons: readonly Untrusted[];
    /** What the review tells the user: {@link restartAdvice}. */
    readonly advice: string;
  };

export async function verifyCheckout(
  deps: VerifyCheckoutDeps,
  untrustedHead: string,
): Promise<CheckoutOutcome> {
  if (!isFullSha(untrustedHead)) return restart("head", "not a full commit sha", null);
  const scripts = await verifyScripts(deps);
  if (scripts.kind === "base_unknown") {
    return restart("base", `the base is unknown: ${scripts.why}`, null);
  }
  const tip = scripts.baseTip;
  if (await deps.git.commitOf(untrustedHead) !== untrustedHead) {
    return restart("head", "names no commit in this repository: fetch it first", tip);
  }
  const facts = await gather(deps, tip, untrustedHead);
  const verdict = judgeCheckout({ ...facts, scripts: scripts.verdict });
  if (verdict.holds) return { kind: "trusted", baseTip: tip };
  return { kind: "restart", reasons: verdict.reasons, advice: restartAdvice(tip) };
}

/** What the rule reads besides the scripts: each side's commits, the checked files on both sides. */
async function gather(deps: VerifyCheckoutDeps, tip: string, untrustedHead: string) {
  const { git, checkout } = deps;
  const [headCommits, untrustedCommits, tree, atTip] = await Promise.all([
    git.commitsAhead(tip, "HEAD"),
    git.commitsAhead(tip, untrustedHead),
    Promise.all(CHECKOUT_SCOPE.map((root) => checkout.walk(root))),
    Promise.all(CHECKOUT_SCOPE.map((root) => git.listRoot(tip, root))),
  ]);
  return { headCommits, untrustedCommits, tree, tip: atTip.flat() };
}

function restart(path: string, reason: string, tip: string | null): CheckoutOutcome {
  return { kind: "restart", reasons: [{ path, reason }], advice: restartAdvice(tip) };
}
