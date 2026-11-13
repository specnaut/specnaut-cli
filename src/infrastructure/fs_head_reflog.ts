import { join } from "@std/path";
import type { HeadReflogReader } from "../application/script_trust_ports.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/** The most bytes the reflog is read as: far above years of a busy checkout's HEAD moves. */
export const MAX_REFLOG_BYTES = 32 * 1024 * 1024;

/** Why a repository whose refs are in a reftable is refused, where its reflog is no file. */
export const REFTABLE = "this repository keeps its refs in a reftable, where HEAD's reflog is " +
  "no file to read: a branch checked out during the session could not be seen";

/**
 * HEAD's reflog, `<git dir>/logs/HEAD`, read as a file. No git subcommand the hardened git allows
 * prints an entry whole: `rev-list --walk-reflogs` gives each entry's commit alone, which cannot
 * tell one entry from another of the same commit. The git directory is the worktree's own, so
 * HEAD's reflog is this checkout's. git keeps appending to the file once it exists, whatever
 * `core.logAllRefUpdates` says; without it git keeps no reflog for HEAD. A repository whose refs
 * are in a reftable (`extensions.refStorage`) keeps its reflog in the table, never in this file:
 * it is refused by name ({@link REFTABLE}), not taken for one git keeps no reflog for, and not
 * read through git, which would leave the check telling entries apart by their commits alone.
 */
export class FsHeadReflog implements HeadReflogReader {
  private constructor(readonly path: string, private readonly reftable: boolean) {}

  /**
   * The reader for `cwd`'s repository. Whether its refs are in a reftable is asked once, here,
   * and before the file is looked at: a `logs/HEAD` left in such a repository (by a copy, or by a
   * tool that predates reftables) is one git no longer appends to, never HEAD's reflog.
   */
  static async open(cwd: string): Promise<FsHeadReflog> {
    const git = new UntrustedGit(cwd);
    const out = await git.run("rev-parse", ["--absolute-git-dir"]);
    return new FsHeadReflog(join(firstLine(out), "logs", "HEAD"), await reftable(git));
  }

  async headReflog(): Promise<Uint8Array | null> {
    if (this.reftable) throw new Error(REFTABLE);
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(this.path);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      return null;
    }
    if (!info.isFile) throw new Error(`${this.path} is not a regular file: a link is not followed`);
    if (info.size > MAX_REFLOG_BYTES) {
      throw new Error(`${this.path} is over ${MAX_REFLOG_BYTES} bytes`);
    }
    return await Deno.readFile(this.path);
  }
}

/**
 * Whether the repository's own configuration puts its refs in a reftable. `git config --get`
 * exits 1 for a key that is not set; any other failure (a configuration git cannot read) is
 * raised with git's own reason rather than read as no reftable.
 */
async function reftable(git: UntrustedGit): Promise<boolean> {
  const out = await git.call("config", ["--local", "--get", "extensions.refStorage"]);
  if (out.code === 1) return false;
  if (out.code !== 0) throw new Error(`git config exited ${out.code}: ${out.why}`);
  return firstLine(out.stdout).trim().toLowerCase() === "reftable";
}
