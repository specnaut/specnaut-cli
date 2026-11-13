import { red } from "@std/fmt/colors";
import { guardToolCall } from "../../application/review_guard.ts";
import type { ReviewLock } from "../../application/review_ports.ts";
import { lockedCallOf } from "../../domain/review_lock.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { FsReviewLock } from "../../infrastructure/fs_review_lock.ts";
import { parsedInput, readHookInput } from "./hook_input.ts";

/**
 * `specnaut review guard`: what the Claude Code `PreToolUse` hook (`.claude/hooks/review-lock.sh`)
 * runs before each tool call once a review lock is held, the hook's input on stdin
 * (`review_lock.ts` says what the lock allows). Nothing is printed on stdout.
 *
 *   0  the session is not locked, or the lock allows the call
 *   2  refused: the lock does not allow the call, the lock could not be read, or the guard could
 *      not finish (any throw); or stdin is a terminal. Why on stderr, which Claude Code shows the
 *      session: exit 2 is the one code that stops the call.
 */
const EXIT = { allowed: 0, refused: 2 } as const;

export type ReviewGuardDeps = {
  readonly cwd: string;
  /** The hook's input, or `null` when stdin is a terminal. */
  readonly input: () => Promise<string | null>;
  readonly err: (s: string) => void;
  /** The lock of the repository `cwd` is in, `null` outside one. */
  readonly open: (cwd: string) => Promise<ReviewLock | null>;
};

export async function runReviewGuard(deps: ReviewGuardDeps = defaultDeps()): Promise<number> {
  try {
    const text = await deps.input();
    if (text === null) return refuse(deps, "reads a PreToolUse hook's input on stdin");
    const call = lockedCallOf(parsedInput(text));
    const outcome = await guardToolCall(await deps.open(deps.cwd), call);
    return outcome.kind === "allowed" ? EXIT.allowed : refuse(deps, outcome.why);
  } catch (err) {
    // Not swallowed: the failure is the refusal's reason.
    return refuse(
      deps,
      `the guard could not finish: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function refuse(deps: ReviewGuardDeps, why: string): number {
  deps.err(red(`error: specnaut review guard: ${terminalText(why)}`));
  return EXIT.refused;
}

function defaultDeps(): ReviewGuardDeps {
  return {
    cwd: Deno.cwd(),
    input: readHookInput,
    err: (s) => console.error(s),
    open: (cwd) => FsReviewLock.open(cwd),
  };
}
