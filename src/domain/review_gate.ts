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
 * Known limit: while a pass exists, this pattern is load-bearing. A line that starts a review
 * under a spelling it does not match, run right after a line it did match, would take that pass.
 * The gate stops a mistaken start; a session that writes the pass file itself is out of reach.
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
