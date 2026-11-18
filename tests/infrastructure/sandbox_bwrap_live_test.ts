import { assertEquals } from "@std/assert";
import { userBus } from "../../src/domain/sandbox_bwrap_args.ts";
import { SYSCALL_NUMBERS } from "../../src/domain/sandbox_syscalls.ts";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { BwrapRunner } from "../../src/infrastructure/sandbox_bwrap_runner.ts";
import { exists, live, probed, runIn, withLayout } from "./sandbox_live_fixture.ts";

/** Bubblewrap on a real Linux host that runs it, through the real launcher; skipped elsewhere. */

const MISSING = probed.bwrap === "usable" ? null : "Linux with a usable bubblewrap";
/** The calls below are made from python3: a shell has no way to make an arbitrary syscall. */
const PYTHON = "/usr/bin/python3";
const NO_PYTHON = MISSING ?? (exists(PYTHON) ? null : `${PYTHON} inside the sandbox`);

const linux = (l: DenoProcessLauncher) =>
  new BwrapRunner(Deno.build.arch, l, Deno.env.get("PATH")!);

Deno.test({
  name: live(
    "bwrap live: the tree is read-only, writes go to a tmpfs the host never sees",
    MISSING,
  ),
  ignore: MISSING !== null,
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
  name: live("bwrap live: a call the syscall filter denies fails with EPERM inside", NO_PYTHON),
  ignore: NO_PYTHON !== null,
  fn: () =>
    withLayout("bwrap", async ({ policy }) => {
      const arch = Deno.build.arch as "x86_64" | "aarch64";
      // keyctl(KEYCTL_GET_KEYRING_ID, KEY_SPEC_SESSION_KEYRING, 0): answered outside the filter.
      const py = "import ctypes; c = ctypes.CDLL(None, use_errno=True); " +
        `r = c.syscall(${SYSCALL_NUMBERS[arch].keyctl}, 0, -3, 0); print(r, ctypes.get_errno())`;
      const { outcome, out } = await runIn(linux, policy, [PYTHON, "-c", py]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out.trim(), "-1 1");
    }),
});

Deno.test({
  name: live("bwrap live: open_tree_attr fails with EPERM inside, on any kernel", NO_PYTHON),
  ignore: NO_PYTHON !== null,
  fn: () =>
    withLayout("bwrap", async ({ policy }) => {
      // open_tree_attr(AT_FDCWD, ".", 0, NULL, 0): an fd on a kernel that has it, ENOSYS on one
      // that does not; EPERM only from the filter.
      const nr = SYSCALL_NUMBERS[Deno.build.arch as "x86_64" | "aarch64"].open_tree_attr;
      const py = "import ctypes; c = ctypes.CDLL(None, use_errno=True); " +
        `r = c.syscall(${nr}, -100, b".", 0, None, 0); print(r, ctypes.get_errno())`;
      const { outcome, out } = await runIn(linux, policy, [PYTHON, "-c", py]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out.trim(), "-1 1");
    }),
});

Deno.test({
  name: live("bwrap live: a vsock socket is refused inside, a unix socket is not", NO_PYTHON),
  ignore: NO_PYTHON !== null,
  fn: () =>
    withLayout("bwrap", async ({ policy }) => {
      const py = "import socket\n" +
        "for family in (socket.AF_UNIX, socket.AF_VSOCK):\n" +
        "    try:\n        socket.socket(family, socket.SOCK_STREAM).close(); print('opened')\n" +
        "    except OSError as e:\n        print(e.errno)\n";
      const { outcome, out } = await runIn(linux, policy, [PYTHON, "-c", py]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out.trim().split("\n"), ["opened", "1"]);
    }),
});

Deno.test({
  name: live("bwrap live: personality takes the persona values inside, no other flag", NO_PYTHON),
  ignore: NO_PYTHON !== null,
  fn: () =>
    withLayout("bwrap", async ({ policy }) => {
      // EPERM is the filter's refusal; anything else is the kernel's answer (arm64 without 32-bit
      // support refuses PER_LINUX32 with EINVAL). The query and no-ASLR are refused, the persona
      // values pass, and 0 last puts PER_LINUX back.
      const py = "import ctypes; c = ctypes.CDLL(None, use_errno=True)\n" +
        "for v in (0x40000, 0xffffffff, 8, 0x20000, 0x20008, 0):\n" +
        "    r = c.personality(ctypes.c_ulong(v))\n" +
        "    print('refused' if r == -1 and ctypes.get_errno() == 1 else 'passed')\n";
      const { outcome, out } = await runIn(linux, policy, [PYTHON, "-c", py]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out.trim().split("\n"), [
        ...["refused", "refused"],
        ...["passed", "passed", "passed", "passed"],
      ]);
    }),
});

const NO_SCOPE = MISSING ??
  (probed.bwrapScope ? null : "a systemd user scope with cgroups delegated");

Deno.test({
  name: live("bwrap live: in a user scope, the memory cap stops a run that exceeds it", NO_SCOPE),
  ignore: NO_SCOPE !== null,
  fn: () =>
    withLayout("bwrap", async ({ policy }) => {
      const small = { ...policy, limits: { ...policy.limits, memoryBytes: 64 * 1024 ** 2 } };
      const bus = userBus((name) => Deno.env.get(name));
      const scoped = (l: DenoProcessLauncher) =>
        new BwrapRunner(Deno.build.arch, l, Deno.env.get("PATH")!, true, bus);
      // 256 MiB held in one shell variable: four times the cap. The marker says the allocation
      // began; the cap's kill (SIGKILL) leaves 137. A run that failed any other way has neither.
      const script =
        "echo allocating; x=$(head -c 268435456 /dev/zero | tr '\\0' a); echo survived";
      const { outcome, out } = await runIn(scoped, small, ["/bin/sh", "-c", script]);
      assertEquals(outcome, { kind: "exited", code: 137 });
      assertEquals(out, "allocating\n");
    }),
});
