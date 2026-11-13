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
import type { ReflogMark } from "./head_reflog.ts";
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
 * The `SessionStart` sources that name the session's record: each one is a harness process that
 * has just loaded the checkout. Only {@link TAKING_SOURCE} takes it; `resume` and `fork` find the
 * one the session's start took, and without one are refused: a record taken later would describe
 * the checkout as it is then, not the one the session first loaded. `clear` and `compact` load
 * nothing anew and leave the record as it was. Any other source names none: a missing record
 * refuses, where a wrong one would pass.
 */
export const RECORDED_SOURCES: ReadonlySet<string> = new Set(["startup", "resume", "fork"]);

/** The one source that takes a session's record: the session's start. */
export const TAKING_SOURCE = "startup";

/** A session id's shape, which `.claude/hooks/review-lock.sh` matches with the same pattern. */
export const SESSION_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";

/** A session id as the record's file name: what the harness issues, never a path of its own. */
export function isSessionId(id: string): boolean {
  return new RegExp(`^${SESSION_ID_PATTERN}$`).test(id);
}

/**
 * How long a record unused is kept: a write removes the folder's other records last used longer
 * ago, so no stale record stays in it. Using one renews it: a resume that finds it, and a check
 * that reads it. Thirty days is Claude Code's default `cleanupPeriodDays`, the life of a session's
 * transcript.
 */
export const RECORD_RETENTION_DAYS = 30;
export const RECORD_RETENTION_MS = RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * The reasons the record adds to the check's. Every one about the record itself is filed under
 * `path`. The record is the one of the session id the harness gave the checking hook on its stdin,
 * never one a variable names: a `/clear` starts a session under a new id, which takes no record.
 */
export const SESSION_REASON = {
  path: "session-start record",
  none: "the hook's input names no session id: only a Claude Code hook is given one, and only " +
    "that session's own record is read; start a new Claude Code session",
  missing: "this session has no session-start record: only a Claude Code session whose " +
    "SessionStart hook ran `specnaut record-checkout` takes one, a `/clear` starts a session " +
    `that takes none, and a record unused for ${RECORD_RETENTION_DAYS} days is removed; ` +
    "start a new session",
  unreadable: "the session-start record cannot be read",
  malformed: "the session-start record cannot be parsed",
  headUnknown: "the session started on a commit this repository does not have",
  atStart: "at session start",
  visited: "HEAD was on this commit during the session, and the base's tip lacks it",
  reflogUnreadable: "HEAD's reflog cannot be read",
  reflogRewritten: "HEAD's reflog no longer holds the entry the session started at, or is not " +
    "a reflog git wrote: what HEAD was on since cannot be told",
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
