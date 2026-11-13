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
 * pass in the worktree's own git directory, and the same entry in a per-user folder
 * (`reviewLockStateFolder`), which needs no repository to be found. A session is locked while
 * either entry is there, whatever it holds: emptying or replacing it locks as surely as the file
 * written, and an entry that does not name a head and a logs folder lets no command run that needs
 * them. Anything but a folder where the locks live locks every session, so a guard that cannot
 * tell fails closed. A session whose per-user entry is there while git cannot find this checkout's
 * git directory is refused outright: the lock no longer lets anything through for want of a
 * repository.
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
    const text = `${JSON.stringify({ session: sessionId, locked: this.now() })}\n`;
    await Deno.mkdir(dirname(state), { recursive: true, mode: 0o700 });
    for (const folder of [state, dir]) {
      await realFolder(dirname(folder));
      await realFolder(folder);
      await createEntry(join(folder, `${sessionId}.json`), text);
    }
  }

  async record(sessionId: string, review: { head: string; logs: string }): Promise<void> {
    const text = `${JSON.stringify({ session: sessionId, locked: this.now(), ...review })}\n`;
    for (const folder of this.#folders(sessionId)) {
      await replaceFile(join(folder, `${sessionId}.json`), text);
    }
  }

  async held(sessionId: string | null): Promise<LockedReview | null> {
    const id = sessionId !== null && isSessionId(sessionId) ? sessionId : null;
    const own = id === null || this.state === null ? null : await heldIn(this.state, id);
    if (own !== null && this.dir === null) throw new Error(NO_GIT_DIR);
    if (own !== null || this.dir === null) return own;
    return await heldIn(this.dir, id);
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

/** What the locks in `dir` record for `id`; for `null`, whether any is there. */
async function heldIn(dir: string, id: string | null): Promise<LockedReview | null> {
  const info = await lstatOrNull(dir);
  if (info === null) return null;
  if (!info.isDirectory) return UNKNOWN_REVIEW;
  if (id === null) return (await entryNames(dir)).length > 0 ? UNKNOWN_REVIEW : null;
  return await entryAt(join(dir, `${id}.json`));
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
