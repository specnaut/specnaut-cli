import { SEPARATOR } from "@std/path";
import { LOCKED, type LockedReview } from "./review_lock.ts";

/**
 * A sandboxed run under the review lock (`review_lock.ts`): as the guard judges the call, and as
 * `sandbox exec` judges itself.
 */

/**
 * `specnaut sandbox exec <head> [--toolchain <dirs>] --log <file> -- <command>...`, exactly: the
 * head this session's review exported, only toolchain folders the start recorded (the base's
 * `gates.yml` declares them), and a log file below the folder `review start` made for it. Any
 * other folder would be mounted with no one having recorded it; a log anywhere else would be a
 * new file on the host, its content the branch's.
 */
export function isLockedExec(words: readonly string[], review: LockedReview, log: string | null) {
  const [, , sub, sha] = words;
  const options = execOptions(words);
  return sub === "exec" && options !== null && review.head !== null && sha === review.head &&
    toolchainRecorded(options.toolchain, review) && log !== null && review.logs !== null &&
    isInsideFolder(log, review.logs);
}

/**
 * The `--toolchain` folders and `--log` file of `specnaut sandbox exec <sha>`'s locked shape (a
 * command after `--`), or `null` for any other shape.
 */
export function execOptions(words: readonly string[]): { toolchain: string[]; log: string } | null {
  const named = words[4] === "--toolchain";
  const at = named ? 6 : 4;
  if (words[at] !== "--log" || words[at + 2] !== "--" || words.length < at + 4) return null;
  return { toolchain: named ? words[5].split(":") : [], log: words[at + 1] };
}

/** Whether every folder of `toolchain` is one the start recorded for `review`. */
function toolchainRecorded(toolchain: readonly string[], review: LockedReview): boolean {
  return toolchain.every((folder) => (review.toolchain ?? []).includes(folder));
}

/**
 * Why `specnaut sandbox exec` itself refuses a run while `held`, the reviews whose logs folder the
 * run may use (`execLockRefusal` says which), is not empty: a run some script starts reaches no
 * hook, so the binary holds the same line: a `--log` below one of their folders, and only
 * toolchain folders that same review recorded. `log` is where its `--log` resolves, `null` for
 * none. With no lock it runs as it always did.
 */
export function lockedExecRefusal(
  held: readonly LockedReview[],
  toolchain: readonly string[],
  log: string | null,
): string | null {
  if (held.length === 0) return null;
  const logged = held.filter((r) => log !== null && r.logs !== null && isInsideFolder(log, r.logs));
  if (logged.length === 0) {
    return "a run with no --log, or a --log outside the folder `specnaut review start` made for " +
      `the review's logs, is ${LOCKED}`;
  }
  if (logged.some((r) => toolchainRecorded(toolchain, r))) return null;
  return "a --toolchain folder the base's gates.yml does not declare (recorded by `specnaut " +
    `review start\`) is ${LOCKED}`;
}

/**
 * Whether `path` lies below `folder`, both real paths, by the host's own separator: on POSIX a `\`
 * is a character of a name, so `<logs>\x` is a file beside `<logs>`, not in it.
 */
export function isInsideFolder(path: string, folder: string): boolean {
  const base = folder.endsWith(SEPARATOR) ? folder.slice(0, -SEPARATOR.length) : folder;
  return path.length > base.length + 1 && path.startsWith(base + SEPARATOR);
}
