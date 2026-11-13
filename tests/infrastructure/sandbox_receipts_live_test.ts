import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type SandboxedBackend, sandboxPolicy } from "../../src/domain/sandbox.ts";
import { FsSandboxHost } from "../../src/infrastructure/fs_sandbox_host.ts";
import { BwrapRunner } from "../../src/infrastructure/sandbox_bwrap_runner.ts";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { SeatbeltRunner } from "../../src/infrastructure/sandbox_seatbelt_runner.ts";
import { live, probed, runIn, withLayout } from "./sandbox_live_fixture.ts";

/**
 * A pipx venv read by a real sandbox: its `pyvenv.cfg` is read, its receipt, which can name an
 * index carrying a login, reads as nothing. The home is a stand-in made for the test. Each backend
 * is skipped where the host lacks it, saying so.
 */

const RUNNERS = {
  seatbelt: {
    missing: probed.sandboxExec ? null : "macOS with sandbox-exec",
    make: (l: DenoProcessLauncher) => new SeatbeltRunner(l),
  },
  bwrap: {
    missing: probed.bwrap === "usable" ? null : "Linux with a usable bubblewrap",
    make: (l: DenoProcessLauncher) => new BwrapRunner(Deno.build.arch, l, Deno.env.get("PATH")!),
  },
} as const;

/** A stand-in home holding one pipx venv: its `pyvenv.cfg` and its receipt, each one line. */
async function homeWithVenv(): Promise<{ home: string; venvs: string }> {
  const home = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-live-home-" }));
  const venvs = join(home, ".local/share/pipx/venvs");
  await Deno.mkdir(join(venvs, "ruff"), { recursive: true });
  await Deno.writeTextFile(join(venvs, "ruff/pyvenv.cfg"), "home = /usr/bin\n");
  await Deno.writeTextFile(join(venvs, "ruff/pipx_metadata.json"), "index-with-a-login\n");
  return { home, venvs };
}

for (const [backend, { missing, make }] of Object.entries(RUNNERS)) {
  Deno.test({
    name: live(`${backend} live: a venv is read, its receipt reads as nothing`, missing),
    ignore: missing !== null,
    fn: () =>
      withLayout(backend as SandboxedBackend, async ({ tree, scratch }) => {
        const { home, venvs } = await homeWithVenv();
        try {
          const receipts = await new FsSandboxHost("/nowhere", home, () => Promise.resolve("/"))
            .receipts(home);
          const checkout = join(home, "checkout");
          const layout = { tree, scratch, toolchain: [venvs], path: [], home, checkout, receipts };
          const result = sandboxPolicy(backend as SandboxedBackend, layout);
          if (!result.ok) throw new Error(result.why);
          const read = `cat ${venvs}/ruff/pyvenv.cfg; cat ${venvs}/ruff/pipx_metadata.json; true`;
          const { outcome, out } = await runIn(make, result.policy, ["/bin/sh", "-c", read]);
          assertEquals(outcome, { kind: "exited", code: 0 });
          assertEquals(out, "home = /usr/bin\n");
        } finally {
          await Deno.remove(home, { recursive: true });
        }
      }),
  });
}
