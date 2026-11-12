import { red } from "@std/fmt/colors";
import { recordCheckout, type RecordCheckoutDeps } from "../../application/record_checkout.ts";
import { SESSION_RECORD_VAR } from "../../domain/session_record.ts";
import { sessionStartOf } from "../../domain/session_record_json.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { exportToSession } from "../../infrastructure/claude_env_file.ts";
import { FsSessionRecords } from "../../infrastructure/fs_session_records.ts";
import { FsTreeWalker } from "../../infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";

/**
 * `specnaut record-checkout`: what the Claude Code `SessionStart` hook
 * (`.claude/hooks/record-checkout.sh`) runs, the hook's input on stdin. It records the checkout the
 * session started on (`record_checkout.ts`) and appends `export SPECNAUT_SESSION_RECORD=<path>` to
 * the file `CLAUDE_ENV_FILE` names, so the session's later commands find its record:
 *
 *   0  taken, or nothing to take: a source that keeps the record (`clear`, `compact`), or a folder
 *      in no git repository
 *   1  the record could not be taken, the reason on stderr
 *   2  usage: stdin is a terminal or not a `SessionStart` hook's input, or `CLAUDE_ENV_FILE` is unset
 *
 * Nothing is printed on stdout: a `SessionStart` hook's stdout is added to the session's context.
 */
const EXIT = { done: 0, failed: 1, usage: 2 } as const;

/** The most bytes of hook input read: far above any `SessionStart` payload. */
const MAX_INPUT_BYTES = 1024 * 1024;

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
    input: readInput,
    env: (name) => Deno.env.get(name),
    err: (s) => console.error(s),
    open: async (cwd) => {
      const records = await FsSessionRecords.open(cwd);
      if (records === null) return null;
      return { git: await GitObjects.open(cwd), checkout: new FsTreeWalker(cwd), records };
    },
    exportToSession,
  };
}

export async function runRecordCheckout(
  deps: RecordCheckoutHandlerDeps = defaultDeps(),
): Promise<number> {
  try {
    const text = await deps.input();
    if (text === null) return fail(deps, EXIT.usage, "reads a SessionStart hook's input on stdin");
    const start = sessionStartOf(parsed(text));
    if (start === null) {
      return fail(deps, EXIT.usage, "the input names no session id and source of a SessionStart");
    }
    const envFile = deps.env("CLAUDE_ENV_FILE");
    if (!envFile) return fail(deps, EXIT.usage, "CLAUDE_ENV_FILE is not set: run it from the hook");
    const opened = await deps.open(deps.cwd);
    if (opened === null) return EXIT.done;
    const outcome = await recordCheckout(opened, start);
    if (outcome.kind === "refused") return fail(deps, EXIT.failed, outcome.why);
    if (outcome.kind === "taken") {
      await deps.exportToSession(envFile, SESSION_RECORD_VAR, outcome.path);
    }
    return EXIT.done;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return fail(deps, EXIT.failed, `the record could not be taken: ${why}`);
  }
}

/** The input as JSON, or `undefined`: the caller refuses either way the payload is not one. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Not swallowed: an input that is not JSON is refused as a usage error by the caller.
    if (!(err instanceof SyntaxError)) throw err;
    return undefined;
  }
}

function fail(deps: RecordCheckoutHandlerDeps, code: number, why: string): number {
  deps.err(red(`error: specnaut record-checkout: ${terminalText(why)}`));
  return code;
}

async function readInput(): Promise<string | null> {
  if (Deno.stdin.isTerminal()) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Deno.stdin.readable) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error(`the input is over ${MAX_INPUT_BYTES} bytes`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(bytes);
}
