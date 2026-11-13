import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, LIVE_IMAGE, probed, runIn, withEnv, withLayout } from "./sandbox_live_fixture.ts";

/**
 * A podman whose containers.conf adds a variable, a volume and a mount to every container, and
 * copies its client's environment into it (`env_host`), starts the sandbox's container with none
 * of them: the configuration it loads last is the CLI's. The same file sets a umask the CLI's
 * leaves alone, and the run seeing it shows that file was read. A remote podman client (macOS,
 * Windows) applies its machine's containers.conf, not this one: Linux only.
 */

const VARIABLE = "SPECNAUT_CONF_ENV=from-containers-conf";
const LEFT = "SPECNAUT_CONF_LEFT=from-the-host";
const VOLUME = "/specnaut-conf-volume";
const MOUNT = "/specnaut-conf-mount";
const UMASK = "0027";

const MISSING = Deno.build.os !== "linux"
  ? "a local podman on Linux, as a remote client applies its machine's containers.conf"
  : probed.podman !== "rootless" || !probed.podmanCgroups
  ? "a rootless podman holding the pids, memory and cpu controllers, the podman a run is offered"
  : isPinned(LIVE_IMAGE)
  ? null
  : "a digest-pinned image with /bin/sh, named in SPECNAUT_LIVE_IMAGE";

/** A containers.conf adding to every container what the sandbox's must start without. */
function containersConf(source: string): string {
  return [
    "[containers]",
    "env_host = true",
    `env = [${JSON.stringify(VARIABLE)}]`,
    `volumes = [${JSON.stringify(`${source}:${VOLUME}:ro`)}]`,
    `mounts = [${JSON.stringify(`type=bind,source=${source},destination=${MOUNT},ro`)}]`,
    `umask = ${JSON.stringify(UMASK)}`,
    "",
  ].join("\n");
}

/** Prints a start marker, the umask, the environment, and which of the two paths exist. */
const SCRIPT = `echo start; umask; env; for p in ${VOLUME} ${MOUNT}; do ` +
  `if [ -e "$p" ]; then echo "present $p"; fi; done`;

Deno.test({
  name: live("podman conf live: the container starts without what containers.conf adds", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("container", async ({ policy, scratch, tree }) => {
      const conf = join(scratch, "containers.conf");
      await Deno.writeTextFile(conf, containersConf(tree));
      const [name, value] = LEFT.split("=");
      await withEnv({ [name]: value, CONTAINERS_CONF: conf }, async () => {
        const { out } = await runIn(
          (l) => new ContainerRunner("podman", LIVE_IMAGE, l),
          policy,
          ["/bin/sh", "-c", SCRIPT],
        );
        // Only the run's own shell prints it: a run that never started proves nothing.
        assert(out.startsWith("start\n"), `the run never started: ${out.slice(0, 200)}`);
        const lines = out.split("\n");
        assert(lines.includes(UMASK), `the containers.conf was not read: ${out.slice(0, 200)}`);
        const added = [VARIABLE, LEFT, `present ${VOLUME}`, `present ${MOUNT}`];
        assertEquals(lines.filter((l) => added.includes(l)), []);
      });
    }),
});
