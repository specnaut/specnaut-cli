import { assertEquals, assertRejects } from "@std/assert";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import {
  COMMAND,
  fakeLauncher,
  IMAGE,
  type Launch,
  NO_DROPS,
  withWallClock,
} from "./sandbox_runner_fixture.ts";

/** A container run's container is removed by name however the run ends, the watchdog's way too. */

/** The removals of a run's container, in launch order. */
const removals = (launches: Launch[]) => launches.filter((l) => l.spec.args[0] === "rm");

Deno.test("ContainerRunner: a run that ends on its own still has its container removed by name", async () => {
  const { launcher, launches } = fakeLauncher(0);
  await new ContainerRunner("docker", IMAGE, launcher, NO_DROPS, () => "specnaut-sandbox-x6").run(
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
  const runner = new ContainerRunner(
    "docker",
    IMAGE,
    failing,
    NO_DROPS,
    () => "specnaut-sandbox-x7",
  );
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
  const runner = new ContainerRunner(
    "docker",
    IMAGE,
    refusing,
    NO_DROPS,
    () => "specnaut-sandbox-x5",
  );
  const outcome = await runner.run(withWallClock(policyOf("container"), 0.01), COMMAND);
  assertEquals(outcome, {
    kind: "timed_out",
    seconds: 0.01,
    haltFailed: "docker rm --force specnaut-sandbox-x5 exited 1",
  });
});
