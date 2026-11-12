import { join } from "@std/path";
import type { SandboxRunner } from "../../src/application/sandbox_ports.ts";
import {
  type SandboxedBackend,
  type SandboxPolicy,
  sandboxPolicy,
} from "../../src/domain/sandbox.ts";
import { DenoSubprocessRunner } from "../../src/infrastructure/deno_subprocess.ts";
import { FsSandboxHost } from "../../src/infrastructure/fs_sandbox_host.ts";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { HostBackendProber } from "../../src/infrastructure/sandbox_probe.ts";

/**
 * What the live sandbox tests share: the host's backends as the real probe finds them, a layout
 * to run in, and the real launcher with its output captured. A test whose backend is absent is
 * skipped, and its name says so. No command run through here touches the network.
 */

const host = { os: Deno.build.os, arch: Deno.build.arch };
export const probed = await new HostBackendProber(
  new DenoSubprocessRunner(),
  host,
  () => Promise.resolve({ kind: "none", why: "not read here" }),
).probe();

/** A live test's name: what it shows, then why it is skipped when `missing` names what is absent. */
export function live(title: string, missing: string | null): string {
  return missing === null ? title : `${title} (skipped: needs ${missing})`;
}

/** Whether `path` exists on this host. */
export function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/** Output captured from the launcher's pipes. */
export function capture() {
  const chunks: Uint8Array[] = [];
  const stream = new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) });
  const text = () => new TextDecoder().decode(new Uint8Array(chunks.flatMap((c) => [...c])));
  return { stream, text };
}

export type Run = { policy: SandboxPolicy; scratch: string; tree: string; home: string };

/** A tree holding one file, a scratch folder, and the policy of `backend` over them. */
export async function withLayout(backend: SandboxedBackend, fn: (run: Run) => Promise<void>) {
  const base = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-live-" }));
  const tree = join(base, "tree");
  await Deno.mkdir(tree);
  await Deno.writeTextFile(join(tree, "hello.txt"), "from the tree\n");
  const scratch = await new FsSandboxHost("/nowhere", "/", () => Promise.resolve("/")).scratch();
  const home = await Deno.realPath(Deno.env.get("HOME")!);
  try {
    const result = sandboxPolicy(backend, {
      tree,
      scratch: scratch.path,
      toolchain: [],
      path: [],
      home,
      checkout: join(base, "checkout"),
    });
    if (!result.ok) throw new Error(result.why);
    await fn({ policy: result.policy, scratch: scratch.path, tree, home });
  } finally {
    await scratch.remove();
    await Deno.remove(base, { recursive: true });
  }
}

export async function runIn(
  make: (l: DenoProcessLauncher) => SandboxRunner,
  policy: SandboxPolicy,
  cmd: string[],
) {
  const out = capture();
  const err = capture();
  const outcome = await make(new DenoProcessLauncher(out.stream, err.stream)).run(policy, cmd);
  return { outcome, out: out.text(), err: err.text() };
}

export function processesNamed(marker: string): string[] {
  const ps = new Deno.Command("/bin/ps", { args: ["-axo", "command"] }).outputSync();
  return new TextDecoder().decode(ps.stdout).split("\n").filter((l) => l.startsWith(marker));
}
