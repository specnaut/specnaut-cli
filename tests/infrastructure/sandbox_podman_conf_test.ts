import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { parse } from "@std/toml";
import { HOOKS, MOUNTS, podmanOverride } from "../../src/infrastructure/sandbox_engine_env.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { exists } from "./sandbox_live_fixture.ts";
import { COMMAND, fakeLauncher, IMAGE, withWallClock } from "./sandbox_runner_fixture.ts";

/**
 * A podman run starts from a CLI-owned configuration: its client, its removal and its watchdog are
 * handed, as `CONTAINERS_CONF_OVERRIDE`, a file written for the run, which podman loads after every
 * other containers.conf. The user's own override is never the one handed; docker, which reads no
 * containers.conf, is handed none.
 */

const USER_OVERRIDE = "/home/dev/.config/containers/override.conf";
const HOST_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/dev",
  CONTAINERS_CONF_OVERRIDE: USER_OVERRIDE,
};

/** What a launch was handed: the override's path and text, and what its folder held. */
type Handed = {
  path: string | undefined;
  text: string | null;
  hooks: string[] | null;
  mounts: string | null;
};

/** A fake launcher that also records, at each launch, the override it is handed and its folder. */
function reading(code: number | null = 0) {
  const fake = fakeLauncher(code);
  const handed: Handed[] = [];
  const launcher: ProcessLauncher = {
    start(spec) {
      const path = spec.env === "host" ? undefined : spec.env.CONTAINERS_CONF_OVERRIDE;
      handed.push(path !== undefined && exists(path) ? folderOf(path) : NOTHING(path));
      return fake.launcher.start(spec);
    },
    runSync: fake.launcher.runSync,
  };
  return { ...fake, launcher, handed };
}

const NOTHING = (path: string | undefined): Handed => ({
  path,
  text: null,
  hooks: null,
  mounts: null,
});

/** The override at `path`, and the hooks folder's entries and mounts.conf beside it. */
function folderOf(path: string): Handed {
  const dir = dirname(path);
  const hooks = [...Deno.readDirSync(join(dir, HOOKS))].map((e) => e.name);
  return { path, text: read(path), hooks, mounts: read(join(dir, MOUNTS)) };
}

const read = (path: string) => Deno.readTextFileSync(path);

const runner = (engine: "podman" | "docker", launcher: ProcessLauncher) =>
  new ContainerRunner(
    engine,
    IMAGE,
    launcher,
    { dropped: [], cpus: null },
    () => "specnaut-sandbox-c1",
    () => HOST_ENV,
  );

/** A list reset to nothing, whatever an earlier containers.conf appended to it. */
const RESET = [{ append: false }];

const DIR = "/tmp/specnaut-podman-x1";

Deno.test("podman conf: the override turns env_host off and resets each list a containers.conf adds to", () => {
  assertEquals(parse(podmanOverride(DIR)), {
    containers: {
      env_host: false,
      env: RESET,
      volumes: RESET,
      mounts: RESET,
      devices: RESET,
      annotations: RESET,
      pidns: "private",
      ipcns: "private",
      utsns: "private",
      cgroupns: "private",
    },
    engine: { hooks_dir: [`${DIR}/${HOOKS}`, { append: false }] },
  });
});

Deno.test("podman conf: every launch of a run is handed the CLI's override, never the user's", async () => {
  const { launcher, launches, handed } = reading(0);
  await runner("podman", launcher).run(policyOf("container"), COMMAND);
  assert(launches.length >= 3, "the run, its watchdog and its removal");
  const path = handed[0].path;
  assert(path !== undefined, "the run's client was handed no override");
  assertNotEquals(path, USER_OVERRIDE);
  const text = podmanOverride(dirname(path));
  assertEquals(handed, launches.map(() => ({ path, text, hooks: [], mounts: "" })));
});

Deno.test("podman conf: the run's podman reads the empty mounts.conf beside the override", async () => {
  const { launcher, launches, handed } = reading(0);
  await runner("podman", launcher).run(policyOf("container"), COMMAND);
  const mounts = join(dirname(handed[0].path!), MOUNTS);
  assertEquals(launches[0].spec.args.slice(0, 3), ["--default-mounts-file", mounts, "run"]);
  assertEquals(handed[0].mounts, "");
  const docker = reading(0);
  await runner("docker", docker.launcher).run(policyOf("container"), COMMAND);
  assertEquals(docker.launches[0].spec.args[0], "run");
});

Deno.test("podman conf: the override's folder is removed once the run is over, however it ends", async () => {
  for (const code of [0, null]) {
    const { launcher, handed } = reading(code);
    const policy = withWallClock(policyOf("container"), 0.01);
    await runner("podman", launcher).run(policy, COMMAND);
    const path = handed[0].path!;
    assertEquals(exists(path), false, `left behind after a run ending with ${code}`);
    assertEquals(exists(dirname(path)), false);
  }
});

Deno.test("podman conf: docker, which reads no containers.conf, is handed no override", async () => {
  const { launcher, handed } = reading(0);
  await runner("docker", launcher).run(policyOf("container"), COMMAND);
  assertEquals(handed.map((h) => h.path), handed.map(() => undefined));
});
