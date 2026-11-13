import { join } from "@std/path";
import type { SandboxRunner } from "../../src/application/sandbox_ports.ts";
import {
  assessBackends,
  type BackendStatus,
  type Engine,
  type SandboxedBackend,
  type SandboxPolicy,
  sandboxPolicy,
} from "../../src/domain/sandbox.ts";
import { userBus } from "../../src/domain/sandbox_args.ts";
import { isPinned } from "../../src/domain/sandbox_image.ts";
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
  new DenoSubprocessRunner({ wholeEnv: true }),
  host,
  () => Promise.resolve({ kind: "none", why: "not read here" }),
).probe();

/** The engine a live container test runs on: docker when its daemon answers, else podman. */
export const ENGINE: Engine | null = probed.docker
  ? "docker"
  : probed.podman !== "absent"
  ? "podman"
  : null;

/**
 * The image a live container test runs: a digest-pinned one already on the host (a run never
 * pulls) with `/bin/sh`, named by `SPECNAUT_LIVE_IMAGE`, as none can be assumed present.
 */
export const LIVE_IMAGE = Deno.env.get("SPECNAUT_LIVE_IMAGE") ?? "";

/** What a live container test lacks here, or `null`. */
export const NO_CONTAINER = ENGINE === null
  ? "podman or docker"
  : isPinned(LIVE_IMAGE)
  ? null
  : "a digest-pinned image with /bin/sh, named in SPECNAUT_LIVE_IMAGE";

/** Every backend in selection order, with what this host offers: a container uses LIVE_IMAGE. */
export const STATUSES = assessBackends({ ...probed, image: { kind: "pinned", ref: LIVE_IMAGE } });

/** Why the backend of `status` cannot run a live test here, or `null` when it can. */
export function skipOf(status: BackendStatus): string | null {
  if (!("offered" in status)) return `${status.kind}: ${status.why}`;
  return status.kind === "container" ? NO_CONTAINER : null;
}

/** The host facts a live runner is built with, read from this process. */
export const RUNNER_HOST = {
  arch: Deno.build.arch,
  path: Deno.env.get("PATH") ?? "",
  bus: userBus(Deno.env.get),
};

/** A live test's name: what it shows, then why it is skipped when `missing` names what is absent. */
export function live(title: string, missing: string | null): string {
  return missing === null ? title : `${title} (skipped: needs ${missing})`;
}

/** The variables `fn` runs under, restored after it whatever happens. */
export async function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const before = Object.keys(vars).map((k) => [k, Deno.env.get(k)] as const);
  for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
  try {
    await fn();
  } finally {
    for (const [k, v] of before) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
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

/** Perl makes the `setsid` call macOS has no command for. */
export const NO_PERL = exists("/usr/bin/perl") ? null : "perl at /usr/bin/perl";

/**
 * A shell line that prints `before`, then leaves behind `sleep <seconds>` in a session of its own,
 * out of the process group, holding the output open; the shell itself ends at once with 0.
 */
export function detaching(seconds: string): string {
  // The parent waits for the child to have left the group (its end of the pipe closes after
  // `setsid`), so the group's kill at the shell's end can never catch it first.
  const perl = "use POSIX; pipe(R, W); if (fork) { close W; <R>; exit } " +
    `close R; setsid(); close W; exec "sleep", "${seconds}"`;
  return `echo before; /usr/bin/perl -e '${perl}'`;
}

/** Kills every process whose command line starts with `marker`: what a test left behind. */
export function killNamed(marker: string): void {
  const ps = new Deno.Command("/bin/ps", { args: ["-axo", "pid=,command="] }).outputSync();
  for (const line of new TextDecoder().decode(ps.stdout).split("\n")) {
    const [, pid, cmd] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    if (cmd?.startsWith(marker)) Deno.kill(Number(pid), "SIGKILL");
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
