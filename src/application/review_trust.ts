import { prNumberOf } from "../domain/branch_source.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import { type TrustDecision, trustOf, untrusted } from "../domain/review_trust.ts";

/**
 * `specnaut review trust`: whether the review of a PR at the commit `head` may be trusted. Only
 * the forge's facts about the PR decide (`review_trust.ts` in the domain); a PR or a head that is
 * not one, or a forge that cannot be read, is untrusted, never an error a caller could misread.
 */

export type TrustDeps = {
  /** The forge's facts about PR `n`: what its PR object says, as the forge sent it. */
  readonly pullRequest: (n: number) => Promise<unknown>;
};

export async function decideTrust(
  deps: TrustDeps,
  pr: string,
  head: string,
): Promise<TrustDecision> {
  const number = prNumberOf(pr);
  if (number === null) return untrusted(`not a PR number: ${pr}`);
  if (!isFullSha(head)) return untrusted(`the head is not a full commit id: ${head}`);
  try {
    return trustOf(await deps.pullRequest(number), head);
  } catch (err) {
    // Not swallowed: the failure is the decision's reason.
    const why = err instanceof Error ? err.message : String(err);
    return untrusted(`the forge could not be read: ${why}`);
  }
}
