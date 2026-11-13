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
};

export const SCRATCH_HOME = `${PATHS.scratch}/home`;
export const SCRATCH_TMP = `${PATHS.scratch}/tmp`;

/** The policy for `backend`, failing the test when the layout is refused. */
export function policyOf(backend: SandboxedBackend, paths: SandboxPaths = PATHS) {
  const result = sandboxPolicy(backend, paths);
  if (!result.ok) throw new Error(result.why);
  return result.policy;
}

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
  podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
  podmanCpus: null,
  docker: false,
  dockerOnPodman: false,
  dockerLimits: { memory: true, swap: true, pids: true, cpuQuota: true },
  dockerCpus: null,
  bwrap: "usable",
  bwrapVersion: "bubblewrap 0.9.0",
  bwrapScope: false,
  sandboxExec: false,
};
