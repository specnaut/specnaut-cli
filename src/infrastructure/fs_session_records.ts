import { dirname, join } from "@std/path";
import type {
  RecordRead,
  RecordWrite,
  SessionRecordReader,
  SessionRecordWriter,
} from "../application/script_trust_ports.ts";
import { isSessionId, SESSION_REASON } from "../domain/session_record.ts";
import { lstatOrNull, realFolder } from "./fs_review_pass.ts";
import { firstLine } from "./git_text.ts";
import { folderFault, placeRecord, pruneRecords, renew } from "./session_record_files.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/** The most bytes a record is read as: far above the record of any checkout's checked files. */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/**
 * The session records of one checkout, in `<git dir>/specnaut/session/<session id>.json`. The git
 * directory is the worktree's own, where no tracked, untracked or ignored file of a branch can
 * land, so two sessions in two worktrees never share a record; the session id keys it, so a
 * resumed session retakes its own and no session reads another's. The files themselves are kept
 * by `session_record_files.ts`.
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
   * The session's first record taken, never replaced: a resumed session finds that one, whatever
   * it resumed on, and renews it. `specnaut/` and `session/` are made where missing, and either one
   * existing as a link is refused. Then other sessions' records unused for
   * `RECORD_RETENTION_MS` are removed: a failure there is returned beside the record, which
   * it never undoes.
   */
  async write(sessionId: string, text: string): Promise<RecordWrite> {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    await realFolder(dirname(this.dir));
    await realFolder(this.dir);
    const placed = await placeRecord(this.dir, sessionId, text);
    try {
      await pruneRecords(this.dir, sessionId, Date.now());
      return placed;
    } catch (err) {
      // Not swallowed: the failure is returned for the caller to report beside the record.
      return { ...placed, pruneFailure: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The record a resumed or forked session's start took, renewed; `null` when it took none. */
  async find(sessionId: string): Promise<RecordWrite | null> {
    if (!isSessionId(sessionId)) throw new Error(`not a session id: ${sessionId}`);
    const path = join(this.dir, `${sessionId}.json`);
    if (await lstatOrNull(path) === null) return null;
    await renew(path);
    return { kind: "existing", path };
  }

  /**
   * The record of the session `sessionId`, read only from this folder. The id is the one the
   * harness gave a hook on its stdin: never a path, and never a variable the session's own
   * commands can set, since instruction files alone could point one at another session's record.
   */
  reader(sessionId: string): SessionRecordReader {
    return { read: () => this.#read(sessionId) };
  }

  async #read(sessionId: string): Promise<RecordRead> {
    if (!isSessionId(sessionId)) return refused(SESSION_REASON.none);
    const fault = await folderFault(this.dir);
    if (fault !== null) return refused(`${SESSION_REASON.unreadable}: ${fault}`);
    const path = join(this.dir, `${sessionId}.json`);
    const info = await lstatOrNull(path);
    if (info === null) return refused(SESSION_REASON.missing);
    if (!info.isFile) return refused(`${SESSION_REASON.unreadable}: not a regular file`);
    if (info.size > MAX_RECORD_BYTES) {
      return refused(`${SESSION_REASON.unreadable}: over ${MAX_RECORD_BYTES} bytes`);
    }
    try {
      await renew(path);
      return { kind: "read", text: await Deno.readTextFile(path) };
    } catch (err) {
      if (err instanceof Deno.errors.NotCapable || !(err instanceof Error)) throw err;
      return refused(`${SESSION_REASON.unreadable}: ${err.message}`);
    }
  }
}

const refused = (reason: string): RecordRead => ({ kind: "refused", reason });
