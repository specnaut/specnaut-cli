import { basename, dirname, join } from "@std/path";
import type {
  RecordRead,
  SessionRecordReader,
  SessionRecordWriter,
} from "../application/script_trust_ports.ts";
import { isSessionId, SESSION_REASON } from "../domain/session_record.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/** The most bytes a record is read as: far above the record of any checkout's checked files. */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/**
 * The session records of one checkout, in `<git dir>/specnaut/session/<session id>.json`. The git
 * directory is the worktree's own, where no tracked, untracked or ignored file of a branch can
 * land, so two sessions in two worktrees never share a record; the session id keys it, so a
 * resumed session retakes its own and no session reads another's.
 */
export class FsSessionRecords implements SessionRecordWriter {
  private constructor(readonly dir: string) {}

  /** The records of the repository `cwd` is in, or `null` outside one. */
  static async open(cwd: string): Promise<FsSessionRecords | null> {
    const out = await new UntrustedGit(cwd).call("rev-parse", ["--absolute-git-dir"]);
    if (out.code !== 0) return null;
    return new FsSessionRecords(join(firstLine(out.stdout), "specnaut", "session"));
  }

  /**
   * Written to a file created new beside it, then renamed onto `<id>.json`: no file or link already
   * there is ever opened for writing, and a resumed session's record replaces its earlier one.
   */
  async write(sessionId: string, text: string): Promise<string> {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    await this.#folder();
    const path = join(this.dir, `${sessionId}.json`);
    const temp = join(this.dir, `.${sessionId}.${crypto.randomUUID()}.tmp`);
    await Deno.writeTextFile(temp, text, { createNew: true, mode: 0o600 });
    try {
      await Deno.rename(temp, path);
    } catch (err) {
      await Deno.remove(temp);
      throw err;
    }
    return path;
  }

  /** The record `named` names (`SPECNAUT_SESSION_RECORD`), read only from this folder. */
  reader(named: string | undefined): SessionRecordReader {
    return { read: () => this.#read(named) };
  }

  async #read(named: string | undefined): Promise<RecordRead> {
    if (named === undefined || named === "") return refused(SESSION_REASON.none);
    if (!this.#holds(named)) return refused(`${SESSION_REASON.outside}: ${named}`);
    const info = await lstatOrNull(named);
    if (info === null) return refused(SESSION_REASON.missing);
    if (!info.isFile) return refused(`${SESSION_REASON.unreadable}: not a regular file`);
    if (info.size > MAX_RECORD_BYTES) {
      return refused(`${SESSION_REASON.unreadable}: over ${MAX_RECORD_BYTES} bytes`);
    }
    try {
      return { kind: "read", text: await Deno.readTextFile(named) };
    } catch (err) {
      if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
      return refused(`${SESSION_REASON.unreadable}: ${err.message}`);
    }
  }

  /**
   * Whether `named` is a record of this folder, spelled exactly as {@link write} returns it:
   * `<dir>/<session id>.json`. No other spelling is resolved, since `x/..` past a link leads
   * wherever the link does.
   */
  #holds(named: string): boolean {
    const name = /^(.+)\.json$/.exec(basename(named));
    return name !== null && isSessionId(name[1]) && named === join(this.dir, basename(named));
  }

  /** `specnaut/` and `session/` made where missing; either one existing as a link is refused. */
  async #folder(): Promise<void> {
    for (const dir of [dirname(this.dir), this.dir]) {
      const info = await lstatOrNull(dir);
      if (info === null) await Deno.mkdir(dir, { mode: 0o700 });
      else if (!info.isDirectory) throw new Error(`${dir} is not a folder: a link is not followed`);
    }
  }
}

const refused = (reason: string): RecordRead => ({ kind: "refused", reason });

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
