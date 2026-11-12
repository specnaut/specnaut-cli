import { dirname, join } from "@std/path";
import type { ReviewLock } from "../application/review_ports.ts";
import { isSessionId } from "../domain/session_record.ts";
import { lstatOrNull, realFolder } from "./fs_review_pass.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/**
 * The review lock as files: `<git dir>/specnaut/review-lock/<session id>.json`, beside the review
 * pass in the worktree's own git directory. A session is locked while its entry is there, whatever
 * the entry holds: emptying or replacing it locks as surely as the file written. Anything but a
 * folder where the locks live locks every session, so a guard that cannot tell fails closed.
 *
 * `.claude/hooks/review-lock.sh` reads the same paths before it starts the binary, and lets a call
 * through only when this class would say no lock holds; a change here is a change there.
 */
export class FsReviewLock implements ReviewLock {
  private constructor(readonly dir: string, readonly now: () => number) {}

  /** The lock of the repository `cwd` is in, or `null` outside one. */
  static async open(cwd: string, now: () => number = Date.now): Promise<FsReviewLock | null> {
    const out = await new UntrustedGit(cwd).call("rev-parse", ["--absolute-git-dir"]);
    if (out.code !== 0) return null;
    return new FsReviewLock(join(firstLine(out.stdout), "specnaut", "review-lock"), now);
  }

  async lock(sessionId: string): Promise<void> {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    await realFolder(dirname(this.dir));
    await realFolder(this.dir);
    const text = `${JSON.stringify({ session: sessionId, locked: this.now() })}\n`;
    try {
      await Deno.writeTextFile(join(this.dir, `${sessionId}.json`), text, {
        createNew: true,
        mode: 0o600,
      });
    } catch (err) {
      // Not swallowed: a lock already there is the outcome sought.
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    }
  }

  async holds(sessionId: string | null): Promise<boolean> {
    const info = await lstatOrNull(this.dir);
    if (info === null) return false;
    if (!info.isDirectory) return true;
    if (sessionId === null || !isSessionId(sessionId)) return await anyEntry(this.dir);
    return await lstatOrNull(join(this.dir, `${sessionId}.json`)) !== null;
  }
}

async function anyEntry(dir: string): Promise<boolean> {
  for await (const _ of Deno.readDir(dir)) return true;
  return false;
}
