/**
 * The checkout check in front of a review that cannot trust its branch. The verdict is taken by
 * `specnaut review gate`, which Claude Code runs as a `PreToolUse` hook: the only process the
 * session's own commands cannot hand a session id, so the record it judges is the session's own.
 * The command that starts the review, `specnaut review start`, runs only after the hook let it
 * through, and only on the pass the hook left: a project whose hook is not installed, or a harness
 * that runs none, gets no pass, and the review does not start.
 */

/**
 * Whether a shell command line starts such a review: the words `review start`, wherever they are
 * on the line. Wider than the command itself on purpose: a line it takes wrongly only costs a
 * check. A pass lives only until the next command, every other one removing it, and the start
 * refuses any option or `--`, so a line the gate misses meets a start that finds no pass.
 *
 * A line it matches and lets through is rewritten to carry the pass's nonce ({@link passedCommand}),
 * and the start takes only the pass its nonce names: a start the gate never saw carries none. The
 * gate stops a mistaken start; a session that writes the pass file itself is out of reach.
 */
export function startsReview(command: string): boolean {
  return /(^|[^\w-])review\s+start($|[^\w-])/.test(command);
}

/**
 * How long a pass stays good: past the gate, Claude Code may still ask the user to allow the
 * command, and the start must not depend on how fast they answer. A pass is taken once.
 */
export const PASS_TTL_MS = 15 * 60 * 1000;

/** Whether a pass granted at `grantedAt` still starts a review at `now`; a clock that ran back never does. */
export function passHolds(grantedAt: number, now: number): boolean {
  return Number.isFinite(grantedAt) && grantedAt <= now && now - grantedAt <= PASS_TTL_MS;
}

/**
 * The checkout a verdict was taken on, as the start reads it again: HEAD's commit, the branch HEAD
 * names (`null` when detached), and the SHA-256 of HEAD's reflog, which grows each time HEAD moves,
 * so a branch checked out and left again between the two still reads as changed. A line that
 * checks out another branch before it starts a review, past the gate that ran before the line,
 * starts nothing. Each field is `null` where git does not say. A file edited in the folder while
 * HEAD stays put does not change it.
 */
export type CheckoutState = {
  readonly head: string | null;
  readonly ref: string | null;
  readonly reflog: string | null;
};

/** Whether the start reads the checkout as the verdict did. */
export function sameCheckout(judged: CheckoutState, now: CheckoutState): boolean {
  return judged.head === now.head && judged.ref === now.ref && judged.reflog === now.reflog;
}

/** What the gate says when the check itself could not finish: a refusal, never a pass. */
export function unfinishedCheck(err: unknown): string {
  const why = err instanceof Error ? err.message : String(err);
  return `the checkout check could not finish: ${why}`;
}

/**
 * What the gate reads of a `PreToolUse` hook's input: the session id and the shell command, each
 * `null` when the input does not carry it as a string. A tool that runs no shell command is not
 * gated; a session id is judged by the record reader, which refuses one that is not an id.
 */
export function toolCallOf(payload: unknown): {
  sessionId: string | null;
  command: string | null;
} {
  const field = (v: unknown, key: string): unknown =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)[key]
      : undefined;
  const text = (v: unknown) => typeof v === "string" ? v : null;
  return {
    sessionId: text(field(payload, "session_id")),
    command: text(field(field(payload, "tool_input"), "command")),
  };
}

/** The variable a passed line exports for the start: the nonce of the pass it was let through on. */
export const REVIEW_PASS_VAR = "SPECNAUT_REVIEW_PASS";

/** A pass nonce as the gate makes one: 32 lowercase hex digits; anything else names no pass. */
export function isPassNonce(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{32}$/.test(value);
}

/**
 * The line the gate lets through: the pass's nonce exported first, so the start carries it however
 * the line runs it (a command substitution included). The start takes only the pass that names its
 * nonce, so a start run outside the hook, or from a checkout whose pass another line was given,
 * takes nothing. A line that cannot follow `export …;` fails to parse and starts nothing.
 */
export function passedCommand(command: string, nonce: string): string {
  return `export ${REVIEW_PASS_VAR}=${nonce}; ${command}`;
}

/**
 * The hook's answer that runs the passed line instead: the tool's input as the harness gave it,
 * its `command` replaced, and the decision `ask`. Claude Code documents `updatedInput` with an
 * `allow` or `ask` decision; with none, whether the rewritten input runs is not stated, and a
 * line that ran unrewritten would carry no nonce and take no pass. `ask` shows the user the line
 * as it will run, at the cost of one prompt per untrusted review start; `allow` would skip the
 * user's own permission rules for that line.
 */
export function passedHookOutput(payload: unknown, command: string): string {
  const input = record(record(payload).tool_input);
  const updatedInput = { ...input, command };
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: PASS_REASON,
      updatedInput,
    },
  });
}

/** What the prompt says of the passed line. */
export const PASS_REASON =
  "specnaut review start, with the review pass's nonce exported first: confirm to start the review";

const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
