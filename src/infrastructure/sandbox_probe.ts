import type { SubprocessRunner } from "../application/ports.ts";
import type { BackendProber } from "../application/sandbox_ports.ts";
import type { BackendProbe } from "../domain/sandbox.ts";
import type { ImageSource } from "../domain/sandbox_image.ts";
import { engineEnv } from "./sandbox_engine_env.ts";
import { NO_DOCKER, NO_PODMAN, probeDocker, probePodman } from "./sandbox_probe_engines.ts";

/**
 * What the host offers a sandbox, asked of the tools themselves. Each answer is a fact the domain
 * judges (`chooseBackend`); nothing here decides which backend runs. A tool is asked only on an OS
 * where the domain could use it, and nothing is asked on Windows, which is always static only.
 * Podman's and docker's own reports are `sandbox_probe_engines.ts`'s.
 */

export type HostFacts = { readonly os: string; readonly arch: string };

/** A trial bubblewrap run, without `--disable-userns`, so an old version still answers. */
const BWRAP_TRIAL = [
  ...["--unshare-all", "--unshare-user", "--die-with-parent", "--ro-bind", "/", "/"],
  ...["--", "/bin/true"],
];
/** What bubblewrap prints when the kernel or a security module refuses it a user namespace. */
const USERNS_REFUSED = /namespace|uid map|Permission denied|Operation not permitted/i;
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const NEEDED_CONTROLLERS = ["pids", "memory", "cpu"];

type Bwrap = Pick<BackendProbe, "bwrap" | "bwrapVersion" | "bwrapScope">;
const NO_BWRAP: Bwrap = { bwrap: "absent", bwrapVersion: null, bwrapScope: false };

/**
 * A trial user scope: the shell inside it prints the controllers its own cgroup (cgroup v2, the
 * one `0::` line) can use, which are the ones a scope's limits act through. It sets a limit through
 * each, as a run's scope does: systemd enables a controller in a scope only when the scope asks for
 * it, so a scope with no limit sees memory and pids but never cpu. It sets the OOM policy a run
 * sets too, so a systemd too old to know it reads as no scope rather than failing every run.
 */
const SCOPE_TRIAL = [
  ...["--user", "--scope", "--quiet", "--collect"],
  ...["-p", "MemoryMax=1G", "-p", "TasksMax=64", "-p", "CPUQuota=100%", "-p", "OOMPolicy=continue"],
  ...["/bin/sh", "-c"],
  'read -r line < /proc/self/cgroup; cat "/sys/fs/cgroup${line#0::}/cgroup.controllers"',
];

export class HostBackendProber implements BackendProber {
  constructor(
    readonly runner: SubprocessRunner,
    readonly host: HostFacts,
    readonly image: () => Promise<ImageSource>,
    /** The environment podman and docker are asked in: the one a run starts them with. */
    readonly engineVars: () => Record<string, string> = () => engineEnv(Deno.env.toObject()),
  ) {}

  async probe(): Promise<BackendProbe> {
    const { os, arch } = this.host;
    if (os === "windows") {
      const image: ImageSource = { kind: "none", why: "no sandbox on Windows" };
      return { os, arch, image, ...NO_PODMAN, ...NO_DOCKER, ...NO_BWRAP, sandboxExec: false };
    }
    const engines = { runner: this.runner, env: this.engineVars() };
    const [image, podman, docker, bwrap, sandboxExec] = await Promise.all([
      this.image(),
      probePodman(engines),
      probeDocker(engines),
      os === "linux" ? this.#bwrap() : NO_BWRAP,
      os === "darwin" && this.#sandboxExec(),
    ]);
    return { os, arch, image, ...podman, ...docker, ...bwrap, sandboxExec };
  }

  async #bwrap(): Promise<Bwrap> {
    const version = await this.runner.run("bwrap", ["--version"]);
    if (version.code !== 0) return NO_BWRAP;
    const bwrapVersion = version.stdout.trim() || null;
    const trial = await this.runner.run("bwrap", BWRAP_TRIAL);
    if (trial.code === 0) return { bwrap: "usable", bwrapVersion, bwrapScope: await this.#scope() };
    const restricted = USERNS_REFUSED.test(trial.stderr);
    const bwrap = restricted ? "userns_restricted" : "trial_failed";
    return { bwrap, bwrapVersion, bwrapScope: false };
  }

  /** Whether a systemd user scope can be made with pids, memory and cpu delegated to it. */
  async #scope(): Promise<boolean> {
    const { code, stdout } = await this.runner.run("systemd-run", SCOPE_TRIAL);
    const controllers = stdout.trim().split(/\s+/);
    return code === 0 && NEEDED_CONTROLLERS.every((c) => controllers.includes(c));
  }

  async #sandboxExec(): Promise<boolean> {
    const args = ["-p", "(version 1)(allow default)", "--", "/usr/bin/true"];
    return (await this.runner.run(SANDBOX_EXEC, args)).code === 0;
  }
}
