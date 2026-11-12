import { basename, dirname, join } from "@std/path";
import type {
  RecordRead,
  RecordWrite,
  SessionRecordReader,
  SessionRecordWriter,
} from "../application/script_trust_ports.ts";
import { isSessionId, RECORD_RETENTION_MS, SESSION_REASON } from "../domain/session_record.ts";
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
   * Written to a file created new beside it, then hard-linked to `<id>.json`, which fails when
   * anything is already there: no file or link is ever opened for writing, and a session's first
   * record is never replaced. A resumed session finds that one, whatever it resumed on. Other
   * sessions' records past {@link RECORD_RETENTION_MS} are removed first.
   */
  async write(sessionId: string, text: string): Promise<RecordWrite> {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    await this.#folder();
    await this.#prune(sessionId, Date.now());
    const path = join(this.dir, `${sessionId}.json`);
    const temp = join(this.dir, `.${sessionId}.${crypto.randomUUID()}.tmp`);
    await Deno.writeTextFile(temp, text, { createNew: true, mode: 0o600 });
    let placed: RecordWrite;
    try {
      placed = await linked(temp, path);
    } catch (err) {
      await removeAfter(temp, err);
      throw err;
    }
    await Deno.remove(temp);
    return placed;
  }

  /** The record `named` names (`SPECNAUT_SESSION_RECORD`), read only from this folder. */
  reader(named: string | undefined): SessionRecordReader {
    return { read: () => this.#read(named) };
  }

  async #read(named: string | undefined): Promise<RecordRead> {
    if (named === undefined || named === "") return refused(SESSION_REASON.none);
    if (!this.#holds(named)) return refused(`${SESSION_REASON.outside}: ${named}`);
    for (const dir of [dirname(this.dir), this.dir]) {
      const folder = await lstatOrNull(dir);
      if (folder !== null && !folder.isDirectory) {
        return refused(`${SESSION_REASON.unreadable}: ${dir} is not a folder`);
      }
    }
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

  /**
   * The records, and the temp files a failed write left, that sessions other than `current` last
   * wrote over {@link RECORD_RETENTION_MS} ago. A folder is never removed, and a file another
   * session removed first is already gone.
   */
  async #prune(current: string, now: number): Promise<void> {
    for await (const entry of Deno.readDir(this.dir)) {
      const owner = /^(.+)\.json$/.exec(entry.name)?.[1] ?? TEMP.exec(entry.name)?.[1];
      if (owner === undefined || !isSessionId(owner) || owner === current) continue;
      const info = entry.isDirectory ? null : await lstatOrNull(join(this.dir, entry.name));
      const written = info?.mtime?.getTime();
      if (written === undefined || now - written <= RECORD_RETENTION_MS) continue;
      await removeIfThere(join(this.dir, entry.name));
    }
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

/** A temp file {@link FsSessionRecords.write} creates: `.<session id>.<uuid>.tmp`. */
const TEMP = /^\.(.+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** `temp` linked to `path`: taken, or the record already there kept. */
async function linked(temp: string, path: string): Promise<RecordWrite> {
  try {
    await Deno.link(temp, path);
    return { kind: "taken", path };
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    return { kind: "existing", path };
  }
}

/**
 * The temp file removed after the write failed with `failure`. Should the removal fail too, the
 * error thrown is still the write's: its message first, `failure` as its cause, the removal's
 * appended. The file left behind is pruned by a later write.
 */
async function removeAfter(temp: string, failure: unknown): Promise<void> {
  try {
    await Deno.remove(temp);
  } catch (removal) {
    const why = (e: unknown) => e instanceof Error ? e.message : String(e);
    throw new Error(`${why(failure)} (and ${temp} could not be removed: ${why(removal)})`, {
      cause: failure,
    });
  }
}

async function removeIfThere(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (err) {
    // Not swallowed: a record another session's write pruned first is the outcome sought.
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
