import { chooseBackend, type SandboxedBackend, sandboxPolicy } from "../domain/sandbox.ts";
import { capsWithout, type SandboxLimits } from "../domain/sandbox_limits.ts";
import type { SandboxPaths } from "../domain/sandbox_paths.ts";
import type {
  BackendProber,
  RunnableBackend,
  RunOutcome,
  SandboxHost,
  SandboxRunner,
} from "./sandbox_ports.ts";

/**
 * Runs one command on an export's scratch copy in a sandbox: the backend is the domain's choice
 * for what the host offers now, the policy the domain's for the host's folders, and the runner the
 * one for that backend. The toolchain is judged by the real folders it names, never by a link.
 * Nothing runs when the choice is static only or the layout is refused. The
 * scratch folder holding the sandbox's home and temp is removed after the run, whatever happened.
 */

export type ExecDeps = {
  readonly prober: BackendProber;
  readonly host: SandboxHost;
  readonly runnerFor: (backend: RunnableBackend) => SandboxRunner;
};

export type ExecRequest = {
  /** The commit whose export is run. */
  readonly sha: string;
  /** Read-only folders holding the command's tools, searched in order before the system's. */
  readonly toolchain: readonly string[];
  readonly command: readonly string[];
};

export type ExecOutcome =
  | {
    readonly kind: "ran";
    readonly backend: SandboxedBackend;
    readonly outcome: RunOutcome;
    /** The caps the run went without (`capsWithout`): reported, never a reason not to run. */
    readonly unenforced: readonly (keyof SandboxLimits)[];
  }
  | { readonly kind: "not_run"; readonly why: string };

export async function execInSandbox(deps: ExecDeps, request: ExecRequest): Promise<ExecOutcome> {
  // The export first: a commit never exported is refused before any engine is asked anything,
  // so the refusal is the same on every host and no probe leaves an engine's state behind.
  const folders = await deps.host.locate(request.sha);
  const backend = chooseBackend(await deps.prober.probe());
  if (backend.kind === "static") {
    return { kind: "not_run", why: `no backend: ${backend.why.join("; ")}` };
  }
  const toolchain = await deps.host.real(request.toolchain);
  const scratch = await deps.host.scratch();
  try {
    const paths = { ...folders, scratch: scratch.path, toolchain, path: toolchain };
    return await runUnder(deps, backend, paths, request.command);
  } finally {
    await scratch.remove();
  }
}

/** Runs `command` on `backend` under its policy over `paths`; nothing if the layout is refused. */
async function runUnder(
  deps: ExecDeps,
  backend: RunnableBackend,
  paths: SandboxPaths,
  command: readonly string[],
): Promise<ExecOutcome> {
  const result = sandboxPolicy(backend.kind, paths);
  if (!result.ok) return { kind: "not_run", why: result.why };
  const outcome = await deps.runnerFor(backend).run(result.policy, command);
  return { kind: "ran", backend: backend.kind, outcome, unenforced: capsWithout(backend) };
}
