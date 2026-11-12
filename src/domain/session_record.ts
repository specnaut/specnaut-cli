import {
  type CheckoutEntry,
  type CheckoutInput,
  type CheckoutVerdict,
  type CheckoutWalk,
  commitReasons,
  configReasons,
  type HoldsTip,
  type RecordedEntry,
  type RecordedWalk,
} from "./checkout_trust.ts";
import type { BaseEntry, Untrusted } from "./script_trust.ts";
import { sha256HexBytes } from "./sha256.ts";

/**
 * The checkout a session started on, as its `SessionStart` hook recorded it: HEAD's full sha,
 * where its reflog stood ({@link ReflogMark}), and the walk of every root of `CHECKOUT_SCOPE`, each
 * file by the SHA-256 of its bytes, untracked and ignored ones included. The harness loads its
 * settings, hooks, agents and skills at that moment, so the checkout check (`checkout_trust.ts`)
 * judges this as well as the folder as it is later.
 */
export type SessionRecord = {
  readonly head: string;
  readonly reflog: ReflogMark;
  readonly tree: readonly RecordedWalk[];
};

/**
 * Where HEAD's reflog stood at session start: how many entries it held, and the commit its newest
 * one named. Every entry written since is a commit HEAD was on during the session, so a branch
 * checked out and left again is still seen, though HEAD and the folder no longer show it.
 */
export type ReflogMark = { readonly entries: number; readonly newest: string };

/**
 * The commits the reflog entries written since `mark` name, each once, newest first; `now` is the
 * commit of every entry, newest first. `null` when the entry `mark` names is not where it stood:
 * the reflog was rewritten or expired, and what it held since cannot be told. A reflog shorter than
 * at the start lands there too, since no entry stands at a negative index.
 */
export function reflogSince(mark: ReflogMark, now: readonly string[]): string[] | null {
  const added = now.length - mark.entries;
  if (now[added] !== mark.newest) return null;
  return [...new Set(now.slice(0, added))];
}

/**
 * The `SessionStart` sources that take the record: each one is a harness process that has just
 * loaded the checkout. `clear` and `compact` load nothing anew, and a record retaken there would
 * describe a checkout switched inside the session, the case the record exists for. Any other
 * source takes none: a missing record refuses, where a wrong one would pass. A session keeps its
 * first record: `resume` or `fork` under an id that has one takes none, so a session started on a
 * branch cannot pass by switching to the base and resuming.
 */
export const RECORDED_SOURCES: ReadonlySet<string> = new Set(["startup", "resume", "fork"]);

/** A session id as the record's file name: what the harness issues, never a path of its own. */
export function isSessionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}

/**
 * How long another session's record is kept: a write removes the folder's records older than this,
 * so no stale record is left for a later session to be pointed at. Thirty days is Claude Code's
 * default `cleanupPeriodDays`, past which a session's transcript, and with it any resume, is gone.
 * A session resumed past it finds no record and takes a new one of the checkout as it is then.
 */
export const RECORD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The variable that names the record to the session's later commands, set through `CLAUDE_ENV_FILE`. */
export const SESSION_RECORD_VAR = "SPECNAUT_SESSION_RECORD";

/** The reasons the record adds to the check's. Every one about the record itself is filed under `path`. */
export const SESSION_REASON = {
  path: SESSION_RECORD_VAR,
  // `/clear` runs the hook with a source that takes no record, and may drop the variable the start
  // set: the session then names none, and only a new one, which takes its own, can be checked.
  none: "this session names no session-start record: only a Claude Code session whose " +
    "SessionStart hook ran `specnaut record-checkout` has one, and a `/clear` may drop it; " +
    "start a new session",
  outside: "names a file outside this checkout's session records",
  missing: "the session-start record is missing",
  unreadable: "the session-start record cannot be read",
  malformed: "the session-start record cannot be parsed",
  headUnknown: "the session started on a commit this repository does not have",
  atStart: "at session start",
  visited: "HEAD was on this commit during the session, and the base's tip lacks it",
  reflogRewritten: "HEAD's reflog no longer holds the entry the session started at: it was " +
    "rewritten or expired since",
} as const;

/** The record of `tree` at `head`: each file's bytes replaced by their digest. */
export async function recordOf(
  head: string,
  reflog: ReflogMark,
  tree: readonly CheckoutWalk[],
): Promise<SessionRecord> {
  const walks = await Promise.all(tree.map(async (walk): Promise<RecordedWalk> => {
    if (walk.kind === "blocked") return walk;
    return { kind: "walked", entries: await Promise.all(walk.entries.map(recorded)) };
  }));
  return { head, reflog, tree: walks };
}

async function recorded(entry: CheckoutEntry): Promise<RecordedEntry> {
  if (entry.kind !== "file") return entry;
  const { bytes, ...rest } = entry;
  return { ...rest, sha256: await sha256HexBytes(bytes) };
}

/** The digest of what each tip path holds as a file: a blob's bytes, or a link's target. */
export async function tipDigests(tip: readonly BaseEntry[]): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const entry of tip) {
    if (entry.kind === "blob") digests.set(entry.path, await sha256HexBytes(entry.bytes));
    if (entry.kind === "link" && entry.target !== undefined) {
      digests.set(entry.path, await sha256HexBytes(new TextEncoder().encode(entry.target)));
    }
  }
  return digests;
}

export type RecordInput = Pick<CheckoutInput, "headCommits" | "untrustedCommits" | "tip"> & {
  readonly tree: readonly RecordedWalk[];
  /** {@link tipDigests} of `tip`. */
  readonly tipDigests: ReadonlyMap<string, string>;
};

/**
 * The record judged by the checkout check's rules 1 and 3: its HEAD holds no commit the tip lacks,
 * and its files equal the tip's, compared by digest. Rule 2, the helper scripts, is not in it: the
 * harness does not load them, and the review checks them when it runs them.
 */
export function judgeRecord(input: RecordInput): CheckoutVerdict {
  const holds: HoldsTip = (file, base) =>
    "sha256" in file && file.sha256 === input.tipDigests.get(base.path);
  const reasons = [...commitReasons(input), ...configReasons(input.tree, input.tip, holds)];
  return { holds: reasons.length === 0, reasons };
}

/**
 * The record's reasons that the checkout as it is now does not already give, each marked as found
 * at session start: the user is told what the session loaded and no longer shows.
 */
export function startReasons(
  now: readonly Untrusted[],
  atStart: readonly Untrusted[],
): Untrusted[] {
  const seen = new Set(now.map((u) => `${u.path}\0${u.reason}`));
  return atStart
    .filter((u) => !seen.has(`${u.path}\0${u.reason}`))
    .map((u) => ({ path: u.path, reason: `${SESSION_REASON.atStart}: ${u.reason}` }));
}
