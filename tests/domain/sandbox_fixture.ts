import {
  type BackendProbe,
  type SandboxedBackend,
  sandboxPolicy,
} from "../../src/domain/sandbox.ts";
import type { SandboxPaths } from "../../src/domain/sandbox_paths.ts";

/** A host layout for the sandbox tests: the export and scratch sit in a cache under the home. */
export const PATHS: SandboxPaths = {
  tree: "/home/dev/.cache/specnaut/sandbox/abc/tree",
  scratch: "/home/dev/.cache/specnaut/sandbox/abc/scratch",
  toolchain: ["/home/dev/.deno/bin"],
  path: ["/home/dev/.deno/bin"],
  home: "/home/dev",
  checkout: "/home/dev/src/my-app",
  receipts: [],
};

export const SCRATCH_HOME = `${PATHS.scratch}/home`;
export const SCRATCH_TMP = `${PATHS.scratch}/tmp`;

/** The policy for `backend`, failing the test when the layout is refused. */
export function policyOf(backend: SandboxedBackend, paths: SandboxPaths = PATHS) {
  const result = sandboxPolicy(backend, paths);
  if (!result.ok) throw new Error(result.why);
  return result.policy;
}

/** Where a container run's syscall profile is written, as `engineRunEnv` would name it. */
export const SECCOMP = "/tmp/specnaut-engine-x1/seccomp.json";

/** A docker run of `image` named `name`: no cap dropped, CPUs unknown, its profile {@link SECCOMP}. */
export const runOf = (image: string, name: string) =>
  ({ image, name, engine: "docker", dropped: [], cpus: null, seccomp: SECCOMP }) as const;

/** Each value that follows `flag`, in order. */
export function after(args: readonly string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
}

/** Every proxy variable an engine would copy into a container from the host, by name. */
export const PROXY_NAMES = ["HTTP", "HTTPS", "FTP", "NO", "ALL"]
  .flatMap((p) => [`${p}_PROXY`, `${p.toLowerCase()}_proxy`]);

/** A Linux host where bubblewrap runs, without a scope, and no container: no image, no engine. */
export const LINUX_BWRAP: BackendProbe = {
  os: "linux",
  arch: "x86_64",
  image: { kind: "none", why: "no devcontainer" },
  podman: "absent",
  podmanRemote: false,
  podmanVersion: null,
  podmanSeccomp: true,
  podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
  podmanCpus: null,
  podmanPlatform: { arch: "x86_64", kernel: "6.8.0" },
  docker: false,
  dockerOnPodman: false,
  dockerSeccomp: true,
  dockerLimits: { memory: true, swap: true, pids: true, cpuQuota: true },
  dockerCpus: null,
  dockerPlatform: { arch: "x86_64", kernel: "6.8.0" },
  bwrap: "usable",
  bwrapVersion: "bubblewrap 0.9.0",
  bwrapScope: false,
  sandboxExec: false,
};
