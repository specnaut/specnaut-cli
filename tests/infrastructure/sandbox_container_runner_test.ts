import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { podmanGlobals } from "../../src/infrastructure/sandbox_engine_env.ts";
import {
  DenoProcessLauncher,
  type ProcessLauncher,
} from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";
import { watchdogSpec } from "../../src/infrastructure/sandbox_watchdog.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { capture } from "./sandbox_live_fixture.ts";
import {
  COMMAND,
  fakeLauncher,
  IMAGE,
  type Launch,
  POSIX,
  withWallClock,
} from "./sandbox_runner_fixture.ts";

/**
 * The container runner: the engine launched with exactly the domain's `run` arguments under a
 * fresh name, and the container removed by that name when the wall clock runs out and whenever
 * the run ends, however it ends.
 */

/** A host environment: what the engine needs, beside what it must never be handed. */
const HOST_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/dev",
  CONTAINERS_CONF_OVERRIDE: "/home/dev/override.conf",
  DOCKER_HOST: "unix:///var/run/docker.sock",
  GITHUB_TOKEN: "ghp_example",
  SPECNAUT_CLOUD_TOKEN: "example",
};
const ENGINE_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/dev",
  DOCKER_HOST: "unix:///var/run/docker.sock",
};
/** A podman launch's environment: the engine's, with the override written for the run. */
const podmanEnv = (l: Launch) => ({ ...ENGINE_ENV, CONTAINERS_CONF_OVERRIDE: overrideOf(l) });
const overrideOf = (l: Launch) => l.spec.env === "host" ? "" : l.spec.env.CONTAINERS_CONF_OVERRIDE;

Deno.test("ContainerRunner: launches the engine with exactly containerArgs and its options, under a fresh name", async () => {
  const { launcher, launches } = fakeLauncher(3);
  const policy = policyOf("container");
  const runner = new ContainerRunner(
    "podman",
    IMAGE,
    launcher,
    [],
    () => "specnaut-sandbox-x1",
    () => HOST_ENV,
  );
  assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 3 });
  const run = { image: IMAGE, name: "specnaut-sandbox-x1", engine: "podman", dropped: [] } as const;
  assertEquals(launches[0].spec, {
    cmd: "podman",
    args: [
      ...podmanGlobals(dirname(overrideOf(launches[0]))),
      ...containerArgs(policy, run, COMMAND),
    ],
    env: podmanEnv(launches[0]),
  });
});

Deno.test("ContainerRunner: a watchdog beside the run removes the container past the clock and grace", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const policy = withWallClock(policyOf("container"), 60);
  const name = () => "specnaut-sandbox-x4";
  const runner = new ContainerRunner("docker", IMAGE, launcher, [], name, () => HOST_ENV);
  await runner.run(policy, COMMAND);
  const removal = ["docker", "rm", "--force", "specnaut-sandbox-x4"];
  const seconds = 60 + DRAIN_GRACE_SECONDS;
  assertEquals(launches[1].spec, watchdogSpec(launches[0].pid, seconds, removal, ENGINE_ENV));
  assertEquals(launches[1].stopped, 1);
});

/** The removals of a run's container, in launch order. */
const removals = (launches: Launch[]) => launches.filter((l) => l.spec.args[0] === "rm");

Deno.test("ContainerRunner: a run that ends on its own still has its container removed by name", async () => {
  const { launcher, launches } = fakeLauncher(0);
  await new ContainerRunner("docker", IMAGE, launcher, [], () => "specnaut-sandbox-x6").run(
    policyOf("container"),
    COMMAND,
  );
  // After the watchdog: a client that ended early has left a container behind it.
  assertEquals(launches.map((l) => l.spec.args[0]), ["run", "-c", "rm"]);
  assertEquals(removals(launches)[0].spec.args, ["rm", "--force", "specnaut-sandbox-x6"]);
});

Deno.test("ContainerRunner: a watchdog that cannot start leaves no container either", async () => {
  const { launcher, launches } = fakeLauncher(null);
  const failing: ProcessLauncher = {
    ...launcher,
    start: (spec) => {
      if (spec.cmd === "/bin/sh") throw new Error("no /bin/sh");
      return launcher.start(spec);
    },
  };
  const runner = new ContainerRunner("docker", IMAGE, failing, [], () => "specnaut-sandbox-x7");
  await assertRejects(() => runner.run(policyOf("container"), COMMAND), Error, "no /bin/sh");
  assertEquals(launches[0].stopped, 1);
  assertEquals(removals(launches).map((l) => l.spec.args), [
    ["rm", "--force", "specnaut-sandbox-x7"],
  ]);
});

Deno.test("ContainerRunner: a removal that fails at the timeout is named in the outcome", async () => {
  const { launcher } = fakeLauncher(null);
  const refusing: ProcessLauncher = {
    ...launcher,
    start: (spec) => {
      const started = launcher.start(spec);
      if (spec.args[0] !== "rm") return started;
      return { ...started, ended: Promise.resolve(1), exited: Promise.resolve(1) };
    },
  };
  const runner = new ContainerRunner("docker", IMAGE, refusing, [], () => "specnaut-sandbox-x5");
  const outcome = await runner.run(withWallClock(policyOf("container"), 0.01), COMMAND);
  assertEquals(outcome, {
    kind: "timed_out",
    seconds: 0.01,
    haltFailed: "docker rm --force specnaut-sandbox-x5 exited 1",
  });
});

Deno.test("ContainerRunner: each run gets a name of its own", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", IMAGE, launcher, []);
  await runner.run(policyOf("container"), COMMAND);
  await runner.run(policyOf("container"), COMMAND);
  const runs = launches.filter((l) => l.spec.args[0] === "run");
  const names = runs.map((l) => l.spec.args[l.spec.args.indexOf("--name") + 1]);
  assert(/^specnaut-sandbox-[0-9a-f]{16}$/.test(names[0]), names[0]);
  assert(names[0] !== names[1]);
});

Deno.test("ContainerRunner: only a digest-pinned image is ever launched", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", "acme/dev:latest", launcher, []);
  let refused = false;
  await runner.run(policyOf("container"), COMMAND).catch(() => (refused = true));
  assert(refused);
  assertEquals(launches, []);
});

Deno.test("ContainerRunner: past the wall clock the container is removed by name", async () => {
  const { launcher, launches } = fakeLauncher(null);
  const name = () => "specnaut-sandbox-x2";
  const runner = new ContainerRunner("podman", IMAGE, launcher, [], name, () => HOST_ENV);
  const outcome = await runner.run(withWallClock(policyOf("container"), 0.01), COMMAND);
  assertEquals(outcome, { kind: "timed_out", seconds: 0.01 });
  // `--ignore`: podman, unlike docker, fails on a container already gone, as a `--rm` one is.
  assertEquals(launches.find((l) => l.spec.args[0] === "rm")?.spec, {
    cmd: "podman",
    args: ["rm", "--force", "--ignore", "specnaut-sandbox-x2"],
    env: podmanEnv(launches[0]),
    stdout: "discarded",
    stderr: "captured",
  });
  assertEquals(launches[0].stopped, 1);
});

/** An engine that prints a line and hangs on `run`, and prints the name it removes on `rm`. */
const FAKE_ENGINE = `#!/bin/sh
if [ "$1" = --default-mounts-file ]; then shift 2; fi
case "$1" in
  run) echo "from the command"; exec sleep 30.137 ;;
  rm) echo "removed $3" ;;
esac
`;

Deno.test({
  name: "ContainerRunner: past the wall clock, stdout holds the command's output and nothing else",
  ignore: !POSIX,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "specnaut-engine-" });
    try {
      const engine = join(dir, "engine");
      await Deno.writeTextFile(engine, FAKE_ENGINE, { mode: 0o755 });
      const out = capture();
      const real = new DenoProcessLauncher(out.stream, capture().stream);
      const launcher: ProcessLauncher = {
        start: (spec) => real.start({ ...spec, cmd: engine }),
        runSync: (spec) => real.runSync({ ...spec, cmd: engine }),
      };
      const name = () => "specnaut-sandbox-x3";
      const runner = new ContainerRunner("podman", IMAGE, launcher, [], name);
      const outcome = await runner.run(withWallClock(policyOf("container"), 1), COMMAND);
      assertEquals(outcome, { kind: "timed_out", seconds: 1 });
      assertEquals(out.text(), "from the command\n");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
