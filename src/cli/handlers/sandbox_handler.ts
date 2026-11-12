import { red } from "@std/fmt/colors";
import {
  type ExecDeps,
  execInSandbox,
  type ExecOutcome,
  type ExecRequest,
} from "../../application/sandbox_exec.ts";
import { assessBackends, type BackendProbe, chooseBackend } from "../../domain/sandbox.ts";
import { terminalText } from "../../domain/terminal_text.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { readDevcontainerImage } from "../../infrastructure/devcontainer_image.ts";
import { FsSandboxHost } from "../../infrastructure/fs_sandbox_host.ts";
import { exportCacheRoot } from "../../infrastructure/fs_tree_export.ts";
import { DenoProcessLauncher } from "../../infrastructure/sandbox_process.ts";
import { HostBackendProber } from "../../infrastructure/sandbox_probe.ts";
import { runnerFor } from "../../infrastructure/sandbox_runners.ts";
import type { SandboxIntent } from "../intent.ts";

/**
 * `specnaut sandbox`: the one entry through which a branch's code is run. The output contract and
 * the exit codes live here:
 *
 *   probe  one line per backend in selection order, `AVAILABLE <backend>` or
 *          `UNAVAILABLE <backend> <reason>`, then `BACKEND <backend|static>`: the one a run would use.
 *          Exit 0 when a backend is available, 1 when a run would be static only.
 *   exec   the command's own exit code. 124: the wall clock ran out and the run was stopped.
 *          125: nothing ran (static only, no such export, a layout the policy refuses, or a
 *          launcher that could not start). Every 124 and 125 says why on stderr; the command's own
 *          output is passed through unchanged.
 *
 * Usage errors are the parser's: exit 2 with the help, before anything is probed.
 */
const EXIT = { available: 0, staticOnly: 1, timedOut: 124, notRun: 125 } as const;

export type SandboxDeps = {
  readonly out: (s: string) => void;
  readonly err: (s: string) => void;
  readonly probe: () => Promise<BackendProbe>;
  readonly exec: (request: ExecRequest) => Promise<ExecOutcome>;
};

export async function runSandbox(
  intent: SandboxIntent,
  deps: SandboxDeps = defaultDeps(),
): Promise<number> {
  if (intent.sub === "probe") return probe(deps);
  try {
    return answer(await deps.exec(intent), deps);
  } catch (err) {
    return notRun(deps, err instanceof Error ? err.message : String(err));
  }
}

async function probe(deps: SandboxDeps): Promise<number> {
  const found = await deps.probe();
  const lines = assessBackends(found).map((s) =>
    "offered" in s ? `AVAILABLE ${s.kind}` : `UNAVAILABLE ${s.kind} ${terminalText(s.why)}`
  );
  const chosen = chooseBackend(found).kind;
  deps.out([...lines, `BACKEND ${chosen}`].join("\n"));
  return chosen === "static" ? EXIT.staticOnly : EXIT.available;
}

function answer(outcome: ExecOutcome, deps: SandboxDeps): number {
  if (outcome.kind === "not_run") return notRun(deps, outcome.why);
  if (outcome.outcome.kind === "exited") return outcome.outcome.code;
  const seconds = outcome.outcome.seconds;
  deps.err(red(`error: specnaut sandbox exec: the wall clock ran out after ${seconds} s`));
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
  const prober = new HostBackendProber(subprocess, { os, arch }, image);
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    probe: () => prober.probe(),
    exec: (request) => execInSandbox(execDeps(prober, checkout), request),
  };
}

/** The real host's folders and runners; bubblewrap is found on our PATH, as the probe found it. */
function execDeps(prober: HostBackendProber, checkout: () => Promise<string>): ExecDeps {
  const { os, arch } = Deno.build;
  const env = (name: string) => Deno.env.get(name);
  const path = env("PATH") ?? "/usr/bin:/bin";
  return {
    prober,
    host: new FsSandboxHost(exportCacheRoot(os, env), env("HOME") ?? "", checkout),
    runnerFor: (backend) => runnerFor(backend, new DenoProcessLauncher(), { arch, path }),
  };
}

/** The checkout the command runs from: the repository's top, or the folder itself outside one. */
async function checkoutRoot(subprocess: DenoSubprocessRunner): Promise<string> {
  const args = ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"];
  const top = await subprocess.run("git", args, { cwd: Deno.cwd() });
  return await Deno.realPath(top.code === 0 ? top.stdout.trim() : Deno.cwd());
}
