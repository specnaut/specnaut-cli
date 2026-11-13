import { red } from "@std/fmt/colors";
import { execLockRefusal } from "../../application/review_guard.ts";
import {
  type ExecDeps,
  execInSandbox,
  type ExecOutcome,
  type ExecRequest,
} from "../../application/sandbox_exec.ts";
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
import { userBus } from "../../domain/sandbox_args.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { type CappedLog, openCappedLog } from "../../infrastructure/capped_log.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { readDevcontainerImage } from "../../infrastructure/devcontainer_image.ts";
import { FsSandboxHost } from "../../infrastructure/fs_sandbox_host.ts";
import { FsReviewLock, realLogPath } from "../../infrastructure/fs_review_lock.ts";
import { exportCacheRoot } from "../../infrastructure/fs_tree_export.ts";
import { DenoProcessLauncher } from "../../infrastructure/sandbox_process.ts";
import { HostBackendProber } from "../../infrastructure/sandbox_probe.ts";
import { runnerFor } from "../../infrastructure/sandbox_runners.ts";
import type { SandboxIntent } from "../intent.ts";

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
  deps: SandboxDeps = defaultDeps(),
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
  if (outcome.outcome.kind === "exited") return outcome.outcome.code;
  const { seconds, haltFailed } = outcome.outcome;
  deps.err(red(`error: specnaut sandbox exec: the wall clock ran out after ${seconds} s`));
  if (haltFailed !== undefined) {
    const why = terminalText(haltFailed);
    deps.err(red(`error: specnaut sandbox exec: the run was not stopped cleanly: ${why}`));
  }
  return EXIT.timedOut;
}

function notRun(deps: SandboxDeps, why: string): number {
  deps.err(red(`error: specnaut sandbox exec: not run: ${terminalText(why)}`));
  return EXIT.notRun;
}

function defaultDeps(): SandboxDeps {
  const subprocess = new DenoSubprocessRunner();
  const checkout = () => checkoutRoot(subprocess);
  const { os, arch } = Deno.build;
  const image = async () => readDevcontainerImage(await checkout());
  // The engines are asked with the environment a run gives them, and nothing of ours beside it.
  const prober = new HostBackendProber(
    new DenoSubprocessRunner({ wholeEnv: true }),
    { os, arch },
    image,
  );
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    probe: () => prober.probe(),
    lockRefusal: async (request) =>
      await execLockRefusal(await FsReviewLock.open(Deno.cwd()), request, realLogPath),
    exec: async (request) => {
      const log = request.log === null ? null : await openCappedLog(request.log);
      try {
        return await execInSandbox(execDeps(prober, checkout, log), request);
      } finally {
        await log?.close();
      }
    },
  };
}

/** The real host's folders and runners; bubblewrap is found on our PATH, as the probe found it. */
function execDeps(
  prober: HostBackendProber,
  checkout: () => Promise<string>,
  log: CappedLog | null,
): ExecDeps {
  const { os, arch } = Deno.build;
  const env = (name: string) => Deno.env.get(name);
  const path = env("PATH") ?? "/usr/bin:/bin";
  return {
    prober,
    host: new FsSandboxHost(exportCacheRoot(os, env), env("HOME") ?? "", checkout),
    runnerFor: (backend) =>
      runnerFor(backend, new DenoProcessLauncher(log?.out, log?.err), {
        arch,
        path,
        bus: userBus(env),
      }),
  };
}

/** The checkout the command runs from: the repository's top, or the folder itself outside one. */
async function checkoutRoot(subprocess: DenoSubprocessRunner): Promise<string> {
  const args = ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"];
  const top = await subprocess.run("git", args, { cwd: Deno.cwd() });
  return await Deno.realPath(top.code === 0 ? top.stdout.trim() : Deno.cwd());
}
