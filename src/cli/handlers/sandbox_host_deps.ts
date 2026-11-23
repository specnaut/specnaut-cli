import { execLockRefusal } from "../../application/review_guard.ts";
import {
  type ExecDeps,
  execInSandbox,
  type ExecOutcome,
  type ExecRequest,
} from "../../application/sandbox_exec.ts";
import type { BackendProber } from "../../application/sandbox_ports.ts";
import { userBus } from "../../domain/sandbox_bwrap_args.ts";
import { type CappedLog, openCappedLog } from "../../infrastructure/capped_log.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { baseTipOf } from "../../application/verify_scripts.ts";
import type { ImageSource } from "../../domain/sandbox_image.ts";
import { readDevcontainerImage } from "../../infrastructure/devcontainer_image.ts";
import { GitObjects } from "../../infrastructure/git_object_reader.ts";
import { filterGitPath, treeTop } from "../../infrastructure/git_path.ts";
import { decode } from "../../infrastructure/git_text.ts";
import { GitRefused, type GitResult, UntrustedGit } from "../../infrastructure/untrusted_git.ts";
import { FsSandboxHost } from "../../infrastructure/fs_sandbox_host.ts";
import { FsReviewLock, realLogPath } from "../../infrastructure/fs_review_lock.ts";
import { exportCacheRoot } from "../../infrastructure/fs_tree_export.ts";
import { DenoProcessLauncher } from "../../infrastructure/sandbox_process.ts";
import { HostBackendProber } from "../../infrastructure/sandbox_probe.ts";
import { runnerFor } from "../../infrastructure/sandbox_runners.ts";
import type { SandboxDeps } from "./sandbox_handler.ts";

/** `specnaut sandbox` on the real host: its engines, its folders, the checkout's review lock. */
export function sandboxHostDeps(): SandboxDeps {
  const checkout = () => checkoutRoot(Deno.cwd());
  const { os, arch } = Deno.build;
  const image = () => baseImage(Deno.cwd());
  // The engines are asked with the environment a run gives them, and nothing of ours beside it,
  // and found, as every program started by name is, on the PATH the run finds them on.
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
 * tree's devcontainer, which the branch under review can edit. The repository is the one git
 * names from `cwd`, read from its top: in a submodule, the submodule's own base, not the
 * superproject's that `checkoutRoot` widens to. Outside a repository there is no base, so no image.
 */
export async function baseImage(cwd: string): Promise<ImageSource> {
  let git: GitObjects;
  try {
    git = await GitObjects.open(await gitTop(cwd) ?? cwd);
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

/**
 * The PATH the sandbox's engines are found on by a run: ours, kept to the entries outside the tree
 * the binary runs in (`filterGitPath`), the ones the probe's runner keeps (`DenoSubprocessRunner`).
 * An entry in the checkout would supply the engine meant to isolate it, and a run that searched
 * another PATH than the probe could start an engine the probe never saw.
 */
export function enginePath(): string {
  return filterGitPath(Deno.env.get("PATH") ?? "", Deno.cwd()).kept;
}

/** The real host's folders and runners; each engine is found on `enginePath`, as the probe was. */
export function execDeps(
  prober: BackendProber,
  checkout: () => Promise<string>,
  log: CappedLog | null,
): ExecDeps {
  const { os, arch } = Deno.build;
  const env = (name: string) => Deno.env.get(name);
  const path = enginePath();
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

/**
 * The checkout `cwd` is in, at `treeTop`'s width: from a submodule or a linked work tree inside
 * another, the superproject's top, not the folder holding the `.git` file. The sandbox keeps every
 * folder of the checkout out of sight, so the wider folder is the one that fails safe, and the two
 * paths below answer with the same one. The repository's top is asked of the hardened git
 * (`gitTop`), so the checkout's own folders cannot supply the git that answers, then widened by
 * `treeTop`. When git gives no answer, because it failed or was refused before it ran (no PATH entry
 * outside the tree, a grafts file), `treeTop` is asked from `cwd` itself; outside a repository,
 * that is `cwd`.
 */
export async function checkoutRoot(cwd: string): Promise<string> {
  return treeTop(await gitTop(cwd) ?? cwd);
}

/**
 * The top of the repository `cwd` is in as the hardened git names it: the nearest folder holding a
 * `.git`, a submodule's own. Undefined when git gives no answer.
 */
async function gitTop(cwd: string): Promise<string | undefined> {
  let top: GitResult | undefined;
  try {
    top = await new UntrustedGit(cwd).call("rev-parse", ["--show-toplevel"]);
  } catch (err) {
    if (!(err instanceof GitRefused)) throw err;
  }
  const answer = top?.code === 0 ? decode(top.stdout).trim() : "";
  return answer === "" ? undefined : answer;
}
