import { isFullSha } from "./commit_sha.ts";

/**
 * Whether a PR's head may be reviewed as trusted: taken from the forge's own facts about the PR
 * and nothing else, never from what the branch or the request says. Team members are trusted by
 * default, which is the only way to trusted; every other answer, and every fact the forge does not
 * state plainly, is untrusted. The facts, as the forge's PR object names them:
 *
 * - `authorAssociation`: OWNER, MEMBER or COLLABORATOR is a team member.
 * - `isCrossRepository`: the head must live in this repository, where only people with write
 *   access to it can push. A head in another repository can hold commits from people the team
 *   never gave access, whoever opened the PR.
 * - `headRefOid`: the decision holds for that commit alone. The review names the commit it will
 *   read, and a head that moved since is untrusted.
 */

export type TrustDecision = { readonly trusted: true } | {
  readonly trusted: false;
  readonly why: string;
};

/** The associations of a team member: the only authors a review trusts. */
export const TEAM_ASSOCIATIONS: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];

/** How the forge spells an association: upper case and underscores, nothing a terminal reads. */
const ASSOCIATION = /^[A-Z_]{1,40}$/;

/** The decision for the PR the forge described as `facts`, reviewed at commit `head`. */
export function trustOf(facts: unknown, head: string): TrustDecision {
  if (typeof facts !== "object" || facts === null || Array.isArray(facts)) {
    return untrusted("the forge named no such PR");
  }
  const { authorAssociation, headRefOid, isCrossRepository } = facts as Record<string, unknown>;
  if (typeof isCrossRepository !== "boolean") {
    return untrusted("the forge does not say which repository the head lives in");
  }
  if (isCrossRepository) {
    return untrusted(
      "the head lives in another repository, where people outside the team can push",
    );
  }
  if (typeof headRefOid !== "string" || !isFullSha(headRefOid)) {
    return untrusted("the forge names no head commit for the PR");
  }
  if (headRefOid !== head) {
    return untrusted(`the head moved: the PR's head is ${headRefOid}, not ${head}`);
  }
  return associationDecision(authorAssociation);
}

function associationDecision(association: unknown): TrustDecision {
  if (typeof association !== "string" || !ASSOCIATION.test(association)) {
    return untrusted("the author's association is not one the forge names");
  }
  if (TEAM_ASSOCIATIONS.includes(association)) return { trusted: true };
  return untrusted(`the author's association is ${association}, not a team member's`);
}

/** The one line `specnaut review trust` prints: `trusted`, or `untrusted <why>`. */
export function trustLine(decision: TrustDecision): string {
  return decision.trusted ? "trusted" : `untrusted ${decision.why}`;
}

export const untrusted = (why: string): TrustDecision => ({ trusted: false, why });
