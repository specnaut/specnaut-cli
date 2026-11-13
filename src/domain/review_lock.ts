import { SEPARATOR } from "@std/path";
import { plainWords } from "./plain_command.ts";
import { isReviewScript } from "./review_lock_scripts.ts";

/**
 * The review lock: once `specnaut review start` has exported a branch this session cannot trust,
 * the branch's text is in the session's context, and the session holds the user's credentials.
 * From then until the session ends, a Claude Code `PreToolUse` hook (`specnaut review guard`)
 * lets a tool call run only when this module allows it, and refuses every other: nothing the
 * branch says can lead the session to push, write to the tracker, merge or land. Deny by default:
 * a tool this list does not name is refused, every MCP tool and WebFetch included.
 */

/**
 * The review seats `phases/review.md` § Seat selection names, the only agents dispatched under
 * the lock. A seat's own tool calls meet the same hook, under the same session's lock.
 */
export const REVIEW_SEATS: readonly string[] = [
  "code-reviewer",
  "security-expert",
  "accessibility-expert",
  "dependency-expert",
  "performance-expert",
];

/** The tools that only read: what the seats and the session review with. */
const READ_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

/**
 * The harness's bookkeeping that stays in the session: `TodoWrite`'s list lives in the session that
 * writes it and reaches no one else, so the branch's text cannot carry anything out through it. The
 * `Task*` tools (`TaskCreate`, `TaskUpdate`, ...) are not here, and so are refused: their list may be
 * shared with other sessions, a channel out of the one the hook watches.
 */
const SESSION_TOOLS: readonly string[] = ["TodoWrite"];

/** The tools that dispatch an agent, `Task` being the name older harness versions give it. */
const DISPATCH_TOOLS: readonly string[] = ["Agent", "Task"];

const LOCKED = "refused under the review lock: this session read a branch it cannot trust, so " +
  "until it ends only Read, Grep, Glob, TodoWrite, the review seats and the review's own commands " +
  "run; start a new session for anything else";

/**
 * What a session's lock entry records of its review, each `null` where the entry does not say:
 * the head `specnaut review start` exported, and the folder it made for the review's logs (its
 * real path). An entry written before the export, or one that cannot be read, says neither, and
 * then no command that needs them runs.
 */
export type LockedReview = { readonly head: string | null; readonly logs: string | null };

export const UNKNOWN_REVIEW: LockedReview = { head: null, logs: null };

/**
 * Why the call is refused under the lock of `review`, or `null` when it runs. `log` is where the
 * `--log` file `lockedLogOf` names resolves (its folder's real path), `null` when it does not.
 */
export function lockedCallRefusal(
  tool: string | null,
  input: unknown,
  review: LockedReview,
  log: string | null,
): string | null {
  if (tool !== null && (READ_TOOLS.includes(tool) || SESSION_TOOLS.includes(tool))) return null;
  if (tool !== null && DISPATCH_TOOLS.includes(tool)) return dispatchRefusal(input);
  if (tool === "Bash") return commandRefusal(field(input, "command"), review, log);
  return `${tool ?? "a tool call naming no tool"} is ${LOCKED}`;
}

/**
 * What a dispatch under the lock may carry: the seat, and what it is told. Anything else (where it
 * runs, in the background, on which model) is a way out of the session the hook watches.
 */
const DISPATCH_KEYS: readonly string[] = ["subagent_type", "description", "prompt"];

function dispatchRefusal(input: unknown): string | null {
  const seat = field(input, "subagent_type");
  if (typeof seat !== "string" || !REVIEW_SEATS.includes(seat)) {
    return `a dispatch to anything but a review seat (${REVIEW_SEATS.join(", ")}) is ${LOCKED}`;
  }
  const extra = Object.keys(input as object).filter((k) => !DISPATCH_KEYS.includes(k));
  if (extra.length === 0) return null;
  return `a dispatch carrying ${extra.join(", ")} (only ${DISPATCH_KEYS.join(", ")}) is ${LOCKED}`;
}

function commandRefusal(command: unknown, review: LockedReview, log: string | null) {
  const words = typeof command === "string" ? plainWords(command) : null;
  if (words === null) {
    return "a command that is not one program and its words (no `;`, `&&`, `|`, `$`, " +
      `redirection, glob or newline; every value written out) is ${LOCKED}`;
  }
  return isReviewCommand(words, review, log) ? null : `\`${words.join(" ")}\` is ${LOCKED}`;
}

/** Whether `words` are one of the commands `phases/review-untrusted.md` runs under the lock. */
function isReviewCommand(words: readonly string[], review: LockedReview, log: string | null) {
  const [program, first, second, third] = words;
  if (program === "bash") return isReviewScript(words, review);
  if (program !== "specnaut") return false;
  if (first === "verify-scripts") return words.length === 2;
  if (first === "sandbox" && second === "probe") return words.length === 3;
  if (first === "sandbox") return isLockedExec(words, review, log);
  return first === "review" && second === "end" && words.length === 4 && review.head !== null &&
    third === review.head;
}

/**
 * `specnaut sandbox exec <head> --log <file> -- <command>...`, exactly: the head this session's
 * review exported, a log file below the folder `review start` made for it, and no `--toolchain`,
 * which would mount folders no one recorded. A log anywhere else would be a new file on the host,
 * its content the branch's.
 */
function isLockedExec(words: readonly string[], review: LockedReview, log: string | null) {
  const [, , sub, sha, flag, , dash] = words;
  return sub === "exec" && words.length >= 8 && flag === "--log" && dash === "--" &&
    review.head !== null && sha === review.head && log !== null && review.logs !== null &&
    isInsideFolder(log, review.logs);
}

/** The `--log` file of a call of `sandbox exec`'s locked shape, for the guard to resolve. */
export function lockedLogOf(tool: string | null, input: unknown): string | null {
  const command = tool === "Bash" ? field(input, "command") : undefined;
  const words = typeof command === "string" ? plainWords(command) : null;
  if (words === null || words.slice(0, 3).join(" ") !== "specnaut sandbox exec") return null;
  return words[4] === "--log" && words[6] === "--" ? words[5] ?? null : null;
}

/**
 * Why `specnaut sandbox exec` itself refuses a run while `held`, the reviews whose logs folder the
 * run may use (`execLockRefusal` says which), is not empty: a run some script starts reaches no
 * hook, so the binary holds the same line. `log` is where its `--log` resolves, `null` for none.
 * With no lock it runs as it always did.
 */
export function lockedExecRefusal(
  held: readonly LockedReview[],
  toolchain: readonly string[],
  log: string | null,
): string | null {
  if (held.length === 0) return null;
  if (toolchain.length > 0) return `--toolchain is ${LOCKED}`;
  if (log !== null && held.some((r) => r.logs !== null && isInsideFolder(log, r.logs))) return null;
  return "a run with no --log, or a --log outside the folder `specnaut review start` made for " +
    `the review's logs, is ${LOCKED}`;
}

/**
 * Whether `path` lies below `folder`, both real paths, by the host's own separator: on POSIX a `\`
 * is a character of a name, so `<logs>\x` is a file beside `<logs>`, not in it.
 */
export function isInsideFolder(path: string, folder: string): boolean {
  const base = folder.endsWith(SEPARATOR) ? folder.slice(0, -SEPARATOR.length) : folder;
  return path.length > base.length + 1 && path.startsWith(base + SEPARATOR);
}

function field(v: unknown, key: string): unknown {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)[key]
    : undefined;
}

/**
 * What the guard reads of a `PreToolUse` hook's input: the session id and the tool's name, each
 * `null` when the input does not carry it as a string, and the tool's own input as given.
 */
export function lockedCallOf(payload: unknown): {
  sessionId: string | null;
  tool: string | null;
  input: unknown;
} {
  const text = (v: unknown) => typeof v === "string" ? v : null;
  return {
    sessionId: text(field(payload, "session_id")),
    tool: text(field(payload, "tool_name")),
    input: field(payload, "tool_input"),
  };
}
