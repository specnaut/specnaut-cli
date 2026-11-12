import { red, yellow } from "@std/fmt/colors";
import { recordCheckout, type RecordCheckoutDeps } from "../../application/record_checkout.ts";
import { type SessionStart, sessionStartOf } from "../../domain/session_record_json.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { FsHeadReflog } from "../../infrastructure/fs_head_reflog.ts";
import { FsSessionRecords } from "../../infrastructure/fs_session_records.ts";
import { FsTreeWalker } from "../../infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { parsedInput, readHookInput } from "./hook_input.ts";

/**
 * `specnaut record-checkout`: what the Claude Code `SessionStart` hook
 * (`.claude/hooks/record-checkout.sh`) runs, the hook's input on stdin. It records the checkout the
 * session started on (`record_checkout.ts`), under the session id the hook's input names: a later
 * check finds the record by the id its own hook input names, so nothing is exported to the session,
 * whose commands could set any variable they like:
 *
 *   0  taken, or the session's first record kept, or nothing to take: a source that keeps the
 *      record (`clear`, `compact`), or a folder in no git repository; old records of other sessions
 *      that could not be removed are a warning on stderr
 *   1  the record could not be taken, or a resumed or forked session has none, the reason on stderr
 *   2  usage: stdin is a terminal or not a `SessionStart` hook's input
 *
 * Nothing is printed on stdout: a `SessionStart` hook's stdout is added to the session's context.
 */
const EXIT = { done: 0, failed: 1, usage: 2 } as const;

export type RecordCheckoutHandlerDeps = {
  readonly cwd: string;
  /** The hook's input, or `null` when stdin is a terminal. */
  readonly input: () => Promise<string | null>;
  readonly err: (s: string) => void;
  readonly open: (cwd: string) => Promise<RecordCheckoutDeps | null>;
};

function defaultDeps(): RecordCheckoutHandlerDeps {
  return {
    cwd: Deno.cwd(),
    input: readHookInput,
    err: (s) => console.error(s),
    open: async (cwd) => {
      const records = await FsSessionRecords.open(cwd);
      if (records === null) return null;
      return {
        git: await GitObjects.open(cwd),
        reflog: await FsHeadReflog.open(cwd),
        checkout: new FsTreeWalker(cwd),
        records,
      };
    },
  };
}

export async function runRecordCheckout(
  deps: RecordCheckoutHandlerDeps = defaultDeps(),
): Promise<number> {
  try {
    return await fromHook(deps);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return fail(deps, EXIT.failed, `the record could not be taken: ${why}`);
  }
}

/** The hook's input and environment checked, then the record taken. */
async function fromHook(deps: RecordCheckoutHandlerDeps): Promise<number> {
  const text = await deps.input();
  if (text === null) return fail(deps, EXIT.usage, "reads a SessionStart hook's input on stdin");
  const start = sessionStartOf(parsedInput(text));
  if (start === null) {
    return fail(deps, EXIT.usage, "the input names no session id and source of a SessionStart");
  }
  return await take(deps, start);
}

/** The record taken in the repository the folder is in. */
async function take(deps: RecordCheckoutHandlerDeps, start: SessionStart): Promise<number> {
  const opened = await deps.open(deps.cwd);
  if (opened === null) return EXIT.done;
  const outcome = await recordCheckout(opened, start);
  if (outcome.kind === "refused") return fail(deps, EXIT.failed, outcome.why);
  if (outcome.kind !== "kept" && outcome.pruneFailure !== undefined) {
    const why = `old session records could not all be removed: ${outcome.pruneFailure}`;
    deps.err(yellow(`warning: specnaut record-checkout: ${terminalText(why)}`));
  }
  return EXIT.done;
}

function fail(deps: RecordCheckoutHandlerDeps, code: number, why: string): number {
  deps.err(red(`error: specnaut record-checkout: ${terminalText(why)}`));
  return code;
}
