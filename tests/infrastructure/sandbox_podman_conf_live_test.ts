import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { containerEngine } from "../../src/domain/sandbox_container.ts";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import { engineEnv } from "../../src/infrastructure/sandbox_engine_env.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, LIVE_IMAGE, probed, runIn, withEnv, withLayout } from "./sandbox_live_fixture.ts";

/**
 * A podman whose containers.conf adds a variable, a volume, a mount and a device to every
 * container, each list marked `{append=true}` so a later file adds to it rather than replacing it,
 * and copies its client's environment into it (`env_host`), starts the sandbox's container with
 * none of them: the configuration it loads last is the CLI's, and it resets each list. The same
 * file sets a umask the CLI's leaves alone, and the run seeing it shows that file was read. A
 * remote podman client (macOS, Windows) applies its machine's containers.conf, not this one:
 * Linux only.
 */

const VARIABLE = "SPECNAUT_CONF_ENV=from-containers-conf";
const LEFT = "SPECNAUT_CONF_LEFT=from-the-host";
const VOLUME = "/specnaut-conf-volume";
const MOUNT = "/specnaut-conf-mount";
const DEVICE = "/dev/specnaut-conf-device";
const UMASK = "0027";

const MISSING = Deno.build.os !== "linux"
  ? "a local podman on Linux, as a remote client applies its machine's containers.conf"
  : containerEngine(probed) !== "podman"
  ? "a local rootless podman 4.8 or later, with seccomp and the pids, memory and cpu controllers"
  : isPinned(LIVE_IMAGE)
  ? null
  : "a digest-pinned image with /bin/sh, named in SPECNAUT_LIVE_IMAGE";

/** `entry` as a containers.conf list that every file loaded after it adds to. */
const appended = (entry: string) => `[${JSON.stringify(entry)}, {append=true}]`;

/** A containers.conf adding to every container what the sandbox's must start without. */
function containersConf(source: string): string {
  return [
    "[containers]",
    "env_host = true",
    `env = ${appended(VARIABLE)}`,
    `volumes = ${appended(`${source}:${VOLUME}:ro`)}`,
    `mounts = ${appended(`type=bind,source=${source},destination=${MOUNT},ro`)}`,
    `devices = ${appended(`/dev/null:${DEVICE}:rw`)}`,
    `umask = ${JSON.stringify(UMASK)}`,
    "",
  ].join("\n");
}

/** Prints a start marker, the umask, the environment, and which of the added paths exist. */
const SCRIPT = `echo start; umask; env; for p in ${VOLUME} ${MOUNT} ${DEVICE}; do ` +
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
          (l) => new ContainerRunner("podman", LIVE_IMAGE, l, { dropped: [], cpus: null }),
          policy,
          ["/bin/sh", "-c", SCRIPT],
        );
        // Only the run's own shell prints it: a run that never started proves nothing.
        assert(out.startsWith("start\n"), `the run never started: ${out.slice(0, 200)}`);
        const lines = out.split("\n");
        assert(lines.includes(UMASK), `the containers.conf was not read: ${out.slice(0, 200)}`);
        const added = [VARIABLE, LEFT, ...[VOLUME, MOUNT, DEVICE].map((p) => `present ${p}`)];
        assertEquals(lines.filter((l) => added.includes(l)), []);
      });
    }),
});

/**
 * A rootless podman adds to every container the folders the first mounts.conf it finds names,
 * the user's own (`$HOME/.config/containers/mounts.conf`) first. The sandbox's podman reads the
 * empty one beside the CLI's containers.conf instead, so the folder is not in its container; a
 * plain `podman run` under the same environment, which does see it, shows that file was read.
 */
const MOUNTED = "/specnaut-mounts-conf";
const LOOK = `echo start; if [ -e ${MOUNTED} ]; then echo present; fi`;

Deno.test({
  name: live("podman conf live: the container starts without what mounts.conf adds", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("container", async ({ policy }) => {
      const real = Deno.env.get("HOME")!;
      const home = await Deno.makeTempDir({ prefix: "specnaut-podman-home-" });
      try {
        const source = join(home, "mounted");
        await Deno.mkdir(source);
        await Deno.writeTextFile(join(source, "note"), "from mounts.conf\n");
        await Deno.mkdir(join(home, ".config", "containers"), { recursive: true });
        const conf = join(home, ".config", "containers", "mounts.conf");
        await Deno.writeTextFile(conf, `${source}:${MOUNTED}\n`);
        // Only the mounts.conf lookup follows HOME here: storage and configuration stay the user's.
        const vars = {
          HOME: home,
          XDG_CONFIG_HOME: Deno.env.get("XDG_CONFIG_HOME") ?? join(real, ".config"),
          XDG_DATA_HOME: Deno.env.get("XDG_DATA_HOME") ?? join(real, ".local", "share"),
        };
        await withEnv(vars, async () => {
          assertEquals(plainRun(), "start\npresent\n", "a plain run did not read mounts.conf");
          const { out } = await runIn(
            (l) => new ContainerRunner("podman", LIVE_IMAGE, l, { dropped: [], cpus: null }),
            policy,
            ["/bin/sh", "-c", LOOK],
          );
          assertEquals(out, "start\n");
        });
      } finally {
        await Deno.remove(home, { recursive: true });
      }
    }),
});

/** What {@link LOOK} prints in a plain podman run, under the engine environment a run gets. */
function plainRun(): string {
  const args = ["run", "--rm", "--pull", "never", "--network", "none", LIVE_IMAGE];
  const { stdout } = new Deno.Command("podman", {
    args: [...args, "/bin/sh", "-c", LOOK],
    env: engineEnv(Deno.env.toObject()),
    clearEnv: true,
    stderr: "inherit",
  }).outputSync();
  return new TextDecoder().decode(stdout);
}
