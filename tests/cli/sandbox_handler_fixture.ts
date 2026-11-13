import type { ExecOutcome } from "../../src/application/sandbox_exec.ts";
import type { SandboxDeps } from "../../src/cli/handlers/sandbox_handler.ts";
import type { SandboxIntent } from "../../src/cli/intent.ts";
import type { BackendProbe, SandboxedBackend } from "../../src/domain/sandbox.ts";
import { CAP_ENFORCEMENT, CAP_NAMES, type SandboxLimits } from "../../src/domain/sandbox_limits.ts";

/** What the `specnaut sandbox` handler tests share: a macOS host, recorded output, the table. */

export const SHA = "a".repeat(40);
export const MAC: BackendProbe = {
  os: "darwin",
  arch: "aarch64",
  image: { kind: "none", why: "no devcontainer" },
  podman: "absent",
  podmanRemote: false,
  podmanVersion: null,
  podmanSeccomp: true,
  podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
  podmanCpus: null,
  podmanPlatform: { arch: "aarch64", kernel: "6.10.14-linuxkit" },
  docker: false,
  dockerOnPodman: false,
  dockerSeccomp: true,
  dockerLimits: { memory: true, swap: true, pids: true, cpuQuota: true },
  dockerCpus: null,
  dockerPlatform: { arch: "aarch64", kernel: "6.10.14-linuxkit" },
  bwrap: "absent",
  bwrapVersion: null,
  bwrapScope: false,
  sandboxExec: true,
};

export function deps(
  probe: BackendProbe,
  exec: () => Promise<ExecOutcome>,
  lockRefusal: string | null = null,
) {
  const out: string[] = [];
  const err: string[] = [];
  const d: SandboxDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    probe: () => Promise.resolve(probe),
    realLog: (path) => Promise.resolve(path),
    exec: () => exec(),
    lockRefusal: () => Promise.resolve(lockRefusal),
  };
  return { d, out, err };
}

export const EXEC: SandboxIntent = {
  kind: "sandbox",
  sub: "exec",
  sha: SHA,
  toolchain: [],
  command: ["make"],
  log: null,
};
export const PROBE: SandboxIntent = { kind: "sandbox", sub: "probe" };

/**
 * The caps the table says `backend` runs without, read from the table itself: those it enforces
 * nowhere, and those only a user scope enforces when it runs without one.
 */
export function capsWithout(backend: SandboxedBackend, scope = false): (keyof SandboxLimits)[] {
  const by = CAP_ENFORCEMENT[backend];
  return (Object.keys(by) as (keyof SandboxLimits)[])
    .filter((cap) => by[cap] === "unenforced" || (by[cap] === "scope" && !scope));
}

/** The UNCAPPED line the table calls for, if any. */
export function uncapped(backend: SandboxedBackend, scope = false): string[] {
  const caps = capsWithout(backend, scope);
  return caps.length === 0
    ? []
    : [`UNCAPPED ${backend} ${caps.map((c) => CAP_NAMES[c]).join(",")}`];
}

export const ran = (backend: SandboxedBackend): Extract<ExecOutcome, { kind: "ran" }> => ({
  kind: "ran",
  backend,
  outcome: { kind: "exited", code: 0 },
  unenforced: capsWithout(backend),
});
