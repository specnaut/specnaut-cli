import type { LockedReview } from "./review_lock.ts";

/** The review's own scripts under the review lock (`review_lock.ts`): which run, with what. */

/**
 * The scripts `phases/review-untrusted.md` runs, each with the flags it must carry there: every
 * one reads the exported head (`--head`), never this checkout's work, and the gate runner runs
 * only in the sandbox (`--sandbox`), with the base its tier is read from (`--base`); the values
 * they carry, `reviewValuesHeld`. A map, so a name
 * like `constructor` is no script.
 */
const REVIEW_SCRIPTS = new Map<string, readonly string[]>([
  [".specnaut/scripts/audit/collect-audit-scope.sh", ["--head"]],
  [".specnaut/scripts/bash/size-ratchet.sh", ["--head"]],
  [".specnaut/scripts/bash/boundary-check.sh", ["--head"]],
  [".specnaut/scripts/bash/git-read.sh", ["--head"]],
  [".specnaut/scripts/bash/run-gate.sh", ["--head", "--sandbox", "--base"]],
]);

/** Whether `words`, `bash <script> ...`, run one of the review's scripts under the lock of `review`. */
export function isReviewScript(words: readonly string[], review: LockedReview): boolean {
  const flags = REVIEW_SCRIPTS.get(words[1]);
  return flags !== undefined && flags.every((f) => words.includes(f)) &&
    reviewValuesHeld(words, review);
}

/**
 * Whether every `--head` of a script's `words` names the head this review exported, every
 * `--evidence` the folder `review start` made for its logs, both as it printed them, and every
 * `--base` the base tip the start was judged against, the full commit id it recorded: the gate
 * runner reads its tier from that commit, so no other may stand for the base. The words
 * beyond the required flags are otherwise the script's own: each refuses an option it does not
 * know, `git-read.sh` and the readers run git's read commands alone, and `run-gate.sh` runs its
 * gates only through `sandbox exec`, which judges its own log. What these two values bound: a
 * gate run of another export, and the folder `run-gate.sh` makes under its `--evidence` (`mktemp
 * -d`) before any run is judged, which would otherwise land anywhere outside the repository.
 */
function reviewValuesHeld(words: readonly string[], review: LockedReview): boolean {
  const pinned = new Map([
    ["--head", review.head],
    ["--evidence", review.logs],
    ["--base", review.base ?? null],
  ]);
  return words.every((word, i) => {
    const value = pinned.get(word);
    return value === undefined || words[i + 1] === value;
  });
}
