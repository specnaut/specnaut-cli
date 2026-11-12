import type { SubprocessRunner } from "../application/ports.ts";
import type { BackendProber } from "../application/sandbox_ports.ts";
import type { BackendProbe } from "../domain/sandbox.ts";
import type { ImageSource } from "../domain/sandbox_image.ts";

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
type Bwrap = Pick<BackendProbe, "bwrap" | "bwrapVersion">;
const NO_PODMAN: Podman = { podman: "absent", podmanCgroups: false };
const NO_BWRAP: Bwrap = { bwrap: "absent", bwrapVersion: null };

export class HostBackendProber implements BackendProber {
  constructor(
    readonly runner: SubprocessRunner,
    readonly host: HostFacts,
    readonly image: () => Promise<ImageSource>,
  ) {}

  async probe(): Promise<BackendProbe> {
    const { os, arch } = this.host;
    if (os === "windows") {
      const image: ImageSource = { kind: "none", why: "no sandbox on Windows" };
      return { os, arch, image, ...NO_PODMAN, docker: false, ...NO_BWRAP, sandboxExec: false };
    }
    const [image, podman, docker, bwrap, sandboxExec] = await Promise.all([
      this.image(),
      this.#podman(),
      this.#docker(),
      os === "linux" ? this.#bwrap() : NO_BWRAP,
      os === "darwin" && this.#sandboxExec(),
    ]);
    return { os, arch, image, ...podman, docker, ...bwrap, sandboxExec };
  }

  /** Podman's own report: whether it runs as the user, and which cgroup controllers it holds. */
  async #podman(): Promise<Podman> {
    const { code, stdout } = await this.runner.run("podman", ["info", "--format", "json"]);
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

  async #docker(): Promise<boolean> {
    const { code, stdout } = await this.runner.run("docker", [
      "info",
      "--format",
      "{{.ServerVersion}}",
    ]);
    return code === 0 && stdout.trim() !== "";
  }

  async #bwrap(): Promise<Bwrap> {
    const version = await this.runner.run("bwrap", ["--version"]);
    if (version.code !== 0) return NO_BWRAP;
    const bwrapVersion = version.stdout.trim() || null;
    const trial = await this.runner.run("bwrap", BWRAP_TRIAL);
    if (trial.code === 0) return { bwrap: "usable", bwrapVersion };
    const restricted = USERNS_REFUSED.test(trial.stderr);
    return { bwrap: restricted ? "userns_restricted" : "trial_failed", bwrapVersion };
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
