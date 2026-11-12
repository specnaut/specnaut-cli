import { isFullSha } from "./commit_sha.ts";
import { plainWords } from "./plain_command.ts";

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

/** The tools that dispatch an agent, `Task` being the name older harness versions give it. */
const DISPATCH_TOOLS: readonly string[] = ["Agent", "Task"];

/**
 * The scripts `phases/review-untrusted.md` runs, each with the flags it must carry there: every
 * one reads the exported head (`--head`), never this checkout's work, and the gate runner runs
 * only in the sandbox (`--sandbox`). A map, so a name like `constructor` is no script.
 */
const REVIEW_SCRIPTS = new Map<string, readonly string[]>([
  [".specnaut/scripts/audit/collect-audit-scope.sh", ["--head"]],
  [".specnaut/scripts/bash/size-ratchet.sh", ["--head"]],
  [".specnaut/scripts/bash/boundary-check.sh", ["--head"]],
  [".specnaut/scripts/bash/git-read.sh", ["--head"]],
  [".specnaut/scripts/bash/run-gate.sh", ["--head", "--sandbox"]],
]);

const LOCKED = "refused under the review lock: this session read a branch it cannot trust, so " +
  "until it ends only Read, Grep, Glob, the review seats and the review's own commands run; " +
  "start a new session for anything else";

/** Why the call is refused under the lock, or `null` when it runs. */
export function lockedCallRefusal(tool: string | null, input: unknown): string | null {
  if (tool !== null && READ_TOOLS.includes(tool)) return null;
  if (tool !== null && DISPATCH_TOOLS.includes(tool)) return dispatchRefusal(input);
  if (tool === "Bash") return commandRefusal(field(input, "command"));
  return `${tool ?? "a tool call naming no tool"} is ${LOCKED}`;
}

function dispatchRefusal(input: unknown): string | null {
  const seat = field(input, "subagent_type");
  if (typeof seat === "string" && REVIEW_SEATS.includes(seat)) return null;
  return `a dispatch to anything but a review seat (${REVIEW_SEATS.join(", ")}) is ${LOCKED}`;
}

function commandRefusal(command: unknown): string | null {
  const words = typeof command === "string" ? plainWords(command) : null;
  if (words === null) {
    return "a command that is not one program and its words (no `;`, `&&`, `|`, `$`, " +
      `redirection, glob or newline; every value written out) is ${LOCKED}`;
  }
  return isReviewCommand(words) ? null : `\`${words.join(" ")}\` is ${LOCKED}`;
}

/** Whether `words` are one of the commands `phases/review-untrusted.md` runs under the lock. */
function isReviewCommand(words: readonly string[]): boolean {
  const [program, first, second, third] = words;
  if (program === "mktemp") return words.length === 2 && first === "-d";
  if (program === "bash") {
    const flags = REVIEW_SCRIPTS.get(first);
    return flags !== undefined && flags.every((f) => words.includes(f));
  }
  if (program !== "specnaut") return false;
  if (first === "verify-scripts") return words.length === 2;
  if (first === "sandbox") return second === "exec" || (second === "probe" && words.length === 3);
  return first === "review" && second === "end" && words.length === 4 && isFullSha(third);
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
