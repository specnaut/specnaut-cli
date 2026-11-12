import { join } from "@std/path";
import type { HeadReflogReader } from "../application/script_trust_ports.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/** The most bytes the reflog is read as: far above years of a busy checkout's HEAD moves. */
export const MAX_REFLOG_BYTES = 32 * 1024 * 1024;

/**
 * HEAD's reflog, `<git dir>/logs/HEAD`, read as a file. No git subcommand the hardened git allows
 * prints an entry whole: `rev-list --walk-reflogs` gives each entry's commit alone, which cannot
 * tell one entry from another of the same commit. The git directory is the worktree's own, so
 * HEAD's reflog is this checkout's. git keeps appending to the file once it exists, whatever
 * `core.logAllRefUpdates` says; without it git keeps no reflog for HEAD, and neither does a
 * repository whose refs are in a reftable.
 */
export class FsHeadReflog implements HeadReflogReader {
  private constructor(readonly path: string) {}

  static async open(cwd: string): Promise<FsHeadReflog> {
    const out = await new UntrustedGit(cwd).run("rev-parse", ["--absolute-git-dir"]);
    return new FsHeadReflog(join(firstLine(out), "logs", "HEAD"));
  }

  async headReflog(): Promise<Uint8Array | null> {
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(this.path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    if (!info.isFile) throw new Error(`${this.path} is not a regular file: a link is not followed`);
    if (info.size > MAX_REFLOG_BYTES) {
      throw new Error(`${this.path} is over ${MAX_REFLOG_BYTES} bytes`);
    }
    return await Deno.readFile(this.path);
  }
}
