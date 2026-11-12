import { CHECKOUT_SCOPE, type ScopeRoot } from "../domain/checkout_scope.ts";
import { judgeCheckout, restartAdvice } from "../domain/checkout_trust.ts";
import type { Untrusted } from "../domain/script_trust.ts";
import type { CheckoutTreeWalker, GitObjectReader } from "./script_trust_ports.ts";
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

/** A full sha, checked before it reaches git, so no argument can read as an option or a range. */
const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export async function verifyCheckout(
  deps: VerifyCheckoutDeps,
  untrustedHead: string,
): Promise<CheckoutOutcome> {
  if (!FULL_SHA.test(untrustedHead)) return restart("head", "not a full commit sha", null);
  const scripts = await verifyScripts(deps);
  if (scripts.kind === "base_unknown") {
    return restart("base", `the base is unknown: ${scripts.why}`, null);
  }
  const { git } = deps;
  const tip = scripts.baseTip;
  if (await git.commitOf(untrustedHead) !== untrustedHead) {
    return restart("head", "names no commit in this repository: fetch it first", tip);
  }
  const [headCommits, untrustedCommits, tree, atTip] = await Promise.all([
    git.commitsAhead(tip, "HEAD"),
    git.commitsAhead(tip, untrustedHead),
    Promise.all(CHECKOUT_SCOPE.map((root) => deps.checkout.walk(root))),
    listScope(git, tip),
  ]);
  const verdict = judgeCheckout({
    headCommits,
    untrustedCommits,
    scripts: scripts.verdict,
    tree,
    tip: atTip,
  });
  if (verdict.holds) return { kind: "trusted", baseTip: tip };
  return { kind: "restart", reasons: verdict.reasons, advice: restartAdvice(tip) };
}

async function listScope(git: GitObjectReader, tip: string) {
  const roots = await Promise.all(CHECKOUT_SCOPE.map((root: ScopeRoot) => git.listRoot(tip, root)));
  return roots.flat();
}

function restart(path: string, reason: string, tip: string | null): CheckoutOutcome {
  return { kind: "restart", reasons: [{ path, reason }], advice: restartAdvice(tip) };
}
