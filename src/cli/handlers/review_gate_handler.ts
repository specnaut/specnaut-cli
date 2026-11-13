import { red } from "@std/fmt/colors";
import { type GateDeps, type GateOutcome, gateReview } from "../../application/review_gate.ts";
import { verifyCheckout } from "../../application/verify_checkout.ts";
import { passedHookOutput, toolCallOf, unfinishedCheck } from "../../domain/review_gate.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { FsHeadReflog } from "../../infrastructure/fs_head_reflog.ts";
import { FsReviewPass } from "../../infrastructure/fs_review_pass.ts";
import { FsScriptTreeWalker } from "../../infrastructure/fs_script_tree_walker.ts";
import { FsSessionRecords } from "../../infrastructure/fs_session_records.ts";
import { FsTreeWalker } from "../../infrastructure/fs_tree_walker.ts";
import { checkoutState } from "../../infrastructure/git_checkout_state.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { CORE_BUNDLE } from "../../templates_bundle.ts";
import { findHarness } from "../harnesses.ts";
import { parsedInput, readHookInput } from "./hook_input.ts";

/**
 * `specnaut review gate`: what the Claude Code `PreToolUse` hook (`.claude/hooks/review-gate.sh`)
 * runs before each shell command, the hook's input on stdin (`review_gate.ts` says what it
 * gates). Stdout is empty, but for a passed line: the hook's JSON answer, whose `updatedInput` is
 * the line rewritten to carry the pass's nonce (`passedCommand`).
 *
 *   0  the command starts no review (an input naming no shell command included), or the
 *      session's checkout holds, the pass is left, and the passed line is on stdout
 *   2  refused: the checkout does not hold, or the check could not finish (no git repository,
 *      a record that cannot be read, any throw); or stdin is a terminal. Why on stderr, which
 *      Claude Code shows the session: exit 2 is the one code that stops the command.
 */
const EXIT = { allowed: 0, refused: 2 } as const;

export type ReviewGateDeps = {
  readonly cwd: string;
  /** The hook's input, or `null` when stdin is a terminal. */
  readonly input: () => Promise<string | null>;
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  /** The gate's adapters for the repository `cwd` is in, opened only when a command is gated. */
  readonly open: (cwd: string) => GateDeps;
};

export async function runReviewGate(deps: ReviewGateDeps = defaultDeps()): Promise<number> {
  try {
    const text = await deps.input();
    if (text === null) return refuse(deps, ["reads a PreToolUse hook's input on stdin"]);
    const payload = parsedInput(text);
    const outcome = await gateReview(deps.open(deps.cwd), toolCallOf(payload));
    if (outcome.kind === "passed") deps.out(passedHookOutput(payload, outcome.command));
    return answer(deps, outcome);
  } catch (err) {
    return refuse(deps, [unfinishedCheck(err)]);
  }
}

function answer(deps: ReviewGateDeps, outcome: GateOutcome): number {
  if (outcome.kind === "not_gated" || outcome.kind === "passed") return EXIT.allowed;
  const reasons = outcome.reasons.map((u) => `${terminalText(u.path)}: ${terminalText(u.reason)}`);
  return refuse(deps, [...reasons, outcome.advice]);
}

function refuse(deps: ReviewGateDeps, lines: readonly string[]): number {
  const said = ["the checkout does not hold for a review that cannot trust its branch", ...lines];
  deps.err(red(`error: specnaut review gate: ${said.map(terminalText).join("\n  ")}`));
  return EXIT.refused;
}

function defaultDeps(): ReviewGateDeps {
  return {
    cwd: Deno.cwd(),
    input: readHookInput,
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    open: openGate,
  };
}

/** A pass nonce: 128 bits from the platform's secure source, as 32 lowercase hex digits. */
export function newPassNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The gate's real adapters, opened on first use: the checkout check reads the record of the
 * session id it is given, and only from this worktree's git directory.
 */
export function openGate(cwd: string): GateDeps {
  let opening: Promise<{ records: FsSessionRecords; pass: FsReviewPass }> | undefined;
  const opened = () => opening ??= openRepository(cwd);
  return {
    verify: async (sessionId) =>
      await verifyCheckout(await checkDeps(cwd, (await opened()).records, sessionId), null),
    // The repository first, so a folder in none is refused as such.
    checkout: async () => await opened().then(() => checkoutState(cwd)),
    pass: {
      grant: async (tip, checkout, session, nonce) =>
        await (await opened()).pass.grant(tip, checkout, session, nonce),
      // Not the repository's records: removing a pass needs the pass alone, and
      // outside a repository there is none to remove.
      revoke: async () => await (await FsReviewPass.open(cwd))?.revoke(),
      take: async () => await (await opened()).pass.take(),
    },
    nonce: newPassNonce,
  };
}

async function openRepository(cwd: string) {
  const [records, pass] = await Promise.all([FsSessionRecords.open(cwd), FsReviewPass.open(cwd)]);
  if (records === null || pass === null) throw new Error("this folder is in no git repository");
  return { records, pass };
}

async function checkDeps(cwd: string, records: FsSessionRecords, sessionId: string) {
  return {
    git: await GitObjects.open(cwd),
    reflog: await FsHeadReflog.open(cwd),
    walker: new FsScriptTreeWalker(cwd),
    checkout: new FsTreeWalker(cwd),
    session: records.reader(sessionId),
    core: CORE_BUNDLE,
    findHarness,
  };
}
