import { SEPARATOR } from "@std/path";
import { LOCKED, type LockedReview } from "./review_lock.ts";

/**
 * A sandboxed run under the review lock (`review_lock.ts`): as the guard judges the call, and as
 * `sandbox exec` judges itself.
 */

/**
 * `specnaut sandbox exec <head> --log <file> -- <command>...`, exactly: the head this session's
 * review exported, a log file below the folder `review start` made for it, and no `--toolchain`,
 * which would mount folders no one recorded. A log anywhere else would be a new file on the host,
 * its content the branch's.
 */
export function isLockedExec(words: readonly string[], review: LockedReview, log: string | null) {
  const [, , sub, sha, flag, , dash] = words;
  return sub === "exec" && words.length >= 8 && flag === "--log" && dash === "--" &&
    review.head !== null && sha === review.head && log !== null && review.logs !== null &&
    isInsideFolder(log, review.logs);
}

/**
 * Why `specnaut sandbox exec` itself refuses a run while `held`, the reviews whose logs folder the
 * run may use (`execLockRefusal` says which), is not empty: a run some script starts reaches no
 * hook, so the binary holds the same line. `log` is where its `--log` resolves, `null` for none.
 * With no lock it runs as it always did.
 */
export function lockedExecRefusal(
  held: readonly LockedReview[],
  toolchain: readonly string[],
  log: string | null,
): string | null {
  if (held.length === 0) return null;
  if (toolchain.length > 0) return `--toolchain is ${LOCKED}`;
  if (log !== null && held.some((r) => r.logs !== null && isInsideFolder(log, r.logs))) return null;
  return "a run with no --log, or a --log outside the folder `specnaut review start` made for " +
    `the review's logs, is ${LOCKED}`;
}

/**
 * Whether `path` lies below `folder`, both real paths, by the host's own separator: on POSIX a `\`
 * is a character of a name, so `<logs>\x` is a file beside `<logs>`, not in it.
 */
export function isInsideFolder(path: string, folder: string): boolean {
  const base = folder.endsWith(SEPARATOR) ? folder.slice(0, -SEPARATOR.length) : folder;
  return path.length > base.length + 1 && path.startsWith(base + SEPARATOR);
}
