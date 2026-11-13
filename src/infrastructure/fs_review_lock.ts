import { basename, dirname, isAbsolute, join } from "@std/path";
import type { ReviewLock } from "../application/review_ports.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import { type LockedReview, UNKNOWN_REVIEW } from "../domain/review_lock.ts";
import { isSessionId } from "../domain/session_record.ts";
import { lstatOrNull, realFolder, replaceFile } from "./fs_review_pass.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/**
 * The review lock as files: `<git dir>/specnaut/review-lock/<session id>.json`, beside the review
 * pass in the worktree's own git directory. A session is locked while its entry is there, whatever
 * the entry holds: emptying or replacing it locks as surely as the file written, and an entry that
 * does not name a head and a logs folder lets no command run that needs them. Anything but a
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

  async record(sessionId: string, review: { head: string; logs: string }): Promise<void> {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    const entry = { session: sessionId, locked: this.now(), ...review };
    await replaceFile(join(this.dir, `${sessionId}.json`), `${JSON.stringify(entry)}\n`);
  }

  async held(sessionId: string | null): Promise<LockedReview | null> {
    const info = await lstatOrNull(this.dir);
    if (info === null) return null;
    if (!info.isDirectory) return UNKNOWN_REVIEW;
    if (sessionId === null || !isSessionId(sessionId)) {
      return (await entryNames(this.dir)).length > 0 ? UNKNOWN_REVIEW : null;
    }
    return await entryAt(join(this.dir, `${sessionId}.json`));
  }

  async all(): Promise<readonly LockedReview[]> {
    const info = await lstatOrNull(this.dir);
    if (info === null) return [];
    if (!info.isDirectory) return [UNKNOWN_REVIEW];
    const names = await entryNames(this.dir);
    return await Promise.all(
      names.map(async (n) => await entryAt(join(this.dir, n)) ?? UNKNOWN_REVIEW),
    );
  }
}

/**
 * Where the `--log` file `path` would be made: its folder's real path and its name; `null` for a
 * relative path, a name that is no file's, or a folder that does not resolve.
 */
export async function realLogPath(path: string): Promise<string | null> {
  const name = basename(path);
  if (!isAbsolute(path) || name === "" || name === "." || name === "..") return null;
  try {
    return join(await Deno.realPath(dirname(path)), name);
  } catch (err) {
    // Not swallowed: a folder that is not there holds no log.
    if (err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotADirectory) {
      return null;
    }
    throw err;
  }
}

/** The review the entry at `path` records; `null` when there is none, a link counting as one. */
async function entryAt(path: string): Promise<LockedReview | null> {
  const info = await lstatOrNull(path);
  if (info === null) return null;
  return info.isFile ? reviewOf(await Deno.readTextFile(path)) : UNKNOWN_REVIEW;
}

function reviewOf(text: string): LockedReview {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return UNKNOWN_REVIEW;
    const { head, logs } = parsed as Record<string, unknown>;
    return {
      head: typeof head === "string" && isFullSha(head) ? head : null,
      logs: typeof logs === "string" && isAbsolute(logs) ? logs : null,
    };
  } catch (err) {
    // Not swallowed: an entry that is not JSON locks all the same, naming nothing.
    if (!(err instanceof SyntaxError)) throw err;
    return UNKNOWN_REVIEW;
  }
}

async function entryNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names.sort();
}
