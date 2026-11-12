import { red, yellow } from "@std/fmt/colors";
import { recordCheckout, type RecordCheckoutDeps } from "../../application/record_checkout.ts";
import { SESSION_RECORD_VAR } from "../../domain/session_record.ts";
import { type SessionStart, sessionStartOf } from "../../domain/session_record_json.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { exportToSession } from "../../infrastructure/claude_env_file.ts";
import { FsHeadReflog } from "../../infrastructure/fs_head_reflog.ts";
import { FsSessionRecords } from "../../infrastructure/fs_session_records.ts";
import { FsTreeWalker } from "../../infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { parsedInput, readHookInput } from "./hook_input.ts";

/**
 * `specnaut record-checkout`: what the Claude Code `SessionStart` hook
 * (`.claude/hooks/record-checkout.sh`) runs, the hook's input on stdin. It records the checkout the
 * session started on (`record_checkout.ts`) and appends `export SPECNAUT_SESSION_RECORD=<path>` to
 * the file `CLAUDE_ENV_FILE` names, so the session's later commands find its record:
 *
 *   0  taken, or the session's first record kept and its path exported again, or nothing to
 *      take: a source that keeps the record (`clear`, `compact`), or a folder in no git repository;
 *      old records of other sessions that could not be removed are a warning on stderr
 *   1  the record could not be taken, or a resumed or forked session has none, the reason on stderr
 *   2  usage: stdin is a terminal or not a `SessionStart` hook's input, or `CLAUDE_ENV_FILE` is unset
 *
 * Nothing is printed on stdout: a `SessionStart` hook's stdout is added to the session's context.
 */
const EXIT = { done: 0, failed: 1, usage: 2 } as const;

export type RecordCheckoutHandlerDeps = {
  readonly cwd: string;
  /** The hook's input, or `null` when stdin is a terminal. */
  readonly input: () => Promise<string | null>;
  readonly env: (name: string) => string | undefined;
  readonly err: (s: string) => void;
  readonly open: (cwd: string) => Promise<RecordCheckoutDeps | null>;
  readonly exportToSession: (envFile: string, name: string, value: string) => Promise<void>;
};

function defaultDeps(): RecordCheckoutHandlerDeps {
  return {
    cwd: Deno.cwd(),
    input: readHookInput,
    env: (name) => Deno.env.get(name),
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
    exportToSession,
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
  const envFile = deps.env("CLAUDE_ENV_FILE");
  if (!envFile) return fail(deps, EXIT.usage, "CLAUDE_ENV_FILE is not set: run it from the hook");
  return await take(deps, start, envFile);
}

/** The record taken in the repository the folder is in, and its path exported to the session. */
async function take(
  deps: RecordCheckoutHandlerDeps,
  start: SessionStart,
  envFile: string,
): Promise<number> {
  const opened = await deps.open(deps.cwd);
  if (opened === null) return EXIT.done;
  const outcome = await recordCheckout(opened, start);
  if (outcome.kind === "refused") return fail(deps, EXIT.failed, outcome.why);
  if (outcome.kind === "taken" || outcome.kind === "existing") {
    await deps.exportToSession(envFile, SESSION_RECORD_VAR, outcome.path);
    if (outcome.pruneFailure !== undefined) {
      const why = `old session records could not all be removed: ${outcome.pruneFailure}`;
      deps.err(yellow(`warning: specnaut record-checkout: ${terminalText(why)}`));
    }
  }
  return EXIT.done;
}

function fail(deps: RecordCheckoutHandlerDeps, code: number, why: string): number {
  deps.err(red(`error: specnaut record-checkout: ${terminalText(why)}`));
  return code;
}
