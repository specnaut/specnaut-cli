import type { SubprocessRunner } from "../application/ports.ts";
import type { BackendProber } from "../application/sandbox_ports.ts";
import type { BackendProbe } from "../domain/sandbox.ts";
import type { ImageSource } from "../domain/sandbox_image.ts";
import { engineEnv } from "./sandbox_engine_env.ts";

/**
 * What the host offers a sandbox, asked of the tools themselves. Each answer is a fact the domain
 * judges (`chooseBackend`); nothing here decides which backend runs. A tool is asked only on an OS
 * where the domain could use it, and nothing is asked on Windows, which is always static only.
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

type Podman = Pick<BackendProbe, "podman" | "podmanCgroups">;
type Docker = Pick<BackendProbe, "docker" | "dockerLimits">;
type Bwrap = Pick<BackendProbe, "bwrap" | "bwrapVersion" | "bwrapScope">;
const NO_PODMAN: Podman = { podman: "absent", podmanCgroups: false };
const NO_DOCKER: Docker = {
  docker: false,
  dockerLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
};
const NO_BWRAP: Bwrap = { bwrap: "absent", bwrapVersion: null, bwrapScope: false };

/**
 * A trial user scope: the shell inside it prints the controllers its own cgroup (cgroup v2, the
 * one `0::` line) can use, which are the ones a scope's limits act through. It sets a limit through
 * each, as a run's scope does: systemd enables a controller in a scope only when the scope asks for
 * it, so a scope with no limit sees memory and pids but never cpu.
 */
const SCOPE_TRIAL = [
  ...["--user", "--scope", "--quiet", "--collect"],
  ...["-p", "MemoryMax=1G", "-p", "TasksMax=64", "-p", "CPUQuota=100%"],
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
    const [image, podman, docker, bwrap, sandboxExec] = await Promise.all([
      this.image(),
      this.#podman(),
      this.#docker(),
      os === "linux" ? this.#bwrap() : NO_BWRAP,
      os === "darwin" && this.#sandboxExec(),
    ]);
    return { os, arch, image, ...podman, ...docker, ...bwrap, sandboxExec };
  }

  /** Podman's own report: whether it runs as the user, and which cgroup controllers it holds. */
  async #podman(): Promise<Podman> {
    const args = ["info", "--format", "json"];
    const { code, stdout } = await this.runner.run("podman", args, { env: this.engineVars() });
    if (code !== 0) return NO_PODMAN;
    const host = parsed(stdout, "podman info")?.host;
    if (host === undefined) return NO_PODMAN;
    const controllers: unknown = host?.cgroupControllers;
    const delegated = Array.isArray(controllers) &&
      NEEDED_CONTROLLERS.every((c) => controllers.includes(c));
    return {
      podman: host?.security?.rootless === true ? "rootless" : "root",
      podmanCgroups: host?.cgroupVersion === "v2" && delegated,
    };
  }

  /**
   * Docker's own report: whether its daemon answers with a version, and which limits it can apply
   * on its host. A limit it does not say it can (false, or left out) counts as one it cannot.
   */
  async #docker(): Promise<Docker> {
    const args = ["info", "--format", "{{json .}}"];
    const { code, stdout } = await this.runner.run("docker", args, { env: this.engineVars() });
    if (code !== 0) return NO_DOCKER;
    const info = parsed(stdout, "docker info");
    if (typeof info?.ServerVersion !== "string" || info.ServerVersion === "") return NO_DOCKER;
    const can = (flag: string) => info[flag] === true;
    return {
      docker: true,
      dockerLimits: {
        memory: can("MemoryLimit"),
        swap: can("SwapLimit"),
        pids: can("PidsLimit"),
        cpuQuota: can("CpuCfsQuota"),
      },
    };
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

/** `stdout` as JSON, or `undefined` with a warning: a tool that answers garbled is not used. */
// deno-lint-ignore no-explicit-any
function parsed(stdout: string, what: string): any {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    console.error(
      `warning: ${what} did not print JSON, so it is not used: ${(err as Error).message}`,
    );
    return undefined;
  }
}
