import { type SandboxedBackend, sandboxPolicy } from "../../src/domain/sandbox.ts";
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
