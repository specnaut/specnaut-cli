import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import {
  DenoProcessLauncher,
  type ProcessLauncher,
} from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { capture } from "./sandbox_live_fixture.ts";
import { COMMAND, fakeLauncher, IMAGE, POSIX, withWallClock } from "./sandbox_runner_fixture.ts";

/**
 * The container runner: the engine launched with exactly the domain's `run` arguments under a
 * fresh name, and the container removed by that name when the wall clock runs out.
 */

Deno.test("ContainerRunner: launches the engine with exactly containerArgs, under a fresh name", async () => {
  const { launcher, launches } = fakeLauncher(3);
  const policy = policyOf("container");
  const runner = new ContainerRunner("podman", IMAGE, launcher, () => "specnaut-sandbox-x1");
  assertEquals(await runner.run(policy, COMMAND), { kind: "exited", code: 3 });
  assertEquals(launches.map((l) => l.spec), [{
    cmd: "podman",
    args: containerArgs(policy, { image: IMAGE, name: "specnaut-sandbox-x1" }, COMMAND),
    env: "host",
  }]);
});

Deno.test("ContainerRunner: each run gets a name of its own", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", IMAGE, launcher);
  await runner.run(policyOf("container"), COMMAND);
  await runner.run(policyOf("container"), COMMAND);
  const names = launches.map((l) => l.spec.args[l.spec.args.indexOf("--name") + 1]);
  assert(/^specnaut-sandbox-[0-9a-f]{16}$/.test(names[0]), names[0]);
  assert(names[0] !== names[1]);
});

Deno.test("ContainerRunner: only a digest-pinned image is ever launched", async () => {
  const { launcher, launches } = fakeLauncher(0);
  const runner = new ContainerRunner("docker", "acme/dev:latest", launcher);
  let refused = false;
  await runner.run(policyOf("container"), COMMAND).catch(() => (refused = true));
  assert(refused);
  assertEquals(launches, []);
});

Deno.test("ContainerRunner: past the wall clock the container is removed by name", async () => {
  const { launcher, launches } = fakeLauncher(null);
  const runner = new ContainerRunner("podman", IMAGE, launcher, () => "specnaut-sandbox-x2");
  const outcome = await runner.run(withWallClock(policyOf("container"), 0.01), COMMAND);
  assertEquals(outcome, { kind: "timed_out", seconds: 0.01 });
  assertEquals(launches[1].spec, {
    cmd: "podman",
    args: ["rm", "--force", "specnaut-sandbox-x2"],
    env: "host",
    stdout: "discarded",
  });
  assertEquals(launches[0].stopped, 1);
});

/** An engine that prints a line and hangs on `run`, and prints the name it removes on `rm`. */
const FAKE_ENGINE = `#!/bin/sh
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
      const runner = new ContainerRunner("podman", IMAGE, launcher, () => "specnaut-sandbox-x3");
      const outcome = await runner.run(withWallClock(policyOf("container"), 1), COMMAND);
      assertEquals(outcome, { kind: "timed_out", seconds: 1 });
      assertEquals(out.text(), "from the command\n");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
