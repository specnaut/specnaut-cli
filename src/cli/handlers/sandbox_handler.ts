import { red } from "@std/fmt/colors";
import type { ExecOutcome, ExecRequest } from "../../application/sandbox_exec.ts";
import type { RunOutcome } from "../../application/sandbox_ports.ts";
import {
  assessBackends,
  type BackendProbe,
  chooseBackend,
  type SandboxedBackend,
} from "../../domain/sandbox.ts";
import {
  CAP_NAMES,
  capsWithout,
  type SandboxLimits,
  STOP_LIMIT,
} from "../../domain/sandbox_limits.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import type { SandboxIntent } from "../intent.ts";
import { sandboxHostDeps } from "./sandbox_host_deps.ts";

type SandboxExecIntent = Extract<SandboxIntent, { sub: "exec" }>;

/**
 * `specnaut sandbox`: the one entry through which a branch's code is run. The output contract and
 * the exit codes live here:
 *
 *   probe  one line per backend in selection order, `AVAILABLE <backend>` or
 *          `UNAVAILABLE <backend> <reason>`; under an available one, `UNCAPPED <backend> <cap,...>`
 *          when it runs without a resource cap, and `LIMIT <backend> <what>` when stopping a run
 *          on it cannot reach every process. Then `BACKEND <backend|static>`: the one a run would
 *          use. Exit 0 when a backend is available, 1 when a run would be static.
 *   exec   the command's own exit code, whatever caps it ran without; after a run, its backend's
 *          `UNCAPPED` and `LIMIT` lines on stderr, prefixed `notice: specnaut sandbox exec: `, so
 *          stdout stays the command's. 124: the wall clock ran out and the run was stopped;
 *          a stop that failed (a container left behind) is said on a second line.
 *          125: nothing ran (static only, no such export, a layout the policy refuses, a
 *          launcher that could not start, or a run the checkout's review lock refuses: under it,
 *          a `--log` below the folder `review start` made and no `--toolchain`). Every 124 and 125
 *          says why on stderr; the command's own
 *          output is passed through unchanged, or, with `--log <file>`, written to that new file
 *          with every control but tab and line feed dropped and cut at `LOG_CAP_BYTES`: a review
 *          briefs the file by path, and reads the result from the exit code alone.
 *
 * Usage errors are the parser's: exit 2 with the help, before anything is probed.
 */
const EXIT = { available: 0, staticOnly: 1, timedOut: 124, notRun: 125 } as const;

export type SandboxDeps = {
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly probe: () => Promise<BackendProbe>;
  readonly exec: (request: ExecRequest & { readonly log: string | null }) => Promise<ExecOutcome>;
  /** Why the checkout's review lock refuses the run (`execLockRefusal`), or `null`. */
  readonly lockRefusal: (request: SandboxExecIntent) => Promise<string | null>;
};

export async function runSandbox(
  intent: SandboxIntent,
  deps: SandboxDeps = sandboxHostDeps(),
): Promise<number> {
  if (intent.sub === "probe") return probe(deps);
  try {
    const locked = await deps.lockRefusal(intent);
    if (locked !== null) return notRun(deps, locked);
    return answer(await deps.exec(intent), deps);
  } catch (err) {
    return notRun(deps, err instanceof Error ? err.message : String(err));
  }
}

async function probe(deps: SandboxDeps): Promise<number> {
  const found = await deps.probe();
  const lines = assessBackends(found).flatMap((s) =>
    "offered" in s
      ? [`AVAILABLE ${s.kind}`, ...gaps(s.kind, capsWithout(s.offered))]
      : [`UNAVAILABLE ${s.kind} ${terminalText(s.why)}`]
  );
  const chosen = chooseBackend(found).kind;
  deps.out([...lines, `BACKEND ${chosen}`].join("\n"));
  return chosen === "static" ? EXIT.staticOnly : EXIT.available;
}

/**
 * What a run on `backend` goes without, one line each, the same on probe and after exec: the caps
 * it runs without (`UNCAPPED`), then what stopping it cannot reach (`LIMIT`).
 */
function gaps(backend: SandboxedBackend, unenforced: readonly (keyof SandboxLimits)[]): string[] {
  const caps = unenforced.map((cap) => CAP_NAMES[cap]).join(",");
  const limit = STOP_LIMIT[backend];
  return [
    ...(caps === "" ? [] : [`UNCAPPED ${backend} ${caps}`]),
    ...(limit === null ? [] : [`LIMIT ${backend} ${limit}`]),
  ];
}

function answer(outcome: ExecOutcome, deps: SandboxDeps): number {
  if (outcome.kind === "not_run") return notRun(deps, outcome.why);
  for (const line of gaps(outcome.backend, outcome.unenforced)) {
    deps.err(`notice: specnaut sandbox exec: ${line}`);
  }
  const run = outcome.outcome;
  return run.kind === "exited" ? exited(run, deps) : timedOut(run, deps);
}

/** The command's own code; a container its run left behind is warned of first. */
function exited(run: Extract<RunOutcome, { kind: "exited" }>, deps: SandboxDeps): number {
  if (run.removalFailed !== undefined) {
    const why = terminalText(run.removalFailed);
    deps.err(`warning: specnaut sandbox exec: the sandbox's container may be left: ${why}`);
  }
  return run.code;
}

function timedOut(run: Extract<RunOutcome, { kind: "timed_out" }>, deps: SandboxDeps): number {
  deps.err(red(`error: specnaut sandbox exec: the wall clock ran out after ${run.seconds} s`));
  if (run.haltFailed !== undefined) {
    const why = terminalText(run.haltFailed);
    deps.err(red(`error: specnaut sandbox exec: the run was not stopped cleanly: ${why}`));
  }
  return EXIT.timedOut;
}

function notRun(deps: SandboxDeps, why: string): number {
  deps.err(red(`error: specnaut sandbox exec: not run: ${terminalText(why)}`));
  return EXIT.notRun;
}
