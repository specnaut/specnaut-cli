import { assertEquals } from "@std/assert";
import { SYSCALL_NUMBERS } from "../../src/domain/sandbox_seccomp.ts";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { BwrapRunner } from "../../src/infrastructure/sandbox_runners.ts";
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
