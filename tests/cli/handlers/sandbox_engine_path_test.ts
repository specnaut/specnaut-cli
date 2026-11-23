import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  enginePath,
  execDeps,
  sandboxHostDeps,
} from "../../../src/cli/handlers/sandbox_host_deps.ts";
import { BwrapRunner } from "../../../src/infrastructure/sandbox_bwrap_runner.ts";
import { ContainerRunner } from "../../../src/infrastructure/sandbox_runners.ts";
import { plantGit, ran, withPath } from "../../helpers/planted_git.ts";

/**
 * The sandbox's engines are found where every program the binary starts by name is: on the PATH
 * entries outside the tree it runs in. The checkout here is a folder under the working folder,
 * whose `bin` holds an engine of each name, first on the PATH: the probe starts none of them, and
 * the run is handed the PATH the probe searched and the engine's file on it, the one the probe found.
 */

const ENGINES = ["podman", "docker", "bwrap", "systemd-run", "git"];
const POSIX_ONLY = Deno.build.os === "windows";

/** `fn` given a planted `bin` under the working folder, first on the PATH, then a folder outside. */
async function inCheckout(fn: (outside: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".planted-engine-" });
  const outside = await Deno.makeTempDir({ prefix: "planted-engine-outside-" });
  const fired = join(outside, "fired");
  try {
    for (const name of ENGINES) await plantGit(join(dir, "bin"), fired, name);
    await withPath([join(dir, "bin"), outside], () => fn(outside));
    assertEquals(await ran(fired), false, "a planted engine ran");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
}

Deno.test({
  name: "the sandbox probe starts no engine the checkout holds",
  ignore: POSIX_ONLY,
  fn: () => inCheckout(async () => void await sandboxHostDeps().probe()),
});

Deno.test({
  name: "the sandbox run is handed the PATH the probe searched and the engine's file outside",
  ignore: POSIX_ONLY,
  fn: () =>
    inCheckout(async (outside) => {
      for (const name of ["podman", "bwrap"]) await plantGit(outside, join(outside, "x"), name);
      assertEquals(enginePath(), outside);
      const prober = { probe: () => Promise.reject(new Error("not asked")) };
      const deps = execDeps(prober, () => Promise.resolve(outside), null);
      const bwrap = deps.runnerFor({ kind: "bwrap", scope: false }) as BwrapRunner;
      assertEquals([bwrap.path, bwrap.bwrap], [outside, join(outside, "bwrap")]);
      const backend = { engine: "podman", image: "x", dropped: [], cpus: null } as const;
      const container = deps.runnerFor({ kind: "container", ...backend }) as ContainerRunner;
      assertEquals([container.hostEnv().PATH, container.program], [
        outside,
        join(outside, "podman"),
      ]);
    }),
});
