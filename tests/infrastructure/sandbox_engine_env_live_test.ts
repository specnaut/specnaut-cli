import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, LIVE_IMAGE, probed, runIn, withEnv, withLayout } from "./sandbox_live_fixture.ts";

/**
 * A podman configured to copy its own environment into every container (`env_host = true`)
 * copies only what its client was started with. A variable of ours outside `engineEnv` is set,
 * and so is one inside it; the run sees the second, which shows the setting was in force, and
 * never the first. A remote podman client (macOS, Windows) has no `env_host`: Linux only.
 */

const KEPT = "DOCKER_CERT_PATH=/specnaut-engine-env-kept";
const LEFT = "SPECNAUT_ENGINE_ENV_LEFT=from-the-host";

const MISSING = Deno.build.os !== "linux"
  ? "a local podman on Linux, as a remote client has no env_host"
  : probed.podman === "absent"
  ? "podman"
  : isPinned(LIVE_IMAGE)
  ? null
  : "a digest-pinned image with /bin/sh, named in SPECNAUT_LIVE_IMAGE";

Deno.test({
  name: live("engine env live: podman's env_host copies only the engine's variables", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("container", async ({ policy, scratch }) => {
      const conf = join(scratch, "env-host.conf");
      await Deno.writeTextFile(conf, "[containers]\nenv_host = true\n");
      const vars = Object.fromEntries([KEPT, LEFT].map((v) => v.split("=")));
      await withEnv({ ...vars, CONTAINERS_CONF_OVERRIDE: conf }, async () => {
        const { out } = await runIn(
          (l) => new ContainerRunner("podman", LIVE_IMAGE, l),
          policy,
          ["/bin/sh", "-c", "echo start; env"],
        );
        // Only the run's own shell prints it: a run that never started proves nothing.
        assert(out.startsWith("start\n"), `the run never started: ${out.slice(0, 200)}`);
        const lines = out.split("\n");
        assert(lines.includes(KEPT), "env_host was not in force: the kept variable is missing");
        assertEquals(lines.filter((l) => l === LEFT), []);
      });
    }),
});
