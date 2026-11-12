import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { SandboxRunner } from "../../src/application/sandbox_ports.ts";
import {
  type SandboxedBackend,
  type SandboxPolicy,
  sandboxPolicy,
} from "../../src/domain/sandbox.ts";
import { SYSCALL_NUMBERS } from "../../src/domain/sandbox_seccomp.ts";
import { DenoSubprocessRunner } from "../../src/infrastructure/deno_subprocess.ts";
import { FsSandboxHost } from "../../src/infrastructure/fs_sandbox_host.ts";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { HostBackendProber } from "../../src/infrastructure/sandbox_probe.ts";
import { BwrapRunner, SeatbeltRunner } from "../../src/infrastructure/sandbox_runners.ts";

/**
 * The runners on a real host, with the real launcher: `sandbox-exec` on macOS, bubblewrap on a
 * Linux host where it runs. A test whose backend is absent is skipped, and its name says so. No
 * command here touches the network.
 */

const host = { os: Deno.build.os, arch: Deno.build.arch };
const probed = await new HostBackendProber(
  new DenoSubprocessRunner(),
  host,
  () => Promise.resolve({ kind: "none", why: "not read here" }),
).probe();
const seatbelt = probed.sandboxExec;
const bwrap = probed.bwrap === "usable";
const NEEDS_MAC = " (skipped: needs macOS with sandbox-exec)";
const NEEDS_BWRAP = " (skipped: needs Linux with a usable bubblewrap)";

/** Output captured from the launcher's pipes. */
function capture() {
  const chunks: Uint8Array[] = [];
  const stream = new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) });
  const text = () => new TextDecoder().decode(new Uint8Array(chunks.flatMap((c) => [...c])));
  return { stream, text };
}

type Run = { policy: SandboxPolicy; scratch: string; tree: string; home: string };

/** A tree holding one file, a scratch folder, and the policy of `backend` over them. */
async function withLayout(backend: SandboxedBackend, fn: (run: Run) => Promise<void>) {
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

async function runIn(
  make: (l: DenoProcessLauncher) => SandboxRunner,
  policy: SandboxPolicy,
  cmd: string[],
) {
  const out = capture();
  const err = capture();
  const outcome = await make(new DenoProcessLauncher(out.stream, err.stream)).run(policy, cmd);
  return { outcome, out: out.text(), err: err.text() };
}

function processesNamed(marker: string): string[] {
  const ps = new Deno.Command("/bin/ps", { args: ["-axo", "command"] }).outputSync();
  return new TextDecoder().decode(ps.stdout).split("\n").filter((l) => l.startsWith(marker));
}

const mac = (l: DenoProcessLauncher) => new SeatbeltRunner(l);

Deno.test({
  name: `seatbelt live: the command's exit code is the run's${seatbelt ? "" : NEEDS_MAC}`,
  ignore: !seatbelt,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const { outcome } = await runIn(mac, policy, ["/bin/sh", "-c", "exit 7"]);
      assertEquals(outcome, { kind: "exited", code: 7 });
    }),
});

Deno.test({
  name: `seatbelt live: the tree is read, never written; home and temp are ${
    seatbelt ? "" : NEEDS_MAC
  }`,
  ignore: !seatbelt,
  fn: () =>
    withLayout("seatbelt", async ({ policy, tree }) => {
      const script = "cat hello.txt; touch planted 2>/dev/null && echo TREE-WRITTEN; " +
        'echo h > "$HOME/f" && echo t > "$TMPDIR/f" && cat "$HOME/f" "$TMPDIR/f"';
      const { outcome, out } = await runIn(mac, policy, ["/bin/sh", "-c", script]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out, "from the tree\nh\nt\n");
      assertEquals([...Deno.readDirSync(tree)].map((e) => e.name), ["hello.txt"]);
    }),
});

Deno.test({
  name: `seatbelt live: the environment is exactly the policy's${seatbelt ? "" : NEEDS_MAC}`,
  ignore: !seatbelt,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const { out } = await runIn(mac, policy, ["/usr/bin/env"]);
      const expected = Object.entries(policy.env).map(([k, v]) => `${k}=${v}`).sort();
      assertEquals(out.trim().split("\n").sort(), expected);
    }),
});

Deno.test({
  name: `seatbelt live: the user's home stays out of reach${seatbelt ? "" : NEEDS_MAC}`,
  ignore: !seatbelt,
  fn: () =>
    withLayout("seatbelt", async ({ policy, home }) => {
      const { outcome } = await runIn(mac, policy, ["/bin/ls", home]);
      assert(outcome.kind === "exited" && outcome.code !== 0, JSON.stringify(outcome));
    }),
});

Deno.test({
  name: `seatbelt live: what the command leaves running is stopped with it ${
    seatbelt ? "" : NEEDS_MAC
  }`,
  ignore: !seatbelt,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const marker = "sleep 31.731";
      const started = Date.now();
      const { outcome } = await runIn(mac, policy, ["/bin/sh", "-c", `(${marker} &); exit 0`]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      // Killed, not waited for: the sleep holds the output pipe, so waiting would take its 31 s.
      assert(Date.now() - started < 10_000, `the run took ${Date.now() - started} ms`);
      assertEquals(processesNamed(marker), []);
    }),
});

Deno.test({
  name: `seatbelt live: the wall clock stops the run and its children${seatbelt ? "" : NEEDS_MAC}`,
  ignore: !seatbelt,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const marker = "sleep 32.417";
      const timed = { ...policy, limits: { ...policy.limits, wallClockSeconds: 0.5 } };
      const { outcome } = await runIn(mac, timed, ["/bin/sh", "-c", `${marker} & ${marker}`]);
      assertEquals(outcome, { kind: "timed_out", seconds: 0.5 });
      assertEquals(processesNamed(marker), []);
    }),
});

const linux = (l: DenoProcessLauncher) =>
  new BwrapRunner(Deno.build.arch, l, Deno.env.get("PATH")!);

Deno.test({
  name: `bwrap live: the tree is read-only, writes go to a tmpfs the host never sees ${
    bwrap ? "" : NEEDS_BWRAP
  }`,
  ignore: !bwrap,
  fn: () =>
    withLayout("bwrap", async ({ policy, tree, scratch }) => {
      const script = "cat hello.txt; touch planted 2>/dev/null && echo TREE-WRITTEN; " +
        'echo h > "$HOME/f" && cat "$HOME/f"';
      const { outcome, out } = await runIn(linux, policy, ["/bin/sh", "-c", script]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out, "from the tree\nh\n");
      assertEquals([...Deno.readDirSync(tree)].map((e) => e.name), ["hello.txt"]);
      assertEquals([...Deno.readDirSync(scratch)], []);
    }),
});

Deno.test({
  name: `bwrap live: a call the syscall filter denies fails with EPERM inside ${
    bwrap ? "" : NEEDS_BWRAP
  }`,
  ignore: !bwrap,
  fn: () =>
    withLayout("bwrap", async ({ policy }) => {
      const arch = Deno.build.arch as "x86_64" | "aarch64";
      // keyctl(KEYCTL_GET_KEYRING_ID, KEY_SPEC_SESSION_KEYRING, 0): answered outside the filter.
      const py = "import ctypes; c = ctypes.CDLL(None, use_errno=True); " +
        `r = c.syscall(${SYSCALL_NUMBERS[arch].keyctl}, 0, -3, 0); print(r, ctypes.get_errno())`;
      const { outcome, out } = await runIn(linux, policy, ["/usr/bin/python3", "-c", py]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out.trim(), "-1 1");
    }),
});
