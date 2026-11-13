import { execLockRefusal } from "../../application/review_guard.ts";
import {
  type ExecDeps,
  execInSandbox,
  type ExecOutcome,
  type ExecRequest,
} from "../../application/sandbox_exec.ts";
import { userBus } from "../../domain/sandbox_args.ts";
import { type CappedLog, openCappedLog } from "../../infrastructure/capped_log.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { baseTipOf } from "../../application/verify_scripts.ts";
import type { ImageSource } from "../../domain/sandbox_image.ts";
import { readDevcontainerImage } from "../../infrastructure/devcontainer_image.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { GitRefused } from "../../infrastructure/untrusted_git.ts";
import { FsSandboxHost } from "../../infrastructure/fs_sandbox_host.ts";
import { FsReviewLock, realLogPath } from "../../infrastructure/fs_review_lock.ts";
import { exportCacheRoot } from "../../infrastructure/fs_tree_export.ts";
import { DenoProcessLauncher } from "../../infrastructure/sandbox_process.ts";
import { HostBackendProber } from "../../infrastructure/sandbox_probe.ts";
import { runnerFor } from "../../infrastructure/sandbox_runners.ts";
import type { SandboxDeps } from "./sandbox_handler.ts";

/** `specnaut sandbox` on the real host: its engines, its folders, the checkout's review lock. */
export function sandboxHostDeps(): SandboxDeps {
  const subprocess = new DenoSubprocessRunner();
  const checkout = () => checkoutRoot(subprocess);
  const { os, arch } = Deno.build;
  const image = async () => baseImage(await checkout());
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
    realLog: realLogPath,
    lockRefusal: sessionLockRefusal,
    exec: (request) => execWithLog(prober, checkout, request),
  };
}

/**
 * The image the base branch's tip pins, as `verify-scripts` resolves that tip: never the work
 * tree's devcontainer, which the branch under review can edit. Outside a repository there is no
 * base, so no image.
 */
export async function baseImage(checkout: string): Promise<ImageSource> {
  let git: GitObjects;
  try {
    git = await GitObjects.open(checkout);
  } catch (err) {
    if (!(err instanceof GitRefused)) throw err;
    return { kind: "none", why: `no base to read the devcontainer from: ${err.message}` };
  }
  return await readDevcontainerImage(git, await baseTipOf(git));
}

/**
 * Why the review lock refuses `request`, judged for the session the run is started from: Claude
 * Code sets it in its shell's environment.
 */
async function sessionLockRefusal(
  request: Parameters<typeof execLockRefusal>[1],
): Promise<string | null> {
  const session = Deno.env.get("CLAUDE_CODE_SESSION_ID") ?? null;
  return await execLockRefusal(await FsReviewLock.open(Deno.cwd()), request, session);
}

/** The run of `request`, its output to the `--log` file when it names one, closed after. */
async function execWithLog(
  prober: HostBackendProber,
  checkout: () => Promise<string>,
  request: ExecRequest & { readonly log: string | null },
): Promise<ExecOutcome> {
  const log = request.log === null ? null : await openCappedLog(request.log);
  try {
    return await execInSandbox(execDeps(prober, checkout, log), request);
  } finally {
    await log?.close();
  }
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
