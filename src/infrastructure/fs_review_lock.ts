import { basename, dirname, isAbsolute, join } from "@std/path";
import type { ReviewLock } from "../application/review_ports.ts";
import { type LockedReview, UNKNOWN_REVIEW } from "../domain/review_lock.ts";
import { entryAt, entryIn, entryNames, heldIn } from "./fs_review_lock_entries.ts";
import { isSessionId } from "../domain/session_record.ts";
import { lstatOrNull, realFolder, replaceFile } from "./fs_review_pass.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/**
 * The review lock as files: `<git dir>/specnaut/review-lock/<session id>.json`, beside the review
 * pass in the worktree's own git directory, and the same entry in a per-user folder
 * (`reviewLockStateFolder`), which needs no repository to be found. A session is locked while
 * either entry is there, whatever it holds: emptying or replacing it locks as surely as the file
 * written, and an entry that does not name a head and a logs folder lets no command run that needs
 * them. Anything but a folder where the locks live locks every session, so a guard that cannot
 * tell fails closed. A session whose per-user entry is there while git cannot find this checkout's
 * git directory is refused outright: the lock no longer lets anything through for want of a
 * repository. Each entry records the per-user folder its copy went to, and a session whose entry
 * names another folder than the one this lock reads is refused: the hook would not find the copy.
 *
 * `.claude/hooks/review-lock.sh` reads the same paths before it starts the binary, and lets a call
 * through only when this class would say no lock holds; a change here is a change there.
 */
export class FsReviewLock implements ReviewLock {
  private constructor(
    readonly dir: string | null,
    readonly state: string | null,
    readonly now: () => number,
  ) {}

  /**
   * The lock of the repository `cwd` is in (`dir` is `null` outside one), its per-user copy in
   * `state` (`null`: no folder for it).
   */
  static async open(cwd: string, options: LockOptions = {}): Promise<FsReviewLock> {
    const state = options.state === undefined ? defaultStateFolder() : options.state;
    const out = await new UntrustedGit(cwd).call("rev-parse", ["--absolute-git-dir"]);
    const dir = out.code === 0 ? join(firstLine(out.stdout), "specnaut", "review-lock") : null;
    return new FsReviewLock(dir, state, options.now ?? Date.now);
  }

  async lock(sessionId: string): Promise<void> {
    const [dir, state] = this.#folders(sessionId);
    const entry = { session: sessionId, locked: this.now(), state };
    const text = `${JSON.stringify(entry)}\n`;
    await Deno.mkdir(dirname(state), { recursive: true, mode: 0o700 });
    for (const folder of [state, dir]) {
      await realFolder(dirname(folder));
      await realFolder(folder);
      await createEntry(join(folder, `${sessionId}.json`), text);
    }
  }

  async record(sessionId: string, review: { head: string; logs: string }): Promise<void> {
    const folders = this.#folders(sessionId);
    const entry = { session: sessionId, locked: this.now(), state: folders[1], ...review };
    const text = `${JSON.stringify(entry)}\n`;
    for (const folder of folders) {
      await replaceFile(join(folder, `${sessionId}.json`), text);
    }
  }

  async held(sessionId: string | null): Promise<LockedReview | null> {
    const id = sessionId !== null && isSessionId(sessionId) ? sessionId : null;
    const own = id === null || this.state === null ? null : await heldIn(this.state, id);
    if (own !== null && this.dir === null) throw new Error(NO_GIT_DIR);
    if (own !== null || this.dir === null) return own;
    if (id === null) return await heldIn(this.dir, null);
    const entry = await entryIn(this.dir, id);
    if (entry !== null && entry.state !== null && entry.state !== this.state) {
      throw new Error(otherStateFolder(entry.state, this.state));
    }
    return entry?.review ?? null;
  }

  async all(): Promise<readonly LockedReview[]> {
    if (this.dir === null) return [];
    const info = await lstatOrNull(this.dir);
    if (info === null) return [];
    if (!info.isDirectory) return [UNKNOWN_REVIEW];
    const dir = this.dir;
    const names = await entryNames(dir);
    return await Promise.all(names.map(async (n) => await entryAt(join(dir, n)) ?? UNKNOWN_REVIEW));
  }

  /** The two folders a session's entry is written to, or why it cannot be. */
  #folders(sessionId: string): [string, string] {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    if (this.dir === null) throw new Error("this folder is in no git repository");
    if (this.state === null) {
      throw new Error("no folder for the review lock's per-user copy: set XDG_STATE_HOME or HOME");
    }
    return [this.dir, this.state];
  }
}

/**
 * Why a session whose entry records its per-user copy in `written` is refused by a lock reading
 * `read`: the writer (`review start`, in the session's shell) and the hook disagree on the folder,
 * so the hook cannot find the copy once git no longer finds this checkout.
 */
function otherStateFolder(written: string, read: string | null): string {
  return `this session's review lock keeps its per-user copy in ${written}, and this hook reads ` +
    `${read ?? "no per-user folder"}: refused until both see the same XDG_STATE_HOME and HOME; ` +
    "start a new session once they do";
}

export type LockOptions = { readonly state?: string | null; readonly now?: () => number };

const NO_GIT_DIR = "this session is under the review lock, and git cannot find this checkout's " +
  "git directory to judge the call against: refused until it can";

/**
 * The per-user folder of the lock's entries: `$XDG_STATE_HOME/specnaut/review-lock`, or
 * `~/.local/state/specnaut/review-lock` when that variable names no absolute folder, on every
 * system alike, so the hook finds it as the binary does; `null` with no home folder either.
 */
export function reviewLockStateFolder(env: (name: string) => string | undefined): string | null {
  const xdg = env("XDG_STATE_HOME");
  const home = env("HOME") ?? env("USERPROFILE");
  const root = xdg !== undefined && isAbsolute(xdg)
    ? xdg
    : home !== undefined && isAbsolute(home)
    ? join(home, ".local", "state")
    : null;
  return root === null ? null : join(root, "specnaut", "review-lock");
}

function defaultStateFolder(): string | null {
  return reviewLockStateFolder((name) => Deno.env.get(name));
}

/** A new entry at `path`; one already there stays as it is, the outcome sought. */
async function createEntry(path: string, text: string): Promise<void> {
  try {
    await Deno.writeTextFile(path, text, { createNew: true, mode: 0o600 });
  } catch (err) {
    // Not swallowed: a lock already there is the outcome sought.
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
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
