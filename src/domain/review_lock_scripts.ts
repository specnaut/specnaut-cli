/** The review's own scripts under the review lock (`review_lock.ts`): which run, with what. */

/**
 * The scripts `phases/review-untrusted.md` runs, each with the flags it must carry there: every
 * one reads the exported head (`--head`), never this checkout's work, and the gate runner runs
 * only in the sandbox (`--sandbox`). A map, so a name like
 * `constructor` is no script.
 */
const REVIEW_SCRIPTS = new Map<string, readonly string[]>([
  [".specnaut/scripts/audit/collect-audit-scope.sh", ["--head"]],
  [".specnaut/scripts/bash/size-ratchet.sh", ["--head"]],
  [".specnaut/scripts/bash/boundary-check.sh", ["--head"]],
  [".specnaut/scripts/bash/git-read.sh", ["--head"]],
  [".specnaut/scripts/bash/run-gate.sh", ["--head", "--sandbox"]],
]);

/** Whether `words`, `bash <script> ...`, run one of the review's scripts under the lock. */
export function isReviewScript(words: readonly string[]): boolean {
  const flags = REVIEW_SCRIPTS.get(words[1]);
  return flags !== undefined && flags.every((f) => words.includes(f));
}
