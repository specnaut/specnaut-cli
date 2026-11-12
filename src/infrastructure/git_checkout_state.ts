import type { CheckoutState } from "../domain/review_gate.ts";
import { sha256HexBytes } from "../domain/sha256.ts";
import { FsHeadReflog } from "./fs_head_reflog.ts";
import { GitObjects } from "./git_object_reader.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/**
 * The checkout of the repository `cwd` is in, read the way the checkout check reads it: HEAD's
 * commit through the hardened git, the branch HEAD names, and HEAD's reflog as a file. The gate
 * and the start both read it here, so the two readings differ only when the checkout did. A throw
 * is the caller's: the gate refuses on it, the start fails on it.
 */
export async function checkoutState(cwd: string): Promise<CheckoutState> {
  const [objects, reflog] = await Promise.all([GitObjects.open(cwd), FsHeadReflog.open(cwd)]);
  const [head, ref, log] = await Promise.all([
    objects.commitOf("HEAD"),
    new UntrustedGit(cwd).call("symbolic-ref", ["--quiet", "HEAD"]),
    reflog.headReflog(),
  ]);
  return {
    head,
    ref: ref.code === 0 ? firstLine(ref.stdout) : null,
    reflog: log === null ? null : await sha256HexBytes(log),
  };
}
