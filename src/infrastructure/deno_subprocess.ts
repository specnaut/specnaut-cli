import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../application/ports.ts";
import { type Dropped, filterGitPath, gitMissing } from "./git_path.ts";
import { programOnPath } from "./program_on_path.ts";

export type RunnerOptions = {
  /**
   * An `env` given is the child's whole environment, not additions to ours. A call that gives
   * none keeps ours either way.
   */
  readonly wholeEnv?: boolean;
};

/** The child's environment, the PATH entries kept in it, and the first entry left out. */
type Launch = {
  readonly env: Record<string, string>;
  readonly kept: string;
  readonly dropped?: Dropped;
};

/**
 * Programs started by their bare name (`gh`, the toolchain `specnaut check` probes), looked up
 * as every git the binary starts is: only on PATH entries outside the tree the program starts in
 * (`git_path.ts`), so a `gh` a checkout carries in its folders is never the one that runs. The
 * spawn is handed the file found there (`programOnPath`), never the bare name: Windows would look
 * in the working folder first.
 */
export class DenoSubprocessRunner implements SubprocessRunner {
  constructor(readonly options: RunnerOptions = {}) {}

  async run(cmd: string, args: string[], opts?: SubprocessOptions): Promise<SubprocessResult> {
    const { env, kept, dropped } = this.launch(opts);
    // No entry left finds nothing: a child with no PATH is looked up on ours, unfiltered.
    const program = programOnPath(cmd, kept);
    if (program === undefined) return notFound(gitMissing(missing(cmd, kept), dropped));
    const p = new Deno.Command(program, {
      args,
      cwd: opts?.cwd,
      env,
      clearEnv: true,
      stdin: opts?.stdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    });
    try {
      return await output(p.spawn(), opts?.stdin);
    } catch (err) {
      return failed(err, cmd, dropped);
    }
  }

  private launch(opts?: SubprocessOptions): Launch {
    const whole = this.options.wholeEnv === true && opts?.env !== undefined;
    const given = whole ? opts?.env : { ...Deno.env.toObject(), ...opts?.env };
    return outsideTree(given ?? {}, opts?.cwd ?? Deno.cwd());
  }
}

/**
 * `given` with its PATH kept outside the tree `cwd` is in, under one spelling: Windows would see
 * `Path` and `PATH` as two. No entry left, no PATH at all, never an empty one.
 */
function outsideTree(given: Record<string, string>, cwd: string): Launch {
  const entries = Object.entries(given);
  const rest = Object.fromEntries(entries.filter(([k]) => k.toUpperCase() !== "PATH"));
  const path = entries.findLast(([k]) => k.toUpperCase() === "PATH")?.[1] ?? "";
  const { kept, dropped } = filterGitPath(path, cwd);
  if (kept === "") return { env: rest, kept, dropped };
  return { env: { ...rest, PATH: kept }, kept, dropped };
}

/** Why `cmd` was not found on the entries `kept`. */
const missing = (cmd: string, kept: string) =>
  kept === "" ? "no PATH entry outside the repository" : `${cmd} is not on the PATH`;

async function output(child: Deno.ChildProcess, stdin?: string): Promise<SubprocessResult> {
  if (stdin) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const { code, stdout, stderr } = await child.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

/**
 * Synthesise POSIX-style exit codes for the failure modes that surface as exceptions on
 * `Deno.Command.spawn()`, so probes can render a clean fail/warn row instead of a stack trace.
 */
function failed(err: unknown, cmd: string, dropped: Dropped | undefined): SubprocessResult {
  // 127: not on the PATH, which names the entry left out: the program may sit there.
  if (err instanceof Deno.errors.NotFound) {
    return notFound(gitMissing(`${cmd} is not on the PATH`, dropped));
  }
  if (err instanceof Deno.errors.PermissionDenied || err instanceof Deno.errors.NotCapable) {
    // 126: the program exists but cannot be executed (chmod 000, --allow-run denial, SELinux).
    return { code: 126, stdout: "", stderr: `${cmd}: permission denied` };
  }
  throw err;
}

const notFound = (stderr: string): SubprocessResult => ({ code: 127, stdout: "", stderr });
